use std::time::{Duration, Instant};

use base64::Engine;

use serde::Serialize;
use tokio_util::sync::CancellationToken;

use crate::error::{CrabError, ErrorKind};
use crate::model::{Header, ResolvedRequest};

#[derive(Debug, Clone)]
pub struct ExecOptions {
    pub timeout: Duration,
    pub follow_redirects: bool,
    pub verify_tls: bool,
    pub max_body_bytes: usize,
}

impl Default for ExecOptions {
    fn default() -> Self {
        Self { timeout: Duration::from_secs(30), follow_redirects: true, verify_tls: true, max_body_bytes: 50 * 1024 * 1024 }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Timing {
    pub total_ms: f64,
    pub ttfb_ms: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResponseData {
    pub status: u16,
    pub status_text: String,
    pub http_version: String,
    pub headers: Vec<Header>,
    pub content_type: Option<String>,
    pub body_text: String,
    pub body_base64: Option<String>,
    pub truncated: bool,
    pub size_bytes: u64,
    pub timing: Timing,
    pub request: ResolvedRequest,
    /// Set by the app: whether `request` has masked secrets (see `ResolvedRequest::masked`).
    pub has_secrets: bool,
    /// Set by the app: the environment the run used.
    pub env: Option<String>,
}

pub async fn execute(req: &ResolvedRequest, opts: &ExecOptions, cancel: CancellationToken) -> Result<ResponseData, CrabError> {
    tokio::select! {
        biased;
        _ = cancel.cancelled() => Err(CrabError::new(ErrorKind::Cancelled, "Request cancelled")),
        result = send(req, opts) => result,
    }
}

async fn send(req: &ResolvedRequest, opts: &ExecOptions) -> Result<ResponseData, CrabError> {
    let map = |e: reqwest::Error| map_reqwest(e, opts.timeout);
    let redirect = if opts.follow_redirects { reqwest::redirect::Policy::limited(10) } else { reqwest::redirect::Policy::none() };
    let client = reqwest::Client::builder()
        .timeout(opts.timeout)
        .redirect(redirect)
        .danger_accept_invalid_certs(!opts.verify_tls)
        .build()
        .map_err(map)?;
    let method = reqwest::Method::from_bytes(req.method.as_bytes())
        .map_err(|_| CrabError::new(ErrorKind::Parse, format!("Invalid method: {}", req.method)))?;

    let mut builder = client.request(method, &req.url);
    for h in &req.headers {
        builder = builder.header(h.name.as_str(), h.value.as_str());
    }
    if let Some(body) = &req.body {
        builder = builder.body(body.clone());
    }

    let started = Instant::now();
    let mut resp = builder.send().await.map_err(map)?;
    let ttfb = started.elapsed();

    let status = resp.status();
    let http_version = format!("{:?}", resp.version());
    let headers: Vec<Header> = resp
        .headers()
        .iter()
        .map(|(k, v)| Header { name: k.as_str().to_string(), value: String::from_utf8_lossy(v.as_bytes()).into_owned() })
        .collect();
    let content_type = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .map(|v| String::from_utf8_lossy(v.as_bytes()).into_owned());

    let mut body = Vec::new();
    let mut truncated = false;
    while let Some(chunk) = resp.chunk().await.map_err(map)? {
        let room = opts.max_body_bytes.saturating_sub(body.len());
        if chunk.len() > room {
            body.extend_from_slice(&chunk[..room]);
            truncated = true;
            break;
        }
        body.extend_from_slice(&chunk);
    }
    let total = started.elapsed();
    let size_bytes = body.len() as u64;

    let (body_text, body_base64) = match String::from_utf8(body) {
        Ok(text) => (text, None),
        Err(e) => {
            let bytes = e.into_bytes();
            (String::from_utf8_lossy(&bytes).into_owned(), Some(base64::engine::general_purpose::STANDARD.encode(&bytes)))
        }
    };

    Ok(ResponseData {
        status: status.as_u16(),
        status_text: status.canonical_reason().unwrap_or("").to_string(),
        http_version,
        headers,
        content_type,
        body_text,
        body_base64,
        truncated,
        size_bytes,
        timing: Timing { total_ms: total.as_secs_f64() * 1000.0, ttfb_ms: ttfb.as_secs_f64() * 1000.0 },
        request: req.clone(),
        has_secrets: false,
        env: None,
    })
}

fn map_reqwest(e: reqwest::Error, timeout: Duration) -> CrabError {
    // The resolved URL may carry secrets; the UI already knows which request failed.
    let e = e.without_url();
    if e.is_timeout() {
        CrabError::new(ErrorKind::Timeout, format!("Request timed out after {} s", timeout.as_secs_f64()))
    } else if e.is_builder() {
        CrabError::new(ErrorKind::Parse, format!("Invalid request: {}", error_chain(&e)))
    } else {
        CrabError::new(ErrorKind::Network, error_chain(&e))
    }
}

fn error_chain(e: &dyn std::error::Error) -> String {
    let mut message = e.to_string();
    let mut source = e.source();
    while let Some(inner) = source {
        message.push_str(": ");
        message.push_str(&inner.to_string());
        source = inner.source();
    }
    message
}
