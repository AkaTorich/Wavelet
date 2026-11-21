//! Поиск и выборка записей. Строка поиска: свободные слова ищутся везде (по началу слова),
//! уточнения `исполнитель:`, `альбом:`, `жанр:`, `название:`, `метка:`, `год:1990-1999`,
//! `вид:видео`, `папка:` (и английские `artist:` …). Фразу можно взять в кавычки.

use rusqlite::{params_from_iter, types::Value, Connection};
use serde::Deserialize;

use crate::model::{Media, MEDIA_COLS};
use crate::Result;

/// Что окно просит показать.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct ListRequest {
    /// Строка поиска.
    pub query: String,
    /// "audio" / "video"
    pub kind: Option<String>,
    /// Отбор по альбому: название и исполнитель альбома.
    pub album: Option<String>,
    pub album_artist: Option<String>,
    pub artist: Option<String>,
    pub genre: Option<String>,
    pub dir: Option<String>,
    pub tag: Option<String>,
    /// default, title, artist, album, year, added, played, plays, duration, rating, path
    pub order: String,
    pub desc: bool,
    pub limit: Option<i64>,
}

/// Разобранная строка поиска.
#[derive(Debug, Default, PartialEq)]
pub struct Parsed {
    /// Выражение для FTS5 MATCH; None — слов для полнотекстового поиска нет.
    pub fts: Option<String>,
    pub years: Option<(i64, i64)>,
    pub kind: Option<String>,
    pub folder: Option<String>,
}

fn column_for(key: &str) -> Option<&'static str> {
    Some(match key {
        "исполнитель" | "артист" | "artist" | "a" => "artist",
        "альбом" | "album" | "al" => "album",
        "жанр" | "genre" | "g" => "genre",
        "название" | "title" | "t" => "title",
        "метка" | "метки" | "тег" | "tag" | "tags" | "label" | "labels" => "tags",
        "файл" | "file" => "file_name",
        _ => return None,
    })
}

/// Делит строку на слова, учитывая кавычки: `жанр:"dark psy" ночь` → [жанр:dark psy, ночь].
fn tokens(q: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut quoted = false;
    for c in q.chars() {
        match c {
            '"' | '«' | '»' => quoted = if c == '«' { true } else if c == '»' { false } else { !quoted },
            c if c.is_whitespace() && !quoted => {
                if !cur.is_empty() {
                    out.push(std::mem::take(&mut cur));
                }
            }
            c => cur.push(c),
        }
    }
    if !cur.is_empty() {
        out.push(cur);
    }
    out
}

/// Слово для FTS5: в кавычках (чтобы знаки не считались синтаксисом) и со звёздочкой — поиск по началу.
fn fts_term(word: &str) -> Option<String> {
    let w: String = word.chars().filter(|c| c.is_alphanumeric() || c.is_whitespace() || *c == '\'' || *c == '-').collect();
    let w = w.trim();
    if w.is_empty() {
        return None;
    }
    let parts: Vec<String> =
        w.split(|c: char| c.is_whitespace() || c == '-' || c == '\'').filter(|p| !p.is_empty()).map(str::to_string).collect();
    if parts.is_empty() {
        return None;
    }
    // фраза: слова подряд, последнее — по началу
    let phrase = parts.join(" ").to_lowercase();
    Some(format!("\"{}\"*", phrase.replace('"', "")))
}

pub fn parse(q: &str) -> Parsed {
    let mut p = Parsed::default();
    let mut terms: Vec<String> = Vec::new();
    for tok in tokens(q) {
        if let Some((key, val)) = tok.split_once(':') {
            let key = key.to_lowercase();
            let val = val.trim();
            if val.is_empty() {
                continue;
            }
            match key.as_str() {
                "год" | "year" | "y" => {
                    let (a, b) = val.split_once('-').unwrap_or((val, val));
                    if let (Ok(a), Ok(b)) = (a.trim().parse::<i64>(), b.trim().parse::<i64>()) {
                        p.years = Some((a.min(b), a.max(b)));
                    }
                    continue;
                }
                "вид" | "тип" | "type" | "kind" => {
                    let v = val.to_lowercase();
                    p.kind = if v.starts_with("вид") || v.starts_with("vid") || v.starts_with("фил") {
                        Some("video".into())
                    } else if v.starts_with("муз") || v.starts_with("зв") || v.starts_with("au") || v.starts_with("mus") {
                        Some("audio".into())
                    } else {
                        None
                    };
                    continue;
                }
                "папка" | "folder" | "dir" => {
                    p.folder = Some(val.to_string());
                    continue;
                }
                _ => {
                    if let Some(col) = column_for(&key) {
                        if let Some(t) = fts_term(val) {
                            terms.push(format!("{col} : {t}"));
                        }
                        continue;
                    }
                }
            }
        }
        if let Some(t) = fts_term(&tok) {
            terms.push(t);
        }
    }
    if !terms.is_empty() {
        p.fts = Some(terms.join(" AND "));
    }
    p
}

fn order_clause(req: &ListRequest, has_fts: bool) -> String {
    let dir = if req.desc { "DESC" } else { "ASC" };
    let by_album =
        "lower(coalesce(nullif(m.album_artist, ''), m.artist)), lower(m.album), m.disc, m.track, lower(m.title)";
    match req.order.as_str() {
        "title" => format!("lower(m.title) {dir}"),
        "artist" => format!("lower(m.artist) {dir}, lower(m.album), m.disc, m.track"),
        "album" => format!("lower(m.album) {dir}, m.disc, m.track"),
        "year" => format!("m.year {dir}, lower(m.album), m.disc, m.track"),
        "added" => format!("m.added {dir}, m.id {dir}"),
        "played" => format!("m.last_played {dir}"),
        "plays" => format!("m.play_count {dir}, m.last_played DESC"),
        "duration" => format!("m.duration {dir}"),
        "rating" => format!("m.rating {dir}, lower(m.title)"),
        "path" => format!("m.path {dir}"),
        "track" => format!("m.disc {dir}, m.track {dir}, lower(m.title)"),
        _ if has_fts => "bm25(media_fts, 10.0, 6.0, 4.0, 2.0, 1.0, 5.0)".to_string(),
        _ => by_album.to_string(),
    }
}

/// Главная выборка: и простой список библиотеки, и поиск, и отбор по альбому/исполнителю/жанру/папке/метке.
pub fn list_media(conn: &Connection, req: &ListRequest) -> Result<Vec<Media>> {
    let parsed = parse(&req.query);
    let mut sql = format!("SELECT {MEDIA_COLS} FROM media m");
    let mut cond: Vec<String> = Vec::new();
    let mut args: Vec<Value> = Vec::new();

    if let Some(fts) = &parsed.fts {
        sql.push_str(" JOIN media_fts ON media_fts.rowid = m.id");
        cond.push("media_fts MATCH ?".into());
        args.push(Value::Text(fts.clone()));
    }
    if let Some(k) = req.kind.as_ref().or(parsed.kind.as_ref()) {
        cond.push("m.kind = ?".into());
        args.push(Value::Text(k.clone()));
    }
    if let Some((a, b)) = parsed.years {
        cond.push("m.year BETWEEN ? AND ?".into());
        args.push(Value::Integer(a));
        args.push(Value::Integer(b));
    }
    if let Some(al) = &req.album {
        cond.push("m.album = ?".into());
        args.push(Value::Text(al.clone()));
        if let Some(aa) = &req.album_artist {
            cond.push("coalesce(nullif(m.album_artist, ''), m.artist) = ?".into());
            args.push(Value::Text(aa.clone()));
        }
    }
    if let Some(a) = &req.artist {
        cond.push("(m.artist = ? OR m.album_artist = ?)".into());
        args.push(Value::Text(a.clone()));
        args.push(Value::Text(a.clone()));
    }
    if let Some(g) = &req.genre {
        cond.push("m.genre = ?".into());
        args.push(Value::Text(g.clone()));
    }
    if let Some(d) = &req.dir {
        cond.push("m.dir = ?".into());
        args.push(Value::Text(d.clone()));
    }
    if let Some(t) = &req.tag {
        cond.push("m.id IN (SELECT mt.media_id FROM media_tags mt JOIN tags t ON t.id = mt.tag_id WHERE t.name = ?)".into());
        args.push(Value::Text(t.clone()));
    }
    if req.order == "played" {
        cond.push("m.last_played IS NOT NULL".into());
    }
    if req.order == "plays" {
        cond.push("m.play_count > 0".into());
    }
    if !cond.is_empty() {
        sql.push_str(" WHERE ");
        sql.push_str(&cond.join(" AND "));
    }
    sql.push_str(" ORDER BY ");
    sql.push_str(&order_clause(req, parsed.fts.is_some()));
    // отбор по папке — здесь, а не в SQL: LIKE в SQLite не знает заглавных русских букв
    let folder = parsed.folder.as_ref().map(|f| f.to_lowercase());
    if let (Some(l), None) = (req.limit, &folder) {
        sql.push_str(&format!(" LIMIT {}", l.max(0)));
    }

    let mut st = conn.prepare(&sql)?;
    let rows = st.query_map(params_from_iter(args.iter()), Media::from_row)?;
    let mut out = Vec::new();
    let limit = req.limit.map_or(usize::MAX, |l| l.max(0) as usize);
    for r in rows {
        let m = r?;
        if let Some(f) = &folder {
            if !m.dir.to_lowercase().contains(f.as_str()) {
                continue;
            }
        }
        if out.len() >= limit {
            break;
        }
        out.push(m);
    }
    Ok(out)
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_filters() {
        let p = parse("жанр:\"dark psy\" год:1999-1995 вид:видео ночь");
        assert_eq!(p.years, Some((1995, 1999)));
        assert_eq!(p.kind.as_deref(), Some("video"));
        assert_eq!(p.fts.as_deref(), Some("genre : \"dark psy\"* AND \"ночь\"*"));
    }

    #[test]
    fn strips_fts_syntax() {
        let p = parse("AC/DC \"(live)\" NEAR*");
        assert_eq!(p.fts.as_deref(), Some("\"acdc\"* AND \"live\"* AND \"near\"*"));
        assert_eq!(parse("  ").fts, None);
    }
}
