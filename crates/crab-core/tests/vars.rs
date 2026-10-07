use crab_core::error::ErrorKind;
use crab_core::model::FileVar;
use crab_core::prepare_request;
use crab_core::vars::{EnvProvider, NoEnv, Resolver};

fn vars(pairs: &[(&str, &str)]) -> Vec<FileVar> {
    pairs
        .iter()
        .enumerate()
        .map(|(i, (n, v))| FileVar { name: n.to_string(), value: v.to_string(), line: i })
        .collect()
}

#[test]
fn substitutes_file_variables_with_whitespace_inside_braces() {
    let v = vars(&[("host", "api.test")]);
    let r = Resolver::new(&v, &NoEnv);
    assert_eq!(r.resolve("https://{{host}}/{{ host }}").unwrap(), "https://api.test/api.test");
}

#[test]
fn variables_can_reference_other_variables() {
    let v = vars(&[("base", "https://{{host}}"), ("host", "api.test")]);
    assert_eq!(Resolver::new(&v, &NoEnv).resolve("{{base}}/x").unwrap(), "https://api.test/x");
}

#[test]
fn later_definition_wins() {
    let v = vars(&[("a", "1"), ("a", "2")]);
    assert_eq!(Resolver::new(&v, &NoEnv).resolve("{{a}}").unwrap(), "2");
}

#[test]
fn unresolved_variables_are_listed_once_and_sorted() {
    let err = Resolver::new(&[], &NoEnv).resolve("{{missing}} {{other}} {{missing}}").unwrap_err();
    assert_eq!(err.kind, ErrorKind::UnresolvedVars);
    assert_eq!(err.message, "Unresolved variables: missing, other");
}

#[test]
fn circular_variables_error_instead_of_hanging() {
    let v = vars(&[("a", "{{b}}"), ("b", "{{a}}")]);
    let err = Resolver::new(&v, &NoEnv).resolve("{{a}}").unwrap_err();
    assert_eq!(err.kind, ErrorKind::UnresolvedVars);
    assert!(err.message.contains("circular"), "{}", err.message);
}

#[test]
fn env_provider_is_consulted_after_file_vars() {
    struct Env;
    impl EnvProvider for Env {
        fn get(&self, name: &str) -> Option<String> {
            match name {
                "token" => Some("secret".into()),
                "host" => Some("from-env".into()),
                _ => None,
            }
        }
    }
    let v = vars(&[("host", "from-file")]);
    let r = Resolver::new(&v, &Env);
    assert_eq!(r.resolve("{{host}} {{token}}").unwrap(), "from-file secret");
}

#[test]
fn dynamic_variables() {
    let r = Resolver::new(&[], &NoEnv);
    let guid = r.resolve("{{$guid}}").unwrap();
    assert_eq!(guid.len(), 36);
    assert_eq!(guid.matches('-').count(), 4);
    assert_ne!(r.resolve("{{$uuid}}").unwrap(), guid);
    let ts: u64 = r.resolve("{{$timestamp}}").unwrap().parse().unwrap();
    assert!(ts > 1_700_000_000);
    let n: i64 = r.resolve("{{$randomInt}}").unwrap().parse().unwrap();
    assert!((0..1000).contains(&n));
    let n: i64 = r.resolve("{{$randomInt 5 7}}").unwrap().parse().unwrap();
    assert!((5..7).contains(&n));
    assert_eq!(r.resolve("{{$nope}}").unwrap_err().kind, ErrorKind::UnresolvedVars);
}

// lines: 0 @host, 1 "", 2 ###, 3 GET, 4 "", 5 ###, 6 POST, 7 X-Id, 8 Content-Type, 9 "", 10 hello
const TWO_REQUESTS: &str = "@host = api.test\n\n###\nGET https://{{host}}/a\n\n###\nPOST {{host}}/b\nX-Id: {{$guid}}\nContent-Type: text/plain\n\nhello {{host}}\n";

#[test]
fn prepare_request_resolves_the_block_under_the_cursor() {
    let req = prepare_request(TWO_REQUESTS, 8, None, &NoEnv).unwrap();
    assert_eq!(req.method, "POST");
    assert_eq!(req.url, "http://api.test/b", "scheme defaults to http://");
    assert_eq!(req.headers[0].name, "X-Id");
    assert_eq!(req.headers[0].value.len(), 36);
    assert_eq!(req.body.as_deref(), Some("hello api.test".as_bytes()));
    assert_eq!(prepare_request(TWO_REQUESTS, 3, None, &NoEnv).unwrap().url, "https://api.test/a");
}

#[test]
fn prepare_request_outside_any_request_is_a_parse_error() {
    let err = prepare_request(TWO_REQUESTS, 0, None, &NoEnv).unwrap_err();
    assert_eq!(err.kind, ErrorKind::Parse);
    assert_eq!(err.message, "No request at cursor");
}

#[test]
fn prepare_request_reports_the_block_diagnostic() {
    let err = prepare_request("GET\n", 0, None, &NoEnv).unwrap_err();
    assert_eq!(err.kind, ErrorKind::Parse);
    assert_eq!(err.message, "Request line has no URL");
}

#[test]
fn prepare_request_reads_body_file_relative_to_the_http_file() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("payload.json"), b"{\"a\":1}").unwrap();
    let ok = prepare_request("POST https://x.test\n\n< ./payload.json\n", 0, Some(dir.path()), &NoEnv).unwrap();
    assert_eq!(ok.body.unwrap(), b"{\"a\":1}");
    let missing = prepare_request("POST https://x.test\n\n< ./missing.json\n", 0, Some(dir.path()), &NoEnv).unwrap_err();
    assert_eq!(missing.kind, ErrorKind::Io);
    let no_base = prepare_request("POST https://x.test\n\n< ./payload.json\n", 0, None, &NoEnv).unwrap_err();
    assert_eq!(no_base.kind, ErrorKind::Io);
}
