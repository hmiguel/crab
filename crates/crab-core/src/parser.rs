//! Parser for `.http` / `.rest` files (JetBrains HTTP Client and VS Code REST Client format).

use crate::model::{BodySource, Diagnostic, FileVar, Header, ParsedFile, RequestBlock, Span};

const METHODS: &[&str] = &["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "TRACE", "CONNECT"];

#[derive(PartialEq)]
enum Phase {
    Preamble,
    Headers,
    Body,
}

struct BlockBuilder {
    start_line: usize,
    name: Option<String>,
    request_line: Option<usize>,
    method: String,
    url: String,
    headers: Vec<Header>,
    body_lines: Vec<String>,
    in_handler: bool,
    phase: Phase,
}

impl BlockBuilder {
    fn new(start_line: usize, name: Option<String>) -> Self {
        Self {
            start_line,
            name,
            request_line: None,
            method: String::new(),
            url: String::new(),
            headers: Vec::new(),
            body_lines: Vec::new(),
            in_handler: false,
            phase: Phase::Preamble,
        }
    }

    /// Skips JetBrains response-handler lines (`> {% … %}`, `>> file`, …). Returns true when `trimmed` was consumed.
    fn skip_handler_line(&mut self, trimmed: &str) -> bool {
        if self.in_handler {
            if trimmed.ends_with("%}") {
                self.in_handler = false;
            }
            return true;
        }
        if let Some(rest) = trimmed.strip_prefix("> {%") {
            if !rest.trim_end().ends_with("%}") {
                self.in_handler = true;
            }
            return true;
        }
        is_handler_start(trimmed)
    }

    fn finish(self, end_line: usize, out: &mut ParsedFile) {
        let Some(request_line) = self.request_line else { return };
        let mut lines = self.body_lines;
        while lines.last().is_some_and(|l| l.trim().is_empty()) {
            lines.pop();
        }
        let first_content = lines.iter().position(|l| !l.trim().is_empty()).unwrap_or(lines.len());
        lines.drain(..first_content);
        let body = match lines.as_slice() {
            [] => None,
            [only] => match only.trim_start().strip_prefix("< ") {
                Some(path) => Some(BodySource::File(path.trim().to_string())),
                None => Some(BodySource::Inline(only.clone())),
            },
            _ => Some(BodySource::Inline(lines.join("\n"))),
        };
        out.requests.push(RequestBlock {
            name: self.name,
            method: self.method,
            url: self.url,
            headers: self.headers,
            body,
            span: Span { start_line: self.start_line, end_line },
            request_line,
        });
    }
}

pub fn parse(text: &str) -> ParsedFile {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let lines: Vec<&str> = text.lines().collect();
    let mut out = ParsedFile::default();
    let mut block = BlockBuilder::new(0, None);

    for (i, raw) in lines.iter().enumerate() {
        let line = raw.trim_end();
        let trimmed = line.trim();

        if trimmed.starts_with("###") {
            block.finish(i.saturating_sub(1), &mut out);
            let name = trimmed.trim_start_matches('#').trim();
            block = BlockBuilder::new(i, (!name.is_empty()).then(|| name.to_string()));
            continue;
        }

        match block.phase {
            Phase::Preamble => {
                if trimmed.is_empty() {
                    continue;
                }
                if let Some((name, value)) = parse_file_var(trimmed) {
                    out.variables.push(FileVar { name, value, line: i });
                    continue;
                }
                if let Some(comment) = comment_text(trimmed) {
                    if let Some(name) = comment.trim().strip_prefix("@name") {
                        let name = name.trim().trim_start_matches('=').trim();
                        if !name.is_empty() {
                            block.name = Some(name.to_string());
                        }
                    }
                    continue;
                }
                let (method, url) = parse_request_line(trimmed);
                if url.is_empty() {
                    out.diagnostics.push(Diagnostic { line: i, message: "Request line has no URL".into() });
                    continue;
                }
                block.method = method;
                block.url = url;
                block.request_line = Some(i);
                block.phase = Phase::Headers;
            }
            Phase::Headers => {
                if trimmed.is_empty() {
                    block.phase = Phase::Body;
                    continue;
                }
                if block.headers.is_empty() && (trimmed.starts_with('?') || trimmed.starts_with('&')) {
                    block.url.push_str(trimmed);
                    continue;
                }
                if comment_text(trimmed).is_some() {
                    continue;
                }
                // A handler may follow the headers without a blank line; the body (if any) is over.
                if is_handler_start(trimmed) {
                    block.phase = Phase::Body;
                    block.skip_handler_line(trimmed);
                    continue;
                }
                match trimmed.split_once(':') {
                    Some((name, value)) if is_header_name(name.trim()) => block.headers.push(Header {
                        name: name.trim().to_string(),
                        value: value.trim().to_string(),
                    }),
                    _ => out.diagnostics.push(Diagnostic { line: i, message: format!("Invalid header line: {trimmed}") }),
                }
            }
            Phase::Body => {
                if !block.skip_handler_line(trimmed) {
                    block.body_lines.push(line.to_string());
                }
            }
        }
    }

    block.finish(lines.len().saturating_sub(1), &mut out);
    out
}

fn is_handler_start(trimmed: &str) -> bool {
    ["> ", ">> ", ">>! ", "<> "].iter().any(|p| trimmed.starts_with(p))
}

fn comment_text(trimmed: &str) -> Option<&str> {
    trimmed.strip_prefix("//").or_else(|| trimmed.strip_prefix('#'))
}

fn parse_file_var(trimmed: &str) -> Option<(String, String)> {
    let rest = trimmed.strip_prefix('@')?;
    let (name, value) = rest.split_once('=')?;
    let name = name.trim();
    let valid = !name.is_empty() && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.'));
    valid.then(|| (name.to_string(), value.trim().to_string()))
}

fn parse_request_line(trimmed: &str) -> (String, String) {
    let line = match trimmed.rfind(" HTTP/") {
        Some(idx) => trimmed[..idx].trim_end(),
        None => trimmed,
    };
    let (first, rest) = line.split_once(char::is_whitespace).unwrap_or((line, ""));
    let upper = first.to_ascii_uppercase();
    if METHODS.contains(&upper.as_str()) {
        (upper, rest.trim().to_string())
    } else {
        ("GET".to_string(), line.to_string())
    }
}

fn is_header_name(name: &str) -> bool {
    !name.is_empty() && name.chars().all(|c| c.is_ascii_alphanumeric() || "!#$%&'*+-.^_`|~{}".contains(c))
}
