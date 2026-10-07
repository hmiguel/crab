//! macOS menu bar. Tauri's default menu binds Cmd+W to "Close Window" and Cmd+Q to an
//! immediate exit, which would steal Cmd+W from "close tab" and skip the session flush.

use tauri::menu::{Menu, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{AppHandle, Manager, Runtime};

const QUIT_ID: &str = "crab-quit";

pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    // A custom Quit closes the window instead of exiting, so the frontend's
    // onCloseRequested handler saves the session (and unsaved drafts) first.
    let quit = MenuItemBuilder::with_id(QUIT_ID, "Quit Crab").accelerator("CmdOrCtrl+Q").build(app)?;
    let app_menu = SubmenuBuilder::new(app, "Crab")
        .about(None)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .item(&quit)
        .build()?;
    let edit = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;
    let window = SubmenuBuilder::new(app, "Window").minimize().maximize().fullscreen().build()?;
    MenuBuilder::new(app).items(&[&app_menu, &edit, &window]).build()
}

pub fn on_event<R: Runtime>(app: &AppHandle<R>, id: &str) {
    if id == QUIT_ID {
        match app.get_webview_window("main") {
            Some(window) => {
                let _ = window.close();
            }
            None => app.exit(0),
        }
    }
}
