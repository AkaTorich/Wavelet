//! Команды, которые зовёт окно (window.__TAURI__.core.invoke). Тяжёлого здесь нет:
//! всё делает wavelet-core, а эти функции только достают базу и передают ответ.

use base64::Engine;
use tauri::{AppHandle, Manager, State};

use wavelet_core::model::{Album, Group, Media, Playlist, PlaylistEntry, Stats, TagEdit};
use wavelet_core::search::{self, ListRequest};
use wavelet_core::{browse, library, playlists, subs, Error, Result};

use crate::state::AppState;

type S<'a> = State<'a, AppState>;

// ── выборки ──────────────────────────────────────────────────────────────

#[tauri::command(async)]
pub fn list_media(state: S<'_>, req: ListRequest) -> Result<Vec<Media>> {
    search::list_media(&*state.db()?, &req)
}

#[tauri::command(async)]
pub fn get_media(state: S<'_>, ids: Vec<i64>) -> Result<Vec<Media>> {
    library::get_many(&*state.db()?, &ids)
}

#[tauri::command(async)]
pub fn stats(state: S<'_>) -> Result<Stats> {
    browse::stats(&*state.db()?)
}

#[tauri::command(async)]
pub fn albums(state: S<'_>) -> Result<Vec<Album>> {
    browse::albums(&*state.db()?)
}

/// Сводка по виду: artists, genres, dirs, tags.
#[tauri::command(async)]
pub fn groups(state: S<'_>, by: String) -> Result<Vec<Group>> {
    let db = state.db()?;
    match by.as_str() {
        "artists" => browse::artists(&db),
        "genres" => browse::genres(&db),
        "dirs" => browse::dirs(&db),
        "tags" => browse::tags(&db),
        _ => Err(Error::msg(format!("no such summary: {by}"))),
    }
}

// ── папки и обход ────────────────────────────────────────────────────────

#[tauri::command(async)]
pub fn folders(state: S<'_>) -> Result<Vec<String>> {
    library::folders(&*state.db()?)
}

#[tauri::command(async)]
pub fn add_folder(state: S<'_>, path: String) -> Result<bool> {
    library::add_folder(&*state.db()?, &path)
}

#[tauri::command(async)]
pub fn remove_folder(state: S<'_>, path: String) -> Result<usize> {
    library::remove_folder(&mut *state.db()?, &path)
}

/// Папки, которые стоит предложить: Музыка, Видео, Загрузки этого устройства (только существующие).
#[tauri::command(async)]
pub fn default_folders(app: AppHandle) -> Vec<String> {
    let mut v: Vec<std::path::PathBuf> = Vec::new();
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let _ = &app;
        for d in ["Music", "Movies", "Download", "DCIM", "Podcasts"] {
            v.push(std::path::PathBuf::from("/storage/emulated/0").join(d));
        }
    }
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let p = app.path();
        v.extend([p.audio_dir(), p.video_dir(), p.download_dir()].into_iter().flatten());
    }
    v.into_iter().filter(|p| p.is_dir()).map(|p| p.to_string_lossy().to_string()).collect()
}

#[tauri::command(async)]
pub fn start_scan(app: AppHandle, state: S<'_>) -> Result<bool> {
    state.start_scan(app.clone())
}

#[tauri::command(async)]
pub fn cancel_scan(state: S<'_>) {
    state.cancel_scan();
}

#[tauri::command(async)]
pub fn is_scanning(state: S<'_>) -> bool {
    state.is_scanning()
}

// ── запись: счётчики, оценки, метки, теги ────────────────────────────────

#[tauri::command(async)]
pub fn set_rating(state: S<'_>, id: i64, rating: i64) -> Result<()> {
    library::set_rating(&*state.db()?, id, rating)
}

#[tauri::command(async)]
pub fn mark_played(state: S<'_>, id: i64) -> Result<()> {
    library::mark_played(&*state.db()?, id)
}

#[tauri::command(async)]
pub fn set_position(state: S<'_>, id: i64, pos: f64) -> Result<()> {
    library::set_position(&*state.db()?, id, pos)
}

#[tauri::command(async)]
pub fn set_duration(state: S<'_>, id: i64, duration: f64) -> Result<()> {
    library::set_duration(&*state.db()?, id, duration)
}

/// Кадр-обложка видео: окно присылает картинку как data:image/jpeg;base64,…
#[tauri::command(async)]
pub fn save_thumb(state: S<'_>, id: i64, data_url: String) -> Result<String> {
    let b64 = data_url.split_once(',').map_or(data_url.as_str(), |(_, b)| b);
    let bytes = base64::engine::general_purpose::STANDARD.decode(b64).map_err(|e| Error::msg(e.to_string()))?;
    library::set_cover(&*state.db()?, &state.covers, id, &bytes, "jpg")
}

#[tauri::command(async)]
pub fn set_user_tags(state: S<'_>, id: i64, tags: Vec<String>) -> Result<Option<Media>> {
    let mut db = state.db()?;
    library::set_user_tags(&mut db, id, &tags)?;
    library::get(&db, id)
}

#[tauri::command(async)]
pub fn add_tag(state: S<'_>, ids: Vec<i64>, name: String) -> Result<()> {
    library::add_tag(&mut *state.db()?, &ids, &name)
}

#[tauri::command(async)]
pub fn edit_tags(state: S<'_>, id: i64, edit: TagEdit) -> Result<Media> {
    library::edit_tags(&*state.db()?, id, &edit)
}

/// Субтитры видео как текст WebVTT (или null, если рядом нет файла).
#[tauri::command(async)]
pub fn subtitles(state: S<'_>, id: i64) -> Result<Option<String>> {
    let m = library::get(&*state.db()?, id)?;
    match m.and_then(|m| m.subs) {
        Some(p) => Ok(Some(subs::load_vtt(std::path::Path::new(&p))?)),
        None => Ok(None),
    }
}

// ── списки ───────────────────────────────────────────────────────────────

#[tauri::command(async)]
pub fn playlists_list(state: S<'_>) -> Result<Vec<Playlist>> {
    playlists::list(&*state.db()?)
}

#[tauri::command(async)]
pub fn playlist_create(state: S<'_>, name: String) -> Result<i64> {
    playlists::create(&*state.db()?, &name)
}

#[tauri::command(async)]
pub fn playlist_rename(state: S<'_>, id: i64, name: String) -> Result<()> {
    playlists::rename(&*state.db()?, id, &name)
}

#[tauri::command(async)]
pub fn playlist_delete(state: S<'_>, id: i64) -> Result<()> {
    playlists::delete(&*state.db()?, id)
}

#[tauri::command(async)]
pub fn playlist_items(state: S<'_>, id: i64) -> Result<Vec<PlaylistEntry>> {
    playlists::items(&*state.db()?, id)
}

#[tauri::command(async)]
pub fn playlist_add(state: S<'_>, id: i64, media_ids: Vec<i64>) -> Result<()> {
    playlists::add(&mut *state.db()?, id, &media_ids)
}

#[tauri::command(async)]
pub fn playlist_remove(state: S<'_>, item_ids: Vec<i64>) -> Result<()> {
    playlists::remove_items(&mut *state.db()?, &item_ids)
}

#[tauri::command(async)]
pub fn playlist_reorder(state: S<'_>, id: i64, item_ids: Vec<i64>) -> Result<()> {
    playlists::reorder(&mut *state.db()?, id, &item_ids)
}

// ── настройки и прочее ───────────────────────────────────────────────────

#[tauri::command(async)]
pub fn setting_get(state: S<'_>, key: String) -> Result<Option<String>> {
    library::setting(&*state.db()?, &key)
}

#[tauri::command(async)]
pub fn setting_set(state: S<'_>, key: String, value: String) -> Result<()> {
    library::set_setting(&*state.db()?, &key, &value)
}

/// Показать файл в проводнике (только на ПК).
#[tauri::command(async)]
pub fn reveal(path: String) -> Result<()> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer").arg(format!("/select,{path}")).spawn()?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open").arg("-R").arg(&path).spawn()?;
    }
    #[cfg(target_os = "linux")]
    {
        if let Some(dir) = std::path::Path::new(&path).parent() {
            std::process::Command::new("xdg-open").arg(dir).spawn()?;
        }
    }
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let _ = path;
    }
    Ok(())
}

/// "windows", "android", "ios", "macos", "linux" — окно подстраивает вид.
#[tauri::command]
pub fn platform() -> &'static str {
    std::env::consts::OS
}
