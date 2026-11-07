//! Обход папок библиотеки: новые и изменённые файлы читаются и попадают в базу,
//! неизменённые (тот же размер и время изменения) пропускаются, пропавшие удаляются.

use rusqlite::{params, Connection};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::UNIX_EPOCH;
use walkdir::WalkDir;

use crate::{subs, tags, video, Result};

pub const AUDIO_EXT: &[&str] = &["mp3", "flac", "ogg", "oga", "opus", "m4a", "aac", "wav"];
pub const VIDEO_EXT: &[&str] = &["mp4", "m4v", "webm", "mov"];

/// "audio", "video" или None, если файл не наш.
pub fn kind_of(path: &Path) -> Option<&'static str> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    if AUDIO_EXT.contains(&ext.as_str()) {
        Some("audio")
    } else if VIDEO_EXT.contains(&ext.as_str()) {
        Some("video")
    } else {
        None
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct Progress {
    pub done: usize,
    pub total: usize,
    pub current: String,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct Report {
    pub added: usize,
    pub updated: usize,
    pub removed: usize,
    pub total: usize,
    pub errors: usize,
    pub cancelled: bool,
}

struct Found {
    path: PathBuf,
    kind: &'static str,
    size: i64,
    mtime: i64,
}

fn collect(folders: &[String], cancel: &AtomicBool) -> Vec<Found> {
    let mut out = Vec::new();
    for root in folders {
        let walker = WalkDir::new(root).follow_links(true).into_iter().filter_entry(|e| {
            e.depth() == 0 || !e.file_name().to_str().map_or(false, |n| n.starts_with('.') || n.starts_with('$'))
        });
        for e in walker.flatten() {
            if cancel.load(Ordering::Relaxed) {
                return out;
            }
            if !e.file_type().is_file() {
                continue;
            }
            let Some(kind) = kind_of(e.path()) else { continue };
            let Ok(md) = e.metadata() else { continue };
            let mtime = md
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map_or(0, |d| d.as_secs() as i64);
            out.push(Found { path: e.into_path(), kind, size: md.len() as i64, mtime });
        }
    }
    out
}

/// Полный проход по всем папкам библиотеки.
pub fn scan(
    conn: &mut Connection,
    folders: &[String],
    covers_dir: &Path,
    cancel: &AtomicBool,
    mut progress: impl FnMut(&Progress),
) -> Result<Report> {
    let mut report = Report::default();
    progress(&Progress { done: 0, total: 0, current: String::new() });
    let found = collect(folders, cancel);
    let total = found.len();

    // путь → (размер, время изменения), и у какой музыки ещё нет обложки
    let mut known: HashMap<String, (i64, i64)> = HashMap::new();
    let mut no_cover: HashSet<String> = HashSet::new();
    {
        let mut st = conn.prepare("SELECT path, size, mtime, kind = 'audio' AND cover IS NULL FROM media")?;
        let rows = st.query_map([], |r| Ok((r.get::<_, String>(0)?, (r.get(1)?, r.get(2)?), r.get::<_, bool>(3)?)))?;
        for row in rows {
            let (p, v, bare) = row?;
            if bare {
                no_cover.insert(p.clone());
            }
            known.insert(p, v);
        }
    }

    let mut seen: HashSet<String> = HashSet::with_capacity(total);
    let mut dir_covers: HashMap<PathBuf, Option<String>> = HashMap::new();
    let now = crate::now();

    for (n, chunk) in found.chunks(100).enumerate() {
        if cancel.load(Ordering::Relaxed) {
            report.cancelled = true;
            break;
        }
        let tx = conn.transaction()?;
        for (i, f) in chunk.iter().enumerate() {
            let path_s = f.path.to_string_lossy().to_string();
            seen.insert(path_s.clone());
            let old = known.get(&path_s).copied();
            if old == Some((f.size, f.mtime)) {
                // файл тот же, но рядом могла появиться картинка-обложка (или раньше её не было видно)
                if no_cover.contains(&path_s) {
                    if let Some(dir) = f.path.parent() {
                        let cover = dir_covers
                            .entry(dir.to_path_buf())
                            .or_insert_with(|| tags::folder_cover(dir).map(|p| p.to_string_lossy().to_string()))
                            .clone();
                        if let Some(c) = cover {
                            tx.execute("UPDATE media SET cover = ?1 WHERE path = ?2", params![c, path_s])?;
                            report.updated += 1;
                        }
                    }
                }
                continue;
            }
            if i % 10 == 0 {
                progress(&Progress { done: n * 100 + i, total, current: path_s.clone() });
            }
            let ok = upsert(&tx, f, &path_s, covers_dir, &mut dir_covers, now);
            if !ok {
                report.errors += 1;
            }
            if old.is_some() {
                report.updated += 1;
            } else {
                report.added += 1;
            }
        }
        tx.commit()?;
        progress(&Progress { done: (n * 100 + chunk.len()).min(total), total, current: String::new() });
    }

    if !report.cancelled && !cancel.load(Ordering::Relaxed) {
        let tx = conn.transaction()?;
        {
            let mut del = tx.prepare("DELETE FROM media WHERE path = ?1")?;
            for p in known.keys().filter(|p| !seen.contains(*p)) {
                report.removed += del.execute([p])?;
            }
        }
        tx.commit()?;
    } else {
        report.cancelled = true;
    }
    report.total = conn.query_row("SELECT count(*) FROM media", [], |r| r.get::<_, i64>(0))? as usize;
    Ok(report)
}

/// Читает один файл и пишет его в базу. false — теги не прочлись (запись всё равно сделана по имени файла).
fn upsert(
    conn: &Connection,
    f: &Found,
    path_s: &str,
    covers_dir: &Path,
    dir_covers: &mut HashMap<PathBuf, Option<String>>,
    now: i64,
) -> bool {
    let dir = f.path.parent().map(Path::to_path_buf).unwrap_or_default();
    let file_name = f.path.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    let stem = f.path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| file_name.clone());

    let mut ok = true;
    let mut rec = Record { title: stem, ..Default::default() };
    if f.kind == "audio" {
        match tags::read_audio(&f.path) {
            Ok(m) => {
                if let Some(t) = m.title {
                    rec.title = t;
                }
                rec.artist = m.artist.unwrap_or_default();
                rec.album = m.album.unwrap_or_default();
                rec.album_artist = m.album_artist.unwrap_or_default();
                rec.genre = m.genre.unwrap_or_default();
                rec.year = m.year;
                rec.track = m.track;
                rec.disc = m.disc;
                rec.duration = m.duration;
                if let Some((data, ext)) = m.picture {
                    rec.cover = tags::store_cover(covers_dir, &data, ext).ok().map(|p| p.to_string_lossy().to_string());
                }
            }
            Err(_) => ok = false,
        }
        if rec.cover.is_none() {
            rec.cover = dir_covers
                .entry(dir.clone())
                .or_insert_with(|| tags::folder_cover(&dir).map(|p| p.to_string_lossy().to_string()))
                .clone();
        }
    } else {
        let v = video::read_video(&f.path);
        rec.duration = v.duration;
        rec.width = v.width;
        rec.height = v.height;
        rec.subs = subs::find_for(&f.path).map(|p| p.to_string_lossy().to_string());
    }

    let res = conn.execute(
        "INSERT INTO media(path, dir, file_name, kind, title, artist, album, album_artist, genre, year, track, disc,
                           duration, width, height, size, mtime, added, cover, subs)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20)
         ON CONFLICT(path) DO UPDATE SET
            dir = excluded.dir, file_name = excluded.file_name, kind = excluded.kind, title = excluded.title,
            artist = excluded.artist, album = excluded.album, album_artist = excluded.album_artist,
            genre = excluded.genre, year = excluded.year, track = excluded.track, disc = excluded.disc,
            duration = CASE WHEN excluded.duration > 0 THEN excluded.duration ELSE media.duration END,
            width = excluded.width, height = excluded.height, size = excluded.size, mtime = excluded.mtime,
            cover = CASE WHEN excluded.kind = 'video' THEN media.cover ELSE excluded.cover END,
            subs = excluded.subs",
        params![
            path_s,
            dir.to_string_lossy(),
            file_name,
            f.kind,
            rec.title,
            rec.artist,
            rec.album,
            rec.album_artist,
            rec.genre,
            rec.year,
            rec.track,
            rec.disc,
            rec.duration,
            rec.width,
            rec.height,
            f.size,
            f.mtime,
            now,
            rec.cover,
            rec.subs
        ],
    );
    ok && res.is_ok()
}

#[derive(Default)]
struct Record {
    title: String,
    artist: String,
    album: String,
    album_artist: String,
    genre: String,
    year: Option<i64>,
    track: Option<i64>,
    disc: Option<i64>,
    duration: f64,
    width: Option<i64>,
    height: Option<i64>,
    cover: Option<String>,
    subs: Option<String>,
}
