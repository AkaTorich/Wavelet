# Сборка Wavelet.apk: arm64 для телефонов + x86_64 для эмулятора, подпись своим ключом, копия в корень проекта.
#
# Почему не одной командой «cargo tauri android build»: в конце она делает символьные ссылки на библиотеки,
# а Windows без режима разработчика даёт их только администратору. Поэтому так:
#   1) библиотека Rust под каждую цель собирается самим Tauri (со всеми нужными переменными); его последний шаг —
#      ссылка — падает, это ожидаемо, проверяется только свежесть готовой .so;
#   2) .so копируются в jniLibs обычным копированием;
#   3) Gradle собирает apk без своих задач сборки Rust (-x rustBuild…). Gradle не терпит русских букв в пути,
#      поэтому на время его работы папка проекта подключается буквой W: (subst).
# Запуск: powershell -ExecutionPolicy Bypass -File tools\build-android.ps1 [-SkipRust]

param([switch]$SkipRust)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'android-env.ps1')
$root = Split-Path $PSScriptRoot -Parent
$app = Join-Path $root 'app'
$android = Join-Path $app 'gen\android'
$targets = @(
    @{ tauri = 'aarch64'; triple = 'aarch64-linux-android'; abi = 'arm64-v8a'; arch = 'arm64' },
    @{ tauri = 'x86_64'; triple = 'x86_64-linux-android'; abi = 'x86_64'; arch = 'x86_64' }
)

Set-Location $app
if (-not (Test-Path $android)) { throw 'Нет app\gen\android — сначала «cargo tauri android init --ci» и правки из README.' }

if (-not $SkipRust) {
    foreach ($t in $targets) {
        $so = Join-Path $root "target\$($t.triple)\release\libwavelet_lib.so"
        $started = Get-Date
        Write-Output "Rust: $($t.triple)"
        $ErrorActionPreference = 'Continue'
        cargo tauri android build --apk --target $t.tauri -- --jobs 2 2>&1 | ForEach-Object { "$_" } |
            Select-String -Pattern '^error|error\[|Finished' | ForEach-Object { "  $_" }
        $ErrorActionPreference = 'Stop'
        if (-not (Test-Path $so) -or (Get-Item $so).LastWriteTime -lt $started.AddSeconds(-5)) {
            # библиотека не пересобралась: либо ничего не менялось, либо настоящая ошибка — проверить сборкой ещё раз
            $fresh = (cargo tauri android build --apk --target $t.tauri -- --jobs 2 2>&1 | Out-String)
            if ($fresh -notmatch 'Finished') { throw "Rust для $($t.triple) не собрался:`n$fresh" }
        }
    }
}

foreach ($t in $targets) {
    $dir = Join-Path $android "app\src\main\jniLibs\$($t.abi)"
    New-Item -ItemType Directory -Force $dir | Out-Null
    $dst = Join-Path $dir 'libwavelet_lib.so'
    if (Test-Path $dst) { Remove-Item $dst -Force }
    Copy-Item (Join-Path $root "target\$($t.triple)\release\libwavelet_lib.so") $dst
}

$letter = 'W:'
if (Test-Path "$letter\") { subst $letter /D | Out-Null }
subst $letter $root
Set-Location "$letter\app\gen\android"
$abis = ($targets | ForEach-Object { $_.abi }) -join ','
$archs = ($targets | ForEach-Object { $_.arch }) -join ','
$tlist = ($targets | ForEach-Object { $_.tauri }) -join ','
$skip = @('-x', 'rustBuildUniversalRelease')
foreach ($t in $targets) { $skip += @('-x', "rustBuild$((Get-Culture).TextInfo.ToTitleCase($t.arch))Release") }
$ErrorActionPreference = 'Continue'
& .\gradlew.bat assembleUniversalRelease "-PabiList=$abis" "-ParchList=$archs" "-PtargetList=$tlist" @skip --no-daemon 2>&1 |
    ForEach-Object { "$_" } | Select-String -Pattern 'BUILD|What went wrong|error:|e: ' | ForEach-Object { "  $_" }
$ErrorActionPreference = 'Stop'
Set-Location $root
subst $letter /D | Out-Null
$apk = Get-ChildItem (Join-Path $android 'app\build\outputs\apk\universal\release') -Filter '*.apk' -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $apk) { throw 'apk не собрался' }
Copy-Item $apk.FullName (Join-Path $root 'Wavelet.apk') -Force
Set-Location $root
Write-Output "APK: $(Join-Path $root 'Wavelet.apk')"
