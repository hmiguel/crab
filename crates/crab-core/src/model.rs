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
    /// Secret values substituted into this request; never sent to the UI.
    #[serde(skip)]
    pub secrets: Vec<String>,
}

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

fn serialize_body<S: Serializer>(body: &Option<Vec<u8>>, s: S) -> Result<S::Ok, S::Error> {
    match body {
        Some(bytes) => s.serialize_some(&String::from_utf8_lossy(bytes)),
        None => s.serialize_none(),
    }
}
