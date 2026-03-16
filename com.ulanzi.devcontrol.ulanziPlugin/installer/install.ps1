# ============================================================================
# install.ps1 - Installer fuer das Ulanzi Device Pilot Plugin
# ============================================================================
# Ausfuehren (als Administrator):
#   powershell -ExecutionPolicy Bypass -File ".\installer\install.ps1"
#
# Deinstallation (Doppelklick oder):
#   powershell -ExecutionPolicy Bypass -File ".\installer\uninstall.ps1"
# ============================================================================

[CmdletBinding()]
param (
    [switch]$Uninstall,
    [switch]$SkipNodeCheck,
    [ValidateSet('de','en')]
    [string]$Language = ''
)

$ErrorActionPreference = 'Continue'

$PluginName    = 'com.ulanzi.devpilot.ulanziPlugin'
$TaskName      = 'DevicePilotBridge'
$VcamTaskName  = 'DevicePilotVirtualCamService'
$BridgePort    = 3907
$VcamPort      = 5000
$NodeMinMajor  = 18

function Write-Header { param($msg) Write-Host ""; Write-Host "=== $msg ===" -ForegroundColor Cyan }
function Write-OK     { param($msg) Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Warn   { param($msg) Write-Host "  [!]  $msg" -ForegroundColor Yellow }
function Write-Err    { param($msg) Write-Host "  [X]  $msg" -ForegroundColor Red }
function Write-Info   { param($msg) Write-Host "  -->  $msg" -ForegroundColor White }
function Pause-Exit   { param($code) Write-Host ""; Read-Host $L.PauseExit; exit $code }

# Pfade ermitteln
$ScriptDir = $PSScriptRoot
if (-not $ScriptDir) {
    $ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
}
if (-not $ScriptDir) {
    Write-Host "  [X]  Script path could not be determined." -ForegroundColor Red
    Write-Host "       Run with: powershell -ExecutionPolicy Bypass -File `"<path>\installer\install.ps1`"" -ForegroundColor Yellow
    Read-Host "  Press Enter to exit"
    exit 1
}

$PluginSrc  = Split-Path -Parent $ScriptDir
$PluginDest = Join-Path $env:APPDATA "Ulanzi\UlanziDeck\Plugins\$PluginName"
$BridgePath = Join-Path $PluginDest "native\bridge.js"

# ---- Sprachauswahl / Language selection -------------------------------------
if ($Language -eq '') {
    Write-Host ""
    Write-Host "============================================" -ForegroundColor Cyan
    Write-Host "  Device Pilot by Walfrosch92 - Installer  " -ForegroundColor Cyan
    Write-Host "============================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  1  Deutsch" -ForegroundColor White
    Write-Host "  2  English" -ForegroundColor White
    Write-Host ""
    $langChoice = Read-Host "  Sprache / Language (1/2)"
    $Language = if ($langChoice -eq '2') { 'en' } else { 'de' }
}

# ---- String-Tabelle ---------------------------------------------------------
$L = @{}
if ($Language -eq 'en') {
    # General
    $L.PauseExit              = "  Press Enter to exit"
    $L.NeedAdmin              = "  This installer requires administrator rights."
    $L.RestartAdmin           = "  Restarting as administrator..."
    $L.PathError              = "  [X]  Script path could not be determined."
    $L.PathErrorHint          = "       Run with: powershell -ExecutionPolicy Bypass -File `"<path>\installer\install.ps1`""

    # Uninstall
    $L.UninstallHeader        = "Uninstallation"
    $L.UninstallTasksOK       = "Tasks removed (if present)."
    $L.UninstallVcamOK        = "Python Virtual-Cam service stopped (PID {0})."
    $L.UninstallVcamIdle      = "Python Virtual-Cam service was not running."
    $L.UninstallBridgeOK      = "Bridge process stopped."
    $L.UninstallRegOK         = "Unity Capture DirectShow filter unregistered."
    $L.UninstallRegWarn       = "regsvr32 /u ExitCode {0} - filter may still be active."
    $L.UninstallRegRemoved    = "Unity Capture registry entries removed."
    $L.UninstallFolderOK      = "Plugin folder deleted: {0}"
    $L.UninstallFolderWarn    = "Folder could not be fully deleted (files still in use)."
    $L.UninstallFolderManual  = "Please delete manually: {0}"
    $L.UninstallFolderGone    = "Plugin folder already absent."
    $L.UninstallDone          = "Device Pilot Plugin has been completely uninstalled."

    # Step 1 Node
    $L.Step1Header            = "Step 1: Check Node.js"
    $L.Step1Skip              = "Node.js check skipped (-SkipNodeCheck)."
    $L.Step1Found             = "Node.js {0} already installed."
    $L.Step1Old               = "Node.js v{0} found - v{1} or newer required. Updating."
    $L.Step1Missing           = "Node.js not found. Installing automatically."
    $L.Step1Winget            = "Installing Node.js LTS via winget..."
    $L.Step1Download          = "winget not available - downloading Node.js LTS installer..."
    $L.Step1DownloadFail      = "Download failed: {0}"
    $L.Step1Fail              = "Node.js installation failed."
    $L.Step1FailHint          = "Please install manually: https://nodejs.org/"
    $L.Step1OK                = "Node.js successfully installed."
    $L.Step1NotFound          = "Node.js not found after installation. Please close and reopen this window."

    # Step 2 Python
    $L.Step2Header            = "Step 2: Check Python"
    $L.Step2Found             = "Python {0} already installed."
    $L.Step2Missing           = "Python not found. Installing automatically..."
    $L.Step2Winget            = "Installing Python 3.11 via winget..."
    $L.Step2Download          = "winget not available - downloading Python installer..."
    $L.Step2DownloadFail      = "Python download failed: {0}"
    $L.Step2InstallerWarn     = "Python installer ExitCode: {0}"
    $L.Step2OK                = "Python successfully installed."
    $L.Step2NotFound          = "Python not found after installation."
    $L.Step2NotFoundHint      = "Please install manually: https://python.org"

    # Step 3 Ulanzi check
    $L.Step3Header            = "Step 3: Check Ulanzi Software"
    $L.Step3Running           = "Ulanzi Software is running. Please close it before installing."
    $L.Step3Confirm           = "  Continue anyway? (y/N)"
    $L.Step3ConfirmYes        = 'y'
    $L.Step3OK                = "Ulanzi Software is not running."

    # Step 4 Files
    $L.Step4Header            = "Step 4: Install plugin files"
    $L.Step4Source            = "Source: {0}"
    $L.Step4Dest              = "Dest:   {0}"
    $L.Step4CopyOK            = "Plugin files copied."
    $L.Step4NpmInfo           = "Installing plugin dependencies (ws)..."
    $L.Step4NpmOK             = "Plugin dependencies installed."
    $L.Step4NpmWarn           = "npm install failed: {0}"
    $L.Step4UnblockOK         = "Files unblocked (Windows security zone removed)."
    $L.Step4PipInfo           = "Installing Python dependencies..."
    $L.Step4PipEnsure         = "pip not found - bootstrapping via ensurepip..."
    $L.Step4PipEnsureWarn     = "ensurepip failed: {0}"
    $L.Step4PipOK             = "Python dependencies installed."
    $L.Step4PipWarn           = "pip install failed: {0}"
    $L.Step4PipManual         = "Manual: python -m pip install -r `"{0}`""
    $L.Step4ReqMissing        = "requirements.txt not found: {0}"
    $L.Step4NoPython          = "Python not found - pip install skipped."
    $L.Step4NoPythonHint      = "After installing Python, run: python -m pip install -r `"{0}`""

    # Step 5 Unity Capture
    $L.Step5Header            = "Step 5: Install Unity Capture Virtual Camera"
    $L.Step5Download          = "Downloading Unity Capture DLL (MIT license, ~500 KB)..."
    $L.Step5DownloadOK        = "Unity Capture DLL downloaded."
    $L.Step5DownloadWarn      = "Download failed: {0}"
    $L.Step5DownloadManual    = "Download manually: https://github.com/schellingb/UnityCapture"
    $L.Step5DownloadPlace     = "Place 'UnityCaptureFilter64.dll' from the Install folder into: {0}"
    $L.Step5RegOK             = "Unity Capture registered as DirectShow filter."
    $L.Step5TeamsHint         = "In Microsoft Teams: Settings > Camera > select 'Unity Video Capture'."
    $L.Step5RegWarn           = "regsvr32 ExitCode {0} - will be active after next reboot."
    $L.Step5DllMissing        = "Unity Capture DLL not found."
    $L.Step5DllManual1        = "Please get 'UnityCaptureFilter64.dll' from https://github.com/schellingb/UnityCapture"
    $L.Step5DllManual2        = "and place it in: {0}, then run regsvr32."

    # Step 6 Bridge task
    $L.Step6Header            = "Step 6: Register native bridge as autostart"
    $L.Step6TaskOK            = "Task '{0}' registered (starts automatically at logon)."
    $L.Step6BridgeOK          = "Bridge started."
    $L.Step6TaskWarn          = "Task registration failed: {0}"
    $L.Step6BridgeManual      = "Start bridge manually: node `"{0}`""

    # Step 7 VCam task
    $L.Step7Header            = "Step 7: Register virtual-cam service as autostart"
    $L.Step7NoPython          = "Python not found - Virtual-Cam task will not be registered."
    $L.Step7NoPythonHint      = "Please install Python and run the installer again."
    $L.Step7PythonFound       = "Python found: {0}"
    $L.Step7TaskOK            = "Task '{0}' registered."
    $L.Step7VcamOK            = "Virtual-Cam service responding (muted: {0})."
    $L.Step7VcamNotReady      = "Virtual-Cam service not yet responding - will start automatically at next logon."
    $L.Step7TaskWarn          = "Task registration failed: {0}"

    # Step 8 Bridge test
    $L.Step8Header            = "Step 8: Test bridge"
    $L.Step8OK                = "Bridge responding: Version {0}"
    $L.Step8Warn              = "Bridge not yet responding. Will be active after next Windows start."

    # Done
    $L.DoneHeader             = "  Installation complete!               "
    $L.DoneNext               = "Next steps:"
    $L.DoneStep1              = "  1. In Microsoft Teams: Settings > Camera > select 'Unity Video Capture'"
    $L.DoneStep2              = "  2. Start Ulanzi Stream Controller Software"
    $L.DoneStep3              = "  3. Plugin 'Device Pilot' appears in the software"
    $L.DoneStep4              = "  4. Drag the camera button onto the deck and assign a name"
    $L.DoneFolder             = "Plugin folder: {0}"
    $L.DonePause              = "  Press Enter to exit & restart your system"

    # Installer header
    $L.InstallerTitle         = "  Device Pilot Plugin by Walfrosch92 - Installer "

    # Uninstall done banner
    $L.UninstallDoneBanner    = "Device Pilot Plugin has been completely uninstalled."

} else {
    # General
    $L.PauseExit              = "  Druecke Enter zum Beenden"
    $L.NeedAdmin              = "  Dieser Installer benoetigt Administrator-Rechte."
    $L.RestartAdmin           = "  Starte neu als Administrator..."
    $L.PathError              = "  [X]  Skriptpfad konnte nicht ermittelt werden."
    $L.PathErrorHint          = "       Starte mit: powershell -ExecutionPolicy Bypass -File `"<Pfad>\installer\install.ps1`""

    # Uninstall
    $L.UninstallHeader        = "Deinstallation"
    $L.UninstallTasksOK       = "Tasks entfernt (falls vorhanden)."
    $L.UninstallVcamOK        = "Python Virtual-Cam-Dienst beendet (PID {0})."
    $L.UninstallVcamIdle      = "Python Virtual-Cam-Dienst war nicht aktiv."
    $L.UninstallBridgeOK      = "Bridge-Prozess beendet."
    $L.UninstallRegOK         = "Unity Capture DirectShow-Filter deregistriert."
    $L.UninstallRegWarn       = "regsvr32 /u ExitCode {0} - Filter moeglicherweise noch aktiv."
    $L.UninstallRegRemoved    = "Unity Capture Registry-Eintraege entfernt."
    $L.UninstallFolderOK      = "Plugin-Ordner geloescht: {0}"
    $L.UninstallFolderWarn    = "Ordner konnte nicht vollstaendig geloescht werden (Dateien noch in Verwendung)."
    $L.UninstallFolderManual  = "Bitte manuell loeschen: {0}"
    $L.UninstallFolderGone    = "Plugin-Ordner bereits nicht vorhanden."
    $L.UninstallDone          = "Device Pilot Plugin wurde vollstaendig deinstalliert."

    # Step 1 Node
    $L.Step1Header            = "Schritt 1: Node.js pruefen"
    $L.Step1Skip              = "Node.js-Pruefung uebersprungen (-SkipNodeCheck)."
    $L.Step1Found             = "Node.js {0} bereits installiert."
    $L.Step1Old               = "Node.js v{0} gefunden - mindestens v{1} erforderlich. Wird aktualisiert."
    $L.Step1Missing           = "Node.js nicht gefunden. Wird automatisch installiert."
    $L.Step1Winget            = "Installiere Node.js LTS via winget..."
    $L.Step1Download          = "winget nicht verfuegbar - lade Node.js LTS Installer herunter..."
    $L.Step1DownloadFail      = "Download fehlgeschlagen: {0}"
    $L.Step1Fail              = "Node.js-Installation fehlgeschlagen."
    $L.Step1FailHint          = "Bitte manuell installieren: https://nodejs.org/"
    $L.Step1OK                = "Node.js erfolgreich installiert."
    $L.Step1NotFound          = "Node.js nach Installation nicht gefunden. Bitte Fenster schliessen und neu oeffnen."

    # Step 2 Python
    $L.Step2Header            = "Schritt 2: Python pruefen"
    $L.Step2Found             = "Python {0} bereits installiert."
    $L.Step2Missing           = "Python nicht gefunden. Wird automatisch installiert..."
    $L.Step2Winget            = "Installiere Python 3.11 via winget..."
    $L.Step2Download          = "winget nicht verfuegbar - lade Python Installer herunter..."
    $L.Step2DownloadFail      = "Python-Download fehlgeschlagen: {0}"
    $L.Step2InstallerWarn     = "Python Installer ExitCode: {0}"
    $L.Step2OK                = "Python erfolgreich installiert."
    $L.Step2NotFound          = "Python nach Installation nicht gefunden."
    $L.Step2NotFoundHint      = "Bitte manuell installieren: https://python.org"

    # Step 3 Ulanzi check
    $L.Step3Header            = "Schritt 3: Ulanzi Software pruefen"
    $L.Step3Running           = "Ulanzi Software laeuft gerade. Bitte vor der Installation schliessen."
    $L.Step3Confirm           = "  Trotzdem fortfahren? (j/N)"
    $L.Step3ConfirmYes        = 'j'
    $L.Step3OK                = "Ulanzi Software ist nicht aktiv."

    # Step 4 Files
    $L.Step4Header            = "Schritt 4: Plugin-Dateien installieren"
    $L.Step4Source            = "Quelle: {0}"
    $L.Step4Dest              = "Ziel:   {0}"
    $L.Step4CopyOK            = "Plugin-Dateien kopiert."
    $L.Step4NpmInfo           = "Installiere Plugin-Abhaengigkeiten (ws)..."
    $L.Step4NpmOK             = "Plugin-Abhaengigkeiten installiert."
    $L.Step4NpmWarn           = "npm install fehlgeschlagen: {0}"
    $L.Step4UnblockOK         = "Dateien entsperrt (Windows-Sicherheitssperre entfernt)."
    $L.Step4PipInfo           = "Installiere Python-Abhaengigkeiten..."
    $L.Step4PipEnsure         = "pip nicht gefunden - wird ueber ensurepip installiert..."
    $L.Step4PipEnsureWarn     = "ensurepip fehlgeschlagen: {0}"
    $L.Step4PipOK             = "Python-Abhaengigkeiten installiert."
    $L.Step4PipWarn           = "pip install fehlgeschlagen: {0}"
    $L.Step4PipManual         = "Manuell: python -m pip install -r `"{0}`""
    $L.Step4ReqMissing        = "requirements.txt nicht gefunden: {0}"
    $L.Step4NoPython          = "Python nicht gefunden - pip install uebersprungen."
    $L.Step4NoPythonHint      = "Manuell nach Python-Installation: python -m pip install -r `"{0}`""

    # Step 5 Unity Capture
    $L.Step5Header            = "Schritt 5: Unity Capture Virtual Camera installieren"
    $L.Step5Download          = "Lade Unity Capture DLL herunter (MIT-Lizenz, ~500 KB)..."
    $L.Step5DownloadOK        = "Unity Capture DLL heruntergeladen."
    $L.Step5DownloadWarn      = "Download fehlgeschlagen: {0}"
    $L.Step5DownloadManual    = "Manuell herunterladen: https://github.com/schellingb/UnityCapture"
    $L.Step5DownloadPlace     = "Datei 'UnityCaptureFilter64.dll' aus dem Install-Ordner ablegen in: {0}"
    $L.Step5RegOK             = "Unity Capture als DirectShow-Filter registriert."
    $L.Step5TeamsHint         = "In Microsoft Teams: Einstellungen > Kamera > 'Unity Video Capture' auswaehlen."
    $L.Step5RegWarn           = "regsvr32 ExitCode {0} - wird beim naechsten Neustart aktiv."
    $L.Step5DllMissing        = "Unity Capture DLL nicht gefunden."
    $L.Step5DllManual1        = "Bitte 'UnityCaptureFilter64.dll' aus https://github.com/schellingb/UnityCapture"
    $L.Step5DllManual2        = "in diesen Ordner kopieren und regsvr32 ausfuehren: {0}"

    # Step 6 Bridge task
    $L.Step6Header            = "Schritt 6: Native Bridge als Autostart registrieren"
    $L.Step6TaskOK            = "Task '{0}' registriert (startet automatisch beim Anmelden)."
    $L.Step6BridgeOK          = "Bridge gestartet."
    $L.Step6TaskWarn          = "Task-Registrierung fehlgeschlagen: {0}"
    $L.Step6BridgeManual      = "Bridge manuell starten: node `"{0}`""

    # Step 7 VCam task
    $L.Step7Header            = "Schritt 7: Virtual-Cam-Dienst als Autostart registrieren"
    $L.Step7NoPython          = "Python nicht gefunden - Virtual-Cam-Task wird nicht registriert."
    $L.Step7NoPythonHint      = "Bitte Python installieren und Installer erneut ausfuehren."
    $L.Step7PythonFound       = "Python gefunden: {0}"
    $L.Step7TaskOK            = "Task '{0}' registriert."
    $L.Step7VcamOK            = "Virtual-Cam-Dienst antwortet (muted: {0})."
    $L.Step7VcamNotReady      = "Virtual-Cam-Dienst antwortet noch nicht - wird beim naechsten Anmelden automatisch gestartet."
    $L.Step7TaskWarn          = "Task-Registrierung fehlgeschlagen: {0}"

    # Step 8 Bridge test
    $L.Step8Header            = "Schritt 8: Bridge testen"
    $L.Step8OK                = "Bridge antwortet: Version {0}"
    $L.Step8Warn              = "Bridge antwortet noch nicht. Beim naechsten Windows-Start automatisch aktiv."

    # Done
    $L.DoneHeader             = "  Installation abgeschlossen!          "
    $L.DoneNext               = "Naechste Schritte:"
    $L.DoneStep1              = "  1. In Microsoft Teams: Einstellungen > Kamera > 'Unity Video Capture' auswaehlen"
    $L.DoneStep2              = "  2. Ulanzi Stream Controller Software starten"
    $L.DoneStep3              = "  3. Plugin 'Device Pilot' erscheint in der Software"
    $L.DoneStep4              = "  4. Kamera-Button auf das Deck ziehen und Name vergeben"
    $L.DoneFolder             = "Plugin-Ordner: {0}"
    $L.DonePause              = "  Druecke Enter zum Beenden & starte dein System neu"

    # Installer header
    $L.InstallerTitle         = " Device Pilot Plugin by Walfrosch92 - Installer "

    # Uninstall done banner
    $L.UninstallDoneBanner    = "Device Pilot Plugin wurde vollstaendig deinstalliert."
}

# ---- Administrator-Check ----------------------------------------------------
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host ""
    Write-Host $L.NeedAdmin    -ForegroundColor Yellow
    Write-Host $L.RestartAdmin -ForegroundColor Yellow
    $selfPath = Join-Path $ScriptDir 'install.ps1'
    $argList  = "-NoProfile -ExecutionPolicy Bypass -File `"$selfPath`" -Language $Language"
    if ($Uninstall)     { $argList += " -Uninstall" }
    if ($SkipNodeCheck) { $argList += " -SkipNodeCheck" }
    Start-Process powershell.exe -Verb RunAs -ArgumentList $argList
    exit 0
}

# ---- Deinstallation ---------------------------------------------------------
if ($Uninstall) {
    Write-Header $L.UninstallHeader

    # 1. Task Scheduler Tasks entfernen
    Unregister-ScheduledTask -TaskName $TaskName     -Confirm:$false -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $VcamTaskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-OK $L.UninstallTasksOK

    # 2. Python Virtual-Cam-Dienst beenden (nur Prozess auf Port 5000)
    $vcamPid = $null
    try {
        $conn = Get-NetTCPConnection -LocalPort $VcamPort -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($conn) { $vcamPid = $conn.OwningProcess }
    } catch { }
    if ($vcamPid) {
        Stop-Process -Id $vcamPid -Force -ErrorAction SilentlyContinue
        Write-OK ($L.UninstallVcamOK -f $vcamPid)
    } else {
        Write-OK $L.UninstallVcamIdle
    }

    # 3. Bridge-Prozess (node.exe) beenden
    Get-Process -Name "node" -ErrorAction SilentlyContinue |
        Where-Object {
            try { $_.MainModule.FileName -notlike "*Ulanzi Studio*" } catch { $false }
        } | Stop-Process -Force -ErrorAction SilentlyContinue
    Write-OK $L.UninstallBridgeOK

    # 4. Unity Capture DirectShow-Filter deregistrieren
    $ucDll = Join-Path $PluginDest "native\webcam-mute\UnityCaptureFilter64.dll"
    if (Test-Path $ucDll) {
        $reg = Start-Process regsvr32 -ArgumentList "/s /u `"$ucDll`"" -Wait -PassThru
        if ($reg.ExitCode -eq 0) {
            Write-OK $L.UninstallRegOK
        } else {
            Write-Warn ($L.UninstallRegWarn -f $reg.ExitCode)
        }
    } else {
        Remove-Item 'HKLM:\SOFTWARE\Classes\CLSID\{5C2CD55C-92AD-4999-8666-912BD3E70010}' -Recurse -Force -ErrorAction SilentlyContinue
        Remove-Item 'HKLM:\SOFTWARE\Classes\CLSID\{5C2CD55C-92AD-4999-8666-912BD3E70011}' -Recurse -Force -ErrorAction SilentlyContinue
        Write-OK $L.UninstallRegRemoved
    }

    # 5. Plugin-Ordner loeschen
    if (Test-Path $PluginDest) {
        Remove-Item $PluginDest -Recurse -Force -ErrorAction SilentlyContinue
        if (Test-Path $PluginDest) {
            Write-Warn $L.UninstallFolderWarn
            Write-Info ($L.UninstallFolderManual -f $PluginDest)
        } else {
            Write-OK ($L.UninstallFolderOK -f $PluginDest)
        }
    } else {
        Write-OK $L.UninstallFolderGone
    }

    Write-Host ""
    Write-Host $L.UninstallDoneBanner -ForegroundColor Green
    Pause-Exit 0
}

# ---- Start ------------------------------------------------------------------
Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host $L.InstallerTitle                             -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan

# ---- Hilfsfunktionen fuer Versionsabfragen ----------------------------------
function Get-NodeMajorVersion {
    try {
        $v = (& node --version 2>&1).ToString().Trim()
        if ($v -match '^v(\d+)\.') { return [int]$Matches[1] }
    } catch { }
    return 0
}

function Get-PythonMajorVersion {
    try {
        $v = (& python --version 2>&1).ToString().Trim()
        if ($v -match '(\d+)\.') { return [int]$Matches[1] }
    } catch { }
    return 0
}

# ---- Schritt 1: Node.js -----------------------------------------------------
Write-Header $L.Step1Header

if ($SkipNodeCheck) {
    Write-Warn $L.Step1Skip
} else {
    $nodeMajor = Get-NodeMajorVersion
    if ($nodeMajor -ge $NodeMinMajor) {
        $nodeVersion = (& node --version 2>&1).ToString().Trim()
        Write-OK ($L.Step1Found -f $nodeVersion)
    } else {
        if ($nodeMajor -gt 0) {
            Write-Warn ($L.Step1Old -f $nodeMajor, $NodeMinMajor)
        } else {
            Write-Warn $L.Step1Missing
        }

        $installed = $false

        # Versuch 1: winget
        $wingetCmd = Get-Command winget -ErrorAction SilentlyContinue
        if ($wingetCmd) {
            Write-Info $L.Step1Winget
            & winget install --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements --silent
            if ($LASTEXITCODE -eq 0) { $installed = $true }
        }

        # Versuch 2: MSI-Download
        if (-not $installed) {
            Write-Info $L.Step1Download
            $tmpMsi = Join-Path $env:TEMP "node_lts_installer.msi"
            $url    = "https://nodejs.org/dist/v20.19.0/node-v20.19.0-x64.msi"
            try {
                $meta = Invoke-RestMethod -Uri "https://nodejs.org/dist/index.json" -TimeoutSec 15 |
                            Where-Object { $_.lts -ne $false } |
                            Select-Object -First 1
                if ($meta) { $url = "https://nodejs.org/dist/$($meta.version)/node-$($meta.version)-x64.msi" }
            } catch { }
            Write-Info "URL: $url"
            try {
                Invoke-WebRequest -Uri $url -OutFile $tmpMsi -UseBasicParsing -TimeoutSec 120
                $proc = Start-Process msiexec.exe -ArgumentList "/i `"$tmpMsi`" /qn /norestart ADDLOCAL=ALL" -Wait -PassThru
                Remove-Item $tmpMsi -Force -ErrorAction SilentlyContinue
                if ($proc.ExitCode -eq 0 -or $proc.ExitCode -eq 3010) { $installed = $true }
            } catch {
                Write-Err ($L.Step1DownloadFail -f $_)
            }
        }

        if (-not $installed) {
            Write-Err $L.Step1Fail
            Write-Info $L.Step1FailHint
            Pause-Exit 1
        }

        $env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
                    [System.Environment]::GetEnvironmentVariable('Path', 'User')

        $nodeMajor = Get-NodeMajorVersion
        if ($nodeMajor -ge $NodeMinMajor) {
            Write-OK $L.Step1OK
        } else {
            Write-Err $L.Step1NotFound
            Pause-Exit 1
        }
    }
}

# Vollpfad zu node.exe jetzt ermitteln (wird fuer npm und Task Scheduler benoetigt)
$NodeExeFull = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $NodeExeFull) { $NodeExeFull = 'node' }

# ---- Schritt 2: Python ------------------------------------------------------
Write-Header $L.Step2Header

$pyMajor = Get-PythonMajorVersion
if ($pyMajor -ge 3) {
    $pyVersion = (& python --version 2>&1).ToString().Trim()
    Write-OK ($L.Step2Found -f $pyVersion)
} else {
    Write-Warn $L.Step2Missing
    $pyInstalled = $false

    # Versuch 1: winget
    $wingetCmd = Get-Command winget -ErrorAction SilentlyContinue
    if ($wingetCmd) {
        Write-Info $L.Step2Winget
        & winget install --id Python.Python.3.11 --accept-package-agreements --accept-source-agreements --silent
        if ($LASTEXITCODE -eq 0) { $pyInstalled = $true }
    }

    # Versuch 2: Installer von python.org herunterladen
    if (-not $pyInstalled) {
        Write-Info $L.Step2Download
        $tmpExe = Join-Path $env:TEMP "python_installer.exe"
        $pyUrl  = "https://www.python.org/ftp/python/3.11.9/python-3.11.9-amd64.exe"
        try {
            Write-Info "URL: $pyUrl"
            Invoke-WebRequest -Uri $pyUrl -OutFile $tmpExe -UseBasicParsing -TimeoutSec 180
            $proc = Start-Process $tmpExe -ArgumentList "/quiet InstallAllUsers=1 PrependPath=1 Include_test=0" -Wait -PassThru
            Remove-Item $tmpExe -Force -ErrorAction SilentlyContinue
            if ($proc.ExitCode -eq 0) { $pyInstalled = $true }
            else { Write-Warn ($L.Step2InstallerWarn -f $proc.ExitCode) }
        } catch {
            Write-Err ($L.Step2DownloadFail -f $_)
        }
    }

    $env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
                [System.Environment]::GetEnvironmentVariable('Path', 'User')
    $pyMajor = Get-PythonMajorVersion
    if ($pyMajor -ge 3) {
        Write-OK $L.Step2OK
    } else {
        Write-Warn $L.Step2NotFound
        Write-Info $L.Step2NotFoundHint
    }
}

# ---- Schritt 3: Ulanzi-Software pruefen -------------------------------------
Write-Header $L.Step3Header
$ulanziProcess = Get-Process -Name "*ulanzi*","*ustudio*","*UlanziDeck*" -ErrorAction SilentlyContinue
if ($ulanziProcess) {
    Write-Warn $L.Step3Running
    $confirm = Read-Host $L.Step3Confirm
    if ($confirm -ne $L.Step3ConfirmYes -and $confirm -ne $L.Step3ConfirmYes.ToUpper()) { Pause-Exit 0 }
} else {
    Write-OK $L.Step3OK
}

# ---- Schritt 4: Plugin-Dateien kopieren -------------------------------------
Write-Header $L.Step4Header
Write-Info ($L.Step4Source -f $PluginSrc)
Write-Info ($L.Step4Dest   -f $PluginDest)

New-Item -ItemType Directory -Force -Path $PluginDest | Out-Null

$excludeDirs = @('.git', 'node_modules')

Get-ChildItem -Path $PluginSrc -Recurse | ForEach-Object {
    $item         = $_
    $relativePath = $item.FullName.Substring($PluginSrc.Length).TrimStart('\','/')
    $topLevel     = ($relativePath -split '[/\\]')[0]
    if ($excludeDirs -contains $topLevel) { return }
    $destPath = Join-Path $PluginDest $relativePath
    if ($item.PSIsContainer) {
        New-Item -ItemType Directory -Force -Path $destPath | Out-Null
    } else {
        Copy-Item -Path $item.FullName -Destination $destPath -Force -ErrorAction SilentlyContinue
    }
}

Write-OK $L.Step4CopyOK

# Node.js-Abhaengigkeiten installieren
Write-Info $L.Step4NpmInfo
try {
    $nodeDir  = if ($NodeExeFull -ne 'node') { Split-Path $NodeExeFull } else { $null }
    $npmCmd   = if ($nodeDir -and (Test-Path (Join-Path $nodeDir 'npm.cmd'))) { Join-Path $nodeDir 'npm.cmd' } else { 'npm' }
    & $npmCmd install --prefix $PluginDest --omit=dev --silent 2>&1 | Out-Null
    Write-OK $L.Step4NpmOK
} catch {
    Write-Warn ($L.Step4NpmWarn -f $_)
}

# Sicherheitssperre entfernen
Get-ChildItem -Path $PluginDest -Recurse -File |
    ForEach-Object { Unblock-File -Path $_.FullName -ErrorAction SilentlyContinue }
Write-OK $L.Step4UnblockOK

# Python-Abhaengigkeiten installieren
$reqFile = Join-Path $PluginDest "native\webcam-mute\requirements.txt"
$pyNow   = Get-PythonMajorVersion
if ($pyNow -ge 3) {
    if (Test-Path $reqFile) {
        Write-Info $L.Step4PipInfo

        # pip sicherstellen
        $pipCheck = & python -m pip --version 2>&1
        if ($LASTEXITCODE -ne 0 -or $pipCheck -notmatch 'pip') {
            Write-Info $L.Step4PipEnsure
            try {
                & python -m ensurepip --upgrade 2>&1 | Out-Null
                & python -m pip install --upgrade pip --quiet 2>&1 | Out-Null
            } catch {
                Write-Warn ($L.Step4PipEnsureWarn -f $_)
            }
        }

        try {
            & python -m pip install -r $reqFile --quiet
            Write-OK $L.Step4PipOK
        } catch {
            Write-Warn ($L.Step4PipWarn -f $_)
            Write-Info ($L.Step4PipManual -f $reqFile)
        }
    } else {
        Write-Warn ($L.Step4ReqMissing -f $reqFile)
    }
} else {
    Write-Warn $L.Step4NoPython
    Write-Info ($L.Step4NoPythonHint -f $reqFile)
}

# ---- Schritt 5: Unity Capture Virtual Camera --------------------------------
Write-Header $L.Step5Header

$ucDir = Join-Path $PluginDest "native\webcam-mute"
$ucDll = Join-Path $ucDir "UnityCaptureFilter64.dll"

if (-not (Test-Path $ucDll)) {
    Write-Info $L.Step5Download
    $ucUrl = "https://raw.githubusercontent.com/schellingb/UnityCapture/master/Install/UnityCaptureFilter64.dll"
    try {
        Invoke-WebRequest -Uri $ucUrl -OutFile $ucDll -UseBasicParsing -TimeoutSec 60
        Write-OK $L.Step5DownloadOK
    } catch {
        Write-Warn ($L.Step5DownloadWarn -f $_)
        Write-Info $L.Step5DownloadManual
        Write-Info ($L.Step5DownloadPlace -f $ucDir)
    }
}

if (Test-Path $ucDll) {
    $reg = Start-Process regsvr32 -ArgumentList "/s `"$ucDll`"" -Wait -PassThru
    if ($reg.ExitCode -eq 0) {
        Write-OK $L.Step5RegOK
        Write-Info $L.Step5TeamsHint
    } else {
        Write-Warn ($L.Step5RegWarn -f $reg.ExitCode)
    }
} else {
    Write-Warn $L.Step5DllMissing
    Write-Info $L.Step5DllManual1
    Write-Info ($L.Step5DllManual2 -f $ucDir)
}

# ---- Schritt 6: Task Scheduler ----------------------------------------------
Write-Header $L.Step6Header

$LauncherPath = Join-Path $PluginDest "native\start-hidden.vbs"
$vbsContent = @"
Dim oShell, q
Set oShell = CreateObject("WScript.Shell")
q = Chr(34)
oShell.Run q & "$NodeExeFull" & q & " " & q & "$BridgePath" & q, 0, False
"@
Set-Content -Path $LauncherPath -Value $vbsContent -Encoding ASCII

$action = New-ScheduledTaskAction `
    -Execute 'wscript.exe' `
    -Argument "`"$LauncherPath`"" `
    -WorkingDirectory (Join-Path $PluginDest "native")

$trigger = New-ScheduledTaskTrigger -AtLogOn

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Days 365) `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -MultipleInstances IgnoreNew

$principal = New-ScheduledTaskPrincipal `
    -UserId $env:USERNAME `
    -LogonType Interactive `
    -RunLevel Limited

try {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

    Get-Process -Name "node" -ErrorAction SilentlyContinue |
        Where-Object {
            try { $_.MainModule.FileName -notlike "*Ulanzi Studio*" } catch { $false }
        } | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 500

    Register-ScheduledTask `
        -TaskName $TaskName `
        -Action $action `
        -Trigger $trigger `
        -Settings $settings `
        -Principal $principal `
        -Description "Native Bridge fuer Ulanzi Device Pilot Plugin (Port $BridgePort)" `
        -Force | Out-Null
    Write-OK ($L.Step6TaskOK -f $TaskName)
    Start-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    Write-OK $L.Step6BridgeOK
} catch {
    Write-Warn ($L.Step6TaskWarn -f $_)
    Write-Info ($L.Step6BridgeManual -f $BridgePath)
}

# ---- Schritt 7: Virtual-Cam-Dienst als Autostart registrieren ---------------
Write-Header $L.Step7Header

$PythonExe = $null
$PythonCandidates = @('python', 'python3', 'py')
$LocalPyBase = Join-Path $env:LOCALAPPDATA 'Programs\Python'
if (Test-Path $LocalPyBase) {
    Get-ChildItem $LocalPyBase -Filter 'Python*' -Directory | Sort-Object Name -Descending | ForEach-Object {
        $PythonCandidates += Join-Path $_.FullName 'python.exe'
    }
}
foreach ($candidate in $PythonCandidates) {
    try {
        $v = & $candidate --version 2>&1
        if ($v -match 'Python \d') { $PythonExe = $candidate; break }
    } catch { }
}

if (-not $PythonExe) {
    Write-Warn $L.Step7NoPython
    Write-Info $L.Step7NoPythonHint
} else {
    Write-OK ($L.Step7PythonFound -f $PythonExe)
    $VcamScript = Join-Path $PluginDest "native\webcam-mute\main.py"
    $VcamDir    = Join-Path $PluginDest "native\webcam-mute"

    $vcamAction = New-ScheduledTaskAction `
        -Execute $PythonExe `
        -Argument "`"$VcamScript`"" `
        -WorkingDirectory $VcamDir

    $vcamTrigger = New-ScheduledTaskTrigger -AtLogOn

    $vcamSettings = New-ScheduledTaskSettingsSet `
        -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries `
        -ExecutionTimeLimit (New-TimeSpan -Days 365) `
        -RestartCount 5 `
        -RestartInterval (New-TimeSpan -Minutes 1) `
        -MultipleInstances IgnoreNew

    $vcamPrincipal = New-ScheduledTaskPrincipal `
        -UserId $env:USERNAME `
        -LogonType Interactive `
        -RunLevel Limited

    try {
        Unregister-ScheduledTask -TaskName $VcamTaskName -Confirm:$false -ErrorAction SilentlyContinue

        try {
            $oldPid = (Get-NetTCPConnection -LocalPort $VcamPort -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess
            if ($oldPid) { Stop-Process -Id $oldPid -Force -ErrorAction SilentlyContinue }
        } catch { }
        Start-Sleep -Milliseconds 500

        Register-ScheduledTask `
            -TaskName $VcamTaskName `
            -Action $vcamAction `
            -Trigger $vcamTrigger `
            -Settings $vcamSettings `
            -Principal $vcamPrincipal `
            -Description "Virtual-Cam-Dienst fuer Ulanzi Device Pilot Plugin (Port $VcamPort)" `
            -Force | Out-Null

        Write-OK ($L.Step7TaskOK -f $VcamTaskName)
        Start-ScheduledTask -TaskName $VcamTaskName -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 4

        try {
            $r = Invoke-WebRequest -Uri "http://127.0.0.1:$VcamPort/status" -TimeoutSec 5 -UseBasicParsing -ErrorAction Stop
            $j = $r.Content | ConvertFrom-Json
            Write-OK ($L.Step7VcamOK -f $j.muted)
        } catch {
            Write-Warn $L.Step7VcamNotReady
        }
    } catch {
        Write-Warn ($L.Step7TaskWarn -f $_)
    }
}

# ---- Schritt 8: Bridge testen -----------------------------------------------
Write-Header $L.Step8Header
Start-Sleep -Seconds 1
try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:$BridgePort/ping" -TimeoutSec 5 -UseBasicParsing -ErrorAction Stop
    $json = $response.Content | ConvertFrom-Json
    Write-OK ($L.Step8OK -f $json.version)
} catch {
    Write-Warn $L.Step8Warn
}

# ---- Fertig -----------------------------------------------------------------
Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host $L.DoneHeader                                  -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host ""
Write-Host $L.DoneNext  -ForegroundColor White
Write-Host $L.DoneStep1 -ForegroundColor Gray
Write-Host $L.DoneStep2 -ForegroundColor Gray
Write-Host $L.DoneStep3 -ForegroundColor Gray
Write-Host $L.DoneStep4 -ForegroundColor Gray
Write-Host ""
Write-Host ($L.DoneFolder -f $PluginDest) -ForegroundColor DarkGray
Write-Host ""
Read-Host $L.DonePause
