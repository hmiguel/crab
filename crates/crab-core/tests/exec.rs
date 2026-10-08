use std::time::{Duration, Instant};

use crab_core::env::{EnvFiles, FileEnv};
use crab_core::error::ErrorKind;
use crab_core::exec::{execute, ExecOptions};
use crab_core::model::{Header, ResolvedRequest, MASK};
use crab_core::prepare_request;
use tokio_util::sync::CancellationToken;
use wiremock::matchers::{body_string, header, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

fn req(method: &str, url: String) -> ResolvedRequest {
    ResolvedRequest { method: method.into(), url, headers: vec![], body: None, secrets: vec![] }
}

#[tokio::test]
async fn sends_method_headers_and_body_and_returns_response() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/items"))
        .and(header("x-id", "42"))
        .and(body_string("hello"))
        .respond_with(
            ResponseTemplate::new(201).set_body_raw(r#"{"ok":true}"#, "application/json"),
        )
        .expect(1)
        .mount(&server)
        .await;

    let mut r = req("POST", format!("{}/items", server.uri()));
    r.headers.push(Header { name: "X-Id".into(), value: "42".into() });
    r.body = Some(b"hello".to_vec());

    let resp = execute(&r, &ExecOptions::default(), CancellationToken::new()).await.unwrap();
    assert_eq!(resp.status, 201);
    assert_eq!(resp.status_text, "Created");
    assert_eq!(resp.http_version, "HTTP/1.1");
    assert_eq!(resp.content_type.as_deref(), Some("application/json"));
    assert_eq!(resp.body_text, r#"{"ok":true}"#);
    assert_eq!(resp.body_base64, None);
    assert_eq!(resp.size_bytes, 11);
    assert!(!resp.truncated);
    assert!(resp.timing.total_ms >= resp.timing.ttfb_ms);
    assert!(resp.headers.iter().any(|h| h.name == "content-type"));
    assert_eq!(resp.request, r);
}

#[tokio::test]
async fn follows_redirects_only_when_enabled() {
    let server = MockServer::start().await;
    Mock::given(path("/old"))
        .respond_with(ResponseTemplate::new(302).insert_header("location", "/new"))
        .mount(&server)
        .await;
    Mock::given(path("/new")).respond_with(ResponseTemplate::new(200).set_body_string("moved")).mount(&server).await;
    let r = req("GET", format!("{}/old", server.uri()));

    let followed = execute(&r, &ExecOptions::default(), CancellationToken::new()).await.unwrap();
    assert_eq!(followed.status, 200);
    assert_eq!(followed.body_text, "moved");

    let opts = ExecOptions { follow_redirects: false, ..Default::default() };
    assert_eq!(execute(&r, &opts, CancellationToken::new()).await.unwrap().status, 302);
}

#[tokio::test]
async fn times_out() {
    let server = MockServer::start().await;
    Mock::given(path("/slow"))
        .respond_with(ResponseTemplate::new(200).set_delay(Duration::from_secs(2)))
        .mount(&server)
        .await;
    let opts = ExecOptions { timeout: Duration::from_millis(200), ..Default::default() };
    let err = execute(&req("GET", format!("{}/slow", server.uri())), &opts, CancellationToken::new()).await.unwrap_err();
    assert_eq!(err.kind, ErrorKind::Timeout);
}

#[tokio::test]
async fn can_be_cancelled() {
    let server = MockServer::start().await;
    Mock::given(path("/slow"))
        .respond_with(ResponseTemplate::new(200).set_delay(Duration::from_secs(5)))
        .mount(&server)
        .await;
    let token = CancellationToken::new();
    let trigger = token.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(100)).await;
        trigger.cancel();
    });
    let start = Instant::now();
    let err = execute(&req("GET", format!("{}/slow", server.uri())), &ExecOptions::default(), token).await.unwrap_err();
    assert_eq!(err.kind, ErrorKind::Cancelled);
    assert!(start.elapsed() < Duration::from_secs(2));
}

#[tokio::test]
async fn truncates_large_bodies() {
    let server = MockServer::start().await;
    Mock::given(path("/big")).respond_with(ResponseTemplate::new(200).set_body_string("x".repeat(100))).mount(&server).await;
    let opts = ExecOptions { max_body_bytes: 10, ..Default::default() };
    let resp = execute(&req("GET", format!("{}/big", server.uri())), &opts, CancellationToken::new()).await.unwrap();
    assert!(resp.truncated);
    assert_eq!(resp.body_text.len(), 10);
    assert_eq!(resp.size_bytes, 10);
}

#[tokio::test]
async fn binary_bodies_are_base64_encoded() {
    let server = MockServer::start().await;
    Mock::given(path("/img"))
        .respond_with(ResponseTemplate::new(200).insert_header("content-type", "image/png").set_body_bytes(vec![0x89, 0x50, 0x4e, 0x47, 0xff]))
        .mount(&server)
        .await;
    let resp = execute(&req("GET", format!("{}/img", server.uri())), &ExecOptions::default(), CancellationToken::new()).await.unwrap();
    assert_eq!(resp.body_base64.as_deref(), Some("iVBOR/8="));
}

#[tokio::test]
async fn connection_refused_is_a_network_error() {
    let err = execute(&req("GET", "http://127.0.0.1:1/".into()), &ExecOptions::default(), CancellationToken::new()).await.unwrap_err();
    assert_eq!(err.kind, ErrorKind::Network);
}

#[tokio::test]
async fn invalid_url_is_a_parse_error() {
    let err = execute(&req("GET", "http://exa mple.com/".into()), &ExecOptions::default(), CancellationToken::new()).await.unwrap_err();
    assert_eq!(err.kind, ErrorKind::Parse);
}

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
