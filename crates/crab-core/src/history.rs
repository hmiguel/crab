//! Persistent run history: the masked request and the response of every sent run, in SQLite.

use std::path::Path;

use rusqlite::{params, params_from_iter, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::{CrabError, ErrorKind};
use crate::exec::ResponseData;
use crate::model::ResolvedRequest;

pub const DEFAULT_LIMIT: usize = 1000;
pub const MAX_BODY_BYTES: usize = 1_048_576;

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY,
  at_ms INTEGER NOT NULL,
  path TEXT,
  request_key TEXT NOT NULL,
  request_line INTEGER NOT NULL,
  name TEXT,
  method TEXT NOT NULL,
  url TEXT NOT NULL,
  env TEXT,
  status INTEGER,
  error_kind TEXT,
  error_message TEXT,
  total_ms REAL,
  size_bytes INTEGER,
  request_json TEXT NOT NULL,
  response_json TEXT,
  body_text TEXT,
  body_base64 TEXT,
  truncated INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS runs_key ON runs(path, request_key, id DESC);
CREATE VIRTUAL TABLE IF NOT EXISTS runs_fts USING fts5(name, url, body_text, content='runs', content_rowid='id');
CREATE TRIGGER IF NOT EXISTS runs_ai AFTER INSERT ON runs BEGIN
  INSERT INTO runs_fts(rowid, name, url, body_text) VALUES (new.id, new.name, new.url, new.body_text);
END;
CREATE TRIGGER IF NOT EXISTS runs_ad AFTER DELETE ON runs BEGIN
  INSERT INTO runs_fts(runs_fts, rowid, name, url, body_text) VALUES ('delete', old.id, old.name, old.url, old.body_text);
END;
";

const SUMMARY_COLUMNS: &str =
    "id, at_ms, path, request_key, request_line, name, method, url, env, status, error_kind, error_message, total_ms, size_bytes";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestKey {
    pub key: String,
    pub name: Option<String>,
    pub line: usize,
}

/// One sent run, ready to store. Built only through `from_outcome`.
#[derive(Debug, Clone)]
pub struct NewRun {
    at_ms: i64,
    path: Option<String>,
    key: RequestKey,
    env: Option<String>,
    request_json: String,
    method: String,
    url: String,
    response: Option<ResponseData>,
    error: Option<CrabError>,
}

impl NewRun {
    /// `None` when the run never reached the network (parse, variable, env or body-file errors).
    /// `request` must be the masked request.
    pub fn from_outcome(
        at_ms: i64,
        path: Option<String>,
        key: RequestKey,
        env: Option<String>,
        request: &ResolvedRequest,
        outcome: &Result<ResponseData, CrabError>,
    ) -> Option<NewRun> {
        let (response, error) = match outcome {
            Ok(r) => (Some(r.clone()), None),
            Err(e) if matches!(e.kind, ErrorKind::Network | ErrorKind::Timeout | ErrorKind::Cancelled) => (None, Some(e.clone())),
            Err(_) => return None,
        };
        Some(NewRun {
            at_ms,
            path,
            key,
            env,
            request_json: serde_json::to_string(request).ok()?,
            method: request.method.clone(),
            url: request.url.clone(),
            response,
            error,
        })
    }
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ListQuery {
    pub query: Option<String>,
    pub path: Option<String>,
    pub key: Option<String>,
    /// Only runs older than this id (paging).
    pub before: Option<i64>,
    pub limit: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunSummary {
    pub id: i64,
    pub at_ms: i64,
    pub path: Option<String>,
    pub request_key: String,
    pub request_line: i64,
    pub name: Option<String>,
    pub method: String,
    pub url: String,
    pub env: Option<String>,
    pub status: Option<u16>,
    pub error_kind: Option<String>,
    pub error_message: Option<String>,
    pub total_ms: Option<f64>,
    pub size_bytes: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PastRun {
    pub summary: RunSummary,
    pub request: Value,
    /// `ResponseData`'s JSON shape, with `historyId` set; `None` for errored runs.
    pub response: Option<Value>,
}

pub struct History {
    conn: Connection,
    limit: usize,
}

fn db_err(e: impl std::fmt::Display) -> CrabError {
    CrabError::new(ErrorKind::Io, format!("History database: {e}"))
}

/// Each word becomes a quoted prefix phrase, so user input is never FTS5 syntax.
fn fts_query(input: &str) -> Option<String> {
    let terms: Vec<String> = input.split_whitespace().map(|w| format!("\"{}\"*", w.replace('"', "\"\""))).collect();
    (!terms.is_empty()).then(|| terms.join(" "))
}

fn cap_text(text: &str) -> (&str, bool) {
    if text.len() <= MAX_BODY_BYTES {
        return (text, false);
    }
    let mut end = MAX_BODY_BYTES;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    (&text[..end], true)
}

fn error_kind_name(kind: ErrorKind) -> String {
    serde_json::to_value(kind).ok().and_then(|v| v.as_str().map(str::to_string)).unwrap_or_default()
}

fn summary(row: &Row<'_>) -> rusqlite::Result<RunSummary> {
    Ok(RunSummary {
        id: row.get(0)?,
        at_ms: row.get(1)?,
        path: row.get(2)?,
        request_key: row.get(3)?,
        request_line: row.get(4)?,
        name: row.get(5)?,
        method: row.get(6)?,
        url: row.get(7)?,
        env: row.get(8)?,
        status: row.get(9)?,
        error_kind: row.get(10)?,
        error_message: row.get(11)?,
        total_ms: row.get(12)?,
        size_bytes: row.get(13)?,
    })
}

impl History {
    /// Open or create the database. Fails on a read-only or locked file, so callers learn at startup.
    pub fn open(path: &Path) -> Result<History, CrabError> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).map_err(db_err)?;
        }
        let conn = Connection::open(path).map_err(db_err)?;
        conn.execute_batch(SCHEMA).map_err(db_err)?;
        // A real write: a read-only file opens fine but fails here.
        conn.execute_batch("PRAGMA user_version = 1;").map_err(db_err)?;
        Ok(History { conn, limit: DEFAULT_LIMIT })
    }

    pub fn with_limit(mut self, limit: usize) -> History {
        self.limit = limit;
        self
    }

    pub fn record(&self, run: &NewRun) -> Result<i64, CrabError> {
        let r = run.response.as_ref();
        let (body_text, cut) = r.map(|r| cap_text(&r.body_text)).unwrap_or(("", false));
        let base64 = r.and_then(|r| r.body_base64.as_deref()).filter(|b| b.len() <= MAX_BODY_BYTES);
        let base64_dropped = r.is_some_and(|r| r.body_base64.is_some()) && base64.is_none();
        let truncated = r.is_some_and(|r| r.truncated) || cut || base64_dropped;
        let response_json = match r {
            Some(r) => {
                let mut v = serde_json::to_value(r).map_err(db_err)?;
                if let Value::Object(map) = &mut v {
                    for k in ["bodyText", "bodyBase64", "truncated", "request", "historyId"] {
                        map.remove(k);
                    }
                }
                Some(v.to_string())
            }
            None => None,
        };
        self.conn
            .execute(
                "INSERT INTO runs (at_ms, path, request_key, request_line, name, method, url, env, status, error_kind,
                   error_message, total_ms, size_bytes, request_json, response_json, body_text, body_base64, truncated)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)",
                params![
                    run.at_ms,
                    run.path,
                    run.key.key,
                    run.key.line as i64,
                    run.key.name,
                    run.method,
                    run.url,
                    run.env,
                    r.map(|r| r.status),
                    run.error.as_ref().map(|e| error_kind_name(e.kind)),
                    run.error.as_ref().map(|e| e.message.clone()),
                    r.map(|r| r.timing.total_ms),
                    r.map(|r| r.size_bytes as i64),
                    run.request_json,
                    response_json,
                    r.map(|_| body_text),
                    base64,
                    truncated,
                ],
            )
            .map_err(db_err)?;
        let id = self.conn.last_insert_rowid();
        self.conn
            .execute("DELETE FROM runs WHERE id NOT IN (SELECT id FROM runs ORDER BY id DESC LIMIT ?1)", params![self.limit as i64])
            .map_err(db_err)?;
        Ok(id)
    }

    pub fn list(&self, q: &ListQuery) -> Result<Vec<RunSummary>, CrabError> {
        let mut sql = format!("SELECT {SUMMARY_COLUMNS} FROM runs WHERE 1 = 1");
        let mut args: Vec<rusqlite::types::Value> = Vec::new();
        if let Some(fts) = q.query.as_deref().and_then(fts_query) {
            sql.push_str(" AND id IN (SELECT rowid FROM runs_fts WHERE runs_fts MATCH ?)");
            args.push(fts.into());
        }
        if let Some(path) = &q.path {
            sql.push_str(" AND path = ?");
            args.push(path.clone().into());
        }
        if let Some(key) = &q.key {
            sql.push_str(" AND request_key = ?");
            args.push(key.clone().into());
        }
        if let Some(before) = q.before {
            sql.push_str(" AND id < ?");
            args.push(before.into());
        }
        sql.push_str(" ORDER BY id DESC LIMIT ?");
        args.push(i64::from(q.limit.max(1)).into());
        let mut stmt = self.conn.prepare(&sql).map_err(db_err)?;
        let rows = stmt.query_map(params_from_iter(args), summary).map_err(db_err)?;
        rows.collect::<rusqlite::Result<Vec<_>>>().map_err(db_err)
    }

    pub fn get(&self, id: i64) -> Result<Option<PastRun>, CrabError> {
        let sql = format!("SELECT {SUMMARY_COLUMNS}, request_json, response_json, body_text, body_base64, truncated FROM runs WHERE id = ?1");
        self.conn
            .query_row(&sql, params![id], |row| {
                let s = summary(row)?;
                let request_json: String = row.get(14)?;
                let response_json: Option<String> = row.get(15)?;
                let body_text: Option<String> = row.get(16)?;
                let body_base64: Option<String> = row.get(17)?;
                let truncated: bool = row.get(18)?;
                Ok((s, request_json, response_json, body_text, body_base64, truncated))
            })
            .optional()
            .map_err(db_err)?
            .map(|(summary, request_json, response_json, body_text, body_base64, truncated)| {
                let request: Value = serde_json::from_str(&request_json).map_err(db_err)?;
                let response = match response_json {
                    Some(json) => {
                        let mut v: Value = serde_json::from_str(&json).map_err(db_err)?;
                        if let Value::Object(map) = &mut v {
                            map.insert("bodyText".into(), Value::from(body_text.unwrap_or_default()));
                            map.insert("bodyBase64".into(), body_base64.map_or(Value::Null, Value::from));
                            map.insert("truncated".into(), Value::from(truncated));
                            map.insert("request".into(), request.clone());
                            map.insert("historyId".into(), Value::from(summary.id));
                        }
                        Some(v)
                    }
                    None => None,
                };
                Ok(PastRun { summary, request, response })
            })
            .transpose()
    }

    pub fn clear(&self) -> Result<(), CrabError> {
        self.conn.execute_batch("DELETE FROM runs;").map_err(db_err)
    }
}
