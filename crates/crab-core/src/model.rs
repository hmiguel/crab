use serde::{Serialize, Serializer};

/// Inclusive, 0-based line range of a request block (from its `###` separator to the line before the next one).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Span {
    pub start_line: usize,
    pub end_line: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Header {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", content = "value", rename_all = "camelCase")]
pub enum BodySource {
    Inline(String),
    /// `< ./path` — path relative to the .http file
    File(String),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestBlock {
    pub name: Option<String>,
    pub method: String,
    pub url: String,
    pub headers: Vec<Header>,
    pub body: Option<BodySource>,
    pub span: Span,
    pub request_line: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct FileVar {
    pub name: String,
    pub value: String,
    pub line: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Diagnostic {
    pub line: usize,
    pub message: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct ParsedFile {
    pub variables: Vec<FileVar>,
    pub requests: Vec<RequestBlock>,
    pub diagnostics: Vec<Diagnostic>,
}

impl ParsedFile {
    pub fn request_at_line(&self, line: usize) -> Option<&RequestBlock> {
        self.requests.iter().find(|r| r.span.start_line <= line && line <= r.span.end_line)
    }
}

/// A request with every `{{variable}}` substituted, ready to send.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedRequest {
    pub method: String,
    pub url: String,
    pub headers: Vec<Header>,
    #[serde(serialize_with = "serialize_body")]
    pub body: Option<Vec<u8>>,
}

fn serialize_body<S: Serializer>(body: &Option<Vec<u8>>, s: S) -> Result<S::Ok, S::Error> {
    match body {
        Some(bytes) => s.serialize_some(&String::from_utf8_lossy(bytes)),
        None => s.serialize_none(),
    }
}
