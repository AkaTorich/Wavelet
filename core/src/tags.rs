//! Теги музыкальных файлов: чтение при обходе, запись после правки, обложки.

use lofty::config::WriteOptions;
use lofty::picture::{MimeType, PictureType};
use lofty::prelude::*;
use lofty::probe::Probe;
use lofty::tag::{ItemKey, Tag};
use std::path::{Path, PathBuf};

use crate::model::TagEdit;
use crate::Result;

/// Что удалось прочесть из файла. Пустые поля — None.
#[derive(Debug, Default)]
pub struct AudioMeta {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub album_artist: Option<String>,
    pub genre: Option<String>,
    pub year: Option<i64>,
    pub track: Option<i64>,
    pub disc: Option<i64>,
    pub duration: f64,
    /// Вшитая обложка: байты и расширение файла.
    pub picture: Option<(Vec<u8>, &'static str)>,
}

fn clean<S: AsRef<str>>(s: Option<S>) -> Option<String> {
    s.map(|v| v.as_ref().trim().trim_matches('\0').to_string()).filter(|v| !v.is_empty())
}

/// Год из строки даты: «1997», «1997-03-12», «12.03.1997».
pub fn parse_year(s: &str) -> Option<i64> {
    let chars: Vec<char> = s.chars().collect();
    for w in chars.windows(4) {
        if w.iter().all(|c| c.is_ascii_digit()) {
            let y: i64 = w.iter().collect::<String>().parse().ok()?;
            if (1000..=2999).contains(&y) {
                return Some(y);
            }
        }
    }
    None
}

pub fn read_audio(path: &Path) -> Result<AudioMeta> {
    let tagged = Probe::open(path)?.guess_file_type()?.read()?;
    let mut meta = AudioMeta { duration: tagged.properties().duration().as_secs_f64(), ..Default::default() };
    let Some(tag) = tagged.primary_tag().or_else(|| tagged.first_tag()) else {
        return Ok(meta);
    };
    meta.title = clean(tag.title());
    meta.artist = clean(tag.artist());
    meta.album = clean(tag.album());
    meta.genre = clean(tag.genre());
    meta.album_artist = clean(tag.get_string(&ItemKey::AlbumArtist));
    meta.year = tag
        .get_string(&ItemKey::Year)
        .and_then(parse_year)
        .or_else(|| tag.get_string(&ItemKey::RecordingDate).and_then(parse_year))
        .or_else(|| tag.get_string(&ItemKey::OriginalReleaseDate).and_then(parse_year));
    meta.track = tag.track().map(i64::from);
    meta.disc = tag.disk().map(i64::from);
    let pics = tag.pictures();
    let pic = pics.iter().find(|p| p.pic_type() == PictureType::CoverFront).or_else(|| pics.first());
    if let Some(p) = pic {
        let ext = match p.mime_type() {
            Some(MimeType::Png) => "png",
            Some(MimeType::Gif) => "gif",
            Some(MimeType::Bmp) => "bmp",
            _ => "jpg",
        };
        if !p.data().is_empty() {
            meta.picture = Some((p.data().to_vec(), ext));
        }
    }
    Ok(meta)
}

fn set_text(tag: &mut Tag, key: ItemKey, v: &Option<String>) {
    if let Some(v) = v {
        let v = v.trim();
        if v.is_empty() {
            tag.remove_key(&key);
        } else {
            tag.insert_text(key, v.to_string());
        }
    }
}

/// Пишет правку в сам файл. Поле с пустой строкой стирается из тега.
pub fn write_audio(path: &Path, edit: &TagEdit) -> Result<()> {
    let mut tagged = Probe::open(path)?.guess_file_type()?.read()?;
    if tagged.primary_tag().is_none() {
        let tt = tagged.primary_tag_type();
        tagged.insert_tag(Tag::new(tt));
    }
    let tag = tagged.primary_tag_mut().expect("тег только что вставлен");

    set_text(tag, ItemKey::TrackTitle, &edit.title);
    set_text(tag, ItemKey::TrackArtist, &edit.artist);
    set_text(tag, ItemKey::AlbumTitle, &edit.album);
    set_text(tag, ItemKey::AlbumArtist, &edit.album_artist);
    set_text(tag, ItemKey::Genre, &edit.genre);
    if let Some(y) = edit.year {
        // год у разных форматов лежит под разными ключами: пишется туда, куда формат принимает
        let v = Some(y.map(|y| y.to_string()).unwrap_or_default());
        set_text(tag, ItemKey::Year, &v);
        set_text(tag, ItemKey::RecordingDate, &v);
    }
    if let Some(t) = edit.track {
        match t {
            Some(n) if n > 0 => tag.set_track(n as u32),
            _ => tag.remove_track(),
        }
    }
    if let Some(d) = edit.disc {
        match d {
            Some(n) if n > 0 => tag.set_disk(n as u32),
            _ => tag.remove_disk(),
        }
    }
    tag.save_to_path(path, WriteOptions::default())?;
    Ok(())
}

/// FNV-1a: короткое устойчивое имя файла для обложки по её байтам (одинаковые обложки — один файл).
pub fn fnv64(data: &[u8]) -> u64 {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in data {
        h ^= *b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    h
}

/// Кладёт обложку в папку обложек, если такой ещё нет. Возвращает полный путь.
pub fn store_cover(covers_dir: &Path, data: &[u8], ext: &str) -> Result<PathBuf> {
    std::fs::create_dir_all(covers_dir)?;
    let file = covers_dir.join(format!("{:016x}.{ext}", fnv64(data)));
    if !file.exists() {
        std::fs::write(&file, data)?;
    }
    Ok(file)
}

/// Обложка, лежащая картинкой рядом с файлами (cover.jpg, folder.jpg …).
pub fn folder_cover(dir: &Path) -> Option<PathBuf> {
    const NAMES: [&str; 5] = ["cover", "folder", "front", "albumart", "album"];
    let mut found: Option<(usize, PathBuf)> = None;
    for e in std::fs::read_dir(dir).ok()?.flatten() {
        let p = e.path();
        let stem = p.file_stem().and_then(|s| s.to_str()).map(str::to_ascii_lowercase);
        let ext = p.extension().and_then(|s| s.to_str()).map(str::to_ascii_lowercase);
        let (Some(stem), Some(ext)) = (stem, ext) else { continue };
        if !matches!(ext.as_str(), "jpg" | "jpeg" | "png" | "webp") {
            continue;
        }
        let rank = NAMES.iter().position(|n| stem == *n || stem.starts_with(&format!("{n}.")));
        if let Some(rank) = rank {
            if found.as_ref().map_or(true, |(r, _)| rank < *r) {
                found = Some((rank, p));
            }
        }
    }
    found.map(|(_, p)| p)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn years() {
        assert_eq!(parse_year("1997"), Some(1997));
        assert_eq!(parse_year("1997-03-12"), Some(1997));
        assert_eq!(parse_year("12.03.2004"), Some(2004));
        assert_eq!(parse_year("n/a"), None);
    }
}
