//! Длительность и размер кадра видео MP4/MOV — по коробкам moov/mvhd/tkhd, без сторонних крейтов.
//! WebM здесь не разбирается: длительность ему проставит окно при первом проигрывании.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

#[derive(Debug, Default, Clone, Copy, PartialEq)]
pub struct VideoMeta {
    pub duration: f64,
    pub width: Option<i64>,
    pub height: Option<i64>,
}

pub fn read_video(path: &Path) -> VideoMeta {
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    if !matches!(ext.as_str(), "mp4" | "m4v" | "mov") {
        return VideoMeta::default();
    }
    read_mp4(path).unwrap_or_default()
}

fn read_mp4(path: &Path) -> Option<VideoMeta> {
    let mut f = File::open(path).ok()?;
    let len = f.metadata().ok()?.len();
    let (start, size) = find_box(&mut f, 0, len, b"moov")?;
    let mut buf = vec![0u8; usize::try_from(size).ok()?.min(64 * 1024 * 1024)];
    f.seek(SeekFrom::Start(start)).ok()?;
    f.read_exact(&mut buf).ok()?;
    let mut meta = VideoMeta::default();
    parse_moov(&buf, &mut meta);
    Some(meta)
}

/// Ищет коробку верхнего уровня; возвращает (начало содержимого, длина содержимого).
fn find_box(f: &mut File, mut pos: u64, end: u64, name: &[u8; 4]) -> Option<(u64, u64)> {
    let mut head = [0u8; 16];
    while pos + 8 <= end {
        f.seek(SeekFrom::Start(pos)).ok()?;
        f.read_exact(&mut head[..8]).ok()?;
        let mut size = u32::from_be_bytes(head[0..4].try_into().ok()?) as u64;
        let mut header = 8;
        if size == 1 {
            f.read_exact(&mut head[8..16]).ok()?;
            size = u64::from_be_bytes(head[8..16].try_into().ok()?);
            header = 16;
        } else if size == 0 {
            size = end - pos;
        }
        if size < header {
            return None;
        }
        if &head[4..8] == name {
            return Some((pos + header, size - header));
        }
        pos += size;
    }
    None
}

/// Коробки внутри куска данных: (имя, содержимое).
fn boxes(data: &[u8]) -> impl Iterator<Item = (&[u8], &[u8])> {
    let mut pos = 0usize;
    std::iter::from_fn(move || {
        if pos + 8 > data.len() {
            return None;
        }
        let size = u32::from_be_bytes(data[pos..pos + 4].try_into().ok()?) as usize;
        let name = &data[pos + 4..pos + 8];
        let (start, end) = if size == 1 {
            let big = u64::from_be_bytes(data.get(pos + 8..pos + 16)?.try_into().ok()?) as usize;
            (pos + 16, pos.checked_add(big)?)
        } else if size == 0 {
            (pos + 8, data.len())
        } else {
            (pos + 8, pos.checked_add(size)?)
        };
        if end > data.len() || end < start {
            return None;
        }
        pos = end;
        Some((name, &data[start..end]))
    })
}

fn be32(d: &[u8], at: usize) -> Option<u64> {
    Some(u32::from_be_bytes(d.get(at..at + 4)?.try_into().ok()?) as u64)
}

fn be64(d: &[u8], at: usize) -> Option<u64> {
    Some(u64::from_be_bytes(d.get(at..at + 8)?.try_into().ok()?))
}

fn parse_moov(moov: &[u8], meta: &mut VideoMeta) {
    for (name, body) in boxes(moov) {
        match name {
            b"mvhd" => {
                let v = body.first().copied().unwrap_or(0);
                let (scale, dur) = if v == 1 { (be32(body, 20), be64(body, 24)) } else { (be32(body, 12), be32(body, 16)) };
                if let (Some(s), Some(d)) = (scale, dur) {
                    if s > 0 && d != u64::MAX && d != u32::MAX as u64 {
                        meta.duration = d as f64 / s as f64;
                    }
                }
            }
            b"trak" => {
                for (n, b) in boxes(body) {
                    if n == b"tkhd" && b.len() >= 8 && meta.width.is_none() {
                        let w = be32(b, b.len() - 8).unwrap_or(0) >> 16;
                        let h = be32(b, b.len() - 4).unwrap_or(0) >> 16;
                        if w > 0 && h > 0 {
                            meta.width = Some(w as i64);
                            meta.height = Some(h as i64);
                        }
                    }
                }
            }
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bx(name: &[u8; 4], body: &[u8]) -> Vec<u8> {
        let mut v = ((body.len() + 8) as u32).to_be_bytes().to_vec();
        v.extend_from_slice(name);
        v.extend_from_slice(body);
        v
    }

    #[test]
    fn reads_duration_and_size() {
        let mut mvhd = vec![0u8; 100];
        mvhd[12..16].copy_from_slice(&1000u32.to_be_bytes());
        mvhd[16..20].copy_from_slice(&125_500u32.to_be_bytes());
        let mut tkhd = vec![0u8; 84];
        let n = tkhd.len();
        tkhd[n - 8..n - 4].copy_from_slice(&(1920u32 << 16).to_be_bytes());
        tkhd[n - 4..].copy_from_slice(&(1080u32 << 16).to_be_bytes());
        let moov = [bx(b"mvhd", &mvhd), bx(b"trak", &bx(b"tkhd", &tkhd))].concat();
        let file = [bx(b"ftyp", b"isom0000"), bx(b"moov", &moov), bx(b"mdat", &[0u8; 32])].concat();

        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("a.mp4");
        std::fs::write(&p, file).unwrap();
        let m = read_video(&p);
        assert!((m.duration - 125.5).abs() < 1e-9);
        assert_eq!((m.width, m.height), (Some(1920), Some(1080)));
    }
}
