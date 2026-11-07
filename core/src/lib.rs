//! Wavelet — библиотека плеера без окон: база SQLite, обход папок, теги, поиск, списки.
//! Окно (Tauri) зовёт только то, что здесь объявлено публичным.

pub mod browse;
pub mod db;
pub mod error;
pub mod library;
pub mod model;
pub mod playlists;
pub mod scan;
pub mod search;
pub mod subs;
pub mod tags;
pub mod video;

pub use error::{Error, Result};
pub use rusqlite;

/// Секунды с 1970 года — так в базе хранятся все даты.
pub fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}
