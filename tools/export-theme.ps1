# Собирает ExportTheme.exe (во временной папке) и выгружает тему «Киберпанк» из ThemeLibrary
# в app\ui\css\theme.css. Запуск: powershell -ExecutionPolicy Bypass -File tools\export-theme.ps1

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$lib = Join-Path $root '..\Libraries\ThemeLibrary\ThemeLibrary.dll' | Resolve-Path
$fw = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319'
$wpf = Join-Path $fw 'WPF'
$csc = Get-ChildItem 'C:\Program Files\Microsoft Visual Studio' -Recurse -Filter csc.exe -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match 'Roslyn\\csc.exe$' } | Select-Object -First 1 -ExpandProperty FullName
if (-not $csc) { $csc = Join-Path $fw 'csc.exe' }

$tmp = Join-Path ([IO.Path]::GetTempPath()) 'wavelet-theme'
New-Item -ItemType Directory -Force $tmp | Out-Null
Copy-Item $lib $tmp -Force
$exe = Join-Path $tmp 'ExportTheme.exe'
& $csc /nologo /target:exe /platform:anycpu /out:$exe `
    /r:$lib /r:"$wpf\PresentationCore.dll" /r:"$wpf\PresentationFramework.dll" /r:"$wpf\WindowsBase.dll" `
    /r:"$fw\System.Xaml.dll" /r:System.Core.dll (Join-Path $PSScriptRoot 'ExportTheme\ExportTheme.cs')
if ($LASTEXITCODE -ne 0) { throw 'не собралось' }
& $exe (Join-Path $root 'app\ui\css\theme.css') Cyberpunk
$code = $LASTEXITCODE
Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
exit $code
