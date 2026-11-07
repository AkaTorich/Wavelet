//! Wavelet — точка входа, общая для ПК и телефонов (на телефонах её зовёт мобильная оболочка).

mod commands;
mod state;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            app.manage(state::AppState::open(dir)?);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_media,
            commands::get_media,
            commands::stats,
            commands::albums,
            commands::groups,
            commands::folders,
            commands::add_folder,
            commands::remove_folder,
            commands::default_folders,
            commands::start_scan,
            commands::cancel_scan,
            commands::is_scanning,
            commands::set_rating,
            commands::mark_played,
            commands::set_position,
            commands::set_duration,
            commands::save_thumb,
            commands::set_user_tags,
            commands::add_tag,
            commands::edit_tags,
            commands::subtitles,
            commands::playlists_list,
            commands::playlist_create,
            commands::playlist_rename,
            commands::playlist_delete,
            commands::playlist_items,
            commands::playlist_add,
            commands::playlist_remove,
            commands::playlist_reorder,
            commands::setting_get,
            commands::setting_set,
            commands::reveal,
            commands::platform,
        ])
        .run(tauri::generate_context!())
        .expect("Wavelet не запустился");
}
