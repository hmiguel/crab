use crab_core::error::{CrabError, ErrorKind};
use crab_core::exec::{ResponseData, Timing};
use crab_core::history::{History, ListQuery, NewRun, RequestKey, MAX_BODY_BYTES};
use crab_core::model::{Header, ResolvedRequest};
use crab_core::request_key;

fn masked(url: &str) -> ResolvedRequest {
    ResolvedRequest { method: "GET".into(), url: url.into(), headers: vec![], body: None, secrets: vec![] }
}

fn response(req: &ResolvedRequest, body: &str) -> ResponseData {
    ResponseData {
        status: 200,
        status_text: "OK".into(),
        http_version: "HTTP/1.1".into(),
        headers: vec![Header { name: "content-type".into(), value: "application/json".into() }],
        content_type: Some("application/json".into()),
        body_text: body.into(),
        body_base64: None,
        truncated: false,
        size_bytes: body.len() as u64,
        timing: Timing { total_ms: 12.5, ttfb_ms: 3.0 },
        request: req.clone(),
        has_secrets: false,
        env: Some("dev".into()),
        history_id: None,
    }
}

fn key(k: &str) -> RequestKey {
    RequestKey { key: k.into(), name: None, line: 0 }
}

fn ok_run(at: i64, k: &str, url: &str, body: &str) -> NewRun {
    let req = masked(url);
    NewRun::from_outcome(at, Some("/r/a.http".into()), key(k), Some("dev".into()), &req, &Ok(response(&req, body))).unwrap()
}

fn open() -> (tempfile::TempDir, History) {
    let dir = tempfile::tempdir().unwrap();
    let h = History::open(&dir.path().join("sub/history.db")).unwrap();
    (dir, h)
}

fn q() -> ListQuery {
    ListQuery { limit: 50, ..Default::default() }
}

#[test]
fn round_trips_a_successful_run() {
    let (_d, h) = open();
    let id = h.record(&ok_run(1000, "GET {{host}}/a", "https://x/a?k=••••••", r#"{"hello":"world"}"#)).unwrap();
    let list = h.list(&q()).unwrap();
    assert_eq!(list.len(), 1);
    let s = &list[0];
    assert_eq!((s.id, s.at_ms, s.status, s.env.as_deref()), (id, 1000, Some(200), Some("dev")));
    assert_eq!(s.url, "https://x/a?k=••••••");
    assert_eq!(s.request_key, "GET {{host}}/a");
    let past = h.get(id).unwrap().unwrap();
    let resp = past.response.unwrap();
    assert_eq!(resp["bodyText"], r#"{"hello":"world"}"#);
    assert_eq!(resp["historyId"], id);
    assert_eq!(resp["timing"]["totalMs"], 12.5);
    assert_eq!(past.request["url"], "https://x/a?k=••••••");
    assert!(h.get(id + 1).unwrap().is_none());
}

#[test]
fn records_sent_errors_but_not_pre_send_errors() {
    let (_d, h) = open();
    let req = masked("https://down.test");
    for (kind, recorded) in [
        (ErrorKind::Network, true),
        (ErrorKind::Timeout, true),
        (ErrorKind::Cancelled, true),
        (ErrorKind::Parse, false),
        (ErrorKind::UnresolvedVars, false),
        (ErrorKind::Env, false),
        (ErrorKind::Io, false),
    ] {
        let run = NewRun::from_outcome(1, None, key("k"), None, &req, &Err(CrabError::new(kind, "boom")));
        assert_eq!(run.is_some(), recorded, "{kind:?}");
        if let Some(run) = run {
            h.record(&run).unwrap();
        }
    }
    let list = h.list(&q()).unwrap();
    assert_eq!(list.len(), 3);
    assert_eq!(list[0].error_kind.as_deref(), Some("cancelled"));
    assert_eq!(list[0].status, None);
    let past = h.get(list[0].id).unwrap().unwrap();
    assert!(past.response.is_none());
    assert_eq!(past.summary.error_message.as_deref(), Some("boom"));
}

#[test]
fn body_is_capped_on_a_char_boundary() {
    let (_d, h) = open();
    // 'é' is 2 bytes; put one across the cap.
    let body = format!("{}é{}", "a".repeat(MAX_BODY_BYTES - 1), "b".repeat(10));
    let id = h.record(&ok_run(1, "k", "https://x", &body)).unwrap();
    let resp = h.get(id).unwrap().unwrap().response.unwrap();
    let stored = resp["bodyText"].as_str().unwrap();
    assert_eq!(stored.len(), MAX_BODY_BYTES - 1);
    assert_eq!(resp["truncated"], true);
}

#[test]
fn prunes_to_the_limit_including_the_search_index() {
    let dir = tempfile::tempdir().unwrap();
    let h = History::open(&dir.path().join("h.db")).unwrap().with_limit(3);
    for i in 0..5 {
        h.record(&ok_run(i, "k", "https://x", &format!("body word{i}"))).unwrap();
    }
    let list = h.list(&q()).unwrap();
    assert_eq!(list.iter().map(|s| s.at_ms).collect::<Vec<_>>(), vec![4, 3, 2]);
    let old = h.list(&ListQuery { query: Some("word0".into()), ..q() }).unwrap();
    assert!(old.is_empty());
}

#[test]
fn searches_bodies_names_and_urls_by_word_prefix() {
    let (_d, h) = open();
    h.record(&ok_run(1, "k", "https://x/orders", r#"{"customer":"Ada"}"#)).unwrap();
    h.record(&ok_run(2, "k", "https://x/users", r#"{"customer":"Grace"}"#)).unwrap();
    let hits = |s: &str| h.list(&ListQuery { query: Some(s.into()), ..q() }).unwrap().iter().map(|r| r.at_ms).collect::<Vec<_>>();
    assert_eq!(hits("grace"), vec![2]);
    assert_eq!(hits("orde"), vec![1]);
    assert_eq!(hits("customer"), vec![2, 1]);
    assert_eq!(hits("  "), vec![2, 1]);
}

#[test]
fn search_input_is_never_fts_syntax() {
    let (_d, h) = open();
    h.record(&ok_run(1, "k", "https://x", r#"{"note":"a-b: c*d \"quoted\" AND ("}"#)).unwrap();
    for input in ["\"", "*", "a-b", "b:", "AND", "(", "\"quoted", "c*d", "NEAR(a b)"] {
        assert!(h.list(&ListQuery { query: Some(input.into()), ..q() }).is_ok(), "{input}");
    }
    assert_eq!(h.list(&ListQuery { query: Some("quoted".into()), ..q() }).unwrap().len(), 1);
}

#[test]
fn filters_by_path_and_key_and_pages_with_before() {
    let (_d, h) = open();
    for i in 0..4 {
        h.record(&ok_run(i, if i % 2 == 0 { "even" } else { "odd" }, "https://x", "b")).unwrap();
    }
    let even = h.list(&ListQuery { path: Some("/r/a.http".into()), key: Some("even".into()), ..q() }).unwrap();
    assert_eq!(even.iter().map(|s| s.at_ms).collect::<Vec<_>>(), vec![2, 0]);
    assert!(h.list(&ListQuery { path: Some("/other.http".into()), ..q() }).unwrap().is_empty());
    let first = h.list(&ListQuery { limit: 2, ..q() }).unwrap();
    let next = h.list(&ListQuery { limit: 2, before: Some(first[1].id), ..q() }).unwrap();
    assert_eq!(next.iter().map(|s| s.at_ms).collect::<Vec<_>>(), vec![1, 0]);
}

#[test]
fn clear_removes_everything_and_reopening_keeps_data() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("h.db");
    History::open(&path).unwrap().record(&ok_run(1, "k", "https://x", "kept")).unwrap();
    let h = History::open(&path).unwrap();
    assert_eq!(h.list(&ListQuery { query: Some("kept".into()), ..q() }).unwrap().len(), 1);
    h.clear().unwrap();
    assert!(h.list(&q()).unwrap().is_empty());
    assert!(h.list(&ListQuery { query: Some("kept".into()), ..q() }).unwrap().is_empty());
}

#[cfg(unix)]
#[test]
fn opening_a_read_only_file_fails() {
    use std::os::unix::fs::PermissionsExt;
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("h.db");
    drop(History::open(&path).unwrap());
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o444)).unwrap();
    let err = History::open(&path).err().expect("read-only database must not open");
    assert_eq!(err.kind, ErrorKind::Io);
}

#[test]
fn request_keys_use_the_name_or_method_and_url_as_written() {
    let text = "### \n# @name login\nPOST {{host}}/login\n\n###\nGET {{host}}/orders?x={{id}}\n";
    assert_eq!(request_key(text, 2), Some(RequestKey { key: "login".into(), name: Some("login".into()), line: 2 }));
    assert_eq!(request_key(text, 5), Some(RequestKey { key: "GET {{host}}/orders?x={{id}}".into(), name: None, line: 5 }));
    assert_eq!(request_key("", 0), None);
}

#[test]
fn request_bodies_are_capped_too() {
    let (_d, h) = open();
    let mut req = masked("https://x/upload");
    req.body = Some(vec![b'z'; 3 * MAX_BODY_BYTES]);
    let run = NewRun::from_outcome(1, None, key("k"), None, &req, &Ok(response(&req, "ok"))).unwrap();
    let id = h.record(&run).unwrap();
    let past = h.get(id).unwrap().unwrap();
    let body = past.request["body"].as_str().unwrap();
    assert!(body.len() <= MAX_BODY_BYTES + 64, "{}", body.len());
    assert!(body.ends_with("… (truncated)"));
    assert_eq!(past.response.unwrap()["request"]["body"].as_str().unwrap().len(), body.len());
}

#[test]
fn clear_gives_the_disk_space_back() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("h.db");
    let h = History::open(&path).unwrap();
    let big = "x".repeat(MAX_BODY_BYTES);
    for i in 0..5 {
        h.record(&ok_run(i, "k", "https://x", &big)).unwrap();
    }
    let before = std::fs::metadata(&path).unwrap().len();
    assert!(before > 4 * MAX_BODY_BYTES as u64);
    h.clear().unwrap();
    let after = std::fs::metadata(&path).unwrap().len();
    assert!(after < 256 * 1024, "{after}");
    // Still usable afterwards, search included.
    h.record(&ok_run(9, "k", "https://x", "fresh")).unwrap();
    assert_eq!(h.list(&ListQuery { query: Some("fresh".into()), ..q() }).unwrap().len(), 1);
}
