//! Общее состояние программы: база, папка обложек, обход папок в отдельном потоке.

use wavelet_core::rusqlite::Connection;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use tauri::{AppHandle, Emitter};

use wavelet_core::{db, library, scan, Error, Result};

pub struct AppState {
    db: Mutex<Connection>,
    pub db_path: PathBuf,
    pub covers: PathBuf,
    scanning: Arc<AtomicBool>,
    cancel: Arc<AtomicBool>,
}

impl AppState {
    pub fn open(data_dir: PathBuf) -> Result<Self> {
        let db_path = data_dir.join("wavelet.db");
        let conn = db::open(&db_path)?;
        Ok(AppState {
            db: Mutex::new(conn),
            db_path,
            covers: data_dir.join("covers"),
            scanning: Arc::new(AtomicBool::new(false)),
            cancel: Arc::new(AtomicBool::new(false)),
        })
    }

    pub fn db(&self) -> Result<MutexGuard<'_, Connection>> {
        self.db.lock().map_err(|_| Error::msg("база занята после сбоя"))
    }

    pub fn is_scanning(&self) -> bool {
        self.scanning.load(Ordering::SeqCst)
    }

    /// Запускает обход в отдельном потоке. Ход — событие `scan-progress`, итог — `scan-done`.
    /// Если обход уже идёт, ничего не делает (false).
    pub fn start_scan(&self, app: AppHandle) -> Result<bool> {
        if self.scanning.swap(true, Ordering::SeqCst) {
            return Ok(false);
        }
        self.cancel.store(false, Ordering::SeqCst);
        let folders = library::folders(&*self.db()?)?;
        let db_path = self.db_path.clone();
        let covers = self.covers.clone();
        let scanning = self.scanning.clone();
        let cancel = self.cancel.clone();
        std::thread::spawn(move || {
            let result = (|| -> Result<scan::Report> {
                let mut conn = db::open(&db_path)?;
                let mut last = std::time::Instant::now();
                scan::scan(&mut conn, &folders, &covers, &cancel, |p| {
                    // не чаще 10 раз в секунду, иначе окно захлебнётся событиями
                    if last.elapsed().as_millis() >= 100 || p.done == p.total {
                        last = std::time::Instant::now();
                        let _ = app.emit("scan-progress", p);
                    }
                })
            })();
            scanning.store(false, Ordering::SeqCst);
            let _ = match result {
                Ok(r) => app.emit("scan-done", r),
                Err(e) => app.emit("scan-error", e.0),
            };
        });
        Ok(true)
    }

    pub fn cancel_scan(&self) {
        self.cancel.store(true, Ordering::SeqCst);
    }
}
