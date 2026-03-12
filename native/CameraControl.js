/**
 * CameraControl.js
 *
 * Kameraerkennung und -steuerung für Windows 10/11.
 *
 * Geräte auflisten:
 *   Get-PnpDevice -Class Camera/Image  →  KEINE Admin-Rechte erforderlich
 *
 * Kamera aktivieren/deaktivieren:
 *   Disable-PnpDevice / Enable-PnpDevice  →  BENÖTIGT Administrator-Rechte.
 *   Der Installer registriert die Bridge mit RunLevel Highest (Admin),
 *   daher läuft toggleCamera() direkt ohne UAC-Prompt.
 *   Fallback: runElevated() via UAC-Prompt falls Bridge nicht als Admin läuft.
 *
 * Status-Erkennung:
 *   Korrekte Methode: DEVPKEY_Device_ProblemCode == 22 (CM_PROB_DISABLED).
 *   Nicht: Status -ne 'OK' (falsch-positive bei Treiberproblemen).
 *
 * Kein TOCTOU beim Toggle:
 *   Status-Abfrage und Aktion laufen in EINEM einzigen PowerShell-Aufruf.
 */

'use strict';

const { execFile } = require('child_process');
const shell        = require('./PersistentShell');

// ── PowerShell über PersistentShell ausführen (kein Prozess-Overhead) ─────────

async function runCameraJson(script, timeoutMs = 15000) {
  const output = await shell.run(script, timeoutMs);
  if (!output) return null;
  try { return JSON.parse(output); }
  catch { return { raw: output }; }
}

// ── Kameras auflisten ─────────────────────────────────────────────────────────

/**
 * Gibt alle erkannten Kameras zurück (aktive und deaktivierte).
 * Nutzt DEVPKEY_Device_ProblemCode == 22 für zuverlässige "disabled"-Erkennung.
 * @returns {Promise<Array<{id, name, status, disabled}>>}
 */
async function getCameras() {
  const script = `
$cameras = @()

# Strategie 1: Klasse Camera (Windows 10/11 Standard)
$c1 = Get-PnpDevice -Class Camera -ErrorAction SilentlyContinue
if ($c1) { $cameras += $c1 }

# Strategie 2: Klasse Image (ältere Systeme, Capture Cards)
$c2 = Get-PnpDevice -Class Image -ErrorAction SilentlyContinue
if ($c2) { $cameras += $c2 }

# Strategie 3: Keyword-Suche als Fallback
if ($cameras.Count -eq 0) {
    $cameras = Get-PnpDevice -ErrorAction SilentlyContinue |
        Where-Object {
            $_.FriendlyName -match 'cam|webcam|kamera|capture|video|logitech|elgato|razer|canon|sony' -and
            $_.Status -ne 'Unknown'
        }
}

# Duplikate entfernen
$cameras = $cameras | Sort-Object InstanceId -Unique

$result = $cameras | ForEach-Object {
    # CM_PROB_DISABLED = 22: offiziell per Device Manager deaktiviert
    # Nur dieser Code bedeutet "absichtlich deaktiviert", nicht Treiberfehler
    $prob = Get-PnpDeviceProperty -InstanceId $_.InstanceId -KeyName 'DEVPKEY_Device_ProblemCode' -ErrorAction SilentlyContinue
    $disabled = ($prob -ne $null) -and ($prob.Data -eq 22)

    @{
        id       = $_.InstanceId
        name     = $_.FriendlyName
        status   = $_.Status
        disabled = $disabled
    }
}

@($result) | ConvertTo-Json -Compress
`;
  const result = await runCameraJson(script);
  // PowerShell gibt bei einem einzelnen Objekt ein Objekt statt Array zurück
  if (result === null) return [];
  return Array.isArray(result) ? result : [result];
}

// ── Kamera aktivieren / deaktivieren (erfordert Admin) ───────────────────────

/**
 * Deaktiviert eine Kamera via Device Manager.
 * Benötigt Admin-Rechte.
 * @param {string} instanceId
 * @returns {Promise<{success, enabled, requiresAdmin?, error?}>}
 */
async function disableCamera(instanceId) {
  const safe = instanceId.replace(/'/g, "''");
  const script = `
try {
    Disable-PnpDevice -InstanceId '${safe}' -Confirm:$false -ErrorAction Stop
    '{"success":true,"enabled":false}' | Write-Output
} catch {
    $msg = $_.Exception.Message
    if ($msg -match 'Access|Zugriff|Administrator|Allgemeiner|privilege|Berechtigung|0x80004005|0x80070005') {
        '{"success":false,"enabled":true,"requiresAdmin":true}' | Write-Output
    } else {
        [PSCustomObject]@{ success=$false; enabled=$true; error=$msg } |
            ConvertTo-Json -Compress | Write-Output
    }
}
`;
  return runCameraJson(script);
}

/**
 * Aktiviert eine deaktivierte Kamera.
 * Benötigt Admin-Rechte.
 * @param {string} instanceId
 * @returns {Promise<{success, enabled, requiresAdmin?, error?}>}
 */
async function enableCamera(instanceId) {
  const safe = instanceId.replace(/'/g, "''");
  const script = `
try {
    Enable-PnpDevice -InstanceId '${safe}' -Confirm:$false -ErrorAction Stop
    '{"success":true,"enabled":true}' | Write-Output
} catch {
    $msg = $_.Exception.Message
    if ($msg -match 'Access|Zugriff|Administrator|Allgemeiner|privilege|Berechtigung|0x80004005|0x80070005') {
        '{"success":false,"enabled":false,"requiresAdmin":true}' | Write-Output
    } else {
        [PSCustomObject]@{ success=$false; enabled=$false; error=$msg } |
            ConvertTo-Json -Compress | Write-Output
    }
}
`;
  return runCameraJson(script);
}

/**
 * Wechselt den Kamera-Status atomar in EINEM PowerShell-Aufruf.
 * Kein TOCTOU: Status-Abfrage und Aktion passieren ohne Unterbrechung.
 * @param {string} instanceId
 * @returns {Promise<{success, enabled, requiresAdmin?, error?}>}
 */
async function toggleCamera(instanceId) {
  const safe = instanceId.replace(/'/g, "''");
  const script = `
# Status und Aktion in einem einzigen Skript – kein TOCTOU
$prob = Get-PnpDeviceProperty -InstanceId '${safe}' -KeyName 'DEVPKEY_Device_ProblemCode' -ErrorAction SilentlyContinue
$disabled = ($prob -ne $null) -and ($prob.Data -eq 22)

try {
    if ($disabled) {
        Enable-PnpDevice  -InstanceId '${safe}' -Confirm:$false -ErrorAction Stop
        '{"success":true,"enabled":true}' | Write-Output
    } else {
        Disable-PnpDevice -InstanceId '${safe}' -Confirm:$false -ErrorAction Stop
        '{"success":true,"enabled":false}' | Write-Output
    }
} catch {
    $msg = $_.Exception.Message
    if ($msg -match 'Access|Zugriff|Administrator|Allgemeiner|privilege|Berechtigung|0x80004005|0x80070005') {
        [PSCustomObject]@{
            success      = $false
            enabled      = (-not $disabled)   # Zustand unverändert
            requiresAdmin = $true
        } | ConvertTo-Json -Compress | Write-Output
    } else {
        [PSCustomObject]@{ success=$false; enabled=(-not $disabled); error=$msg } |
            ConvertTo-Json -Compress | Write-Output
    }
}
`;
  return runCameraJson(script);
}

/**
 * Startet eine elevated PowerShell-Sitzung (UAC-Prompt) und führt
 * Enable/Disable-PnpDevice darin aus.
 * Wird aufgerufen, wenn toggleCamera() requiresAdmin meldet.
 * @param {string} instanceId
 * @param {boolean} enable
 * @returns {Promise<{success, enabled}>}
 */
async function runElevated(instanceId, enable) {
  const action = enable ? 'Enable-PnpDevice' : 'Disable-PnpDevice';
  // Doppeltes Escaping: erst für innere PS-Anführungszeichen, dann für -ArgumentList
  const inner  = instanceId.replace(/'/g, "''");

  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      [
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
        `Start-Process powershell.exe -Verb RunAs -Wait -WindowStyle Hidden ` +
        `-ArgumentList '-NoProfile -ExecutionPolicy Bypass -NonInteractive -Command ` +
        `"& { ${action} -InstanceId ''${inner}'' -Confirm:$false }"'`
      ],
      { timeout: 60000, windowsHide: true },
      (err) => {
        if (err) reject(new Error(err.message));
        else     resolve({ success: true, enabled: enable });
      }
    );
  });
}

module.exports = {
  getCameras,
  disableCamera,
  enableCamera,
  toggleCamera,
  runElevated
};
