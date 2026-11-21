# Прогон автотестов обмена с WB на копии демобазы УНФ.
# Поднимает мок API WB (tools/wb-mock.js), восстанавливает базу из эталона до и после прогона,
# после тестов проверяет пакетный запуск обработки, как его вызовет планировщик Windows.
# Пример: tools\test.ps1 -Base C:\1C\UNF_demo -Reference C:\1C\UNF_ref\1Cv8.1CD -Build
param(
    [string]$Base = $env:UNF_BASE,
    [string]$Reference = $env:UNF_REFERENCE,
    [switch]$Build, [switch]$Volume, [int]$TimeoutMin = 0, [int]$Port = 8471,
    [string]$User = "Администратор",
    [string]$Platform = "C:\Program Files (x86)\1cv8t\8.5.1.1150\bin\1cv8t.exe"
)
$ErrorActionPreference = "Stop"
# С ключом -Volume создаются все 300 заказов объёмного теста: проведение заказа в учебной УНФ занимает секунды.
if ($TimeoutMin -le 0) { $TimeoutMin = if ($Volume) { 45 } else { 20 } }
$root = Split-Path $PSScriptRoot
$mock = "http://127.0.0.1:$Port"
$busy = Get-CimInstance Win32_Process -Filter "Name like '1cv8%'" | Where-Object { $_.CommandLine -like "*$Base*" }
if ($busy) { "Закройте 1С на базе $Base`: учебная версия пускает одно подключение"; exit 1 }
if ($Build) {
    & "$PSScriptRoot\build_epf.ps1" -Src "$root\src\ОбменWildberries.xml" -Out "$root\build\ОбменWildberries.epf" -Base $Base -User $User -Platform $Platform
    & "$PSScriptRoot\build_epf.ps1" -Src "$root\tests\src\ТестыОбменаWB.xml" -Out "$root\tests\build\ТестыОбменаWB.epf" -Base $Base -User $User -Platform $Platform
}
foreach ($epf in "$root\build\ОбменWildberries.epf", "$root\tests\build\ТестыОбменаWB.epf") {
    if (-not (Test-Path $epf)) { "Нет $epf, соберите с ключом -Build"; exit 1 }
}

function Run-1C([string]$Epf, [string]$Param, [int]$Minutes) {
    $argLine = "ENTERPRISE /F `"$Base`" /N `"$User`" /DisableStartupDialogs /DisableStartupMessages /Execute `"$Epf`" /C `"$Param`""
    $p = Start-Process $Platform -ArgumentList $argLine -PassThru
    if (-not $p.WaitForExit($Minutes * 60000)) { Stop-Process -Id $p.Id -Force; Start-Sleep 2; "TIMEOUT $Epf" }
}

$node = Start-Process node -ArgumentList "`"$root\tools\wb-mock.js`" --port $Port" -PassThru -WindowStyle Hidden
$ready = $false
for ($i = 0; $i -lt 50 -and -not $ready; $i++) {
    # /ping, как и у WB, требует токен, поэтому готовность проверяем по служебному журналу мока.
    try { Invoke-RestMethod "$mock/__mock/log" | Out-Null; $ready = $true } catch { Start-Sleep -Milliseconds 200 }
}
if (-not $ready) {
    "Мок WB не запустился"
    if (-not $node.HasExited) { Stop-Process -Id $node.Id -Force }
    exit 1
}

$report = "$root\tests\last_run.txt"
$batch = "$root\tests\batch_run.txt"
Remove-Item $report, $batch -ErrorAction SilentlyContinue
try {
    Copy-Item $Reference "$Base\1Cv8.1CD" -Force
    $mode = if ($Volume) { ";Объем" } else { "" }
    Run-1C "$root\tests\build\ТестыОбменаWB.epf" "Тесты;$root\build\ОбменWildberries.epf;$root;$report;$mock$mode" $TimeoutMin

    # Пакетный запуск на той же базе: тесты сохранили настройки. Мок возвращается к исходным заданиям
    # (все уже загружены тестами), и на WB появляется 5 новых.
    Invoke-RestMethod -Method Post "$mock/__mock/reset" | Out-Null
    Invoke-RestMethod -Method Post "$mock/__mock/orders/generate" -ContentType "application/json" -Body '{"count":5}' | Out-Null
    Run-1C "$root\build\ОбменWildberries.epf" "ЗагрузитьЗаказы;$batch" 5
}
finally {
    try { Invoke-RestMethod -Method Post "$mock/__mock/shutdown" | Out-Null } catch { }
    Copy-Item $Reference "$Base\1Cv8.1CD" -Force
    "база восстановлена из эталона"
}

if (-not (Test-Path $report)) { "НЕТ ОТЧЁТА ТЕСТОВ"; exit 1 }
$lines = @(Get-Content $report -Encoding UTF8)
$batchText = if (Test-Path $batch) { @(Get-Content $batch -Encoding UTF8) } else { @("нет отчёта пакетного запуска") }
$batchOk = ($batchText -join "`n") -match "Создано заказов: 5,"
$lines += ""
$lines += "Пакетный запуск: обработка с параметром ЗагрузитьЗаказы, как из планировщика"
$lines += $(if ($batchOk) { "  ok    создано 5 заказов по новым заданиям" } else { "  FAIL  пакетный запуск" })
$lines += $batchText | ForEach-Object { "        " + $_ }
$m = [regex]::Match($lines[0], "Проверок: (\d+), пройдено: (\d+), не пройдено: (\d+)")
if ($m.Success) {
    $total = [int]$m.Groups[1].Value + 1
    $passed = [int]$m.Groups[2].Value + [int]$batchOk
    $failed = [int]$m.Groups[3].Value + [int](-not $batchOk)
    $lines[0] = $lines[0] -replace "Проверок: \d+, пройдено: \d+, не пройдено: \d+", "Проверок: $total, пройдено: $passed, не пройдено: $failed"
}
$lines | Set-Content $report -Encoding UTF8
$lines
