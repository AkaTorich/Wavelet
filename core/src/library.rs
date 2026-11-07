//! Действия над библиотекой: папки, одна запись, оценки, счётчики, свои метки, правка тегов, настройки.

use rusqlite::{params, Connection, OptionalExtension};
use std::path::Path;
use std::time::UNIX_EPOCH;

use crate::model::{Media, TagEdit, MEDIA_COLS};
use crate::{tags, Error, Result};

// ── папки ────────────────────────────────────────────────────────────────

pub fn folders(conn: &Connection) -> Result<Vec<String>> {
    let mut st = conn.prepare("SELECT path FROM folders ORDER BY lower(path)")?;
    let rows = st.query_map([], |r| r.get(0))?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Добавляет папку. Вложенную в уже добавленную не добавляет (false).
pub fn add_folder(conn: &Connection, path: &str) -> Result<bool> {
    let p = path.trim().trim_end_matches(['\\', '/']).to_string();
    if p.is_empty() {
        return Err(Error::msg("пустой путь"));
    }
    if !Path::new(&p).is_dir() {
        return Err(Error::msg(format!("папки нет: {p}")));
    }
    for f in folders(conn)? {
        if Path::new(&p).starts_with(&f) {
            return Ok(false);
        }
    }
    conn.execute("INSERT OR IGNORE INTO folders(path, added) VALUES (?1, ?2)", params![p, crate::now()])?;
    Ok(true)
}

/// Убирает папку и всё, что из неё попало в библиотеку (файлы на диске не трогаются).
pub fn remove_folder(conn: &mut Connection, path: &str) -> Result<usize> {
    let tx = conn.transaction()?;
    tx.execute("DELETE FROM folders WHERE path = ?1", [path])?;
    let rest: Vec<String> = {
        let mut st = tx.prepare("SELECT path FROM folders")?;
        let rows = st.query_map([], |r| r.get(0))?;
        rows.collect::<rusqlite::Result<_>>()?
    };
    let doomed: Vec<i64> = {
        let mut st = tx.prepare("SELECT id, path FROM media")?;
        let rows = st.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))?;
        let mut v = Vec::new();
        for row in rows {
            let (id, p) = row?;
            let p = Path::new(&p);
            if p.starts_with(path) && !rest.iter().any(|f| p.starts_with(f)) {
                v.push(id);
            }
        }
        v
    };
    {
        let mut del = tx.prepare("DELETE FROM media WHERE id = ?1")?;
        for id in &doomed {
            del.execute([id])?;
        }
    }
    tx.commit()?;
    Ok(doomed.len())
}

// ── одна запись ──────────────────────────────────────────────────────────

pub fn get(conn: &Connection, id: i64) -> Result<Option<Media>> {
    Ok(conn.query_row(&format!("SELECT {MEDIA_COLS} FROM media m WHERE m.id = ?1"), [id], Media::from_row).optional()?)
}

pub fn get_many(conn: &Connection, ids: &[i64]) -> Result<Vec<Media>> {
    let mut st = conn.prepare(&format!("SELECT {MEDIA_COLS} FROM media m WHERE m.id = ?1"))?;
    let mut out = Vec::with_capacity(ids.len());
    for id in ids {
        if let Some(m) = st.query_row([id], Media::from_row).optional()? {
            out.push(m);
        }
    }
    Ok(out)
}

pub fn set_rating(conn: &Connection, id: i64, rating: i64) -> Result<()> {
    conn.execute("UPDATE media SET rating = ?1 WHERE id = ?2", params![rating.clamp(0, 5), id])?;
    Ok(())
}

/// Запись доиграна (или прослушана больше половины).
pub fn mark_played(conn: &Connection, id: i64) -> Result<()> {
    conn.execute(
        "UPDATE media SET play_count = play_count + 1, last_played = ?1, position = 0 WHERE id = ?2",
        params![crate::now(), id],
    )?;
    Ok(())
}

/// Где остановился (для видео — продолжить с этого места).
pub fn set_position(conn: &Connection, id: i64, pos: f64) -> Result<()> {
    conn.execute("UPDATE media SET position = ?1 WHERE id = ?2", params![pos.max(0.0), id])?;
    Ok(())
}

/// Длительность, которую узнал проигрыватель (для файлов, где обход её не прочёл).
pub fn set_duration(conn: &Connection, id: i64, dur: f64) -> Result<()> {
    if dur.is_finite() && dur > 0.0 {
        conn.execute("UPDATE media SET duration = ?1 WHERE id = ?2 AND duration <= 0", params![dur, id])?;
    }
    Ok(())
}

/// Кадр-обложка для видео, сделанный проигрывателем.
pub fn set_cover(conn: &Connection, covers_dir: &Path, id: i64, data: &[u8], ext: &str) -> Result<String> {
    let p = tags::store_cover(covers_dir, data, ext)?.to_string_lossy().to_string();
    conn.execute("UPDATE media SET cover = ?1 WHERE id = ?2", params![p, id])?;
    Ok(p)
}

// ── свои метки ───────────────────────────────────────────────────────────

/// Заменяет метки записи на данный набор. Метки, у которых не осталось записей, удаляются.
pub fn set_user_tags(conn: &mut Connection, id: i64, names: &[String]) -> Result<()> {
    let tx = conn.transaction()?;
    tx.execute("DELETE FROM media_tags WHERE media_id = ?1", [id])?;
    for n in names {
        let n = n.trim();
        if n.is_empty() {
            continue;
        }
        tx.execute("INSERT OR IGNORE INTO tags(name) VALUES (?1)", [n])?;
        let tag_id: i64 = tx.query_row("SELECT id FROM tags WHERE name = ?1", [n], |r| r.get(0))?;
        tx.execute("INSERT OR IGNORE INTO media_tags(media_id, tag_id) VALUES (?1, ?2)", params![id, tag_id])?;
    }
    tx.execute("DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM media_tags)", [])?;
    tx.commit()?;
    Ok(())
}

/// Добавляет одну метку нескольким записям сразу.
pub fn add_tag(conn: &mut Connection, ids: &[i64], name: &str) -> Result<()> {
    let name = name.trim();
    if name.is_empty() {
        return Ok(());
    }
    let tx = conn.transaction()?;
    tx.execute("INSERT OR IGNORE INTO tags(name) VALUES (?1)", [name])?;
    let tag_id: i64 = tx.query_row("SELECT id FROM tags WHERE name = ?1", [name], |r| r.get(0))?;
    for id in ids {
        tx.execute("INSERT OR IGNORE INTO media_tags(media_id, tag_id) VALUES (?1, ?2)", params![id, tag_id])?;
    }
    tx.commit()?;
    Ok(())
}

// ── правка тегов в файле ─────────────────────────────────────────────────

/// Пишет теги в файл (только музыка) и в базу. Время изменения файла запоминается,
/// чтобы следующий обход не принял файл за изменённый снаружи.
pub fn edit_tags(conn: &Connection, id: i64, edit: &TagEdit) -> Result<Media> {
    let m = get(conn, id)?.ok_or_else(|| Error::msg("записи нет"))?;
    let path = Path::new(&m.path);
    if m.kind == "audio" {
        tags::write_audio(path, edit)?;
    }
    let (size, mtime) = match std::fs::metadata(path) {
        Ok(md) => (
            md.len() as i64,
            md.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map_or(m.mtime, |d| d.as_secs() as i64),
        ),
        Err(_) => (m.size, m.mtime),
    };
    let pick = |v: &Option<String>, old: &str| v.as_ref().map(|s| s.trim().to_string()).unwrap_or_else(|| old.to_string());
    let mut title = pick(&edit.title, &m.title);
    if title.is_empty() {
        title = path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    }
    conn.execute(
        "UPDATE media SET title = ?1, artist = ?2, album = ?3, album_artist = ?4, genre = ?5, year = ?6, track = ?7,
                          disc = ?8, size = ?9, mtime = ?10 WHERE id = ?11",
        params![
            title,
            pick(&edit.artist, &m.artist),
            pick(&edit.album, &m.album),
            pick(&edit.album_artist, &m.album_artist),
            pick(&edit.genre, &m.genre),
            edit.year.unwrap_or(m.year),
            edit.track.unwrap_or(m.track),
            edit.disc.unwrap_or(m.disc),
            size,
            mtime,
            id
        ],
    )?;
    get(conn, id)?.ok_or_else(|| Error::msg("записи нет"))
}

// ── настройки ────────────────────────────────────────────────────────────

pub fn setting(conn: &Connection, key: &str) -> Result<Option<String>> {
    Ok(conn.query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| r.get(0)).optional()?)
}

pub fn set_setting(conn: &Connection, key: &str, value: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO settings(key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}
