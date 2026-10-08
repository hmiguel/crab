//! `{{variable}}` substitution: file variables, then the environment, plus `$`-prefixed dynamic values.

use std::cell::RefCell;
use std::collections::HashMap;
use std::path::Path;
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};

use rand::Rng;
use regex::{Captures, Regex};

use crate::error::{CrabError, ErrorKind};
use crate::model::{BodySource, FileVar, Header, RequestBlock, ResolvedRequest};

const MAX_DEPTH: usize = 10;

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

pub struct Resolver<'a> {
    file_vars: HashMap<String, String>,
    env: &'a dyn EnvProvider,
    /// Secret values substituted so far, for `ResolvedRequest::masked`.
    secrets: RefCell<Vec<String>>,
}

fn placeholder() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\{\{\s*([^{}]+?)\s*\}\}").expect("valid regex"))
}

impl<'a> Resolver<'a> {
    pub fn new(vars: &[FileVar], env: &'a dyn EnvProvider) -> Self {
        let file_vars = vars.iter().map(|v| (v.name.clone(), v.value.clone())).collect();
        Self { file_vars, env, secrets: RefCell::default() }
    }

    pub fn resolve(&self, input: &str) -> Result<String, CrabError> {
        let mut missing = Vec::new();
        let out = self.resolve_into(input, &mut missing);
        match unresolved_error(missing, self.env.env_name()) {
            Some(err) => Err(err),
            None => Ok(out),
        }
    }

    pub(crate) fn resolve_into(&self, input: &str, missing: &mut Vec<String>) -> String {
        self.expand(input, &mut Vec::new(), missing)
    }

    /// `stack` holds the variable names being expanded, so a cycle is reported on its first re-entry
    /// (bounding the work even for fan-out definitions like `@a = {{a}}{{a}}`).
    fn expand(&self, input: &str, stack: &mut Vec<String>, missing: &mut Vec<String>) -> String {
        placeholder()
            .replace_all(input, |caps: &Captures<'_>| {
                let expr = caps[1].trim();
                if stack.len() >= MAX_DEPTH || stack.iter().any(|s| s == expr) {
                    missing.push(format!("{expr} (circular reference)"));
                    return caps[0].to_string();
                }
                match self.lookup(expr) {
                    Some(value) => {
                        stack.push(expr.to_string());
                        let out = self.expand(&value, stack, missing);
                        stack.pop();
                        out
                    }
                    None => {
                        missing.push(expr.to_string());
                        caps[0].to_string()
                    }
                }
            })
            .into_owned()
    }

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
}

fn dynamic_value(expr: &str) -> Option<String> {
    let mut parts = expr.split_whitespace();
    match parts.next()? {
        "guid" | "uuid" => Some(uuid::Uuid::new_v4().to_string()),
        "timestamp" => Some(SystemTime::now().duration_since(UNIX_EPOCH).ok()?.as_secs().to_string()),
        "randomInt" => {
            let min: i64 = parts.next().map_or(Some(0), |s| s.parse().ok())?;
            let max: i64 = parts.next().map_or(Some(1000), |s| s.parse().ok())?;
            (min < max).then(|| rand::thread_rng().gen_range(min..max).to_string())
        }
        _ => None,
    }
}

fn unresolved_error(mut missing: Vec<String>, env: Option<&str>) -> Option<CrabError> {
    if missing.is_empty() {
        return None;
    }
    missing.sort();
    missing.dedup();
    let suffix = env.map(|e| format!(" (environment: {e})")).unwrap_or_default();
    Some(CrabError::new(ErrorKind::UnresolvedVars, format!("Unresolved variables: {}{suffix}", missing.join(", "))))
}

pub fn resolve_request(block: &RequestBlock, resolver: &Resolver, base_dir: Option<&Path>) -> Result<ResolvedRequest, CrabError> {
    let mut missing = Vec::new();

    let mut url = resolver.resolve_into(&block.url, &mut missing).trim().to_string();
    if !url.contains("://") {
        url = format!("http://{url}");
    }

    let mut headers = Vec::with_capacity(block.headers.len());
    for h in &block.headers {
        let name = resolver.resolve_into(&h.name, &mut missing);
        let value = resolver.resolve_into(&h.value, &mut missing);
        headers.push(Header { name, value });
    }

    let body = match &block.body {
        None => None,
        Some(BodySource::Inline(text)) => Some(resolver.resolve_into(text, &mut missing).into_bytes()),
        Some(BodySource::File(path)) => {
            let path = resolver.resolve_into(path, &mut missing);
            if missing.is_empty() {
                Some(read_body_file(&path, base_dir)?)
            } else {
                None
            }
        }
    };

    if let Some(err) = unresolved_error(missing, resolver.env.env_name()) {
        return Err(err);
    }
    Ok(ResolvedRequest { method: block.method.clone(), url, headers, body, secrets: resolver.take_secrets() })
}

fn read_body_file(path: &str, base_dir: Option<&Path>) -> Result<Vec<u8>, CrabError> {
    let p = Path::new(path);
    let full = if p.is_absolute() {
        p.to_path_buf()
    } else {
        let base = base_dir.ok_or_else(|| {
            CrabError::new(ErrorKind::Io, format!("Cannot resolve relative body file \"{path}\" without a saved .http file"))
        })?;
        base.join(p)
    };
    std::fs::read(&full).map_err(|e| CrabError::new(ErrorKind::Io, format!("Cannot read body file {}: {e}", full.display())))
}
