//! Filesystem helpers shared by the app (and later the CLI).

use std::fs;
use std::io::ErrorKind as IoKind;
use std::path::{Path, PathBuf};

use walkdir::WalkDir;

use crate::error::{CrabError, ErrorKind};

const SKIP_DIRS: &[&str] = &[".git", ".hg", ".svn", "node_modules", "target", "dist", "build", "bin", "obj", ".idea", ".vs", ".vscode"];
const MAX_DEPTH: usize = 12;

fn io_err(action: &str, path: &Path, e: impl std::fmt::Display) -> CrabError {
    CrabError::new(ErrorKind::Io, format!("{action} {}: {e}", path.display()))
}

/// All `.http`/`.rest` files under `root`, as `/`-separated paths relative to it.
pub fn find_http_files(root: &Path) -> Result<Vec<String>, CrabError> {
    if !root.is_dir() {
        return Err(CrabError::new(ErrorKind::Io, format!("Folder not found: {}", root.display())));
    }
    let mut files: Vec<String> = WalkDir::new(root)
        .max_depth(MAX_DEPTH)
        .into_iter()
        .filter_entry(|e| {
            e.depth() == 0 || !(e.file_type().is_dir() && SKIP_DIRS.contains(&e.file_name().to_string_lossy().as_ref()))
        })
        .filter_map(Result::ok)
        .filter(|e| e.file_type().is_file() && is_http_file(e.path()))
        .filter_map(|e| e.path().strip_prefix(root).ok().map(|p| p.to_string_lossy().replace('\\', "/")))
        .collect();
    files.sort_by_key(|f| f.to_lowercase());
    Ok(files)
}

pub fn is_http_file(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("http") || e.eq_ignore_ascii_case("rest"))
}

pub fn read_text(path: &Path) -> Result<String, CrabError> {
    let bytes = fs::read(path).map_err(|e| io_err("Cannot read", path, e))?;
    String::from_utf8(bytes).map_err(|_| CrabError::new(ErrorKind::Io, format!("{} is not valid UTF-8 text", path.display())))
}

/// Write to a sibling temp file, then rename over the target so a crash never leaves a half-written file.
pub fn write_atomic(path: &Path, contents: &[u8]) -> Result<(), CrabError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| io_err("Cannot create folder", parent, e))?;
    }
    let mut tmp_name = path.file_name().map(|n| n.to_os_string()).unwrap_or_default();
    tmp_name.push(".crab-tmp");
    let tmp = path.with_file_name(tmp_name);
    fs::write(&tmp, contents).map_err(|e| io_err("Cannot write", &tmp, e))?;
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        io_err("Cannot replace", path, e)
    })
}

/// `None` when the file is missing; a corrupt file is moved aside to `<name>.corrupt` and also yields `None`.
pub fn load_json(path: &Path) -> Result<Option<serde_json::Value>, CrabError> {
    let text = match fs::read_to_string(path) {
        Ok(t) => t,
        Err(e) if e.kind() == IoKind::NotFound => return Ok(None),
        Err(e) => return Err(io_err("Cannot read", path, e)),
    };
    match serde_json::from_str(&text) {
        Ok(v) => Ok(Some(v)),
        Err(_) => {
            let mut corrupt = path.as_os_str().to_os_string();
            corrupt.push(".corrupt");
            let _ = fs::rename(path, PathBuf::from(corrupt));
            Ok(None)
        }
    }
}
