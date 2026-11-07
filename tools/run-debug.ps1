# Запускает собранный Wavelet с отладочным портом WebView2 (9222) — для проверки через tools\cdp.ps1.
$exe = Join-Path (Split-Path $PSScriptRoot -Parent) 'target\release\Wavelet.exe'
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9222'
Start-Process $exe
