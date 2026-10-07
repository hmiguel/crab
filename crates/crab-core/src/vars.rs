//! `{{variable}}` substitution: file variables, then the environment, plus `$`-prefixed dynamic values.

use std::collections::HashMap;
use std::path::Path;
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};

use rand::Rng;
use regex::{Captures, Regex};

use crate::error::{CrabError, ErrorKind};
use crate::model::{BodySource, FileVar, Header, RequestBlock, ResolvedRequest};

const MAX_DEPTH: usize = 10;

/// Source of environment values (M2 adds http-client.env.json / .env providers).
pub trait EnvProvider {
    fn get(&self, name: &str) -> Option<String>;
}

pub struct NoEnv;

impl EnvProvider for NoEnv {
    fn get(&self, _name: &str) -> Option<String> {
        None
    }
}

pub struct Resolver<'a> {
    file_vars: HashMap<String, String>,
    env: &'a dyn EnvProvider,
}

fn placeholder() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\{\{\s*([^{}]+?)\s*\}\}").expect("valid regex"))
}

impl<'a> Resolver<'a> {
    pub fn new(vars: &[FileVar], env: &'a dyn EnvProvider) -> Self {
        let file_vars = vars.iter().map(|v| (v.name.clone(), v.value.clone())).collect();
        Self { file_vars, env }
    }

    pub fn resolve(&self, input: &str) -> Result<String, CrabError> {
        let mut missing = Vec::new();
        let out = self.resolve_into(input, &mut missing);
        match unresolved_error(missing) {
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
            return dynamic_value(dynamic);
        }
        self.file_vars.get(expr).cloned().or_else(|| self.env.get(expr))
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

fn unresolved_error(mut missing: Vec<String>) -> Option<CrabError> {
    if missing.is_empty() {
        return None;
    }
    missing.sort();
    missing.dedup();
    Some(CrabError::new(ErrorKind::UnresolvedVars, format!("Unresolved variables: {}", missing.join(", "))))
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

    if let Some(err) = unresolved_error(missing) {
        return Err(err);
    }
    Ok(ResolvedRequest { method: block.method.clone(), url, headers, body })
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
