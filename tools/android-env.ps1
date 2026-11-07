# Окружение для сборки под Android. Набор (JDK 17, SDK, NDK, Gradle) лежит на внешнем диске в папке JavaSDK;
# буква диска бывает разной, поэтому ищется по всем дискам. Ничего не записывает в систему — только в этот процесс.
# Подключать: . tools\android-env.ps1

$ndkVer = '27.2.12479018'
$javaSdk = $null
foreach ($d in (Get-PSDrive -PSProvider FileSystem).Name) {
    if (Test-Path "${d}:\JavaSDK\android-sdk\platform-tools") { $javaSdk = "${d}:\JavaSDK"; break }
}
if (-not $javaSdk) { throw 'Не найден диск с JavaSDK — подключите внешний диск.' }

$env:JAVA_HOME = Join-Path $javaSdk 'jdk17'
$env:ANDROID_HOME = Join-Path $javaSdk 'android-sdk'
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
$env:NDK_HOME = Join-Path $env:ANDROID_HOME "ndk\$ndkVer"
$env:ANDROID_AVD_HOME = Join-Path $javaSdk 'avd'
$env:GRADLE_USER_HOME = Join-Path $javaSdk 'gradle-home'
$env:TMP = Join-Path $javaSdk 'tmp'
$env:TEMP = $env:TMP
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:ANDROID_HOME\emulator;$env:PATH"
$adb = Join-Path $env:ANDROID_HOME 'platform-tools\adb.exe'
$emulator = Join-Path $env:ANDROID_HOME 'emulator\emulator.exe'
if (-not (Test-Path $env:NDK_HOME)) { throw "Нет NDK $ndkVer в $env:ANDROID_HOME\ndk" }
