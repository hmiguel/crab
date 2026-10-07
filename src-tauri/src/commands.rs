//! Thin Tauri glue over crab-core. No business logic here.

use std::path::{Path, PathBuf};
use std::time::Duration;

use crab_core::error::{CrabError, ErrorKind};
use crab_core::exec::{execute, ExecOptions, ResponseData};
use crab_core::model::ParsedFile;
use crab_core::vars::NoEnv;
use crab_core::{files, parser, prepare_request};
use notify_debouncer_mini::notify::RecursiveMode;
use notify_debouncer_mini::{new_debouncer, DebounceEventResult};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio_util::sync::CancellationToken;

use crate::state::AppState;

const STATE_FILES: &[&str] = &["workspace", "session"];

#[tauri::command]
pub fn parse_text(text: String) -> ParsedFile {
    parser::parse(&text)
}

#[tauri::command]
pub async fn run_request(
    state: State<'_, AppState>,
    run_id: String,
    path: Option<String>,
    text: String,
    line: usize,
) -> Result<ResponseData, CrabError> {
    let base_dir = path.as_deref().and_then(|p| Path::new(p).parent()).map(Path::to_path_buf);
    let request = prepare_request(&text, line, base_dir.as_deref(), &NoEnv)?;
    let token = CancellationToken::new();
    state.runs.lock().unwrap().insert(run_id.clone(), token.clone());
    let result = execute(&request, &ExecOptions::default(), token).await;
    state.runs.lock().unwrap().remove(&run_id);
    result
}

#[tauri::command]
pub fn cancel_request(state: State<'_, AppState>, run_id: String) {
    if let Some(token) = state.runs.lock().unwrap().remove(&run_id) {
        token.cancel();
    }
}

#[tauri::command]
pub async fn read_text_file(path: String) -> Result<String, CrabError> {
    files::read_text(Path::new(&path))
}

#[tauri::command]
pub async fn write_text_file(path: String, contents: String) -> Result<(), CrabError> {
    files::write_atomic(Path::new(&path), contents.as_bytes())
}

#[tauri::command]
pub async fn list_http_files(root: String) -> Result<Vec<String>, CrabError> {
    files::find_http_files(Path::new(&root))
}

fn state_file(app: &AppHandle, name: &str) -> Result<PathBuf, CrabError> {
    if !STATE_FILES.contains(&name) {
        return Err(CrabError::new(ErrorKind::Io, format!("Unknown state file: {name}")));
    }
    let dir = app.path().app_data_dir().map_err(|e| CrabError::new(ErrorKind::Io, e.to_string()))?;
    Ok(dir.join(format!("{name}.json")))
}

#[tauri::command]
pub fn load_state(app: AppHandle, name: String) -> Result<Option<serde_json::Value>, CrabError> {
    files::load_json(&state_file(&app, &name)?)
}

#[tauri::command]
pub fn save_state(app: AppHandle, name: String, value: serde_json::Value) -> Result<(), CrabError> {
    let bytes = serde_json::to_vec_pretty(&value).map_err(|e| CrabError::new(ErrorKind::Io, e.to_string()))?;
    files::write_atomic(&state_file(&app, &name)?, &bytes)
}

#[tauri::command]
pub fn watch_roots(app: AppHandle, state: State<'_, AppState>, roots: Vec<String>) -> Result<(), CrabError> {
    let mut debouncer = new_debouncer(Duration::from_millis(300), move |res: DebounceEventResult| {
        if let Ok(events) = res {
            let paths: Vec<String> = events.into_iter().map(|e| e.path.to_string_lossy().into_owned()).collect();
            let _ = app.emit("fs-changed", paths);
        }
    })
    .map_err(|e| CrabError::new(ErrorKind::Io, format!("Cannot watch files: {e}")))?;
    for root in &roots {
        let path = Path::new(root);
        if path.is_dir() {
            let _ = debouncer.watcher().watch(path, RecursiveMode::Recursive);
        }
    }
    *state.watcher.lock().unwrap() = Some(debouncer);
    Ok(())
}
