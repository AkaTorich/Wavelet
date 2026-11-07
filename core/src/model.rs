//! Что отдаётся окну: запись библиотеки и сводки.

use rusqlite::Row;
use serde::{Deserialize, Serialize};

/// Разделитель имён меток внутри одной строки выборки (символ, которого нет в обычных именах).
pub const TAG_SEP: char = '\u{1f}';

/// Список столбцов для `SELECT … FROM media m` — в том же порядке, что читает [`Media::from_row`].
pub const MEDIA_COLS: &str = "m.id, m.path, m.dir, m.file_name, m.kind, m.title, m.artist, m.album, m.album_artist, \
    m.genre, m.year, m.track, m.disc, m.duration, m.width, m.height, m.size, m.mtime, m.added, m.play_count, \
    m.last_played, m.rating, m.position, m.cover, m.subs, \
    (SELECT group_concat(t.name, char(31)) FROM media_tags mt JOIN tags t ON t.id = mt.tag_id WHERE mt.media_id = m.id)";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Media {
    pub id: i64,
    pub path: String,
    pub dir: String,
    pub file_name: String,
    /// "audio" или "video"
    pub kind: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub album_artist: String,
    pub genre: String,
    pub year: Option<i64>,
    pub track: Option<i64>,
    pub disc: Option<i64>,
    pub duration: f64,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub size: i64,
    pub mtime: i64,
    pub added: i64,
    pub play_count: i64,
    pub last_played: Option<i64>,
    pub rating: i64,
    pub position: f64,
    pub cover: Option<String>,
    pub subs: Option<String>,
    pub tags: Vec<String>,
}

impl Media {
    pub fn from_row(r: &Row) -> rusqlite::Result<Self> {
        let tags: Option<String> = r.get(25)?;
        Ok(Media {
            id: r.get(0)?,
            path: r.get(1)?,
            dir: r.get(2)?,
            file_name: r.get(3)?,
            kind: r.get(4)?,
            title: r.get(5)?,
            artist: r.get(6)?,
            album: r.get(7)?,
            album_artist: r.get(8)?,
            genre: r.get(9)?,
            year: r.get(10)?,
            track: r.get(11)?,
            disc: r.get(12)?,
            duration: r.get(13)?,
            width: r.get(14)?,
            height: r.get(15)?,
            size: r.get(16)?,
            mtime: r.get(17)?,
            added: r.get(18)?,
            play_count: r.get(19)?,
            last_played: r.get(20)?,
            rating: r.get(21)?,
            position: r.get(22)?,
            cover: r.get(23)?,
            subs: r.get(24)?,
            tags: split_tags(tags),
        })
    }
}

pub fn split_tags(s: Option<String>) -> Vec<String> {
    let mut v: Vec<String> = s
        .unwrap_or_default()
        .split(TAG_SEP)
        .filter(|t| !t.is_empty())
        .map(str::to_string)
        .collect();
    v.sort_by_key(|t| t.to_lowercase());
    v
}

/// Альбом: группа записей с одним названием альбома и одним исполнителем альбома.
#[derive(Debug, Clone, Serialize)]
pub struct Album {
    pub album: String,
    pub artist: String,
    pub year: Option<i64>,
    pub count: i64,
    pub duration: f64,
    pub cover: Option<String>,
}

/// Строка простой сводки: имя (исполнитель, жанр, папка, метка) и сколько записей.
#[derive(Debug, Clone, Serialize)]
pub struct Group {
    pub name: String,
    pub count: i64,
    pub duration: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct Stats {
    pub audio: i64,
    pub video: i64,
    pub albums: i64,
    pub artists: i64,
    pub duration: f64,
    pub size: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct Playlist {
    pub id: i64,
    pub name: String,
    pub created: i64,
    pub count: i64,
    pub duration: f64,
}

/// Строка списка воспроизведения: номер строки в списке + сама запись.
#[derive(Debug, Clone, Serialize)]
pub struct PlaylistEntry {
    pub item_id: i64,
    #[serde(flatten)]
    pub media: Media,
}

/// Правка тегов: что пришло — то и записывается; None — не трогать.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct TagEdit {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub album_artist: Option<String>,
    pub genre: Option<String>,
    pub year: Option<Option<i64>>,
    pub track: Option<Option<i64>>,
    pub disc: Option<Option<i64>>,
}
