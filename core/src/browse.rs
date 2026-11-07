//! Сводки для боковых отборов: альбомы, исполнители, жанры, папки, метки, общий итог.

use rusqlite::Connection;

use crate::model::{Album, Group, Stats};
use crate::Result;

pub fn albums(conn: &Connection) -> Result<Vec<Album>> {
    let mut st = conn.prepare(
        "SELECT album, coalesce(nullif(album_artist, ''), artist) AS aa, max(year), count(*), sum(duration),
                (SELECT m2.cover FROM media m2 WHERE m2.album = m.album
                    AND coalesce(nullif(m2.album_artist, ''), m2.artist) = coalesce(nullif(m.album_artist, ''), m.artist)
                    AND m2.cover IS NOT NULL LIMIT 1)
         FROM media m WHERE kind = 'audio' AND album <> ''
         GROUP BY album, aa ORDER BY lower(aa), max(year), lower(album)",
    )?;
    let rows = st.query_map([], |r| {
        Ok(Album {
            album: r.get(0)?,
            artist: r.get(1)?,
            year: r.get(2)?,
            count: r.get(3)?,
            duration: r.get(4)?,
            cover: r.get(5)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

fn groups(conn: &Connection, sql: &str) -> Result<Vec<Group>> {
    let mut st = conn.prepare(sql)?;
    let rows = st.query_map([], |r| Ok(Group { name: r.get(0)?, count: r.get(1)?, duration: r.get(2)? }))?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

pub fn artists(conn: &Connection) -> Result<Vec<Group>> {
    groups(
        conn,
        "SELECT artist, count(*), sum(duration) FROM media WHERE kind = 'audio' AND artist <> ''
         GROUP BY artist COLLATE NOCASE ORDER BY lower(artist)",
    )
}

pub fn genres(conn: &Connection) -> Result<Vec<Group>> {
    groups(
        conn,
        "SELECT genre, count(*), sum(duration) FROM media WHERE genre <> ''
         GROUP BY genre COLLATE NOCASE ORDER BY lower(genre)",
    )
}

pub fn dirs(conn: &Connection) -> Result<Vec<Group>> {
    groups(conn, "SELECT dir, count(*), sum(duration) FROM media GROUP BY dir ORDER BY lower(dir)")
}

pub fn tags(conn: &Connection) -> Result<Vec<Group>> {
    groups(
        conn,
        "SELECT t.name, count(mt.media_id), ifnull(sum(m.duration), 0) FROM tags t
         JOIN media_tags mt ON mt.tag_id = t.id JOIN media m ON m.id = mt.media_id
         GROUP BY t.id ORDER BY lower(t.name)",
    )
}

pub fn stats(conn: &Connection) -> Result<Stats> {
    Ok(conn.query_row(
        "SELECT
            (SELECT count(*) FROM media WHERE kind = 'audio'),
            (SELECT count(*) FROM media WHERE kind = 'video'),
            (SELECT count(*) FROM (SELECT 1 FROM media WHERE kind = 'audio' AND album <> ''
                GROUP BY album, coalesce(nullif(album_artist, ''), artist))),
            (SELECT count(DISTINCT lower(artist)) FROM media WHERE kind = 'audio' AND artist <> ''),
            (SELECT ifnull(sum(duration), 0) FROM media),
            (SELECT ifnull(sum(size), 0) FROM media)",
        [],
        |r| {
            Ok(Stats {
                audio: r.get(0)?,
                video: r.get(1)?,
                albums: r.get(2)?,
                artists: r.get(3)?,
                duration: r.get(4)?,
                size: r.get(5)?,
            })
        },
    )?)
}
