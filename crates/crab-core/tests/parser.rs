use crab_core::model::{BodySource, Header, Span};
use crab_core::parser::parse;

fn h(name: &str, value: &str) -> Header {
    Header { name: name.into(), value: value.into() }
}

#[test]
fn single_get_without_separator() {
    let p = parse("GET https://example.com/users\n");
    assert_eq!(p.requests.len(), 1);
    let r = &p.requests[0];
    assert_eq!(r.method, "GET");
    assert_eq!(r.url, "https://example.com/users");
    assert_eq!(r.request_line, 0);
    assert!(r.headers.is_empty());
    assert_eq!(r.body, None);
    assert!(p.diagnostics.is_empty());
}

#[test]
fn url_only_line_defaults_to_get_and_strips_http_version() {
    let p = parse("https://example.com HTTP/1.1");
    assert_eq!(p.requests[0].method, "GET");
    assert_eq!(p.requests[0].url, "https://example.com");
}

#[test]
fn lowercase_method_is_normalised() {
    assert_eq!(parse("post https://x.test").requests[0].method, "POST");
}

#[test]
fn headers_and_inline_body() {
    let text = "POST https://api.test/items\nContent-Type: application/json\nAuthorization: Bearer {{token}}\n\n{\n  \"a\": 1\n}\n\n";
    let r = &parse(text).requests[0];
    assert_eq!(r.headers, vec![h("Content-Type", "application/json"), h("Authorization", "Bearer {{token}}")]);
    assert_eq!(r.body, Some(BodySource::Inline("{\n  \"a\": 1\n}".into())));
}

#[test]
fn separators_names_and_spans() {
    // lines: 0 "### First", 1 GET, 2 "", 3 "###", 4 "# @name second", 5 POST, 6 "", 7 "body"
    let text = "### First\nGET https://a.test\n\n###\n# @name second\nPOST https://b.test\n\nbody\n";
    let p = parse(text);
    assert_eq!(p.requests.len(), 2);
    assert_eq!(p.requests[0].name.as_deref(), Some("First"));
    assert_eq!(p.requests[0].span, Span { start_line: 0, end_line: 2 });
    assert_eq!(p.requests[0].request_line, 1);
    assert_eq!(p.requests[1].name.as_deref(), Some("second"));
    assert_eq!(p.requests[1].span, Span { start_line: 3, end_line: 7 });
    assert_eq!(p.requests[1].request_line, 5);
    assert_eq!(p.requests[1].body, Some(BodySource::Inline("body".into())));
}

#[test]
fn file_variables_are_collected_from_any_block() {
    let text = "@host = api.test\n@token=abc\n\nGET https://{{host}}/x\n\n###\n@later = 1\nGET https://{{host}}/y\n";
    let p = parse(text);
    let names: Vec<_> = p.variables.iter().map(|v| (v.name.as_str(), v.value.as_str(), v.line)).collect();
    assert_eq!(names, vec![("host", "api.test", 0), ("token", "abc", 1), ("later", "1", 6)]);
    assert_eq!(p.requests.len(), 2);
}

#[test]
fn comments_are_ignored_outside_body() {
    let p = parse("# a comment\n// another\nGET https://x.test\n# header comment\nAccept: */*\n");
    assert_eq!(p.requests.len(), 1);
    assert_eq!(p.requests[0].headers, vec![h("Accept", "*/*")]);
}

#[test]
fn multiline_query_continuation() {
    let p = parse("GET https://x.test/search\n    ?q=crab\n    &page=2\nAccept: text/html\n");
    assert_eq!(p.requests[0].url, "https://x.test/search?q=crab&page=2");
    assert_eq!(p.requests[0].headers.len(), 1);
}

#[test]
fn body_from_file() {
    let p = parse("POST https://x.test\nContent-Type: application/json\n\n< ./payload.json\n");
    assert_eq!(p.requests[0].body, Some(BodySource::File("./payload.json".into())));
}

#[test]
fn jetbrains_response_handler_is_not_part_of_body() {
    let p = parse("POST https://x.test\n\n{\"a\":1}\n\n> {%\n  client.global.set(\"t\", response.body.token);\n%}\n");
    assert_eq!(p.requests[0].body, Some(BodySource::Inline("{\"a\":1}".into())));
    let p = parse("GET https://x.test\n\n>> ./out.json\n");
    assert_eq!(p.requests[0].body, None);
    let p = parse("GET https://x.test\n\n> {% client.log(1) %}\n");
    assert_eq!(p.requests[0].body, None);
}

#[test]
fn windows_line_endings_and_bom() {
    let p = parse("\u{feff}GET https://x.test\r\nAccept: */*\r\n\r\nhello\r\n");
    let r = &p.requests[0];
    assert_eq!(r.method, "GET");
    assert_eq!(r.url, "https://x.test");
    assert_eq!(r.headers, vec![h("Accept", "*/*")]);
    assert_eq!(r.body, Some(BodySource::Inline("hello".into())));
}

#[test]
fn malformed_header_produces_diagnostic_but_keeps_parsing() {
    let p = parse("GET https://a.test\n{\"oops\": 1}\n\n###\nGET https://b.test\n");
    assert_eq!(p.requests.len(), 2);
    assert_eq!(p.diagnostics.len(), 1);
    assert_eq!(p.diagnostics[0].line, 1);
}

#[test]
fn request_line_without_url_is_a_diagnostic() {
    let p = parse("###\nGET\n");
    assert!(p.requests.is_empty());
    assert_eq!(p.diagnostics[0].line, 1);
}

#[test]
fn request_at_line_maps_cursor_to_block() {
    let p = parse("### First\nGET https://a.test\n\n###\n# @name second\nPOST https://b.test\n\nbody\n");
    assert_eq!(p.request_at_line(0).unwrap().url, "https://a.test");
    assert_eq!(p.request_at_line(2).unwrap().url, "https://a.test");
    assert_eq!(p.request_at_line(3).unwrap().url, "https://b.test");
    assert_eq!(p.request_at_line(7).unwrap().url, "https://b.test");
    assert!(p.request_at_line(99).is_none());
}

#[test]
fn fixture_jetbrains_style_file() {
    let p = parse(include_str!("fixtures/sample.http"));
    assert_eq!(p.variables.len(), 1);
    let names: Vec<_> = p.requests.iter().map(|r| r.name.as_deref().unwrap()).collect();
    assert_eq!(names, vec!["Get anything", "createItem", "Delete"]);
    let methods: Vec<_> = p.requests.iter().map(|r| r.method.as_str()).collect();
    assert_eq!(methods, vec!["GET", "POST", "DELETE"]);
    assert_eq!(
        p.requests[1].body,
        Some(BodySource::Inline("{\n  \"name\": \"crab\",\n  \"createdAt\": {{$timestamp}}\n}".into()))
    );
    assert_eq!(p.requests[2].url, "https://{{host}}/delete");
    assert!(p.diagnostics.is_empty());
}

#[test]
fn response_handler_right_after_headers_is_not_part_of_body() {
    let p = parse("GET http://x.test\nAccept: */*\n> {%\n  client.test(\"a\", function() {\n\n    client.assert(true);\n  });\n%}\n");
    assert_eq!(p.requests[0].body, None);
    assert!(p.diagnostics.is_empty(), "{:?}", p.diagnostics);
    let p = parse("GET http://x.test\n>> ./out.json\n");
    assert_eq!(p.requests[0].body, None);
    assert!(p.diagnostics.is_empty());
}
