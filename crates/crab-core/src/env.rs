//! Environments: `crab.env.json` / `http-client.env.json`, their `.private.env.json` counterparts and
//! `.env`, found in the `.http` file's folder or the nearest folder above it, up to the workspace root.

use std::collections::{BTreeSet, HashMap};
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::Value;
use walkdir::WalkDir;

use crate::error::{CrabError, ErrorKind};
use crate::files::{read_text, MAX_DEPTH, SKIP_DIRS};
use crate::vars::{EnvProvider, EnvValue};

/// Accepted names, preferred first: Crab's short name, then the JetBrains HTTP Client name.
pub const PUBLIC_FILES: [&str; 2] = ["crab.env.json", "http-client.env.json"];
pub const PRIVATE_FILES: [&str; 2] = ["crab.private.env.json", "http-client.private.env.json"];
pub const DOTENV_FILE: &str = ".env";
const SHARED: &str = "$shared";

/// environment name -> variable -> value
type EnvJson = HashMap<String, HashMap<String, String>>;

#[derive(Debug, Default)]
pub struct EnvFiles {
    public: EnvJson,
    private: EnvJson,
    dotenv: HashMap<String, String>,
}

impl EnvFiles {
    /// Load the nearest env files for `http_file`, never looking above `root`.
    pub fn discover(http_file: &Path, root: Option<&Path>) -> Result<Self, CrabError> {
        let dirs = search_dirs(http_file, root);
        let public = nearest(&dirs, &PUBLIC_FILES).map(|p| load_env_json(&p)).transpose()?;
        let private = nearest(&dirs, &PRIVATE_FILES).map(|p| load_env_json(&p)).transpose()?;
        let dotenv = nearest(&dirs, &[DOTENV_FILE]).map(|p| read_text(&p).map(|t| parse_dotenv(&t))).transpose()?;
        Ok(Self { public: public.unwrap_or_default(), private: private.unwrap_or_default(), dotenv: dotenv.unwrap_or_default() })
    }

    /// Environment names from both JSON files, without `$shared`, sorted.
    pub fn names(&self) -> Vec<String> {
        let names: BTreeSet<&String> = self.public.keys().chain(self.private.keys()).filter(|n| *n != SHARED).collect();
        names.into_iter().cloned().collect()
    }
}

/// The file's folder and its ancestors up to `root`, or only the file's folder when it isn't under `root`.
fn search_dirs(http_file: &Path, root: Option<&Path>) -> Vec<PathBuf> {
    let Some(start) = http_file.parent() else { return Vec::new() };
    match root.filter(|r| start.starts_with(r)) {
        Some(root) => start.ancestors().take_while(|d| d.starts_with(root)).map(Path::to_path_buf).collect(),
        None => vec![start.to_path_buf()],
    }
}

/// The first existing file of `names` (in preference order) in the nearest folder that has one.
fn nearest(dirs: &[PathBuf], names: &[&str]) -> Option<PathBuf> {
    dirs.iter().find_map(|d| names.iter().map(|n| d.join(n)).find(|p| p.is_file()))
}

/// Parse an env JSON file. Values that are not strings, numbers or booleans (for example JetBrains
/// `"Security"` objects) are skipped, so the file stays usable.
fn load_env_json(path: &Path) -> Result<EnvJson, CrabError> {
    let err = |msg: String| CrabError::new(ErrorKind::Env, format!("{}: {msg}", path.display()));
    let text = read_text(path)?;
    let text = text.strip_prefix('\u{feff}').unwrap_or(&text);
    let Value::Object(envs) = serde_json::from_str(text).map_err(|e| err(e.to_string()))? else {
        return Err(err("expected a JSON object of environments".into()));
    };
    let mut out = EnvJson::new();
    for (env, vars) in envs {
        let Value::Object(vars) = vars else {
            return Err(err(format!("environment \"{env}\" must be an object")));
        };
        let values = vars
            .into_iter()
            .filter_map(|(key, v)| match v {
                Value::String(s) => Some((key, s)),
                Value::Number(n) => Some((key, n.to_string())),
                Value::Bool(b) => Some((key, b.to_string())),
                _ => None,
            })
            .collect();
        out.insert(env, values);
    }
    Ok(out)
}

/// `KEY=VALUE` lines. Supports `#` comments, `export `, single and double quotes (`\n` and `\"` inside
/// double quotes) and ` #` comments after unquoted values. Malformed lines are ignored.
pub fn parse_dotenv(text: &str) -> HashMap<String, String> {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let mut out = HashMap::new();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let line = line.strip_prefix("export ").unwrap_or(line);
        let Some((key, value)) = line.split_once('=') else { continue };
        let key = key.trim();
        if key.is_empty() || key.contains(char::is_whitespace) {
            continue;
        }
        out.insert(key.to_string(), dotenv_value(value.trim()));
    }
    out
}

fn dotenv_value(v: &str) -> String {
    if v.len() >= 2 && v.starts_with('"') && v.ends_with('"') {
        return v[1..v.len() - 1].replace("\\n", "\n").replace("\\\"", "\"");
    }
    if v.len() >= 2 && v.starts_with('\'') && v.ends_with('\'') {
        return v[1..v.len() - 1].to_string();
    }
    match v.find(" #") {
        Some(i) => v[..i].trim_end().to_string(),
        None => v.to_string(),
    }
}

/// What a workspace root's env files offer: environment names, and warnings about ignored files.
#[derive(Debug, Default, PartialEq, Eq, Serialize)]
pub struct EnvScan {
    pub names: Vec<String>,
    pub warnings: Vec<String>,
}

/// Scan every folder under `root` for env JSON files. In a folder with both naming styles only the
/// preferred file counts, as in `EnvFiles::discover`, and the other is reported. Unreadable files are
/// skipped; they report their error when a request runs.
pub fn scan_env_files(root: &Path) -> EnvScan {
    let dirs: BTreeSet<PathBuf> = WalkDir::new(root)
        .max_depth(MAX_DEPTH)
        .into_iter()
        .filter_entry(|e| e.depth() == 0 || !(e.file_type().is_dir() && SKIP_DIRS.contains(&e.file_name().to_string_lossy().as_ref())))
        .filter_map(Result::ok)
        .filter(|e| e.file_type().is_dir())
        .map(|e| e.into_path())
        .collect();
    let mut names = BTreeSet::new();
    let mut warnings = Vec::new();
    for dir in &dirs {
        for group in [&PUBLIC_FILES, &PRIVATE_FILES] {
            let present: Vec<&str> = group.iter().copied().filter(|n| dir.join(n).is_file()).collect();
            let Some(used) = present.first() else { continue };
            if let [_, ignored, ..] = present.as_slice() {
                warnings.push(format!("Both {used} and {ignored} in {}; using {used}", dir.display()));
            }
            if let Ok(envs) = load_env_json(&dir.join(used)) {
                names.extend(envs.into_keys().filter(|n| n != SHARED));
            }
        }
    }
    EnvScan { names: names.into_iter().collect(), warnings }
}

/// The selected environment over the discovered files.
pub struct FileEnv {
    name: Option<String>,
    files: EnvFiles,
}

impl FileEnv {
    pub fn new(name: Option<String>, files: EnvFiles) -> Self {
        Self { name, files }
    }
}

fn pick(json: &EnvJson, section: Option<&str>, key: &str) -> Option<String> {
    json.get(section?)?.get(key).cloned()
}

impl EnvProvider for FileEnv {
    fn get(&self, key: &str) -> Option<EnvValue> {
        let (f, env) = (&self.files, self.name.as_deref());
        pick(&f.private, env, key)
            .map(EnvValue::secret)
            .or_else(|| pick(&f.public, env, key).map(EnvValue::public))
            .or_else(|| pick(&f.private, Some(SHARED), key).map(EnvValue::secret))
            .or_else(|| pick(&f.public, Some(SHARED), key).map(EnvValue::public))
            .or_else(|| self.dotenv(key))
    }

    fn dotenv(&self, key: &str) -> Option<EnvValue> {
        self.files.dotenv.get(key).cloned().map(EnvValue::public)
    }

    fn env_name(&self) -> Option<&str> {
        self.name.as_deref()
    }
}
