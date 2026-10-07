use std::fs;

use crab_core::error::ErrorKind;
use crab_core::files::{find_http_files, load_json, read_text, write_atomic};

#[test]
fn finds_http_and_rest_files_skipping_build_dirs() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    for p in ["a.http", "nested/b.REST", "nested/c.txt", "node_modules/x.http", ".git/y.http", "target/z.http"] {
        let full = root.join(p);
        fs::create_dir_all(full.parent().unwrap()).unwrap();
        fs::write(full, "GET https://x.test").unwrap();
    }
    assert_eq!(find_http_files(root).unwrap(), vec!["a.http", "nested/b.REST"]);
}

#[test]
fn missing_root_is_an_io_error() {
    let dir = tempfile::tempdir().unwrap();
    let err = find_http_files(&dir.path().join("nope")).unwrap_err();
    assert_eq!(err.kind, ErrorKind::Io);
}

#[test]
fn write_atomic_replaces_contents_and_leaves_no_temp_file() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("api.http");
    write_atomic(&file, b"one").unwrap();
    write_atomic(&file, b"two").unwrap();
    assert_eq!(fs::read_to_string(&file).unwrap(), "two");
    assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
}

#[test]
fn read_text_rejects_non_utf8() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("utf16.http");
    fs::write(&file, [0xff, 0xfe, 0x47, 0x00]).unwrap();
    assert_eq!(read_text(&file).unwrap_err().kind, ErrorKind::Io);
}

#[test]
fn load_json_handles_missing_valid_and_corrupt_files() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("state.json");
    assert_eq!(load_json(&file).unwrap(), None);
    fs::write(&file, r#"{"a":1}"#).unwrap();
    assert_eq!(load_json(&file).unwrap(), Some(serde_json::json!({"a": 1})));
    fs::write(&file, "{oops").unwrap();
    assert_eq!(load_json(&file).unwrap(), None);
    assert!(dir.path().join("state.json.corrupt").exists());
}
