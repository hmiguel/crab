mod commands;
#[cfg(target_os = "macos")]
mod menu;
mod state;

pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(target_os = "macos")]
    let builder = builder.menu(menu::build).on_menu_event(|app, event| menu::on_event(app, event.id().as_ref()));
    builder
        .plugin(tauri_plugin_dialog::init())
        .manage(state::AppState::default())
        .setup(|app| {
            use tauri::Manager;
            let state = app.state::<state::AppState>();
            match app.path().app_data_dir() {
                Ok(dir) => match crab_core::history::History::open(&dir.join("history.db")) {
                    Ok(h) => *state.history.lock().unwrap() = Some(h),
                    Err(e) => *state.history_error.lock().unwrap() = Some(e.message),
                },
                Err(e) => *state.history_error.lock().unwrap() = Some(e.to_string()),
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::parse_text,
            commands::run_request,
            commands::reveal_request,
            commands::list_environments,
            commands::history_list,
            commands::history_get,
            commands::history_clear,
            commands::history_status,
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
