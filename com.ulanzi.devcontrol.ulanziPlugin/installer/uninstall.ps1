# Deinstallation - startet als Administrator mit offenem Fenster
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Start-Process powershell.exe -Verb RunAs -ArgumentList "-NoExit -ExecutionPolicy Bypass -File `"$scriptDir\uninstall.ps1`""
    exit 0
}

$PluginName    = 'com.ulanzi.devcontrol.ulanziPlugin'
$TaskName      = 'UlanziDevControlBridge'
$VcamTaskName  = 'UlanziVirtualCamService'
$VcamPort      = 5000
$PluginDest    = Join-Path $env:APPDATA "Ulanzi\UlanziDeck\Plugins\$PluginName"

function Write-Header { param($msg) Write-Host ""; Write-Host "=== $msg ===" -ForegroundColor Cyan }
function Write-OK     { param($msg) Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Warn   { param($msg) Write-Host "  [!]  $msg" -ForegroundColor Yellow }
function Write-Info   { param($msg) Write-Host "  -->  $msg" -ForegroundColor White }

Write-Header "Deinstallation: Device Pilot Plugin"

# 1. Task Scheduler Tasks entfernen
Unregister-ScheduledTask -TaskName $TaskName     -Confirm:$false -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $VcamTaskName -Confirm:$false -ErrorAction SilentlyContinue
Write-OK "Tasks entfernt (falls vorhanden)."

# 2. Python Virtual-Cam-Dienst beenden
$vcamPid = $null
try {
    $conn = Get-NetTCPConnection -LocalPort $VcamPort -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($conn) { $vcamPid = $conn.OwningProcess }
} catch { }
if ($vcamPid) {
    Stop-Process -Id $vcamPid -Force -ErrorAction SilentlyContinue
    Write-OK "Python Virtual-Cam-Dienst beendet (PID $vcamPid)."
} else {
    Write-OK "Python Virtual-Cam-Dienst war nicht aktiv."
}

# 3. Bridge-Prozess (node.exe) beenden
Get-Process -Name "node" -ErrorAction SilentlyContinue |
    Where-Object {
        try { $_.MainModule.FileName -notlike "*Ulanzi Studio*" } catch { $false }
    } | Stop-Process -Force -ErrorAction SilentlyContinue
Write-OK "Bridge-Prozess beendet."

# 4. Unity Capture DirectShow-Filter deregistrieren
$ucDll = Join-Path $PluginDest "native\webcam-mute\UnityCaptureFilter64.dll"
if (Test-Path $ucDll) {
    $reg = Start-Process regsvr32 -ArgumentList "/s /u `"$ucDll`"" -Wait -PassThru
    if ($reg.ExitCode -eq 0) {
        Write-OK "Unity Capture DirectShow-Filter deregistriert."
    } else {
        Write-Warn "regsvr32 /u ExitCode $($reg.ExitCode) - Filter moeglicherweise noch aktiv."
    }
} else {
    Remove-Item 'HKLM:\SOFTWARE\Classes\CLSID\{5C2CD55C-92AD-4999-8666-912BD3E70010}' -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item 'HKLM:\SOFTWARE\Classes\CLSID\{5C2CD55C-92AD-4999-8666-912BD3E70011}' -Recurse -Force -ErrorAction SilentlyContinue
    Write-OK "Unity Capture Registry-Eintraege entfernt."
}

# 5. Plugin-Ordner loeschen
if (Test-Path $PluginDest) {
    Remove-Item $PluginDest -Recurse -Force -ErrorAction SilentlyContinue
    if (Test-Path $PluginDest) {
        Write-Warn "Ordner konnte nicht vollstaendig geloescht werden (Dateien noch in Verwendung)."
        Write-Info "Bitte manuell loeschen: $PluginDest"
    } else {
        Write-OK "Plugin-Ordner geloescht: $PluginDest"
    }
} else {
    Write-OK "Plugin-Ordner bereits nicht vorhanden."
}

Write-Host ""
Write-Host "Device Pilot Plugin wurde vollstaendig deinstalliert." -ForegroundColor Green
Write-Host ""
Read-Host "  Druecke Enter zum Beenden"
