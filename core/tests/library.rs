//! Проверка библиотеки целиком: настоящие WAV-файлы с тегами, обход, поиск, метки, списки.

use std::path::Path;
use std::sync::atomic::AtomicBool;

use wavelet_core::model::TagEdit;
use wavelet_core::search::{list_media, ListRequest};
use wavelet_core::{browse, db, library, playlists, scan, tags};

/// Секунда тишины: WAV 8 кГц, моно, 16 бит.
fn write_wav(path: &Path) {
    let rate: u32 = 8000;
    let data_len: u32 = rate * 2;
    let mut v = Vec::new();
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
    v.resize(v.len() + data_len as usize, 0);
    std::fs::write(path, v).unwrap();
}

fn track(dir: &Path, name: &str, title: &str, artist: &str, album: &str, genre: &str, year: i64) {
    let p = dir.join(name);
    write_wav(&p);
    let edit = TagEdit {
        title: Some(title.into()),
        artist: Some(artist.into()),
        album: Some(album.into()),
        genre: Some(genre.into()),
        year: Some(Some(year)),
        track: Some(Some(1)),
        ..Default::default()
    };
    tags::write_audio(&p, &edit).unwrap();
}

fn req(q: &str) -> ListRequest {
    ListRequest { query: q.into(), ..Default::default() }
}

#[test]
fn whole_library() {
    let root = tempfile::tempdir().unwrap();
    let music = root.path().join("Музыка");
    let sub = music.join("Ночь");
    std::fs::create_dir_all(&sub).unwrap();
    track(&music, "01.wav", "Утренний свет", "Астрал", "Рассвет", "Psytrance", 2019);
    track(&music, "02.wav", "Глубина", "Астрал", "Рассвет", "Psytrance", 2019);
    track(&sub, "a.wav", "Ночной поезд", "Ветер", "Тьма", "Darkpsy", 1998);
    std::fs::write(sub.join("film.webm"), b"not really a video").unwrap();
    std::fs::write(sub.join("film.srt"), "1\n00:00:01,000 --> 00:00:02,000\nА\n").unwrap();
    std::fs::write(sub.join("notes.txt"), b"skip me").unwrap();

    let mut conn = db::open(&root.path().join("db").join("wavelet.db")).unwrap();
    assert!(library::add_folder(&conn, music.to_str().unwrap()).unwrap());
    // вложенная папка не добавляется второй раз
    assert!(!library::add_folder(&conn, sub.to_str().unwrap()).unwrap());

    let covers = root.path().join("covers");
    let folders = library::folders(&conn).unwrap();
    let cancel = AtomicBool::new(false);
    let r = scan::scan(&mut conn, &folders, &covers, &cancel, |_| {}).unwrap();
    assert_eq!((r.added, r.updated, r.removed, r.total, r.errors), (4, 0, 0, 4, 0));

    // теги прочитаны
    let all = list_media(&conn, &ListRequest::default()).unwrap();
    let night = all.iter().find(|m| m.title == "Ночной поезд").expect("теги WAV прочитаны");
    assert_eq!((night.artist.as_str(), night.year, night.kind.as_str()), ("Ветер", Some(1998), "audio"));
    assert!(night.duration > 0.9 && night.duration < 1.1);
    let film = all.iter().find(|m| m.kind == "video").unwrap();
    assert_eq!(film.title, "film");
    assert!(film.subs.as_deref().unwrap().ends_with("film.srt"));

    // поиск: по началу слова, без учёта регистра, с уточнениями
    assert_eq!(list_media(&conn, &req("утрен")).unwrap().len(), 1);
    assert_eq!(list_media(&conn, &req("АСТРАЛ")).unwrap().len(), 2);
    assert_eq!(list_media(&conn, &req("исполнитель:астрал глуб")).unwrap()[0].title, "Глубина");
    assert_eq!(list_media(&conn, &req("год:1990-1999")).unwrap().len(), 1);
    assert_eq!(list_media(&conn, &req("вид:видео")).unwrap().len(), 1);
    assert_eq!(list_media(&conn, &req("жанр:darkpsy")).unwrap().len(), 1);
    assert_eq!(list_media(&conn, &req("папка:ночь")).unwrap().len(), 2);
    assert!(list_media(&conn, &req("нетакого")).unwrap().is_empty());

    // свои метки ищутся тоже
    let deep = list_media(&conn, &req("глубина")).unwrap()[0].clone();
    library::set_user_tags(&mut conn, deep.id, &["для бега".into(), "Любимое".into()]).unwrap();
    assert_eq!(list_media(&conn, &req("метка:любимое")).unwrap()[0].id, deep.id);
    assert_eq!(list_media(&conn, &req("бега")).unwrap().len(), 1);
    assert_eq!(library::get(&conn, deep.id).unwrap().unwrap().tags, vec!["для бега", "Любимое"]);
    assert_eq!(browse::tags(&conn).unwrap().len(), 2);

    // сводки
    let albums = browse::albums(&conn).unwrap();
    assert_eq!(albums.len(), 2);
    assert_eq!(albums.iter().find(|a| a.album == "Рассвет").unwrap().count, 2);
    let st = browse::stats(&conn).unwrap();
    assert_eq!((st.audio, st.video, st.albums, st.artists), (3, 1, 2, 2));

    // правка тегов: и в файле, и в базе, и в поиске
    let edited = library::edit_tags(
        &conn,
        deep.id,
        &TagEdit { title: Some("Бездна".into()), genre: Some("Ambient".into()), ..Default::default() },
    )
    .unwrap();
    assert_eq!(edited.title, "Бездна");
    let reread = tags::read_audio(Path::new(&edited.path)).unwrap();
    assert_eq!(reread.title.as_deref(), Some("Бездна"));
    assert_eq!(list_media(&conn, &req("бездна")).unwrap().len(), 1);
    assert!(list_media(&conn, &req("глубина")).unwrap().is_empty());

    // повторный обход ничего не трогает, пропавший файл уходит, метки остаются
    let r = scan::scan(&mut conn, &folders, &covers, &cancel, |_| {}).unwrap();
    assert_eq!((r.added, r.updated, r.removed), (0, 0, 0));
    std::fs::remove_file(sub.join("a.wav")).unwrap();
    let r = scan::scan(&mut conn, &folders, &covers, &cancel, |_| {}).unwrap();
    assert_eq!((r.removed, r.total), (1, 3));
    assert_eq!(list_media(&conn, &req("метка:любимое")).unwrap().len(), 1);

    // картинка-обложка, положенная позже, подхватывается следующим обходом без перечитывания файлов
    std::fs::write(music.join("cover.png"), b"png").unwrap();
    let r = scan::scan(&mut conn, &folders, &covers, &cancel, |_| {}).unwrap();
    assert_eq!((r.added, r.updated, r.removed), (0, 2, 0));
    assert!(library::get(&conn, deep.id).unwrap().unwrap().cover.unwrap().ends_with("cover.png"));

    // счётчики
    library::mark_played(&conn, deep.id).unwrap();
    let plays = list_media(&conn, &ListRequest { order: "plays".into(), desc: true, ..Default::default() }).unwrap();
    assert_eq!((plays.len(), plays[0].play_count), (1, 1));
    library::set_duration(&conn, film.id, 42.0).unwrap();
    assert_eq!(library::get(&conn, film.id).unwrap().unwrap().duration, 42.0);

    // списки
    let pl = playlists::create(&conn, "Дорога").unwrap();
    let ids: Vec<i64> = list_media(&conn, &req("вид:музыка")).unwrap().iter().map(|m| m.id).collect();
    playlists::add(&mut conn, pl, &ids).unwrap();
    playlists::add(&mut conn, pl, &[film.id]).unwrap();
    let items = playlists::items(&conn, pl).unwrap();
    assert_eq!(items.len(), 3);
    let reversed: Vec<i64> = items.iter().rev().map(|e| e.item_id).collect();
    playlists::reorder(&mut conn, pl, &reversed).unwrap();
    assert_eq!(playlists::items(&conn, pl).unwrap()[0].media.id, film.id);
    playlists::remove_items(&mut conn, &[reversed[0]]).unwrap();
    assert_eq!(playlists::list(&conn).unwrap()[0].count, 2);

    // убрать папку — уходят и её записи
    let gone = library::remove_folder(&mut conn, music.to_str().unwrap()).unwrap();
    assert_eq!(gone, 3);
    assert!(list_media(&conn, &ListRequest::default()).unwrap().is_empty());

    // настройки
    library::set_setting(&conn, "theme", "ночь").unwrap();
    assert_eq!(library::setting(&conn, "theme").unwrap().as_deref(), Some("ночь"));
}
