//! Списки воспроизведения: создать, переименовать, удалить, добавить записи, убрать, переставить.

use rusqlite::{params, Connection};

use crate::model::{Media, Playlist, PlaylistEntry, MEDIA_COLS};
use crate::Result;

pub fn list(conn: &Connection) -> Result<Vec<Playlist>> {
    let mut st = conn.prepare(
        "SELECT p.id, p.name, p.created, count(i.id), ifnull(sum(m.duration), 0)
         FROM playlists p LEFT JOIN playlist_items i ON i.playlist_id = p.id LEFT JOIN media m ON m.id = i.media_id
         GROUP BY p.id ORDER BY lower(p.name)",
    )?;
    let rows = st.query_map([], |r| {
        Ok(Playlist { id: r.get(0)?, name: r.get(1)?, created: r.get(2)?, count: r.get(3)?, duration: r.get(4)? })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

pub fn create(conn: &Connection, name: &str) -> Result<i64> {
    conn.execute("INSERT INTO playlists(name, created) VALUES (?1, ?2)", params![name.trim(), crate::now()])?;
    Ok(conn.last_insert_rowid())
}

pub fn rename(conn: &Connection, id: i64, name: &str) -> Result<()> {
    conn.execute("UPDATE playlists SET name = ?1 WHERE id = ?2", params![name.trim(), id])?;
    Ok(())
}

pub fn delete(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM playlists WHERE id = ?1", [id])?;
    Ok(())
}

pub fn items(conn: &Connection, id: i64) -> Result<Vec<PlaylistEntry>> {
    let sql = format!(
        "SELECT {MEDIA_COLS}, i.id FROM playlist_items i JOIN media m ON m.id = i.media_id
         WHERE i.playlist_id = ?1 ORDER BY i.pos, i.id"
    );
    let mut st = conn.prepare(&sql)?;
    let rows = st.query_map([id], |r| Ok(PlaylistEntry { media: Media::from_row(r)?, item_id: r.get(26)? }))?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Дописывает записи в конец списка.
pub fn add(conn: &mut Connection, id: i64, media_ids: &[i64]) -> Result<()> {
    let tx = conn.transaction()?;
    let mut pos: i64 =
        tx.query_row("SELECT ifnull(max(pos), -1) FROM playlist_items WHERE playlist_id = ?1", [id], |r| r.get(0))?;
    {
        let mut ins = tx.prepare("INSERT INTO playlist_items(playlist_id, media_id, pos) VALUES (?1, ?2, ?3)")?;
        for m in media_ids {
            pos += 1;
            ins.execute(params![id, m, pos])?;
        }
    }
    tx.commit()?;
    Ok(())
}

pub fn remove_items(conn: &mut Connection, item_ids: &[i64]) -> Result<()> {
    let tx = conn.transaction()?;
    {
        let mut del = tx.prepare("DELETE FROM playlist_items WHERE id = ?1")?;
        for i in item_ids {
            del.execute([i])?;
        }
    }
    tx.commit()?;
    Ok(())
}

/// Новый порядок: строки списка в том порядке, в каком их расставили.
pub fn reorder(conn: &mut Connection, id: i64, item_ids: &[i64]) -> Result<()> {
    let tx = conn.transaction()?;
    {
        let mut up = tx.prepare("UPDATE playlist_items SET pos = ?1 WHERE id = ?2 AND playlist_id = ?3")?;
        for (pos, item) in item_ids.iter().enumerate() {
            up.execute(params![pos as i64, item, id])?;
        }
    }
    tx.commit()?;
    Ok(())
}
