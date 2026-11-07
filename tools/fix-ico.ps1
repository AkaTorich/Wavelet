# Переделывает app\icons\icon.ico так, чтобы Проводник показывал значок везде.
# «cargo tauri icon» кладёт все размеры в сжатом виде PNG, а Проводник на рабочем столе и в ярлыках
# такие мелкие размеры не читает и рисует пустую заглушку. Здесь размеры 16–64 переписываются
# несжатыми картинками (32 бита, с прозрачностью), 256 остаётся PNG.
# Запускать после каждого «cargo tauri icon». Запуск: powershell -ExecutionPolicy Bypass -File tools\fix-ico.ps1

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$ico = Join-Path (Split-Path $PSScriptRoot -Parent) 'app\icons\icon.ico'
$src = [IO.File]::ReadAllBytes($ico)
$count = [BitConverter]::ToUInt16($src, 4)

$entries = @()
for ($i = 0; $i -lt $count; $i++) {
    $e = 6 + 16 * $i
    $size = [BitConverter]::ToUInt32($src, $e + 8)
    $off = [BitConverter]::ToUInt32($src, $e + 12)
    $data = New-Object byte[] $size
    [Array]::Copy($src, $off, $data, 0, $size)
    $isPng = $data[0] -eq 0x89 -and $data[1] -eq 0x50
    $w = if ($src[$e] -eq 0) { 256 } else { $src[$e] }
    if ($isPng -and $w -lt 256) {
        $bmp = New-Object System.Drawing.Bitmap (New-Object IO.MemoryStream (, $data))
        $h = $bmp.Height
        $ms = New-Object IO.MemoryStream
        $bw = New-Object IO.BinaryWriter $ms
        # BITMAPINFOHEADER: высота вдвое (картинка + маска)
        $bw.Write([UInt32]40); $bw.Write([Int32]$w); $bw.Write([Int32]($h * 2)); $bw.Write([UInt16]1); $bw.Write([UInt16]32)
        $bw.Write([UInt32]0); $bw.Write([UInt32]0); $bw.Write([Int32]0); $bw.Write([Int32]0); $bw.Write([UInt32]0); $bw.Write([UInt32]0)
        for ($y = $h - 1; $y -ge 0; $y--) {
            for ($x = 0; $x -lt $w; $x++) {
                $c = $bmp.GetPixel($x, $y)
                $bw.Write([byte]$c.B); $bw.Write([byte]$c.G); $bw.Write([byte]$c.R); $bw.Write([byte]$c.A)
            }
        }
        # маска AND: строки по 32 бита; прозрачность уже в альфе, маска нулевая
        $stride = [int]([Math]::Ceiling($w / 32.0) * 4)
        $bw.Write((New-Object byte[] ($stride * $h)))
        $bw.Flush()
        $data = $ms.ToArray()
        $bmp.Dispose()
    }
    $entries += , @{ w = $w; data = $data }
}

$out = New-Object IO.MemoryStream
$bw = New-Object IO.BinaryWriter $out
$bw.Write([UInt16]0); $bw.Write([UInt16]1); $bw.Write([UInt16]$entries.Count)
$offset = 6 + 16 * $entries.Count
foreach ($en in $entries) {
    $b = if ($en.w -ge 256) { 0 } else { $en.w }
    $bw.Write([byte]$b); $bw.Write([byte]$b); $bw.Write([byte]0); $bw.Write([byte]0)
    $bw.Write([UInt16]1); $bw.Write([UInt16]32); $bw.Write([UInt32]$en.data.Length); $bw.Write([UInt32]$offset)
    $offset += $en.data.Length
}
foreach ($en in $entries) { $bw.Write($en.data) }
$bw.Flush()
[IO.File]::WriteAllBytes($ico, $out.ToArray())
Write-Output "icon.ico: $($entries.Count) размеров, мелкие — несжатые"
