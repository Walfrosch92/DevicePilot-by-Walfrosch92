# Uninstallation - starts as administrator with open window
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Start-Process powershell.exe -Verb RunAs -ArgumentList "-NoExit -ExecutionPolicy Bypass -File `"$scriptDir\uninstall.ps1`""
    exit 0
}

# Language selection
Write-Host ""
Write-Host "  Select language / Sprache waehlen:" -ForegroundColor Cyan
Write-Host "  1 = Deutsch"
Write-Host "  2 = English"
Write-Host ""
do {
    $langInput = Read-Host "  Eingabe / Input"
} while ($langInput -ne '1' -and $langInput -ne '2')
$de = ($langInput -eq '1')

$PluginName    = 'com.ulanzi.devpilot.ulanziPlugin'
$TaskName      = 'DevicePilotBridge'
$VcamTaskName  = 'DevicePilotVirtualCamService'
$VcamPort      = 5000
$PluginDest    = Join-Path $env:APPDATA "Ulanzi\UlanziDeck\Plugins\$PluginName"

function Write-Header { param($msg) Write-Host ""; Write-Host "=== $msg ===" -ForegroundColor Cyan }
function Write-OK     { param($msg) Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Warn   { param($msg) Write-Host "  [!]  $msg" -ForegroundColor Yellow }
function Write-Info   { param($msg) Write-Host "  -->  $msg" -ForegroundColor White }

if ($de) { Write-Header "Deinstallation: Device Pilot Plugin" }
else      { Write-Header "Uninstallation: Device Pilot Plugin" }

# 1. Task Scheduler Tasks entfernen / Remove scheduled tasks
Unregister-ScheduledTask -TaskName $TaskName     -Confirm:$false -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $VcamTaskName -Confirm:$false -ErrorAction SilentlyContinue
if ($de) { Write-OK "Tasks entfernt (falls vorhanden)." }
else      { Write-OK "Scheduled tasks removed (if present)." }

# 2. Python Virtual-Cam-Dienst beenden / Stop Python virtual cam service
$vcamPid = $null
try {
    $conn = Get-NetTCPConnection -LocalPort $VcamPort -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($conn) { $vcamPid = $conn.OwningProcess }
} catch { }
if ($vcamPid) {
    Stop-Process -Id $vcamPid -Force -ErrorAction SilentlyContinue
    if ($de) { Write-OK "Python Virtual-Cam-Dienst beendet (PID $vcamPid)." }
    else      { Write-OK "Python virtual cam service stopped (PID $vcamPid)." }
} else {
    if ($de) { Write-OK "Python Virtual-Cam-Dienst war nicht aktiv." }
    else      { Write-OK "Python virtual cam service was not running." }
}

# 3. Bridge-Prozess (node.exe) beenden / Stop bridge process
Get-Process -Name "node" -ErrorAction SilentlyContinue |
    Where-Object {
        try { $_.MainModule.FileName -notlike "*Ulanzi Studio*" } catch { $false }
    } | Stop-Process -Force -ErrorAction SilentlyContinue
if ($de) { Write-OK "Bridge-Prozess beendet." }
else      { Write-OK "Bridge process stopped." }

# 4. Unity Capture DirectShow-Filter deregistrieren / Unregister Unity Capture DirectShow filter
$ucDll = Join-Path $PluginDest "native\webcam-mute\UnityCaptureFilter64.dll"
if (Test-Path $ucDll) {
    $reg = Start-Process regsvr32 -ArgumentList "/s /u `"$ucDll`"" -Wait -PassThru
    if ($reg.ExitCode -eq 0) {
        if ($de) { Write-OK "Unity Capture DirectShow-Filter deregistriert." }
        else      { Write-OK "Unity Capture DirectShow filter unregistered." }
    } else {
        if ($de) { Write-Warn "regsvr32 /u ExitCode $($reg.ExitCode) - Filter moeglicherweise noch aktiv." }
        else      { Write-Warn "regsvr32 /u ExitCode $($reg.ExitCode) - filter may still be active." }
    }
} else {
    Remove-Item 'HKLM:\SOFTWARE\Classes\CLSID\{5C2CD55C-92AD-4999-8666-912BD3E70010}' -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item 'HKLM:\SOFTWARE\Classes\CLSID\{5C2CD55C-92AD-4999-8666-912BD3E70011}' -Recurse -Force -ErrorAction SilentlyContinue
    if ($de) { Write-OK "Unity Capture Registry-Eintraege entfernt." }
    else      { Write-OK "Unity Capture registry entries removed." }
}

# 5. Plugin-Ordner loeschen / Delete plugin folder
if (Test-Path $PluginDest) {
    Remove-Item $PluginDest -Recurse -Force -ErrorAction SilentlyContinue
    if (Test-Path $PluginDest) {
        if ($de) {
            Write-Warn "Ordner konnte nicht vollstaendig geloescht werden (Dateien noch in Verwendung)."
            Write-Info "Bitte manuell loeschen: $PluginDest"
        } else {
            Write-Warn "Folder could not be fully deleted (files still in use)."
            Write-Info "Please delete manually: $PluginDest"
        }
    } else {
        if ($de) { Write-OK "Plugin-Ordner geloescht: $PluginDest" }
        else      { Write-OK "Plugin folder deleted: $PluginDest" }
    }
} else {
    if ($de) { Write-OK "Plugin-Ordner bereits nicht vorhanden." }
    else      { Write-OK "Plugin folder not found (already removed)." }
}

Write-Host ""
if ($de) { Write-Host "Device Pilot Plugin wurde vollstaendig deinstalliert." -ForegroundColor Green }
else      { Write-Host "Device Pilot Plugin has been completely uninstalled." -ForegroundColor Green }
Write-Host ""
if ($de) { Read-Host "  Druecke Enter zum Beenden" }
else      { Read-Host "  Press Enter to exit" }
