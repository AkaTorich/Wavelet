//! Субтитры рядом с видео: поиск файла и перевод SRT в WebVTT (окно понимает только VTT).

use std::path::{Path, PathBuf};

/// Ищет «имя.vtt», «имя.srt» или «имя.<язык>.srt» рядом с видео. VTT и точное имя — впереди.
pub fn find_for(video: &Path) -> Option<PathBuf> {
    let dir = video.parent()?;
    let stem = video.file_stem()?.to_str()?.to_lowercase();
    let mut best: Option<(u8, PathBuf)> = None;
    for e in std::fs::read_dir(dir).ok()?.flatten() {
        let p = e.path();
        let Some(ext) = p.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase) else { continue };
        let rank = match ext.as_str() {
            "vtt" => 0,
            "srt" => 1,
            _ => continue,
        };
        let Some(name) = p.file_stem().and_then(|s| s.to_str()).map(str::to_lowercase) else { continue };
        let fits = name == stem || name.starts_with(&format!("{stem}."));
        let rank = if name == stem { rank } else { rank + 2 };
        if fits && best.as_ref().map_or(true, |(r, _)| rank < *r) {
            best = Some((rank, p));
        }
    }
    best.map(|(_, p)| p)
}

/// Читает файл субтитров как текст VTT (SRT переводится; кодировка — UTF-8, иначе Windows-1251).
pub fn load_vtt(path: &Path) -> crate::Result<String> {
    let bytes = std::fs::read(path)?;
    let text = decode(&bytes);
    let is_vtt = path.extension().and_then(|e| e.to_str()).map_or(false, |e| e.eq_ignore_ascii_case("vtt"));
    Ok(if is_vtt { text } else { srt_to_vtt(&text) })
}

fn decode(bytes: &[u8]) -> String {
    let bytes = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(bytes);
    match std::str::from_utf8(bytes) {
        Ok(s) => s.to_string(),
        Err(_) => bytes.iter().map(|&b| cp1251(b)).collect(),
    }
}

fn cp1251(b: u8) -> char {
    match b {
        0x00..=0x7F => b as char,
        0xC0..=0xFF => char::from_u32(0x0410 + (b as u32 - 0xC0)).unwrap_or('?'),
        0xA8 => 'Ё',
        0xB8 => 'ё',
        0x96 => '–',
        0x97 => '—',
        0xAB => '«',
        0xBB => '»',
        0x85 => '…',
        0xA0 => '\u{a0}',
        0xB9 => '№',
        _ => '?',
    }
}

/// SRT → VTT: заголовок, запятая в отметках времени меняется на точку.
pub fn srt_to_vtt(srt: &str) -> String {
    let mut out = String::from("WEBVTT\n\n");
    for line in srt.replace("\r\n", "\n").replace('\r', "\n").lines() {
        if line.contains("-->") {
            out.push_str(&line.replace(',', "."));
        } else {
            out.push_str(line);
        }
        out.push('\n');
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn srt_becomes_vtt() {
        let v = srt_to_vtt("1\r\n00:00:01,500 --> 00:00:03,000\r\nПривет, мир\r\n");
        assert!(v.starts_with("WEBVTT\n\n"));
        assert!(v.contains("00:00:01.500 --> 00:00:03.000"));
        assert!(v.contains("Привет, мир"));
    }

    #[test]
    fn finds_language_subs() {
        let d = tempfile::tempdir().unwrap();
        std::fs::write(d.path().join("Film.mp4"), b"").unwrap();
        std::fs::write(d.path().join("Film.ru.srt"), b"").unwrap();
        std::fs::write(d.path().join("Other.srt"), b"").unwrap();
        let f = find_for(&d.path().join("Film.mp4")).unwrap();
        assert!(f.ends_with("Film.ru.srt"));
    }

    #[test]
    fn decodes_cp1251() {
        assert_eq!(decode(&[0xCF, 0xF0, 0xE8, 0xE2, 0xE5, 0xF2]), "Привет");
    }
}
