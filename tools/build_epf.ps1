# Собирает .epf из XML-исходников через конфигуратор (нужна любая база с той же конфигурацией).
# Пример: tools\build_epf.ps1 -Src src\ОбменWildberries.xml -Out build\ОбменWildberries.epf -Base C:\1C\UNF_demo
# Если конфигуратор не закрылся за TimeoutSec, обычно он ждёт ответа в диалоге. Тогда скрипт
# сохраняет снимки окон этого процесса рядом с .epf, печатает их заголовки и закрывает только его.
param(
    [string]$Src, [string]$Out,
    [string]$Base = $env:UNF_BASE,
    [string]$User = "Администратор",
    [int]$TimeoutSec = 300,
    [string]$Platform = "C:\Program Files (x86)\1cv8t\8.5.1.1150\bin\1cv8t.exe"
)

function Save-WindowSnapshots([int]$ProcessId, [string]$Prefix) {
    Add-Type -AssemblyName System.Drawing
    Add-Type @"
using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;
public static class EpfBuildWindows {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint f);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  public struct RECT { public int L, T, R, B; }
  public static List<IntPtr> Of(uint pid) {
    var list = new List<IntPtr>();
    EnumWindows((h, l) => { uint p; GetWindowThreadProcessId(h, out p); if (p == pid && IsWindowVisible(h)) list.Add(h); return true; }, IntPtr.Zero);
    return list;
  }
  public static string Title(IntPtr h) { var sb = new StringBuilder(512); GetWindowText(h, sb, 512); return sb.ToString(); }
}
"@
    [EpfBuildWindows]::SetProcessDPIAware() | Out-Null
    $i = 0
    foreach ($h in [EpfBuildWindows]::Of([uint32]$ProcessId)) {
        $r = New-Object EpfBuildWindows+RECT
        [EpfBuildWindows]::GetWindowRect($h, [ref]$r) | Out-Null
        $w = $r.R - $r.L; $hh = $r.B - $r.T
        $file = "$Prefix.$i.png"
        if ($w -gt 0 -and $hh -gt 0) {
            $bmp = New-Object Drawing.Bitmap $w, $hh
            $g = [Drawing.Graphics]::FromImage($bmp); $dc = $g.GetHdc()
            [EpfBuildWindows]::PrintWindow($h, $dc, 2) | Out-Null
            $g.ReleaseHdc($dc); $g.Dispose()
            $bmp.Save($file, [Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
        }
        "  окно «$([EpfBuildWindows]::Title($h))» ${w}x${hh}: $file"
        $i++
    }
}

$log = [System.IO.Path]::ChangeExtension($Out, ".build.log")
Remove-Item $Out, $log -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force (Split-Path $Out) | Out-Null
$argLine = "DESIGNER /F `"$Base`" /N `"$User`" /DisableStartupDialogs /DisableStartupMessages /LoadExternalDataProcessorOrReportFromFiles `"$Src`" `"$Out`" /Out `"$log`""
$p = Start-Process $Platform -ArgumentList $argLine -PassThru
$null = $p.Handle   # без этого ExitCode у Start-Process -PassThru остаётся пустым
if (-not $p.WaitForExit($TimeoutSec * 1000)) {
    $p.Refresh()
    "TIMEOUT: конфигуратор (PID $($p.Id)) не закрылся за $TimeoutSec с, главное окно «$($p.MainWindowTitle)»"
    Save-WindowSnapshots $p.Id ([System.IO.Path]::ChangeExtension($Out, ".timeout"))
    Stop-Process -Id $p.Id -Force
    $p.WaitForExit(10000) | Out-Null
}
if (Test-Path $log) {
    Get-Content $log -Encoding Default
    Remove-Item $log -ErrorAction SilentlyContinue
}
if (Test-Path $Out) { "OK " + (Get-Item $Out).Length + " bytes" } else { "NO EPF, exit=$($p.ExitCode)"; exit 1 }
