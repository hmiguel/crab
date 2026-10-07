//! Core of Crab: `.http` parsing, variable resolution and request execution.
//! Must not depend on Tauri — it is shared with the future CLI and MCP server.

pub mod error;
pub mod exec;
pub mod model;
pub mod parser;
pub mod vars;

use std::path::Path;

use error::{CrabError, ErrorKind};
use model::ResolvedRequest;
use vars::{EnvProvider, Resolver};

/// Parse `text`, pick the request whose block contains `line` (0-based) and resolve its variables.
pub fn prepare_request(text: &str, line: usize, base_dir: Option<&Path>, env: &dyn EnvProvider) -> Result<ResolvedRequest, CrabError> {
    let parsed = parser::parse(text);
    let Some(block) = parsed.request_at_line(line) else {
        let (start, end) = block_bounds(text, line);
        let message = parsed
            .diagnostics
            .iter()
            .find(|d| (start..=end).contains(&d.line))
            .map_or_else(|| "No request at cursor".to_string(), |d| d.message.clone());
        return Err(CrabError::new(ErrorKind::Parse, message));
    };
    let resolver = Resolver::new(&parsed.variables, env);
    vars::resolve_request(block, &resolver, base_dir)
}

/// Inclusive line range of the `###`-delimited block containing `line`.
fn block_bounds(text: &str, line: usize) -> (usize, usize) {
    let lines: Vec<&str> = text.lines().collect();
    let last = lines.len().saturating_sub(1);
    let is_sep = |i: usize| lines.get(i).is_some_and(|l| l.trim_start().starts_with("###"));
    let start = (0..=line.min(last)).rev().find(|&i| is_sep(i)).unwrap_or(0);
    let end = (line + 1..lines.len()).find(|&i| is_sep(i)).map_or(last, |i| i - 1);
    (start, end)
}
