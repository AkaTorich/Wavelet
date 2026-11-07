# Проверка окна Wavelet без клавиатуры и мыши: подключение к WebView2 по отладочному порту.
# Wavelet нужно запустить с переменной WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222
# (это делает tools\run-debug.ps1).
#   -Eval 'код JS'           выполнить в окне и вывести результат
#   -Shot файл.png           снимок окна
#   -Width 390 -Height 800   размер страницы для снимка (без него — как есть)

param([string]$Eval, [string]$Shot, [int]$Width = 0, [int]$Height = 0, [int]$Port = 9222)
$ErrorActionPreference = 'Stop'

$pages = Invoke-RestMethod "http://127.0.0.1:$Port/json"
$page = $pages | Where-Object { $_.type -eq 'page' } | Select-Object -First 1
if (-not $page) { throw 'окно не найдено' }

$ws = New-Object System.Net.WebSockets.ClientWebSocket
$ws.Options.KeepAliveInterval = [TimeSpan]::FromSeconds(30)
$ws.ConnectAsync([Uri]$page.webSocketDebuggerUrl, [Threading.CancellationToken]::None).Wait()
$script:id = 0

function Send-Cdp([string]$method, $params) {
    $script:id++
    $msg = @{ id = $script:id; method = $method; params = $params } | ConvertTo-Json -Depth 10 -Compress
    $bytes = [Text.Encoding]::UTF8.GetBytes($msg)
    $ws.SendAsync([ArraySegment[byte]]$bytes, 'Text', $true, [Threading.CancellationToken]::None).Wait()
    $buf = New-Object byte[] 1048576
    while ($true) {
        $ms = New-Object IO.MemoryStream
        do {
            $r = $ws.ReceiveAsync([ArraySegment[byte]]$buf, [Threading.CancellationToken]::None).Result
            $ms.Write($buf, 0, $r.Count)
        } while (-not $r.EndOfMessage)
        $text = [Text.Encoding]::UTF8.GetString($ms.ToArray())
        $obj = $text | ConvertFrom-Json
        if ($obj.id -eq $script:id) { return $obj }
    }
}

if ($Width -gt 0) {
    Send-Cdp 'Emulation.setDeviceMetricsOverride' @{ width = $Width; height = $Height; deviceScaleFactor = 1; mobile = ($Width -lt 720) } | Out-Null
    Start-Sleep -Milliseconds 500
}
if ($Eval) {
    $res = Send-Cdp 'Runtime.evaluate' @{ expression = $Eval; awaitPromise = $true; returnByValue = $true }
    if ($res.result.exceptionDetails) { Write-Output ('ОШИБКА: ' + ($res.result.exceptionDetails | ConvertTo-Json -Depth 6 -Compress)) }
    else { Write-Output ($res.result.result.value | ConvertTo-Json -Depth 6 -Compress) }
}
if ($Shot) {
    $res = Send-Cdp 'Page.captureScreenshot' @{ format = 'png' }
    [IO.File]::WriteAllBytes($Shot, [Convert]::FromBase64String($res.result.data))
    Write-Output "снимок: $Shot"
}
if ($Width -gt 0) { Send-Cdp 'Emulation.clearDeviceMetricsOverride' @{} | Out-Null }
$ws.Dispose()
