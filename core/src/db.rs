//! Открытие базы и её устройство. Версия устройства хранится в PRAGMA user_version;
//! каждое следующее изменение — новый шаг в MIGRATIONS, старые шаги не трогать.

use rusqlite::Connection;
use std::path::Path;

use crate::Result;

const MIGRATIONS: &[&str] = &[
    // 1 — первое устройство
    r#"
    CREATE TABLE folders(
        id INTEGER PRIMARY KEY,
        path TEXT NOT NULL UNIQUE,
        added INTEGER NOT NULL
    );
    CREATE TABLE media(
        id INTEGER PRIMARY KEY,
        path TEXT NOT NULL UNIQUE,
        dir TEXT NOT NULL,
        file_name TEXT NOT NULL,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        artist TEXT NOT NULL DEFAULT '',
        album TEXT NOT NULL DEFAULT '',
        album_artist TEXT NOT NULL DEFAULT '',
        genre TEXT NOT NULL DEFAULT '',
        year INTEGER,
        track INTEGER,
        disc INTEGER,
        duration REAL NOT NULL DEFAULT 0,
        width INTEGER,
        height INTEGER,
        size INTEGER NOT NULL,
        mtime INTEGER NOT NULL,
        added INTEGER NOT NULL,
        play_count INTEGER NOT NULL DEFAULT 0,
        last_played INTEGER,
        rating INTEGER NOT NULL DEFAULT 0,
        position REAL NOT NULL DEFAULT 0,
        cover TEXT,
        subs TEXT
    );
    CREATE INDEX media_kind ON media(kind);
    CREATE INDEX media_artist ON media(artist COLLATE NOCASE);
    CREATE INDEX media_album ON media(album COLLATE NOCASE);
    CREATE INDEX media_dir ON media(dir);
    CREATE INDEX media_added ON media(added);

    CREATE TABLE tags(
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL UNIQUE COLLATE NOCASE
    );
    CREATE TABLE media_tags(
        media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
        tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        PRIMARY KEY(media_id, tag_id)
    );

    CREATE TABLE playlists(
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        created INTEGER NOT NULL
    );
    CREATE TABLE playlist_items(
        id INTEGER PRIMARY KEY,
        playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
        media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
        pos INTEGER NOT NULL
    );
    CREATE INDEX playlist_items_pl ON playlist_items(playlist_id, pos);

    CREATE TABLE settings(
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );

    CREATE VIRTUAL TABLE media_fts USING fts5(
        title, artist, album, genre, file_name, tags,
        tokenize = 'unicode61 remove_diacritics 2'
    );

    CREATE TRIGGER media_ai AFTER INSERT ON media BEGIN
        INSERT INTO media_fts(rowid, title, artist, album, genre, file_name, tags)
        VALUES (new.id, new.title, new.artist || ' ' || new.album_artist, new.album, new.genre, new.file_name, '');
    END;
    CREATE TRIGGER media_au AFTER UPDATE OF title, artist, album_artist, album, genre, file_name ON media BEGIN
        DELETE FROM media_fts WHERE rowid = old.id;
        INSERT INTO media_fts(rowid, title, artist, album, genre, file_name, tags)
        VALUES (new.id, new.title, new.artist || ' ' || new.album_artist, new.album, new.genre, new.file_name,
            (SELECT ifnull(group_concat(t.name, ' '), '') FROM media_tags mt JOIN tags t ON t.id = mt.tag_id
             WHERE mt.media_id = new.id));
    END;
    CREATE TRIGGER media_ad AFTER DELETE ON media BEGIN
        DELETE FROM media_fts WHERE rowid = old.id;
    END;
    CREATE TRIGGER media_tags_ai AFTER INSERT ON media_tags BEGIN
        UPDATE media_fts SET tags = (SELECT ifnull(group_concat(t.name, ' '), '') FROM media_tags mt
            JOIN tags t ON t.id = mt.tag_id WHERE mt.media_id = new.media_id) WHERE rowid = new.media_id;
    END;
    CREATE TRIGGER media_tags_ad AFTER DELETE ON media_tags BEGIN
        UPDATE media_fts SET tags = (SELECT ifnull(group_concat(t.name, ' '), '') FROM media_tags mt
            JOIN tags t ON t.id = mt.tag_id WHERE mt.media_id = old.media_id) WHERE rowid = old.media_id;
    END;
    "#,
];

/// Открывает (или создаёт) базу и доводит её устройство до последней версии.
pub fn open(path: &Path) -> Result<Connection> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let conn = Connection::open(path)?;
    prepare(&conn)?;
    Ok(conn)
}

/// База в памяти — для проверок.
pub fn open_memory() -> Result<Connection> {
    let conn = Connection::open_in_memory()?;
    prepare(&conn)?;
    Ok(conn)
}

fn prepare(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;",
    )?;
    let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    for (i, step) in MIGRATIONS.iter().enumerate().skip(version as usize) {
        conn.execute_batch(&format!("BEGIN; {step}; PRAGMA user_version = {}; COMMIT;", i + 1))?;
    }
    Ok(())
}
