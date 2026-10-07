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
