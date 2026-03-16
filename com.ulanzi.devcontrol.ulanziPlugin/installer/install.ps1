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
    [switch]$SkipNodeCheck
)

$ErrorActionPreference = 'Continue'

$PluginName    = 'com.ulanzi.devcontrol.ulanziPlugin'
$TaskName      = 'UlanziDevControlBridge'
$VcamTaskName  = 'UlanziVirtualCamService'
$BridgePort    = 3907
$VcamPort      = 5000
$NodeMinMajor  = 18

function Write-Header { param($msg) Write-Host ""; Write-Host "=== $msg ===" -ForegroundColor Cyan }
function Write-OK     { param($msg) Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Warn   { param($msg) Write-Host "  [!]  $msg" -ForegroundColor Yellow }
function Write-Err    { param($msg) Write-Host "  [X]  $msg" -ForegroundColor Red }
function Write-Info   { param($msg) Write-Host "  -->  $msg" -ForegroundColor White }
function Pause-Exit   { param($code) Write-Host ""; Read-Host "  Druecke Enter zum Beenden"; exit $code }

# Pfade ermitteln
$ScriptDir = $PSScriptRoot
if (-not $ScriptDir) {
    $ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
}
if (-not $ScriptDir) {
    Write-Host "  [X]  Skriptpfad konnte nicht ermittelt werden." -ForegroundColor Red
    Write-Host "       Starte mit: powershell -ExecutionPolicy Bypass -File `"<Pfad>\installer\install.ps1`"" -ForegroundColor Yellow
    Read-Host "  Druecke Enter zum Beenden"
    exit 1
}

$PluginSrc  = Split-Path -Parent $ScriptDir
$PluginDest = Join-Path $env:APPDATA "Ulanzi\UlanziDeck\Plugins\$PluginName"
$BridgePath = Join-Path $PluginDest "native\bridge.js"

# ---- Deinstallation ---------------------------------------------------------
if ($Uninstall) {
    Write-Header "Deinstallation"

    # 1. Task Scheduler Tasks entfernen
    Unregister-ScheduledTask -TaskName $TaskName     -Confirm:$false -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $VcamTaskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-OK "Tasks entfernt (falls vorhanden)."

    # 2. Python Virtual-Cam-Dienst beenden (nur Prozess auf Port 5000)
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
        # DLL nicht mehr vorhanden - Registry-Eintraege direkt entfernen
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
    Pause-Exit 0
}

# ---- Administrator-Check ----------------------------------------------------
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host ""
    Write-Host "  Dieser Installer benoetigt Administrator-Rechte." -ForegroundColor Yellow
    Write-Host "  Starte neu als Administrator..." -ForegroundColor Yellow
    $selfPath = Join-Path $ScriptDir 'install.ps1'
    $argList  = "-NoProfile -ExecutionPolicy Bypass -File `"$selfPath`""
    if ($Uninstall)     { $argList += " -Uninstall" }
    if ($SkipNodeCheck) { $argList += " -SkipNodeCheck" }
    Start-Process powershell.exe -Verb RunAs -ArgumentList $argList
    exit 0
}

# ---- Start ------------------------------------------------------------------
Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Ulanzi Device Control Plugin by Walfrosch92 - Installer " -ForegroundColor Cyan
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
Write-Header "Schritt 1: Node.js pruefen"

if ($SkipNodeCheck) {
    Write-Warn "Node.js-Pruefung uebersprungen (-SkipNodeCheck)."
} else {
    $nodeMajor = Get-NodeMajorVersion
    if ($nodeMajor -ge $NodeMinMajor) {
        $nodeVersion = (& node --version 2>&1).ToString().Trim()
        Write-OK "Node.js $nodeVersion bereits installiert."
    } else {
        if ($nodeMajor -gt 0) {
            Write-Warn "Node.js v$nodeMajor gefunden - mindestens v$NodeMinMajor erforderlich. Wird aktualisiert."
        } else {
            Write-Warn "Node.js nicht gefunden. Wird automatisch installiert."
        }

        $installed = $false

        # Versuch 1: winget
        $wingetCmd = Get-Command winget -ErrorAction SilentlyContinue
        if ($wingetCmd) {
            Write-Info "Installiere Node.js LTS via winget..."
            & winget install --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements --silent
            if ($LASTEXITCODE -eq 0) { $installed = $true }
        }

        # Versuch 2: MSI-Download
        if (-not $installed) {
            Write-Info "winget nicht verfuegbar - lade Node.js LTS Installer herunter..."
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
                Write-Err "Download fehlgeschlagen: $_"
            }
        }

        if (-not $installed) {
            Write-Err "Node.js-Installation fehlgeschlagen."
            Write-Info "Bitte manuell installieren: https://nodejs.org/"
            Pause-Exit 1
        }

        # PATH fuer diese Session aktualisieren
        $env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
                    [System.Environment]::GetEnvironmentVariable('Path', 'User')

        $nodeMajor = Get-NodeMajorVersion
        if ($nodeMajor -ge $NodeMinMajor) {
            Write-OK "Node.js erfolgreich installiert."
        } else {
            Write-Err "Node.js nach Installation nicht gefunden. Bitte Fenster schliessen und neu oeffnen."
            Pause-Exit 1
        }
    }
}

# Vollpfad zu node.exe jetzt ermitteln (wird fuer npm und Task Scheduler benoetigt)
$NodeExeFull = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $NodeExeFull) { $NodeExeFull = 'node' }

# ---- Schritt 2: Python ------------------------------------------------------
Write-Header "Schritt 2: Python pruefen"

$pyMajor = Get-PythonMajorVersion
if ($pyMajor -ge 3) {
    $pyVersion = (& python --version 2>&1).ToString().Trim()
    Write-OK "Python $pyVersion bereits installiert."
} else {
    Write-Warn "Python nicht gefunden. Wird via winget installiert..."
    try {
        & winget install --id Python.Python.3.11 --accept-package-agreements --accept-source-agreements --silent
        $env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
                    [System.Environment]::GetEnvironmentVariable('Path', 'User')
        $pyMajor = Get-PythonMajorVersion
        if ($pyMajor -ge 3) {
            Write-OK "Python erfolgreich installiert."
        } else {
            Write-Warn "Python nach Installation nicht gefunden."
            Write-Info "Bitte manuell installieren: https://python.org"
        }
    } catch {
        Write-Warn "Python-Installation fehlgeschlagen: $_"
        Write-Info "Bitte manuell installieren: https://python.org"
    }
}

# ---- Schritt 3: Ulanzi-Software pruefen -------------------------------------
Write-Header "Schritt 3: Ulanzi Software pruefen"
$ulanziProcess = Get-Process -Name "*ulanzi*","*ustudio*","*UlanziDeck*" -ErrorAction SilentlyContinue
if ($ulanziProcess) {
    Write-Warn "Ulanzi Software laeuft gerade. Bitte vor der Installation schliessen."
    $confirm = Read-Host "  Trotzdem fortfahren? (j/N)"
    if ($confirm -ne 'j' -and $confirm -ne 'J') { Pause-Exit 0 }
} else {
    Write-OK "Ulanzi Software ist nicht aktiv."
}

# ---- Schritt 4: Plugin-Dateien kopieren -------------------------------------
Write-Header "Schritt 4: Plugin-Dateien installieren"
Write-Info "Quelle: $PluginSrc"
Write-Info "Ziel:   $PluginDest"

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

Write-OK "Plugin-Dateien kopiert."

# Node.js-Abhaengigkeiten fuer Plugin installieren (ws-Paket benoetigt)
Write-Info "Installiere Plugin-Abhaengigkeiten (ws)..."
try {
    $nodeDir  = if ($NodeExeFull -ne 'node') { Split-Path $NodeExeFull } else { $null }
    $npmCmd   = if ($nodeDir -and (Test-Path (Join-Path $nodeDir 'npm.cmd'))) { Join-Path $nodeDir 'npm.cmd' } else { 'npm' }
    & $npmCmd install --prefix $PluginDest --omit=dev --silent 2>&1 | Out-Null
    Write-OK "Plugin-Abhaengigkeiten installiert."
} catch {
    Write-Warn "npm install fehlgeschlagen: $_"
}

# Sicherheitssperre von heruntergeladenen Dateien entfernen (Zone.Identifier)
Get-ChildItem -Path $PluginDest -Recurse -File |
    ForEach-Object { Unblock-File -Path $_.FullName -ErrorAction SilentlyContinue }
Write-OK "Dateien entsperrt (Windows-Sicherheitssperre entfernt)."

# Python-Abhaengigkeiten installieren (nach Dateikopie)
$reqFile = Join-Path $PluginDest "native\webcam-mute\requirements.txt"
$pyNow   = Get-PythonMajorVersion
if ($pyNow -ge 3) {
    if (Test-Path $reqFile) {
        Write-Info "Installiere Python-Abhaengigkeiten..."
        try {
            & python -m pip install -r $reqFile --quiet
            Write-OK "Python-Abhaengigkeiten installiert."
        } catch {
            Write-Warn "pip install fehlgeschlagen: $_"
            Write-Info "Manuell: python -m pip install -r `"$reqFile`""
        }
    } else {
        Write-Warn "requirements.txt nicht gefunden: $reqFile"
    }
} else {
    Write-Warn "Python nicht gefunden - pip install uebersprungen."
    Write-Info "Manuell nach Python-Installation: python -m pip install -r `"$reqFile`""
}

# ---- Schritt 5: Unity Capture Virtual Camera --------------------------------
Write-Header "Schritt 5: Unity Capture Virtual Camera installieren"

$ucDir = Join-Path $PluginDest "native\webcam-mute"
$ucDll = Join-Path $ucDir "UnityCaptureFilter64.dll"

if (-not (Test-Path $ucDll)) {
    Write-Info "Lade Unity Capture DLL herunter (MIT-Lizenz, ~500 KB)..."
    $ucUrl = "https://raw.githubusercontent.com/schellingb/UnityCapture/master/Install/UnityCaptureFilter64.dll"
    try {
        Invoke-WebRequest -Uri $ucUrl -OutFile $ucDll -UseBasicParsing -TimeoutSec 60
        Write-OK "Unity Capture DLL heruntergeladen."
    } catch {
        Write-Warn "Download fehlgeschlagen: $_"
        Write-Info "Manuell herunterladen: https://github.com/schellingb/UnityCapture"
        Write-Info "Datei 'UnityCaptureFilter64.dll' aus dem Install-Ordner ablegen in: $ucDir"
    }
}

if (Test-Path $ucDll) {
    $reg = Start-Process regsvr32 -ArgumentList "/s `"$ucDll`"" -Wait -PassThru
    if ($reg.ExitCode -eq 0) {
        Write-OK "Unity Capture als DirectShow-Filter registriert."
        Write-Info "In Microsoft Teams: Einstellungen > Kamera > 'Unity Video Capture' auswaehlen."
    } else {
        Write-Warn "regsvr32 ExitCode $($reg.ExitCode) - wird beim naechsten Neustart aktiv."
    }
} else {
    Write-Warn "Unity Capture DLL nicht gefunden."
    Write-Info "Bitte 'UnityCaptureFilter64.dll' aus https://github.com/schellingb/UnityCapture"
    Write-Info "in diesen Ordner kopieren und regsvr32 ausfuehren: $ucDir"
}

# ---- Schritt 6: Task Scheduler ----------------------------------------------
Write-Header "Schritt 6: Native Bridge als Autostart registrieren"

# start-hidden.vbs mit vollem node-Pfad schreiben (kein Terminalfenster, PATH-unabhaengig)
$LauncherPath = Join-Path $PluginDest "native\start-hidden.vbs"
$q = 'Chr(34)'
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

    # Laufende Bridge-Prozesse beenden (damit der neue Task den Port belegen kann)
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
    Write-OK "Task '$TaskName' registriert (startet automatisch beim Anmelden)."
    Start-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    Write-OK "Bridge gestartet."
} catch {
    Write-Warn "Task-Registrierung fehlgeschlagen: $_"
    Write-Info "Bridge manuell starten: node `"$BridgePath`""
}

# ---- Schritt 7: Virtual-Cam-Dienst als Autostart registrieren ---------------
Write-Header "Schritt 7: Virtual-Cam-Dienst als Autostart registrieren"

# Python-Interpreter finden
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
    Write-Warn "Python nicht gefunden - Virtual-Cam-Task wird nicht registriert."
    Write-Info "Bitte Python installieren und Installer erneut ausfuehren."
} else {
    Write-OK "Python gefunden: $PythonExe"
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

        # Laufenden Virtual-Cam-Dienst beenden (nur Port 5000)
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

        Write-OK "Task '$VcamTaskName' registriert."
        Start-ScheduledTask -TaskName $VcamTaskName -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 4

        try {
            $r = Invoke-WebRequest -Uri "http://127.0.0.1:$VcamPort/status" -TimeoutSec 5 -UseBasicParsing -ErrorAction Stop
            $j = $r.Content | ConvertFrom-Json
            Write-OK "Virtual-Cam-Dienst antwortet (muted: $($j.muted))."
        } catch {
            Write-Warn "Virtual-Cam-Dienst antwortet noch nicht - wird beim naechsten Anmelden automatisch gestartet."
        }
    } catch {
        Write-Warn "Task-Registrierung fehlgeschlagen: $_"
    }
}

# ---- Schritt 8: Bridge testen -----------------------------------------------
Write-Header "Schritt 8: Bridge testen"
Start-Sleep -Seconds 1
try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:$BridgePort/ping" -TimeoutSec 5 -UseBasicParsing -ErrorAction Stop
    $json = $response.Content | ConvertFrom-Json
    Write-OK "Bridge antwortet: Version $($json.version)"
} catch {
    Write-Warn "Bridge antwortet noch nicht. Beim naechsten Windows-Start automatisch aktiv."
}

# ---- Fertig -----------------------------------------------------------------
Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host "  Installation abgeschlossen!              " -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host ""
Write-Host "Naechste Schritte:" -ForegroundColor White
Write-Host "  1. In Microsoft Teams: Einstellungen > Kamera > 'Unity Video Capture' auswaehlen" -ForegroundColor Gray
Write-Host "  2. Ulanzi Stream Controller Software starten" -ForegroundColor Gray
Write-Host "  3. Plugin 'Device Pilot' erscheint in der Software" -ForegroundColor Gray
Write-Host "  4. Kamera-Button auf das Deck ziehen und Name vergeben" -ForegroundColor Gray
Write-Host ""
Write-Host "Plugin-Ordner: $PluginDest" -ForegroundColor DarkGray
Write-Host ""
Read-Host "  Druecke Enter zum Beenden & starte dein System neu"
Write-Host ""
Read-Host "  Please restart your System!"
