# Environments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Select dev, staging or prod for the whole workspace. `{{variables}}` then resolve from JetBrains env files and `.env`. Each environment gets a colour, red environments ask before sending changes, and private values are masked in the UI.

**Architecture:**
- `crab-core` gains `env.rs`, which finds env files near the `.http` file and turns them into a `FileEnv` that implements the existing `EnvProvider` trait.
- The resolver records secret values so a masked copy of the request can be built.
- The Tauri commands pass the selected environment through, return the masked request, and keep the real request in memory for "Reveal".
- A small zustand store holds the selection, colours and the confirmation setting, saved in the workspace state. The status bar, a top colour bar, the ▶ markers and the Request tab show the environment.

**Tech Stack:** Rust (`crab-core`, `serde_json`, `walkdir`, `tempfile`, `wiremock`), Tauri v2, React 19, zustand 5, vitest, `@tauri-apps/plugin-dialog`.

**Spec:** `docs/superpowers/specs/2026-10-08-environments-design.md`

## Global Constraints
- Env file names, exactly: `http-client.env.json`, `http-client.private.env.json`, `.env`. The shared section key is `$shared`.
- Lookup order for `{{x}}`: file vars → `private[env]` → `public[env]` → `private["$shared"]` → `public["$shared"]` → `.env`. Only the private file's values are secret.
- Mask text: `••••••`. Only secrets of **4 or more characters** are masked.
- Danger name pattern: `/prod|production|live/i`. Methods that never ask for confirmation: `GET`, `HEAD`, `OPTIONS`, compared case-insensitively.
- Colours: `"none" | "green" | "blue" | "amber" | "red"`, mapped to `--ok`, `--redirect`, `--client-error` and `--server-error`.
- Crab-only settings (colours, `confirmDanger`, `selected`) are saved in Crab's workspace state, never in env files. The workspace state `version` stays `1`.
- The real resolved request for the last **20** runs is kept in memory only, never written to disk.
- Never mention other API-client products in code, commits or docs.
- Every task ends with `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace`, `pnpm build` and `pnpm test` passing.

## Review Focus
1. **A JetBrains env file with nested objects** (`"Security": {"Auth": {...}}`) must not break running requests. Such keys are skipped. Test: Task 2, `skips_non_scalar_values`.
2. **An env file saved on Windows with a UTF-8 BOM** must still parse. Test: Task 2, `env_json_with_bom_parses`.
3. **The same secret appearing several times, or inside a longer string**, for example `https://x/?k=abcd1234&again=abcd1234`, must be masked everywhere. Short secrets like `"1"` stay visible. Test: Task 1, `masked_hides_every_occurrence_and_skips_short_secrets`.
4. **An unsaved tab (no path), or a file outside every workspace root,** with prod selected must still run, with `root: null` and no crash. Test: Task 5, `untitled tab runs with root null`.
5. **A lowercase method (`post`) against prod** must still ask for confirmation. Test: Task 5, `lowercase methods are still checked`.

---

### Task 1: Resolver records secrets, masked copy, `$dotenv`, environment name in errors

**Files:**
- Modify: `crates/crab-core/src/vars.rs` (trait at lines 16–27, `Resolver` at 29–90, `unresolved_error` at 106–114, `resolve_request` at 115–147)
- Modify: `crates/crab-core/src/model.rs:64-72` (`ResolvedRequest`)
- Modify: `crates/crab-core/tests/exec.rs:11` (constructor gains `secrets: vec![]`)
- Test: `crates/crab-core/tests/vars.rs`

**Interfaces:**
- Produces:
  - `pub struct EnvValue { pub value: String, pub secret: bool }` with `EnvValue::public(v)` and `EnvValue::secret(v)`.
  - `pub trait EnvProvider { fn get(&self, name: &str) -> Option<EnvValue>; fn dotenv(&self, _name: &str) -> Option<EnvValue> { None } fn env_name(&self) -> Option<&str> { None } }`
  - `ResolvedRequest.secrets: Vec<String>` (`#[serde(skip)]`).
  - `ResolvedRequest::masked(&self) -> ResolvedRequest`, `ResolvedRequest::has_secrets(&self) -> bool`, and `pub const MASK: &str = "••••••"` in `model.rs`.

- [ ] **Step 1: Update the existing test helper and write the failing tests**

In `crates/crab-core/tests/vars.rs`, change the import to `use crab_core::vars::{EnvProvider, EnvValue, NoEnv, Resolver};`, add `use crab_core::model::MASK;` and `use crab_core::prepare_request;` (already imported). Change the `Env` helper in `env_provider_is_consulted_after_file_vars` to:

```rust
    impl EnvProvider for Env {
        fn get(&self, name: &str) -> Option<EnvValue> {
            match name {
                "token" => Some(EnvValue::public("secret")),
                "host" => Some(EnvValue::public("from-env")),
                _ => None,
            }
        }
    }
```

Append:

```rust
struct SecretEnv;
impl EnvProvider for SecretEnv {
    fn get(&self, name: &str) -> Option<EnvValue> {
        match name {
            "token" => Some(EnvValue::secret("abcd1234")),
            "short" => Some(EnvValue::secret("1")),
            "host" => Some(EnvValue::public("api.test")),
            _ => None,
        }
    }
    fn dotenv(&self, name: &str) -> Option<EnvValue> {
        (name == "PORT").then(|| EnvValue::public("8080"))
    }
    fn env_name(&self) -> Option<&str> {
        Some("prod")
    }
}

#[test]
fn masked_hides_every_occurrence_and_skips_short_secrets() {
    let text = "GET https://{{host}}/?k={{token}}&again={{token}}&n={{short}}\nAuthorization: Bearer {{token}}\nX-Id: {{$guid}}\n\n{\"t\":\"{{token}}\"}\n";
    let req = prepare_request(text, 0, None, &SecretEnv).unwrap();
    assert!(req.url.contains("abcd1234"));
    assert!(req.has_secrets());
    let masked = req.masked();
    assert_eq!(masked.url, format!("https://api.test/?k={MASK}&again={MASK}&n=1"));
    assert_eq!(masked.headers[0].value, format!("Bearer {MASK}"));
    assert_eq!(String::from_utf8(masked.body.clone().unwrap()).unwrap(), format!("{{\"t\":\"{MASK}\"}}"));
    // Resolved once: the dynamic value is identical in both copies.
    assert_eq!(masked.headers[1].value, req.headers[1].value);
    assert!(masked.secrets.is_empty());
}

#[test]
fn only_short_secrets_means_nothing_to_mask() {
    let req = prepare_request("GET https://x.test/{{short}}\n", 0, None, &SecretEnv).unwrap();
    assert!(!req.has_secrets());
    assert_eq!(req.masked().url, "https://x.test/1");
}

#[test]
fn dotenv_dynamic_variable_reads_the_dotenv_provider() {
    let r = Resolver::new(&[], &SecretEnv);
    assert_eq!(r.resolve("{{$dotenv PORT}}").unwrap(), "8080");
    assert_eq!(r.resolve("{{$dotenv NOPE}}").unwrap_err().kind, ErrorKind::UnresolvedVars);
    assert_eq!(Resolver::new(&[], &NoEnv).resolve("{{$dotenv PORT}}").unwrap_err().kind, ErrorKind::UnresolvedVars);
}

#[test]
fn unresolved_error_names_the_environment() {
    let err = Resolver::new(&[], &SecretEnv).resolve("{{missing}}").unwrap_err();
    assert_eq!(err.message, "Unresolved variables: missing (environment: prod)");
    let err = Resolver::new(&[], &NoEnv).resolve("{{missing}}").unwrap_err();
    assert_eq!(err.message, "Unresolved variables: missing");
}
```

- [ ] **Step 2: Run the tests and check they fail**

Run: `cargo test -p crab-core --test vars`
Expected: compile errors, because `EnvValue`, `MASK`, `masked` and `has_secrets` don't exist yet.

- [ ] **Step 3: Implement**

In `crates/crab-core/src/vars.rs`, replace the trait and `NoEnv` (lines 16–27) with:

```rust
/// A value from the environment. `secret` marks values from private files, which are masked in what the UI shows.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EnvValue {
    pub value: String,
    pub secret: bool,
}

impl EnvValue {
    pub fn public(value: impl Into<String>) -> Self {
        Self { value: value.into(), secret: false }
    }
    pub fn secret(value: impl Into<String>) -> Self {
        Self { value: value.into(), secret: true }
    }
}

/// Source of environment values (see `env::FileEnv`).
pub trait EnvProvider {
    fn get(&self, name: &str) -> Option<EnvValue>;
    /// `{{$dotenv NAME}}`: values from `.env` only.
    fn dotenv(&self, _name: &str) -> Option<EnvValue> {
        None
    }
    /// The selected environment, named in unresolved-variable errors.
    fn env_name(&self) -> Option<&str> {
        None
    }
}

pub struct NoEnv;

impl EnvProvider for NoEnv {
    fn get(&self, _name: &str) -> Option<EnvValue> {
        None
    }
}
```

Add `use std::cell::RefCell;` to the imports. Give `Resolver` a `secrets: RefCell<Vec<String>>` field, initialised with `RefCell::default()` in `new`. Replace `lookup` with:

```rust
    fn lookup(&self, expr: &str) -> Option<String> {
        if let Some(dynamic) = expr.strip_prefix('$') {
            let mut parts = dynamic.split_whitespace();
            if parts.next() == Some("dotenv") {
                return parts.next().and_then(|name| self.env_value(self.env.dotenv(name)));
            }
            return dynamic_value(dynamic);
        }
        if let Some(v) = self.file_vars.get(expr) {
            return Some(v.clone());
        }
        self.env_value(self.env.get(expr))
    }

    fn env_value(&self, value: Option<EnvValue>) -> Option<String> {
        let value = value?;
        if value.secret {
            self.secrets.borrow_mut().push(value.value.clone());
        }
        Some(value.value)
    }

    /// Secret values substituted so far, longest first so masking never leaves part of a longer secret visible.
    fn take_secrets(&self) -> Vec<String> {
        let mut secrets = std::mem::take(&mut *self.secrets.borrow_mut());
        secrets.sort_by(|a, b| b.len().cmp(&a.len()).then_with(|| a.cmp(b)));
        secrets.dedup();
        secrets
    }
```

Change `unresolved_error` to take the environment name:

```rust
fn unresolved_error(mut missing: Vec<String>, env: Option<&str>) -> Option<CrabError> {
    if missing.is_empty() {
        return None;
    }
    missing.sort();
    missing.dedup();
    let suffix = env.map(|e| format!(" (environment: {e})")).unwrap_or_default();
    Some(CrabError::new(ErrorKind::UnresolvedVars, format!("Unresolved variables: {}{suffix}", missing.join(", "))))
}
```

Update both callers: in `resolve` use `unresolved_error(missing, self.env.env_name())`, and in `resolve_request` use `unresolved_error(missing, resolver.env.env_name())`. Change the final line of `resolve_request` to:

```rust
    Ok(ResolvedRequest { method: block.method.clone(), url, headers, body, secrets: resolver.take_secrets() })
```

In `crates/crab-core/src/model.rs`, add the field to `ResolvedRequest`, after `body`:

```rust
    /// Secret values substituted into this request; never sent to the UI.
    #[serde(skip)]
    pub secrets: Vec<String>,
```

Add below the struct:

```rust
/// Shown in place of secret values.
pub const MASK: &str = "••••••";
/// Shorter secrets stay visible: masking "1" would hide every 1 in the request.
const MIN_SECRET_CHARS: usize = 4;

impl ResolvedRequest {
    fn maskable(&self) -> impl Iterator<Item = &String> {
        self.secrets.iter().filter(|s| s.chars().count() >= MIN_SECRET_CHARS)
    }

    pub fn has_secrets(&self) -> bool {
        self.maskable().next().is_some()
    }

    /// A copy safe to show and store: every secret occurrence becomes `MASK`. Binary bodies are left as they are.
    pub fn masked(&self) -> ResolvedRequest {
        let mask = |s: &str| self.maskable().fold(s.to_string(), |acc, secret| acc.replace(secret.as_str(), MASK));
        ResolvedRequest {
            method: self.method.clone(),
            url: mask(&self.url),
            headers: self.headers.iter().map(|h| Header { name: h.name.clone(), value: mask(&h.value) }).collect(),
            body: self.body.as_ref().map(|b| match std::str::from_utf8(b) {
                Ok(text) => mask(text).into_bytes(),
                Err(_) => b.clone(),
            }),
            secrets: Vec::new(),
        }
    }
}
```

In `crates/crab-core/tests/exec.rs:11`, change the constructor to `ResolvedRequest { method: method.into(), url, headers: vec![], body: None, secrets: vec![] }`.

- [ ] **Step 4: Run the tests and check they pass**

Run: `cargo test -p crab-core && cargo clippy --workspace --all-targets -- -D warnings`
Expected: all tests pass and clippy is clean. `src-tauri` still compiles, because `NoEnv` still exists.

- [ ] **Step 5: Commit**

```bash
git add crates/crab-core
git commit -m "feat(core): secret-aware env values, masked requests and \$dotenv"
```

---

### Task 2: `env.rs`: discovery, `.env` parser, `FileEnv`, environment names

**Files:**
- Create: `crates/crab-core/src/env.rs`
- Modify: `crates/crab-core/src/lib.rs` (add `pub mod env;`)
- Modify: `crates/crab-core/src/error.rs` (add `Env` to `ErrorKind`)
- Modify: `crates/crab-core/src/files.rs:11-12` (make `SKIP_DIRS` and `MAX_DEPTH` `pub(crate)`)
- Test: `crates/crab-core/tests/env.rs` (new)

**Interfaces:**
- Consumes: `EnvProvider` and `EnvValue` (Task 1), `files::read_text`.
- Produces:
  - `env::EnvFiles::discover(http_file: &Path, root: Option<&Path>) -> Result<EnvFiles, CrabError>`, plus `EnvFiles::default()` and `EnvFiles::names(&self) -> Vec<String>`.
  - `env::FileEnv::new(name: Option<String>, files: EnvFiles) -> FileEnv`, which implements `EnvProvider`.
  - `env::find_env_names(root: &Path) -> Vec<String>` and `env::parse_dotenv(text: &str) -> HashMap<String, String>`.
  - `ErrorKind::Env`, which serialises as `"env"`.

- [ ] **Step 1: Write the failing tests**

Create `crates/crab-core/tests/env.rs`:

```rust
use std::fs;
use std::path::Path;

use crab_core::env::{find_env_names, parse_dotenv, EnvFiles, FileEnv};
use crab_core::error::ErrorKind;
use crab_core::vars::{EnvProvider, EnvValue};

fn write(dir: &Path, rel: &str, text: &str) {
    let p = dir.join(rel);
    fs::create_dir_all(p.parent().unwrap()).unwrap();
    fs::write(p, text).unwrap();
}

#[test]
fn nearest_files_win_independently_and_the_walk_stops_at_the_root() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("repo");
    write(dir.path(), "http-client.env.json", r#"{"dev": {"host": "above-root"}}"#);
    write(&root, "http-client.env.json", r#"{"dev": {"host": "repo"}}"#);
    write(&root, "api/http-client.env.json", r#"{"dev": {"host": "api"}}"#);
    write(&root, "http-client.private.env.json", r#"{"dev": {"token": "repo-secret"}}"#);
    write(&root, ".env", "PORT=1\n");

    let files = EnvFiles::discover(&root.join("api/users/a.http"), Some(&root)).unwrap();
    let env = FileEnv::new(Some("dev".into()), files);
    assert_eq!(env.get("host"), Some(EnvValue::public("api")));
    assert_eq!(env.get("token"), Some(EnvValue::secret("repo-secret")));
    assert_eq!(env.dotenv("PORT"), Some(EnvValue::public("1")));

    // Directly under the root: never reads the file above it.
    let env = FileEnv::new(Some("dev".into()), EnvFiles::discover(&root.join("a.http"), Some(&root)).unwrap());
    assert_eq!(env.get("host"), Some(EnvValue::public("repo")));
}

#[test]
fn a_file_outside_the_root_only_checks_its_own_folder() {
    let dir = tempfile::tempdir().unwrap();
    write(dir.path(), "http-client.env.json", r#"{"dev": {"host": "parent"}}"#);
    write(dir.path(), "other/http-client.env.json", r#"{"dev": {"host": "own"}}"#);
    let root = dir.path().join("repo");
    fs::create_dir_all(&root).unwrap();
    let env = FileEnv::new(Some("dev".into()), EnvFiles::discover(&dir.path().join("other/a.http"), Some(&root)).unwrap());
    assert_eq!(env.get("host"), Some(EnvValue::public("own")));
    let env = FileEnv::new(Some("dev".into()), EnvFiles::discover(&dir.path().join("x/a.http"), None).unwrap());
    assert_eq!(env.get("host"), None);
}

#[test]
fn lookup_order_private_public_shared_then_dotenv() {
    let dir = tempfile::tempdir().unwrap();
    write(dir.path(), "http-client.env.json", r#"{
        "$shared": {"a": "pub-shared", "b": "pub-shared", "c": "pub-shared", "d": "pub-shared"},
        "dev": {"a": "pub-dev", "b": "pub-dev"}
    }"#);
    write(dir.path(), "http-client.private.env.json", r#"{"$shared": {"c": "priv-shared"}, "dev": {"a": "priv-dev"}}"#);
    write(dir.path(), ".env", "a=dot\ne=dot\n");
    let files = || EnvFiles::discover(&dir.path().join("a.http"), Some(dir.path())).unwrap();

    let dev = FileEnv::new(Some("dev".into()), files());
    assert_eq!(dev.get("a"), Some(EnvValue::secret("priv-dev")));
    assert_eq!(dev.get("b"), Some(EnvValue::public("pub-dev")));
    assert_eq!(dev.get("c"), Some(EnvValue::secret("priv-shared")));
    assert_eq!(dev.get("d"), Some(EnvValue::public("pub-shared")));
    assert_eq!(dev.get("e"), Some(EnvValue::public("dot")));
    assert_eq!(dev.env_name(), Some("dev"));

    // No environment selected: $shared and .env still apply.
    let none = FileEnv::new(None, files());
    assert_eq!(none.get("a"), Some(EnvValue::public("pub-shared")));
    assert_eq!(none.get("e"), Some(EnvValue::public("dot")));
    assert_eq!(none.env_name(), None);
}

#[test]
fn skips_non_scalar_values() {
    let dir = tempfile::tempdir().unwrap();
    write(dir.path(), "http-client.env.json", r#"{"dev": {"port": 8080, "tls": true, "nothing": null, "list": [1], "Security": {"Auth": {"x": 1}}}}"#);
    let env = FileEnv::new(Some("dev".into()), EnvFiles::discover(&dir.path().join("a.http"), None).unwrap());
    assert_eq!(env.get("port"), Some(EnvValue::public("8080")));
    assert_eq!(env.get("tls"), Some(EnvValue::public("true")));
    assert_eq!(env.get("nothing"), None);
    assert_eq!(env.get("list"), None);
    assert_eq!(env.get("Security"), None);
}

#[test]
fn env_json_with_bom_parses() {
    let dir = tempfile::tempdir().unwrap();
    write(dir.path(), "http-client.env.json", "\u{feff}{\"dev\": {\"host\": \"x\"}}\r\n");
    let env = FileEnv::new(Some("dev".into()), EnvFiles::discover(&dir.path().join("a.http"), None).unwrap());
    assert_eq!(env.get("host"), Some(EnvValue::public("x")));
}

#[test]
fn invalid_env_json_is_an_env_error_naming_the_file() {
    let dir = tempfile::tempdir().unwrap();
    write(dir.path(), "http-client.env.json", "{\"dev\": ");
    let err = EnvFiles::discover(&dir.path().join("a.http"), None).unwrap_err();
    assert_eq!(err.kind, ErrorKind::Env);
    assert!(err.message.contains("http-client.env.json"), "{}", err.message);

    write(dir.path(), "http-client.env.json", r#"{"dev": "nope"}"#);
    let err = EnvFiles::discover(&dir.path().join("a.http"), None).unwrap_err();
    assert!(err.message.contains("\"dev\" must be an object"), "{}", err.message);

    write(dir.path(), "http-client.env.json", "[]");
    assert_eq!(EnvFiles::discover(&dir.path().join("a.http"), None).unwrap_err().kind, ErrorKind::Env);
}

#[test]
fn parses_dotenv_files() {
    let vars = parse_dotenv(
        "# comment\n\nexport A=1\nB = two words \nC=\"line\\nbreak \\\"q\\\"\"\nD='single # kept'\nE=value # comment\nnot a line\n=nokey\nF=\n",
    );
    assert_eq!(vars["A"], "1");
    assert_eq!(vars["B"], "two words");
    assert_eq!(vars["C"], "line\nbreak \"q\"");
    assert_eq!(vars["D"], "single # kept");
    assert_eq!(vars["E"], "value");
    assert_eq!(vars["F"], "");
    assert_eq!(vars.len(), 6);
}

#[test]
fn names_merge_public_and_private_without_shared() {
    let dir = tempfile::tempdir().unwrap();
    write(dir.path(), "http-client.env.json", r#"{"$shared": {}, "prod": {}, "dev": {}}"#);
    write(dir.path(), "http-client.private.env.json", r#"{"staging": {}, "dev": {}}"#);
    let files = EnvFiles::discover(&dir.path().join("a.http"), None).unwrap();
    assert_eq!(files.names(), vec!["dev", "prod", "staging"]);
}

#[test]
fn find_env_names_walks_the_root_and_skips_build_folders() {
    let dir = tempfile::tempdir().unwrap();
    write(dir.path(), "a/http-client.env.json", r#"{"dev": {}}"#);
    write(dir.path(), "b/http-client.private.env.json", r#"{"prod": {}}"#);
    write(dir.path(), "node_modules/x/http-client.env.json", r#"{"hidden": {}}"#);
    write(dir.path(), "c/http-client.env.json", "not json");
    assert_eq!(find_env_names(dir.path()), vec!["dev", "prod"]);
}
```

- [ ] **Step 2: Run the tests and check they fail**

Run: `cargo test -p crab-core --test env`
Expected: compile error, `unresolved import crab_core::env`.

- [ ] **Step 3: Implement**

In `crates/crab-core/src/error.rs`, add `Env,` after `Io,` in `ErrorKind`. In `crates/crab-core/src/files.rs`, change `const SKIP_DIRS` and `const MAX_DEPTH` to `pub(crate) const`. In `crates/crab-core/src/lib.rs`, add `pub mod env;` after `pub mod error;`.

Create `crates/crab-core/src/env.rs`:

```rust
//! Environments: `http-client.env.json`, `http-client.private.env.json` and `.env`, found in the `.http`
//! file's folder or the nearest folder above it, up to the workspace root.

use std::collections::{BTreeSet, HashMap};
use std::path::{Path, PathBuf};

use serde_json::Value;
use walkdir::WalkDir;

use crate::error::{CrabError, ErrorKind};
use crate::files::{read_text, MAX_DEPTH, SKIP_DIRS};
use crate::vars::{EnvProvider, EnvValue};

pub const PUBLIC_FILE: &str = "http-client.env.json";
pub const PRIVATE_FILE: &str = "http-client.private.env.json";
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
        let public = nearest(&dirs, PUBLIC_FILE).map(|p| load_env_json(&p)).transpose()?;
        let private = nearest(&dirs, PRIVATE_FILE).map(|p| load_env_json(&p)).transpose()?;
        let dotenv = nearest(&dirs, DOTENV_FILE).map(|p| read_text(&p).map(|t| parse_dotenv(&t))).transpose()?;
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

fn nearest(dirs: &[PathBuf], name: &str) -> Option<PathBuf> {
    dirs.iter().map(|d| d.join(name)).find(|p| p.is_file())
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

/// Environment names from every env JSON file under `root`. Unreadable files are skipped; they report
/// their error when a request runs.
pub fn find_env_names(root: &Path) -> Vec<String> {
    let mut names = BTreeSet::new();
    let entries = WalkDir::new(root)
        .max_depth(MAX_DEPTH)
        .into_iter()
        .filter_entry(|e| e.depth() == 0 || !(e.file_type().is_dir() && SKIP_DIRS.contains(&e.file_name().to_string_lossy().as_ref())))
        .filter_map(Result::ok)
        .filter(|e| e.file_type().is_file() && (e.file_name() == PUBLIC_FILE || e.file_name() == PRIVATE_FILE));
    for entry in entries {
        if let Ok(envs) = load_env_json(entry.path()) {
            names.extend(envs.into_keys().filter(|n| n != SHARED));
        }
    }
    names.into_iter().collect()
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
```

- [ ] **Step 4: Run the tests and check they pass**

Run: `cargo test -p crab-core && cargo clippy --workspace --all-targets -- -D warnings`
Expected: all tests pass and clippy is clean.

- [ ] **Step 5: Commit**

```bash
git add crates/crab-core
git commit -m "feat(core): discover http-client env files and .env as an environment provider"
```

---

### Task 3: Tauri commands, the response shape and frontend API types

**Files:**
- Modify: `crates/crab-core/src/exec.rs:34-46` (`ResponseData` gains fields) and `:114-126` (constructor)
- Modify: `src-tauri/src/commands.rs:9-10, 25-40` (`run_request`) and add `list_environments` and `reveal_request`
- Modify: `src-tauri/src/state.rs` (`revealed` cache)
- Modify: `src-tauri/src/lib.rs:13-23` (register the commands)
- Modify: `src/api.ts` (types and calls)
- Modify: `src/lib/format.ts:93-100` (`env` error title)
- Modify: `src/state/run.test.ts:14-26` (`fakeResponse` gains the new fields)
- Test: `crates/crab-core/tests/exec.rs` (a wiremock run with `FileEnv`)

**Interfaces:**
- Consumes: `FileEnv`, `EnvFiles`, `find_env_names` (Task 2), `masked` and `has_secrets` (Task 1).
- Produces:
  - Rust: `ResponseData { …, pub has_secrets: bool, pub env: Option<String> }`, serialised as `hasSecrets` / `env`.
  - TS: `api.runRequest({ runId, path, text, line, env: string | null, root: string | null })`, `api.listEnvironments(roots: string[]): Promise<string[]>`, `api.revealRequest(runId: string): Promise<ResolvedRequest | null>`, and `ResponseData.hasSecrets: boolean`, `ResponseData.env: string | null`. `ErrorKind` includes `"env"`.

- [ ] **Step 1: Write the failing test**

Append to `crates/crab-core/tests/exec.rs` (add `use crab_core::env::{EnvFiles, FileEnv};`, `use crab_core::model::MASK;` and `use crab_core::prepare_request;`):

```rust
#[tokio::test]
async fn runs_with_file_env_and_returns_a_masked_copy() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/me"))
        .and(header("authorization", "Bearer s3cret-token"))
        .respond_with(ResponseTemplate::new(200))
        .mount(&server)
        .await;
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("http-client.env.json"), format!(r#"{{"dev": {{"host": "{}"}}}}"#, server.uri())).unwrap();
    std::fs::write(dir.path().join("http-client.private.env.json"), r#"{"dev": {"token": "s3cret-token"}}"#).unwrap();
    let file = dir.path().join("a.http");
    let env = FileEnv::new(Some("dev".into()), EnvFiles::discover(&file, Some(dir.path())).unwrap());

    let req = prepare_request("GET {{host}}/me\nAuthorization: Bearer {{token}}\n", 0, Some(dir.path()), &env).unwrap();
    let resp = execute(&req, &ExecOptions::default(), CancellationToken::new()).await.unwrap();
    assert_eq!(resp.status, 200);
    assert!(!resp.has_secrets);
    assert_eq!(resp.env, None);
    assert_eq!(req.masked().headers[0].value, format!("Bearer {MASK}"));
}
```

- [ ] **Step 2: Run the test and check it fails**

Run: `cargo test -p crab-core --test exec runs_with_file_env`
Expected: compile error, because `has_secrets` and `env` aren't fields of `ResponseData`.

- [ ] **Step 3: Implement**

In `crates/crab-core/src/exec.rs`, add to `ResponseData` after `request`:

```rust
    /// Set by the app: whether `request` has masked secrets (see `ResolvedRequest::masked`).
    pub has_secrets: bool,
    /// Set by the app: the environment the run used.
    pub env: Option<String>,
```

In the `Ok(ResponseData { … })` constructor (around line 114), add `has_secrets: false, env: None,` after `request: req.clone(),`.

In `src-tauri/src/state.rs`, add `use std::collections::VecDeque;` and `use crab_core::model::ResolvedRequest;`, then add the field and helpers:

```rust
    /// Unmasked requests of the latest runs that had secrets, for "Reveal secrets". Memory only.
    pub revealed: Mutex<VecDeque<(String, ResolvedRequest)>>,
}

const REVEAL_CAP: usize = 20;

impl AppState {
    pub fn remember_request(&self, run_id: String, request: ResolvedRequest) {
        let mut revealed = self.revealed.lock().unwrap();
        revealed.push_back((run_id, request));
        while revealed.len() > REVEAL_CAP {
            revealed.pop_front();
        }
    }

    pub fn revealed_request(&self, run_id: &str) -> Option<ResolvedRequest> {
        self.revealed.lock().unwrap().iter().find(|(id, _)| id == run_id).map(|(_, r)| r.clone())
    }
}
```

(The struct's closing `}` moves below the new field.) In `src-tauri/src/commands.rs`, replace `use crab_core::vars::NoEnv;` with `use crab_core::env::{self, EnvFiles, FileEnv};` and `use crab_core::model::ResolvedRequest;`, and add `use std::collections::BTreeSet;`. Replace `run_request` with:

```rust
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn run_request(
    state: State<'_, AppState>,
    run_id: String,
    path: Option<String>,
    text: String,
    line: usize,
    env: Option<String>,
    root: Option<String>,
) -> Result<ResponseData, CrabError> {
    let base_dir = path.as_deref().and_then(|p| Path::new(p).parent()).map(Path::to_path_buf);
    // Unsaved files have no folder to look for env files in.
    let files = match path.as_deref() {
        Some(p) => EnvFiles::discover(Path::new(p), root.as_deref().map(Path::new))?,
        None => EnvFiles::default(),
    };
    let provider = FileEnv::new(env.clone(), files);
    let request = prepare_request(&text, line, base_dir.as_deref(), &provider)?;
    let token = CancellationToken::new();
    state.runs.lock().unwrap().insert(run_id.clone(), token.clone());
    let result = execute(&request, &ExecOptions::default(), token).await;
    state.runs.lock().unwrap().remove(&run_id);
    let mut response = result?;
    response.env = env;
    response.has_secrets = request.has_secrets();
    response.request = request.masked();
    if response.has_secrets {
        state.remember_request(run_id, request);
    }
    Ok(response)
}

#[tauri::command]
pub fn reveal_request(state: State<'_, AppState>, run_id: String) -> Option<ResolvedRequest> {
    state.revealed_request(&run_id)
}

#[tauri::command]
pub async fn list_environments(roots: Vec<String>) -> Vec<String> {
    let names: BTreeSet<String> = roots.iter().flat_map(|r| env::find_env_names(Path::new(r))).collect();
    names.into_iter().collect()
}
```

`ResolvedRequest` serialises without `secrets` because of `#[serde(skip)]`, so the revealed copy's secrets never reach the UI as a separate list. Only the real values in the URL, headers and body do. Register `commands::list_environments` and `commands::reveal_request` in `src-tauri/src/lib.rs`'s `generate_handler!` list.

In `src/api.ts`:
- Change `ErrorKind` to `"parse" | "unresolvedVars" | "network" | "timeout" | "cancelled" | "io" | "env"`.
- Add `hasSecrets: boolean; env: string | null;` to `ResponseData`.
- Change `runRequest`'s argument type to `{ runId: string; path: string | null; text: string; line: number; env: string | null; root: string | null }`.
- Add:

```ts
  listEnvironments: (roots: string[]) => invoke<string[]>("list_environments", { roots }),
  revealRequest: (runId: string) => invoke<ResolvedRequest | null>("reveal_request", { runId }),
```

In `src/lib/format.ts`, add `env: "Environment error",` to `ERROR_TITLES`. In `src/state/run.test.ts`, add `hasSecrets: false, env: null,` to `fakeResponse`.

- [ ] **Step 4: Run everything and check it passes**

Run: `cargo test --workspace && cargo clippy --workspace --all-targets -- -D warnings && pnpm build && pnpm test`
Expected: Rust passes. `pnpm build` fails only at `src/state/run.ts`, because `runRequest` now needs `env` and `root`. In `src/state/run.ts`, temporarily pass `env: null, root: null` so this task stays green; Task 5 replaces it. The existing `run.test.ts` assertion `toHaveBeenCalledWith({ runId, path, text, line })` must gain `env: null, root: null`. After those two edits, everything passes.

- [ ] **Step 5: Commit**

```bash
git add crates src-tauri src/api.ts src/lib/format.ts src/state/run.ts src/state/run.test.ts
git commit -m "feat: run requests with an environment, return masked requests, reveal on demand"
```

---

### Task 4: Environments store, persistence and refreshing on file changes

**Files:**
- Create: `src/state/environments.ts`
- Create: `src/state/environments.test.ts`
- Modify: `src/state/workspace.ts` (save and load `environments`, refresh names when roots change)
- Modify: `src/lib/paths.ts` (add `isEnvFile`)
- Modify: `src/state/fs-events.ts` (env file changes refresh the names)
- Test: `src/state/fs-events.test.ts`, `src/state/workspace.test.ts`, `src/lib/paths.test.ts`

**Interfaces:**
- Consumes: `api.listEnvironments` (Task 3).
- Produces:
  - `ENV_COLORS`, `type EnvColor`, `type EnvSettings = { selected: string | null; colors: Record<string, EnvColor>; confirmDanger: boolean }`.
  - `colorOf(s: Pick<EnvSettings, "colors">, name: string | null): EnvColor` and `isDanger(s, name): boolean`.
  - `useEnvironments` with `names`, `selected`, `colors`, `confirmDanger`, `load(saved?: Partial<EnvSettings>)`, `select(name)`, `setColor(name, color)`, `setConfirmDanger(on)`, `refresh(roots: string[])`, `settings(): EnvSettings`.
  - `isEnvFile(path: string): boolean` in `src/lib/paths.ts`.

- [ ] **Step 1: Write the failing tests**

Create `src/state/environments.test.ts`:

```ts
import { beforeEach, expect, test, vi } from "vitest";

vi.mock("../api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api")>()),
  api: { listEnvironments: vi.fn() },
}));

import { api } from "../api";
import { colorOf, isDanger, useEnvironments } from "./environments";

beforeEach(() => {
  vi.clearAllMocks();
  useEnvironments.getState().load(undefined);
  useEnvironments.setState({ names: [] });
});

test("defaults: nothing selected, confirmation on", () => {
  expect(useEnvironments.getState().settings()).toEqual({ selected: null, colors: {}, confirmDanger: true });
});

test("load fills missing fields with defaults", () => {
  useEnvironments.getState().load({ selected: "dev" });
  expect(useEnvironments.getState().settings()).toEqual({ selected: "dev", colors: {}, confirmDanger: true });
});

test("production-like names are red unless a colour is set", () => {
  expect(colorOf({ colors: {} }, "prod")).toBe("red");
  expect(colorOf({ colors: {} }, "Production-EU")).toBe("red");
  expect(colorOf({ colors: {} }, "live")).toBe("red");
  expect(colorOf({ colors: {} }, "dev")).toBe("none");
  expect(colorOf({ colors: {} }, null)).toBe("none");
  expect(colorOf({ colors: { prod: "none" } }, "prod")).toBe("none");
  expect(isDanger({ colors: { dev: "red" } }, "dev")).toBe(true);
  expect(isDanger({ colors: { prod: "amber" } }, "prod")).toBe(false);
});

test("select, setColor and setConfirmDanger update settings", () => {
  const s = useEnvironments.getState();
  s.select("prod");
  s.setColor("prod", "amber");
  s.setConfirmDanger(false);
  expect(useEnvironments.getState().settings()).toEqual({ selected: "prod", colors: { prod: "amber" }, confirmDanger: false });
});

test("refresh loads names and keeps a selection that disappeared", async () => {
  useEnvironments.getState().select("old");
  vi.mocked(api.listEnvironments).mockResolvedValue(["dev", "prod"]);
  await useEnvironments.getState().refresh(["/r"]);
  expect(api.listEnvironments).toHaveBeenCalledWith(["/r"]);
  expect(useEnvironments.getState().names).toEqual(["dev", "prod"]);
  expect(useEnvironments.getState().selected).toBe("old");
});

test("refresh failures leave the names empty", async () => {
  vi.mocked(api.listEnvironments).mockRejectedValue(new Error("boom"));
  await useEnvironments.getState().refresh(["/r"]);
  expect(useEnvironments.getState().names).toEqual([]);
});
```

Append to `src/lib/paths.test.ts` (and add `isEnvFile` to its import from `./paths`):

```ts
test("isEnvFile matches the three env file names on any platform", () => {
  expect(isEnvFile("/r/http-client.env.json")).toBe(true);
  expect(isEnvFile("C:\\r\\http-client.private.env.json")).toBe(true);
  expect(isEnvFile("/r/.env")).toBe(true);
  expect(isEnvFile("/r/.env.local")).toBe(false);
  expect(isEnvFile("/r/package.json")).toBe(false);
});
```

Append to `src/state/fs-events.test.ts` (add `import { useEnvironments } from "./environments";`):

```ts
test("env file changes refresh the environment names once", () => {
  vi.useFakeTimers();
  const refresh = vi.fn().mockResolvedValue(undefined);
  useEnvironments.setState({ refresh });
  handleFsChanged(["/r/http-client.env.json", "/r/sub/.env", "/r/package.json"]);
  vi.advanceTimersByTime(300);
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(refresh).toHaveBeenCalledWith(["/r"]);
  vi.useRealTimers();
});
```

Append to `src/state/workspace.test.ts` (add `listEnvironments: vi.fn().mockResolvedValue([])` to its `api` mock, and add `import { useEnvironments } from "./environments";`):

```ts
test("load restores environment settings and saving includes them", async () => {
  vi.mocked(api.loadState).mockResolvedValue({
    version: 1,
    folders: [{ id: "f1", name: "W", roots: [] }],
    environments: { selected: "prod", colors: { prod: "amber" }, confirmDanger: false },
  });
  await useWorkspace.getState().load();
  expect(useEnvironments.getState().settings()).toEqual({ selected: "prod", colors: { prod: "amber" }, confirmDanger: false });
  vi.mocked(api.saveState).mockClear();
  useEnvironments.getState().select("dev");
  expect(api.saveState).toHaveBeenCalledWith("workspace", {
    version: 1,
    folders: [{ id: "f1", name: "W", roots: [] }],
    environments: { selected: "dev", colors: { prod: "amber" }, confirmDanger: false },
  });
});
```

- [ ] **Step 2: Run the tests and check they fail**

Run: `pnpm vitest run src/state/environments.test.ts src/lib/paths.test.ts src/state/fs-events.test.ts src/state/workspace.test.ts`
Expected: FAIL, with modules and exports not found.

- [ ] **Step 3: Implement**

Create `src/state/environments.ts`:

```ts
import { create } from "zustand";
import { api } from "../api";

export const ENV_COLORS = ["none", "green", "blue", "amber", "red"] as const;
export type EnvColor = (typeof ENV_COLORS)[number];
/** Crab-only settings, saved in the workspace state; env files stay compatible with other clients. */
export type EnvSettings = { selected: string | null; colors: Record<string, EnvColor>; confirmDanger: boolean };

const DEFAULTS: EnvSettings = { selected: null, colors: {}, confirmDanger: true };
const DANGER_NAME = /prod|production|live/i;

export function colorOf(s: Pick<EnvSettings, "colors">, name: string | null): EnvColor {
  if (!name) return "none";
  return s.colors[name] ?? (DANGER_NAME.test(name) ? "red" : "none");
}

export const isDanger = (s: Pick<EnvSettings, "colors">, name: string | null) => colorOf(s, name) === "red";

type EnvironmentsState = EnvSettings & {
  /** Environment names found in the workspace's env files. */
  names: string[];
  load(saved: Partial<EnvSettings> | undefined): void;
  select(name: string | null): void;
  setColor(name: string, color: EnvColor): void;
  setConfirmDanger(on: boolean): void;
  refresh(roots: string[]): Promise<void>;
  settings(): EnvSettings;
};

export const useEnvironments = create<EnvironmentsState>((set, get) => ({
  ...DEFAULTS,
  names: [],
  load: (saved) => set({ ...DEFAULTS, ...saved }),
  select: (selected) => set({ selected }),
  setColor: (name, color) => set((s) => ({ colors: { ...s.colors, [name]: color } })),
  setConfirmDanger: (confirmDanger) => set({ confirmDanger }),
  async refresh(roots) {
    const names = await api.listEnvironments(roots).catch(() => []);
    set({ names });
  },
  settings: () => {
    const { selected, colors, confirmDanger } = get();
    return { selected, colors, confirmDanger };
  },
}));
```

In `src/lib/paths.ts`, add:

```ts
const ENV_FILES = ["http-client.env.json", "http-client.private.env.json", ".env"];
export const isEnvFile = (p: string) => ENV_FILES.includes(basename(p));
```

In `src/state/workspace.ts`:
1. Add `import { useEnvironments, type EnvSettings } from "./environments";`.
2. Change `Persisted` to `{ version: 1; folders: VirtualFolder[]; environments?: EnvSettings }`.
3. Replace `persist` with:

```ts
function save(folders: VirtualFolder[]) {
  const value: Persisted = { version: 1, folders, environments: useEnvironments.getState().settings() };
  api.saveState("workspace", value).catch(console.error);
}

function persist(folders: VirtualFolder[]) {
  save(folders);
  const roots = uniqueRoots(folders);
  api.watchRoots(roots).catch(console.error);
  void useEnvironments.getState().refresh(roots);
}
```

4. In `load()`, right after `set({ folders });`, add `useEnvironments.getState().load(saved?.version === 1 ? saved.environments : undefined);`. After `api.watchRoots(roots)…`, add `void useEnvironments.getState().refresh(roots);`.
5. At the bottom of the file, add:

```ts
// Save when the environment settings change; `names` is derived from disk and not saved.
useEnvironments.subscribe((s, prev) => {
  if (s.selected !== prev.selected || s.colors !== prev.colors || s.confirmDanger !== prev.confirmDanger) {
    save(useWorkspace.getState().folders);
  }
});
```

In `src/state/fs-events.ts`, add `import { isEnvFile } from "../lib/paths";` (merge with the existing import) and `import { useEnvironments } from "./environments";`, plus:

```ts
const refreshEnvironments = debounce(() => void useEnvironments.getState().refresh(useWorkspace.getState().allRoots()), 300);
```

In `handleFsChanged`, make the first line of the loop `if (isEnvFile(p)) { envChanged = true; continue; }`, with `let envChanged = false;` declared before the loop. After the loop, add `if (envChanged) refreshEnvironments();`.

- [ ] **Step 4: Run the tests and check they pass**

Run: `pnpm build && pnpm test`
Expected: all tests pass, after two fixes to existing tests:
- `persist` now calls `api.listEnvironments`, so `workspace.test.ts` and `fs-events.test.ts` must mock it: `listEnvironments: vi.fn().mockResolvedValue([])`.
- Saved workspace state now includes `environments`. Any existing `workspace.test.ts` assertion on `api.saveState` with an exact `{ version: 1, folders }` object must add `environments: expect.any(Object)`.

- [ ] **Step 5: Commit**

```bash
git add src/state src/lib/paths.ts src/lib/paths.test.ts
git commit -m "feat: environment selection, colours and confirmation setting, saved with the workspace"
```

---

### Task 5: Pass the environment and root when running, and the production check

**Files:**
- Modify: `src/state/run.ts`
- Test: `src/state/run.test.ts`

**Interfaces:**
- Consumes: `useEnvironments`, `isDanger` (Task 4), `useOutline` (`src/state/outline.ts`), `requestIndexAt` (`src/lib/outline.ts:12`), `useWorkspace().allRoots()`, `isUnder` (`src/lib/paths.ts`), `ask` from `@tauri-apps/plugin-dialog`.
- Produces: `runAt(tabId, line)`. Same signature as before, but it may now return without running when the user cancels the confirmation.

- [ ] **Step 1: Write the failing tests**

In `src/state/run.test.ts`, add before the imports of `./run`:

```ts
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: vi.fn() }));
```

Add `parseText: vi.fn()` to the mocked `api`. Add the imports `import { ask } from "@tauri-apps/plugin-dialog";`, `import { useEnvironments } from "./environments";`, `import { useOutline } from "./outline";` and `import { useWorkspace } from "./workspace";`. Extend `beforeEach`:

```ts
  useEnvironments.getState().load(undefined);
  useWorkspace.setState({ folders: [{ id: "f", name: "W", roots: ["/r"] }] });
  useOutline.setState({ byPath: {} });
```

Change the first test's expectation to:

```ts
  expect(api.runRequest).toHaveBeenCalledWith({ runId: expect.any(String), path: "/r/a.http", text: "GET https://x.test\n", line: 0, env: null, root: "/r" });
```

Append:

```ts
const block = (method: string) => ({
  name: null, method, url: "https://x.test", headers: [], body: null, span: { startLine: 0, endLine: 0 }, requestLine: 0,
});

test("sends the selected environment", async () => {
  vi.mocked(api.runRequest).mockResolvedValueOnce(fakeResponse(200));
  useEnvironments.getState().select("dev");
  await runAt(tabId, 0);
  expect(api.runRequest).toHaveBeenCalledWith(expect.objectContaining({ env: "dev", root: "/r" }));
});

test("asks before sending a POST to a red environment and stops on cancel", async () => {
  useOutline.getState().set("/r/a.http", [block("POST")]);
  useEnvironments.getState().select("prod");
  vi.mocked(ask).mockResolvedValueOnce(false);
  await runAt(tabId, 0);
  expect(ask).toHaveBeenCalledWith("Send POST https://x.test to prod?", expect.objectContaining({ kind: "warning", okLabel: "Send" }));
  expect(api.runRequest).not.toHaveBeenCalled();
  expect(useResponses.getState().byTab[tabId]).toBeUndefined();
});

test("sends after the user confirms", async () => {
  useOutline.getState().set("/r/a.http", [block("DELETE")]);
  useEnvironments.getState().select("prod");
  vi.mocked(ask).mockResolvedValueOnce(true);
  vi.mocked(api.runRequest).mockResolvedValueOnce(fakeResponse(204));
  await runAt(tabId, 0);
  expect(api.runRequest).toHaveBeenCalledTimes(1);
});

test("lowercase methods are still checked", async () => {
  useOutline.getState().set("/r/a.http", [block("post")]);
  useEnvironments.getState().select("prod");
  vi.mocked(ask).mockResolvedValueOnce(false);
  await runAt(tabId, 0);
  expect(ask).toHaveBeenCalled();
});

test("GET, a non-red environment, or the setting turned off never asks", async () => {
  vi.mocked(api.runRequest).mockResolvedValue(fakeResponse(200));
  useOutline.getState().set("/r/a.http", [block("GET")]);
  useEnvironments.getState().select("prod");
  await runAt(tabId, 0);
  useOutline.getState().set("/r/a.http", [block("POST")]);
  useEnvironments.getState().select("dev");
  await runAt(tabId, 0);
  useEnvironments.getState().select("prod");
  useEnvironments.getState().setConfirmDanger(false);
  await runAt(tabId, 0);
  expect(ask).not.toHaveBeenCalled();
  expect(api.runRequest).toHaveBeenCalledTimes(3);
});

test("untitled tab runs with root null and parses its text for the method", async () => {
  const untitled = useTabs.getState().addTab({ path: null, text: "POST https://x.test\n", savedText: "", eol: "\n", cursor: 0, scrollTop: 0 });
  useEnvironments.getState().select("prod");
  vi.mocked(api.parseText).mockResolvedValueOnce({ variables: [], requests: [block("POST")], diagnostics: [] });
  vi.mocked(ask).mockResolvedValueOnce(true);
  vi.mocked(api.runRequest).mockResolvedValueOnce(fakeResponse(200));
  await runAt(untitled, 0);
  expect(ask).toHaveBeenCalled();
  expect(api.runRequest).toHaveBeenCalledWith(expect.objectContaining({ path: null, env: "prod", root: null }));
});
```

- [ ] **Step 2: Run the tests and check they fail**

Run: `pnpm vitest run src/state/run.test.ts`
Expected: FAIL. `root` is `null` instead of `"/r"`, and `ask` is never called.

- [ ] **Step 3: Implement**

Replace `runAt` in `src/state/run.ts` with this, adding the imports:

```ts
import { ask } from "@tauri-apps/plugin-dialog";
import { api, toCrabError, type RequestBlock } from "../api";
import { requestIndexAt } from "../lib/outline";
import { isUnder } from "../lib/paths";
import { isDanger, useEnvironments } from "./environments";
import { useOutline } from "./outline";
import { useResponses } from "./responses";
import { useTabs, type Tab } from "./tabs";
import { useWorkspace } from "./workspace";

/** Methods that never change data, so they never ask for confirmation. */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

async function requestAt(tab: Tab, line: number): Promise<RequestBlock | null> {
  const requests = (tab.path ? useOutline.getState().get(tab.path) : undefined) ?? (await api.parseText(tab.text)).requests;
  const i = requestIndexAt(requests, line);
  return i === null ? null : requests[i];
}

/** Ask before a request that may change data goes to a red environment. */
async function confirmDanger(tab: Tab, line: number): Promise<boolean> {
  const env = useEnvironments.getState();
  if (!env.selected || !env.confirmDanger || !isDanger(env, env.selected)) return true;
  const request = await requestAt(tab, line);
  if (!request || SAFE_METHODS.has(request.method.toUpperCase())) return true;
  return ask(`Send ${request.method.toUpperCase()} ${request.url} to ${env.selected}?`, {
    title: "Crab", kind: "warning", okLabel: "Send", cancelLabel: "Cancel",
  });
}

/** Run the request whose block contains `line` (0-based) using the tab's current, possibly unsaved, text. */
export async function runAt(tabId: string, line: number): Promise<void> {
  const tab = useTabs.getState().tabs.find((t) => t.id === tabId);
  if (!tab) return;
  if (!(await confirmDanger(tab, line))) return;
  cancelActive(tabId);
  const runId = crypto.randomUUID();
  useResponses.getState().start(tabId, runId, line);
  const path = tab.path;
  const root = path ? (useWorkspace.getState().allRoots().find((r) => isUnder(path, r)) ?? null) : null;
  try {
    const response = await api.runRequest({ runId, path, text: tab.text, line, env: useEnvironments.getState().selected, root });
    useResponses.getState().finish(tabId, runId, response);
  } catch (e) {
    useResponses.getState().fail(tabId, runId, toCrabError(e));
  }
}
```

If `Tab` isn't exported from `./tabs`, check: it is, at `src/state/tabs.ts:6`. Keep `cancelActive` unchanged.

- [ ] **Step 4: Run the tests and check they pass**

Run: `pnpm build && pnpm test`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/state/run.ts src/state/run.test.ts
git commit -m "feat: run with the selected environment and confirm changes sent to red environments"
```

---

### Task 6: Environment UI: status bar menu, colour bar, ▶ colour and the Request tab

**Files:**
- Create: `src/components/EnvMenu.tsx`, `src/components/EnvAccent.tsx`
- Modify: `src/components/StatusBar.tsx` (render `<EnvMenu />` before the dock button)
- Modify: `src/App.tsx` (render `<EnvAccent />` as the first child of `.app`)
- Modify: `src/components/ResponsePanel.tsx:61` (the Request view)
- Modify: `src/editor/theme.ts:11` (gutter colour)
- Modify: `src/styles.css`
- Test: `src/components/env-ui.test.ts` (pure helper only)

**Interfaces:**
- Consumes: `useEnvironments`, `colorOf`, `ENV_COLORS` (Task 4), `api.revealRequest`, `ResponseData.env` and `ResponseData.hasSecrets` (Task 3).
- Produces: `envCssVars(color: EnvColor): { bar: string; marker: string }`, exported from `EnvAccent.tsx` and unit-tested.

- [ ] **Step 1: Write the failing test**

Create `src/components/env-ui.test.ts`:

```ts
import { expect, test } from "vitest";
import { envCssVars } from "./EnvAccent";

test("no colour keeps the bar invisible and the ▶ markers coral", () => {
  expect(envCssVars("none")).toEqual({ bar: "transparent", marker: "var(--accent)" });
});

test("a colour drives both the bar and the markers", () => {
  expect(envCssVars("red")).toEqual({ bar: "var(--env-red)", marker: "var(--env-red)" });
});
```

- [ ] **Step 2: Run the test and check it fails**

Run: `pnpm vitest run src/components/env-ui.test.ts`
Expected: FAIL, because `./EnvAccent` doesn't exist.

- [ ] **Step 3: Implement**

Create `src/components/EnvAccent.tsx`:

```tsx
import { useEffect } from "react";
import { colorOf, useEnvironments, type EnvColor } from "../state/environments";

export function envCssVars(color: EnvColor): { bar: string; marker: string } {
  return color === "none" ? { bar: "transparent", marker: "var(--accent)" } : { bar: `var(--env-${color})`, marker: `var(--env-${color})` };
}

/** A bar across the top of the window in the environment's colour; also tints the ▶ markers and, for red, the status bar. */
export function EnvAccent() {
  const color = useEnvironments((s) => colorOf(s, s.selected));
  useEffect(() => {
    const root = document.documentElement;
    const vars = envCssVars(color);
    root.style.setProperty("--env-color", vars.bar);
    root.style.setProperty("--env-marker", vars.marker);
    root.dataset.envDanger = String(color === "red");
  }, [color]);
  return <div className="env-bar" aria-hidden="true" />;
}
```

Create `src/components/EnvMenu.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import { colorOf, ENV_COLORS, useEnvironments } from "../state/environments";

/** Status bar control: pick the environment, its colour, and whether red environments ask before changes. */
export function EnvMenu() {
  const names = useEnvironments((s) => s.names);
  const selected = useEnvironments((s) => s.selected);
  const colors = useEnvironments((s) => s.colors);
  const confirmDanger = useEnvironments((s) => s.confirmDanger);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const env = useEnvironments.getState();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Keep Escape from also cancelling a running request.
      e.stopPropagation();
      setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const choose = (name: string | null) => { env.select(name); setOpen(false); };
  const color = colorOf({ colors }, selected);
  const missing = selected !== null && !names.includes(selected);

  return (
    <div className="env-menu" ref={ref}>
      <button className={`env-button env-${color}`} title="Environment" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="env-dot" aria-hidden="true">●</span>
        {selected ?? "No environment"}{missing ? " (not found)" : ""}
      </button>
      {open && (
        <div className="env-popup" role="menu">
          {names.length === 0 && (
            <div className="env-empty">No http-client.env.json found in the workspace. See "Environments" in the README.</div>
          )}
          {names.map((n) => (
            <button key={n} role="menuitemradio" aria-checked={n === selected} className={`env-item env-${colorOf({ colors }, n)}`} onClick={() => choose(n)}>
              <span className="check">{n === selected ? "✓" : ""}</span>
              <span className="env-dot" aria-hidden="true">●</span>
              {n}
            </button>
          ))}
          <button role="menuitemradio" aria-checked={selected === null} className="env-item" onClick={() => choose(null)}>
            <span className="check">{selected === null ? "✓" : ""}</span>No environment
          </button>
          {selected && (
            <>
              <hr />
              <div className="env-colors">
                <span>Colour of {selected}</span>
                {ENV_COLORS.map((c) => (
                  <button key={c} title={c} aria-label={`${c} colour`} aria-pressed={color === c} className={`swatch env-${c}`} onClick={() => env.setColor(selected, c)} />
                ))}
              </div>
            </>
          )}
          <hr />
          <label className="env-confirm">
            <input type="checkbox" checked={confirmDanger} onChange={(e) => env.setConfirmDanger(e.currentTarget.checked)} />
            Confirm before sending changes to red environments
          </label>
        </div>
      )}
    </div>
  );
}
```

In `src/components/StatusBar.tsx`, add `import { EnvMenu } from "./EnvMenu";` and render `<EnvMenu />` right before the `<button title="Move the response panel" …>`.

In `src/App.tsx`, add `import { EnvAccent } from "./components/EnvAccent";` and make `<EnvAccent />` the first child inside `<div className="app">`.

In `src/editor/theme.ts:11`, change `color: "var(--accent)"` to `color: "var(--env-marker, var(--accent))"`.

In `src/components/ResponsePanel.tsx`, add `import { useState } from "react";` (merge with the existing React import if there is one), `import { api, type ResolvedRequest } from "../api";` (merge), `import { colorOf, useEnvironments } from "../state/environments";` and `import { showError } from "../ui/actions";`. Replace line 61 with:

```tsx
        {view === "request" && <RequestView key={run.runId} runId={run.runId} r={r} />}
```

and add the component:

```tsx
/** What was sent, with its environment; secrets stay masked until revealed (re-masked on a new run). */
function RequestView({ runId, r }: { runId: string; r: ResponseData }) {
  const colors = useEnvironments((s) => s.colors);
  const [revealed, setRevealed] = useState<ResolvedRequest | null>(null);
  const toggle = () => {
    if (revealed) return setRevealed(null);
    api.revealRequest(runId).then((req) => { if (req) setRevealed(req); }).catch(showError);
  };
  return (
    <div className="request-view">
      <div className="request-env">
        Environment:{" "}
        {r.env ? <><span className={`env-dot env-${colorOf({ colors }, r.env)}`} aria-hidden="true">●</span> {r.env}</> : "none"}
        {r.hasSecrets && <button onClick={toggle}>{revealed ? "Hide secrets" : "Reveal secrets"}</button>}
      </div>
      <CodeView text={formatRequest(revealed ?? r.request)} lang="http" />
    </div>
  );
}
```

(`run` is the `RunState` already in scope where line 61 renders. If the variable has a different name there, use it.)

Append to `src/styles.css`:

```css
/* environments */
:root { --env-green: var(--ok); --env-blue: var(--redirect); --env-amber: var(--client-error); --env-red: var(--server-error); }
.env-green { --c: var(--env-green); } .env-blue { --c: var(--env-blue); } .env-amber { --c: var(--env-amber); } .env-red { --c: var(--env-red); }
.env-bar { height: 3px; flex: none; background: var(--env-color, transparent); }
:root[data-env-danger="true"] .statusbar { background: color-mix(in srgb, var(--env-red) 14%, var(--bg-alt)); }
.env-dot { color: var(--c, var(--fg-muted)); }
.env-menu { position: relative; }
.env-button { display: flex; gap: 4px; align-items: center; }
.env-popup { position: absolute; bottom: calc(100% + 4px); right: 0; z-index: 50; min-width: 240px; display: flex; flex-direction: column; padding: 4px; background: var(--bg); border: 1px solid var(--border); border-radius: 6px; box-shadow: 0 8px 24px rgb(0 0 0 / .2); }
.env-popup hr { border: none; border-top: 1px solid var(--border); margin: 4px 0; width: 100%; }
.env-item { display: flex; gap: 6px; align-items: center; text-align: left; }
.env-item .check { width: 12px; }
.env-empty { padding: 4px 6px; color: var(--fg-muted); max-width: 260px; white-space: normal; }
.env-colors { display: flex; gap: 6px; align-items: center; padding: 4px 6px; }
.env-colors span { flex: 1; color: var(--fg-muted); }
.swatch { width: 16px; height: 16px; padding: 0; border-radius: 50%; border: 1px solid var(--border); background: var(--c, transparent); }
.swatch[aria-pressed="true"] { outline: 2px solid var(--fg); outline-offset: 1px; }
.env-confirm { display: flex; gap: 6px; align-items: center; padding: 4px 6px; }
.env-confirm input { flex: none; }
.request-view { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.request-view > :last-child { flex: 1; min-height: 0; }
.request-env { display: flex; gap: 6px; align-items: center; padding: 4px 10px; border-bottom: 1px solid var(--border); color: var(--fg-muted); font-size: 12px; }
.request-env button { margin-left: auto; }
```

- [ ] **Step 4: Run the tests and the app**

Run: `pnpm build && pnpm test`
Expected: all tests pass.

Then `pnpm tauri dev` with a test folder holding `http-client.env.json` (`{"dev": {"host": "httpbin.org"}, "prod": {"host": "httpbin.org"}}`), `http-client.private.env.json` (`{"prod": {"token": "s3cret-token"}}`) and `a.http` (`POST https://{{host}}/post\nAuthorization: Bearer {{token}}\n`):
- The status bar shows `● No environment`. Choosing `prod` shows a red bar at the top, a red-tinted status bar and red ▶ markers.
- ⌘Enter asks `Send POST https://{{host}}/post to prod?`. Cancel doesn't run it, and Send does.
- The Request tab shows `Environment: ● prod` and `Bearer ••••••`. Reveal shows `s3cret-token`, and running again masks it.
- Setting `prod`'s colour to none removes the bar and stops the prompt.
- Restart, and the selection and colour are still there.

- [ ] **Step 5: Commit**

```bash
git add src
git commit -m "feat: environment menu, colour bar, coloured run markers and masked Request tab"
```

---

### Task 7: Docs

**Files:**
- Modify: `README.md` (feature line and a new `## Environments` section after "Quick start")
- Modify: `CHANGELOG.md` (Unreleased → Added)
- Modify: `ROADMAP.md` (remove the env item from M2)
- Regenerate: `website/llms-full.txt`

- [ ] **Step 1: Write the docs**

README feature list, add after the **Variables** bullet:

```markdown
- **Environments:** `http-client.env.json`, `http-client.private.env.json` and `.env`. Pick one in the status bar, give it a colour, and Crab asks before sending changes to red (production) environments. Private values are masked.
```

New section after "Quick start":

````markdown
## Environments

Put an `http-client.env.json` next to your `.http` files, or in any folder above them inside the workspace folder:

```json
{
  "$shared": { "version": "v1" },
  "dev":  { "host": "localhost:8080" },
  "prod": { "host": "api.example.com" }
}
```

Keep secrets in `http-client.private.env.json`, which uses the same shape, and add that file to `.gitignore`. Values from the private file are shown as `••••••` in the Request tab, and **Reveal secrets** shows them.

Choose the environment in the status bar. `{{name}}` is looked up in this order:
1. `@name` file variables
2. the private file's environment
3. the public file's environment
4. `$shared` (private, then public)
5. `.env`

`{{$dotenv NAME}}` reads `.env` only.

Environments named like `prod`, `production` or `live` are red by default. You can give any environment a colour in the status bar menu. With a red environment selected, Crab asks before sending a POST, PUT, PATCH or DELETE. You can turn this off in the same menu.
````

CHANGELOG, under `## [Unreleased]` → `### Added`:

```markdown
- Environments from `http-client.env.json`, `http-client.private.env.json` and `.env`, picked in the status bar. Each environment can have a colour, red environments ask before sending changes, and private values are masked in the Request tab.
```

ROADMAP: delete the line `  - Support \`http-client.env.json\` + \`http-client.private.env.json\` and \`.env\`, with an env switcher per file or workspace.`, and the line `  - Secrets stay out of tracked files.`. M2 then only lists history.

- [ ] **Step 2: Regenerate and verify**

Run: `pnpm site:llms && pnpm test && pnpm build && cargo test --workspace && cargo clippy --workspace --all-targets -- -D warnings`
Expected: everything passes, including `scripts/website-llms.test.mjs`.

- [ ] **Step 3: Commit**

```bash
git add README.md CHANGELOG.md ROADMAP.md website/llms-full.txt
git commit -m "docs: environments"
```
