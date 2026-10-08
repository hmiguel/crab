use crab_core::error::ErrorKind;
use crab_core::model::FileVar;
use crab_core::prepare_request;
use crab_core::model::MASK;
use crab_core::vars::{EnvProvider, EnvValue, NoEnv, Resolver};

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
        fn get(&self, name: &str) -> Option<EnvValue> {
            match name {
                "token" => Some(EnvValue::public("secret")),
                "host" => Some(EnvValue::public("from-env")),
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

#[test]
fn fan_out_self_reference_fails_fast() {
    let v = vars(&[("a", "{{a}}{{a}}{{a}}{{a}}{{a}}{{a}}")]);
    let start = std::time::Instant::now();
    let err = Resolver::new(&v, &NoEnv).resolve("{{a}}").unwrap_err();
    assert!(err.message.contains("circular"), "{}", err.message);
    assert!(start.elapsed() < std::time::Duration::from_secs(1), "took {:?}", start.elapsed());
}

struct SecretEnv;
impl EnvProvider for SecretEnv {
    fn get(&self, name: &str) -> Option<EnvValue> {
        match name {
            "token" => Some(EnvValue::secret("abcd1234")),
            "short" => Some(EnvValue::secret("1")),
            "host" => Some(EnvValue::public("api.test")),
            _ => None,
        }
    }
    fn dotenv(&self, name: &str) -> Option<EnvValue> {
        (name == "PORT").then(|| EnvValue::public("8080"))
    }
    fn env_name(&self) -> Option<&str> {
        Some("prod")
    }
}

#[test]
fn masked_hides_every_occurrence_and_skips_short_secrets() {
    let text = "GET https://{{host}}/?k={{token}}&again={{token}}&n={{short}}\nAuthorization: Bearer {{token}}\nX-Id: {{$guid}}\n\n{\"t\":\"{{token}}\"}\n";
    let req = prepare_request(text, 0, None, &SecretEnv).unwrap();
    assert!(req.url.contains("abcd1234"));
    assert!(req.has_secrets());
    let masked = req.masked();
    assert_eq!(masked.url, format!("https://api.test/?k={MASK}&again={MASK}&n=1"));
    assert_eq!(masked.headers[0].value, format!("Bearer {MASK}"));
    assert_eq!(String::from_utf8(masked.body.clone().unwrap()).unwrap(), format!("{{\"t\":\"{MASK}\"}}"));
    // Resolved once: the dynamic value is identical in both copies.
    assert_eq!(masked.headers[1].value, req.headers[1].value);
    assert!(masked.secrets.is_empty());
}

#[test]
fn only_short_secrets_means_nothing_to_mask() {
    let req = prepare_request("GET https://x.test/{{short}}\n", 0, None, &SecretEnv).unwrap();
    assert!(!req.has_secrets());
    assert_eq!(req.masked().url, "https://x.test/1");
}

#[test]
fn dotenv_dynamic_variable_reads_the_dotenv_provider() {
    let r = Resolver::new(&[], &SecretEnv);
    assert_eq!(r.resolve("{{$dotenv PORT}}").unwrap(), "8080");
    assert_eq!(r.resolve("{{$dotenv NOPE}}").unwrap_err().kind, ErrorKind::UnresolvedVars);
    assert_eq!(Resolver::new(&[], &NoEnv).resolve("{{$dotenv PORT}}").unwrap_err().kind, ErrorKind::UnresolvedVars);
}

#[test]
fn unresolved_error_names_the_environment() {
    let err = Resolver::new(&[], &SecretEnv).resolve("{{missing}}").unwrap_err();
    assert_eq!(err.message, "Unresolved variables: missing (environment: prod)");
    let err = Resolver::new(&[], &NoEnv).resolve("{{missing}}").unwrap_err();
    assert_eq!(err.message, "Unresolved variables: missing");
}
