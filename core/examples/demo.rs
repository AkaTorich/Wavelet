//! Пробная библиотека для проверки окна: несколько исполнителей и альбомов, записи — короткие мелодии
//! (WAV) с тегами. Запуск: cargo run --release --example demo -- <папка> [картинка-обложка.png]

use std::f32::consts::PI;
use std::path::Path;

use wavelet_core::model::TagEdit;
use wavelet_core::tags;

fn tone_wav(path: &Path, notes: &[f32], secs_per_note: f32) {
    let rate = 22050u32;
    let mut pcm: Vec<i16> = Vec::new();
    for &f in notes {
        let n = (rate as f32 * secs_per_note) as usize;
        for i in 0..n {
            let t = i as f32 / rate as f32;
            let env = (t * 20.0).min(1.0) * (1.0 - i as f32 / n as f32).powf(0.6);
            let s = (2.0 * PI * f * t).sin() * 0.6 + (2.0 * PI * f * 2.0 * t).sin() * 0.15;
            pcm.push((s * env * 9000.0) as i16);
        }
    }
    let data_len = (pcm.len() * 2) as u32;
    let mut v = Vec::with_capacity(44 + data_len as usize);
    v.extend_from_slice(b"RIFF");
    v.extend_from_slice(&(36 + data_len).to_le_bytes());
    v.extend_from_slice(b"WAVEfmt ");
    v.extend_from_slice(&16u32.to_le_bytes());
    v.extend_from_slice(&1u16.to_le_bytes());
    v.extend_from_slice(&1u16.to_le_bytes());
    v.extend_from_slice(&rate.to_le_bytes());
    v.extend_from_slice(&(rate * 2).to_le_bytes());
    v.extend_from_slice(&2u16.to_le_bytes());
    v.extend_from_slice(&16u16.to_le_bytes());
    v.extend_from_slice(b"data");
    v.extend_from_slice(&data_len.to_le_bytes());
    for s in pcm {
        v.extend_from_slice(&s.to_le_bytes());
    }
    std::fs::write(path, v).unwrap();
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let root = Path::new(args.get(1).expect("папка"));
    let cover = args.get(2);
    let lib = [
        ("Астральный Сад", "Рассвет", "Psytrance", 2019, ["Утренний свет", "Глубина", "Сад камней", "Над облаками"]),
        ("Астральный Сад", "Ночные огни", "Psytrance", 2021, ["Город спит", "Неон", "Последний поезд", "Тишина"]),
        ("Ветер Севера", "Тьма", "Darkpsy", 1998, ["Ночной поезд", "Лес", "Туман", "Свеча"]),
        ("Lumen", "Waves", "Ambient", 2024, ["First Light", "Tide", "Drift", "Horizon"]),
    ];
    let scale = [220.0, 246.9, 261.6, 293.7, 329.6, 349.2, 392.0, 440.0];
    let mut k = 0usize;
    for (artist, album, genre, year, titles) in lib {
        let dir = root.join(artist).join(album);
        std::fs::create_dir_all(&dir).unwrap();
        if let Some(c) = cover {
            if album != "Тьма" {
                std::fs::copy(c, dir.join("cover.png")).unwrap();
            }
        }
        for (i, title) in titles.iter().enumerate() {
            let p = dir.join(format!("{:02} {title}.wav", i + 1));
            let notes: Vec<f32> = (0..16).map(|n| scale[(n * 3 + k * 5 + i) % scale.len()]).collect();
            tone_wav(&p, &notes, 0.45);
            k += 1;
            tags::write_audio(
                &p,
                &TagEdit {
                    title: Some(title.to_string()),
                    artist: Some(artist.into()),
                    album: Some(album.into()),
                    genre: Some(genre.into()),
                    year: Some(Some(year)),
                    track: Some(Some(i as i64 + 1)),
                    ..Default::default()
                },
            )
            .unwrap();
        }
    }
    println!("готово: {}", root.display());
}
