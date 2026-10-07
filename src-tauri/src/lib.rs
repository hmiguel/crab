mod commands;
mod state;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(state::AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::parse_text,
            commands::run_request,
            commands::cancel_request,
            commands::read_text_file,
            commands::write_text_file,
            commands::list_http_files,
            commands::load_state,
            commands::save_state,
            commands::watch_roots,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Crab");
}
