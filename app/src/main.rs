// На ПК без чёрного окна консоли в выпуске.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    wavelet_lib::run()
}
