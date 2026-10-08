use std::fs;
use std::path::Path;

use crab_core::env::{parse_dotenv, scan_env_files, EnvFiles, FileEnv};
use crab_core::error::ErrorKind;
use crab_core::vars::{EnvProvider, EnvValue};

fn write(dir: &Path, rel: &str, text: &str) {
    let p = dir.join(rel);
    fs::create_dir_all(p.parent().unwrap()).unwrap();
    fs::write(p, text).unwrap();
}

#[test]
fn nearest_files_win_independently_and_the_walk_stops_at_the_root() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("repo");
    write(dir.path(), "http-client.env.json", r#"{"dev": {"host": "above-root"}}"#);
    write(&root, "http-client.env.json", r#"{"dev": {"host": "repo"}}"#);
    write(&root, "api/http-client.env.json", r#"{"dev": {"host": "api"}}"#);
    write(&root, "http-client.private.env.json", r#"{"dev": {"token": "repo-secret"}}"#);
    write(&root, ".env", "PORT=1\n");

    let files = EnvFiles::discover(&root.join("api/users/a.http"), Some(&root)).unwrap();
    let env = FileEnv::new(Some("dev".into()), files);
    assert_eq!(env.get("host"), Some(EnvValue::public("api")));
    assert_eq!(env.get("token"), Some(EnvValue::secret("repo-secret")));
    assert_eq!(env.dotenv("PORT"), Some(EnvValue::public("1")));

    // Directly under the root: never reads the file above it.
    let env = FileEnv::new(Some("dev".into()), EnvFiles::discover(&root.join("a.http"), Some(&root)).unwrap());
    assert_eq!(env.get("host"), Some(EnvValue::public("repo")));
}

#[test]
fn a_file_outside_the_root_only_checks_its_own_folder() {
    let dir = tempfile::tempdir().unwrap();
    write(dir.path(), "http-client.env.json", r#"{"dev": {"host": "parent"}}"#);
    write(dir.path(), "other/http-client.env.json", r#"{"dev": {"host": "own"}}"#);
    let root = dir.path().join("repo");
    fs::create_dir_all(&root).unwrap();
    let env = FileEnv::new(Some("dev".into()), EnvFiles::discover(&dir.path().join("other/a.http"), Some(&root)).unwrap());
    assert_eq!(env.get("host"), Some(EnvValue::public("own")));
    let env = FileEnv::new(Some("dev".into()), EnvFiles::discover(&dir.path().join("x/a.http"), None).unwrap());
    assert_eq!(env.get("host"), None);
}

#[test]
fn lookup_order_private_public_shared_then_dotenv() {
    let dir = tempfile::tempdir().unwrap();
    write(dir.path(), "http-client.env.json", r#"{
        "$shared": {"a": "pub-shared", "b": "pub-shared", "c": "pub-shared", "d": "pub-shared"},
        "dev": {"a": "pub-dev", "b": "pub-dev"}
    }"#);
    write(dir.path(), "http-client.private.env.json", r#"{"$shared": {"c": "priv-shared"}, "dev": {"a": "priv-dev"}}"#);
    write(dir.path(), ".env", "a=dot\ne=dot\n");
    let files = || EnvFiles::discover(&dir.path().join("a.http"), Some(dir.path())).unwrap();

    let dev = FileEnv::new(Some("dev".into()), files());
    assert_eq!(dev.get("a"), Some(EnvValue::secret("priv-dev")));
    assert_eq!(dev.get("b"), Some(EnvValue::public("pub-dev")));
    assert_eq!(dev.get("c"), Some(EnvValue::secret("priv-shared")));
    assert_eq!(dev.get("d"), Some(EnvValue::public("pub-shared")));
    assert_eq!(dev.get("e"), Some(EnvValue::public("dot")));
    assert_eq!(dev.env_name(), Some("dev"));

    // No environment selected: $shared and .env still apply.
    let none = FileEnv::new(None, files());
    assert_eq!(none.get("a"), Some(EnvValue::public("pub-shared")));
    assert_eq!(none.get("e"), Some(EnvValue::public("dot")));
    assert_eq!(none.env_name(), None);
}

#[test]
fn skips_non_scalar_values() {
    let dir = tempfile::tempdir().unwrap();
    write(dir.path(), "http-client.env.json", r#"{"dev": {"port": 8080, "tls": true, "nothing": null, "list": [1], "Security": {"Auth": {"x": 1}}}}"#);
    let env = FileEnv::new(Some("dev".into()), EnvFiles::discover(&dir.path().join("a.http"), None).unwrap());
    assert_eq!(env.get("port"), Some(EnvValue::public("8080")));
    assert_eq!(env.get("tls"), Some(EnvValue::public("true")));
    assert_eq!(env.get("nothing"), None);
    assert_eq!(env.get("list"), None);
    assert_eq!(env.get("Security"), None);
}

#[test]
fn env_json_with_bom_parses() {
    let dir = tempfile::tempdir().unwrap();
    write(dir.path(), "http-client.env.json", "\u{feff}{\"dev\": {\"host\": \"x\"}}\r\n");
    let env = FileEnv::new(Some("dev".into()), EnvFiles::discover(&dir.path().join("a.http"), None).unwrap());
    assert_eq!(env.get("host"), Some(EnvValue::public("x")));
}

#[test]
fn invalid_env_json_is_an_env_error_naming_the_file() {
    let dir = tempfile::tempdir().unwrap();
    write(dir.path(), "http-client.env.json", "{\"dev\": ");
    let err = EnvFiles::discover(&dir.path().join("a.http"), None).unwrap_err();
    assert_eq!(err.kind, ErrorKind::Env);
    assert!(err.message.contains("http-client.env.json"), "{}", err.message);

    write(dir.path(), "http-client.env.json", r#"{"dev": "nope"}"#);
    let err = EnvFiles::discover(&dir.path().join("a.http"), None).unwrap_err();
    assert!(err.message.contains("\"dev\" must be an object"), "{}", err.message);

    write(dir.path(), "http-client.env.json", "[]");
    assert_eq!(EnvFiles::discover(&dir.path().join("a.http"), None).unwrap_err().kind, ErrorKind::Env);
}

#[test]
fn parses_dotenv_files() {
    let vars = parse_dotenv(
        "# comment\n\nexport A=1\nB = two words \nC=\"line\\nbreak \\\"q\\\"\"\nD='single # kept'\nE=value # comment\nnot a line\n=nokey\nF=\n",
    );
    assert_eq!(vars["A"], "1");
    assert_eq!(vars["B"], "two words");
    assert_eq!(vars["C"], "line\nbreak \"q\"");
    assert_eq!(vars["D"], "single # kept");
    assert_eq!(vars["E"], "value");
    assert_eq!(vars["F"], "");
    assert_eq!(vars.len(), 6);
}

#[test]
fn names_merge_public_and_private_without_shared() {
    let dir = tempfile::tempdir().unwrap();
    write(dir.path(), "http-client.env.json", r#"{"$shared": {}, "prod": {}, "dev": {}}"#);
    write(dir.path(), "http-client.private.env.json", r#"{"staging": {}, "dev": {}}"#);
    let files = EnvFiles::discover(&dir.path().join("a.http"), None).unwrap();
    assert_eq!(files.names(), vec!["dev", "prod", "staging"]);
}

#[test]
fn scan_walks_the_root_and_skips_build_folders() {
    let dir = tempfile::tempdir().unwrap();
    write(dir.path(), "a/http-client.env.json", r#"{"dev": {}}"#);
    write(dir.path(), "b/http-client.private.env.json", r#"{"prod": {}}"#);
    write(dir.path(), "node_modules/x/http-client.env.json", r#"{"hidden": {}}"#);
    write(dir.path(), "c/http-client.env.json", "not json");
    let scan = scan_env_files(dir.path());
    assert_eq!(scan.names, vec!["dev", "prod"]);
    assert!(scan.warnings.is_empty());
}

#[test]
fn dotenv_with_bom_keeps_its_first_key() {
    let vars = parse_dotenv("\u{feff}API_KEY=abc\r\nOTHER=1\r\n");
    assert_eq!(vars.get("API_KEY").map(String::as_str), Some("abc"));
    assert_eq!(vars.get("OTHER").map(String::as_str), Some("1"));
}

#[test]
fn crab_names_work_and_mix_with_jetbrains_names() {
    let dir = tempfile::tempdir().unwrap();
    write(dir.path(), "crab.env.json", r#"{"dev": {"host": "crab"}}"#);
    write(dir.path(), "http-client.private.env.json", r#"{"dev": {"token": "jb-secret"}}"#);
    let env = FileEnv::new(Some("dev".into()), EnvFiles::discover(&dir.path().join("a.http"), None).unwrap());
    assert_eq!(env.get("host"), Some(EnvValue::public("crab")));
    assert_eq!(env.get("token"), Some(EnvValue::secret("jb-secret")));

    write(dir.path(), "crab.private.env.json", r#"{"dev": {"token": "crab-secret"}}"#);
    let env = FileEnv::new(Some("dev".into()), EnvFiles::discover(&dir.path().join("a.http"), None).unwrap());
    assert_eq!(env.get("token"), Some(EnvValue::secret("crab-secret")));
}

#[test]
fn the_crab_name_wins_in_the_same_folder_and_the_nearest_folder_wins_across_styles() {
    let dir = tempfile::tempdir().unwrap();
    write(dir.path(), "crab.env.json", r#"{"dev": {"host": "crab"}}"#);
    write(dir.path(), "http-client.env.json", r#"{"dev": {"host": "jetbrains"}}"#);
    write(dir.path(), "sub/http-client.env.json", r#"{"dev": {"host": "sub-jetbrains"}}"#);
    let at = |rel: &str| FileEnv::new(Some("dev".into()), EnvFiles::discover(&dir.path().join(rel), Some(dir.path())).unwrap());
    assert_eq!(at("a.http").get("host"), Some(EnvValue::public("crab")));
    assert_eq!(at("sub/a.http").get("host"), Some(EnvValue::public("sub-jetbrains")));
}

#[test]
fn scan_ignores_the_shadowed_file_and_warns_about_it() {
    let dir = tempfile::tempdir().unwrap();
    write(dir.path(), "api/crab.env.json", r#"{"dev": {}}"#);
    write(dir.path(), "api/http-client.env.json", r#"{"shadowed": {}}"#);
    write(dir.path(), "web/crab.private.env.json", r#"{"prod": {}}"#);
    let scan = scan_env_files(dir.path());
    assert_eq!(scan.names, vec!["dev", "prod"]);
    assert_eq!(scan.warnings.len(), 1);
    let w = &scan.warnings[0];
    assert!(w.starts_with("Both crab.env.json and http-client.env.json in "), "{w}");
    assert!(w.ends_with("; using crab.env.json"), "{w}");
}
