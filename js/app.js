/**
 * app.js - Hauptdienst des Device Pilot Plugins
 * UUID: com.ulanzi.devcontrol (genau 4 Segmente = Hauptdienst)
 */

'use strict';

// Pro Button-Kontext werden die aktuellen Parameter gespeichert.
const buttonStates = new Map();  // context -> { actionUuid, param }

// ── Action-Typ erkennen ───────────────────────────────────────────────────────
// Robuste Erkennung: erst exaktes Suffix, dann indexOf als Fallback.
function getActionType(actionUuid) {
  if (!actionUuid) return null;
  if (actionUuid.endsWith('.audiooutput')) return 'audiooutput';
  if (actionUuid.endsWith('.microphone'))  return 'microphone';
  if (actionUuid.endsWith('.camera'))      return 'camera';
  // Fallback für ältere/abweichende UUIDs
  if (actionUuid.includes('audiooutput')) return 'audiooutput';
  if (actionUuid.includes('microphone'))  return 'microphone';
  if (actionUuid.includes('camera'))      return 'camera';
  return null;
}

// Log-Hilfsfunktion
const logEl = document.getElementById('log');
function log(msg) {
  console.log('[App] ' + msg);
  if (logEl) {
    const p = document.createElement('p');
    p.textContent = new Date().toLocaleTimeString() + ' ' + msg;
    logEl.prepend(p);
    if (logEl.children.length > 50) logEl.lastChild.remove();
  }
}

// ── Native Bridge starten ─────────────────────────────────────────────────────
async function startNativeBridge() {
  if (typeof window.require === 'function') {
    try {
      const { spawn } = window.require('child_process');
      const path = window.require('path');
      const bridgePath = path.join(__dirname, 'native', 'bridge.js');
      const proc = spawn('node', [bridgePath], { detached: false, stdio: 'ignore' });
      proc.unref();
      log('Native Bridge via Electron gestartet.');
    } catch (e) {
      log('Electron-Start fehlgeschlagen: ' + e.message);
    }
  } else {
    log('Kein Electron-Zugriff. Pruefe vorinstallierte Bridge...');
  }
}

async function initBridge() {
  const statusEl = document.getElementById('bridge-status');
  await startNativeBridge();

  await deviceControl.waitForBridge(
    () => {
      log('Native Bridge bereit (Port 3907).');
      if (statusEl) statusEl.textContent = 'Native Bridge: Verbunden';
      updateAllButtons();
    },
    () => {
      log('Native Bridge nicht erreichbar.');
      if (statusEl) statusEl.textContent = 'Native Bridge: Nicht gefunden - Installer ausfuehren!';
    }
  );
}

// ── Ulanzi verbinden ──────────────────────────────────────────────────────────
$UD.connect('com.ulanzi.devcontrol');

$UD.onConnected(() => {
  log('Ulanzi WebSocket verbunden.');
  initBridge();
});

$UD.onError(err => log('WebSocket-Fehler: ' + err));
$UD.onClose(()  => log('WebSocket-Verbindung getrennt.'));

// ── Button auf Deck gezogen ───────────────────────────────────────────────────
$UD.onAdd(msg => {
  const { context, actionid, param } = msg;
  log('Button hinzugefuegt: ' + actionid + ' [' + context + ']');
  buttonStates.set(context, { actionUuid: actionid, param: param || {} });
  updateButton(context, actionid, param || {});
});

// ── Button vom Deck entfernt ──────────────────────────────────────────────────
$UD.onClear(msg => {
  if (!msg.param) return;
  msg.param.forEach(item => {
    buttonStates.delete(item.context);
  });
});

// ── Gespeicherte Einstellungen vom App erhalten ───────────────────────────────
$UD.onParamFromApp(msg => {
  const { context, actionid, param } = msg;
  log('Param (App): ' + actionid);
  const prev   = buttonStates.get(context) || { param: {} };
  const merged = Object.assign({}, prev.param, param || {});
  buttonStates.set(context, { actionUuid: actionid, param: merged });
  // BUG FIX: merged statt param uebergeben
  updateButton(context, actionid, merged);
});

// ── Einstellungen vom Property Inspector ─────────────────────────────────────
// BUG FIX: Nur EIN Handler. Geraeteanfragen werden hier nicht mehr behandelt.
// Die Property Inspectors fragen Geraete direkt per HTTP von der Bridge ab.
$UD.onParamFromPlugin(msg => {
  const { context, actionid, param } = msg;
  if (!param) return;

  log('Param (Inspector): ' + actionid);
  const prev   = buttonStates.get(context) || { param: {} };
  const merged = Object.assign({}, prev.param, param);
  buttonStates.set(context, { actionUuid: actionid, param: merged });
  updateButton(context, actionid, merged);
  // Einstellungen speichern
  $UD.sendParamFromPlugin(merged, context);
});

// ── Button gedrueckt ──────────────────────────────────────────────────────────
$UD.onRun(async msg => {
  const { context, actionid } = msg;
  const state  = buttonStates.get(context) || {};
  const param  = state.param || {};

  log('Button gedrueckt: ' + actionid);

  if (!deviceControl.bridgeReady) {
    $UD.toast('Bridge nicht bereit - bitte bridge.js starten');
    return;
  }

  try {
    const type = getActionType(actionid);

    if (type === 'audiooutput') {
      // ── Audioausgang wechseln ──────────────────────────────────────────────
      if (!param.deviceId) { $UD.toast('Kein Geraet konfiguriert'); return; }
      await deviceControl.setDefaultAudioOutput(param.deviceId);
      log('Audioausgang gesetzt: ' + (param.deviceName || param.deviceId));
      $UD.toast(param.deviceName || 'Geraet aktiviert');
      await updateButton(context, actionid, param);

    } else if (type === 'microphone') {
      // ── Mikrofon steuern ───────────────────────────────────────────────────
      const mode = param.actionMode || 'toggle-mute';

      if (mode === 'toggle-mute') {
        const result = await deviceControl.toggleMicrophoneMute(param.deviceId || null);
        const muted  = result.muted;
        const merged = Object.assign({}, param, { muteState: muted });
        buttonStates.set(context, { actionUuid: actionid, param: merged });
        setMicIcon(context, param.deviceName || 'Mikrofon', muted);
        log('Mikrofon ' + (muted ? 'stumm' : 'aktiv'));
      } else {
        if (!param.deviceId) { $UD.toast('Kein Geraet konfiguriert'); return; }
        await deviceControl.setDefaultAudioInput(param.deviceId);
        $UD.toast(param.deviceName || 'Mikrofon aktiv');
        await updateButton(context, actionid, param);
      }

    } else if (type === 'camera') {
      // ── Virtual Cam umschalten (schwarz ↔ live) ────────────────────────────
      // Kein deviceId nötig – die virtuelle Kamera läuft immer.
      const result = await deviceControl.toggleVirtualCam();
      const muted  = result.muted;
      const merged = Object.assign({}, param, { cameraMuted: muted });
      buttonStates.set(context, { actionUuid: actionid, param: merged });
      setCamIcon(context, param.deviceName || 'Kamera', muted);
      log('Kamera ' + (muted ? 'stumm (schwarz)' : 'aktiv (live)'));

    } else {
      log('Unbekannter Action-Typ: ' + actionid);
    }

  } catch (e) {
    log('Fehler: ' + e.message);
    $UD.toast('Fehler: ' + e.message);
    $UD.setBaseDataIcon(context, iconRenderer.renderError('Fehler'), 'Fehler');
  }
});

// ── Icon-Setter ───────────────────────────────────────────────────────────────
function setAudioIcon(context, name, active) {
  $UD.setBaseDataIcon(context, iconRenderer.renderAudioOutput(name, active), active ? name : '');
}

function setMicIcon(context, name, muted) {
  // BUG FIX: setStateIcon und setBaseDataIcon nicht doppelt senden
  // Nur setBaseDataIcon verwenden - das reicht fuer visuelle Anzeige
  $UD.setBaseDataIcon(
    context,
    iconRenderer.renderMicrophone(name, muted),
    muted ? 'MUTED' : 'AKTIV'
  );
}

function setCamIcon(context, name, disabled) {
  $UD.setBaseDataIcon(
    context,
    iconRenderer.renderCamera(name, disabled),
    disabled ? 'AUS' : 'AN'
  );
}

// ── Alle Buttons aktualisieren ────────────────────────────────────────────────
// Parallel statt seriell: alle Buttons gleichzeitig aktualisieren
async function updateAllButtons() {
  await Promise.all(
    Array.from(buttonStates.entries()).map(([context, state]) =>
      updateButton(context, state.actionUuid, state.param)
    )
  );
}

// ── Einzelnen Button aktualisieren ───────────────────────────────────────────
async function updateButton(context, actionUuid, param) {
  param = param || {};
  const type = getActionType(actionUuid);

  if (type === 'audiooutput') {
    let name   = param.deviceName || 'Audio';
    let active = false;
    if (deviceControl.bridgeReady && param.deviceId) {
      try {
        const devices = await deviceControl.getAudioOutputDevices();
        const dev     = devices.find(d => d.id === param.deviceId);
        if (dev) { name = dev.name; active = dev.isDefault; }
      } catch(e) { log('getOutputDevices Fehler: ' + e.message); }
    }
    setAudioIcon(context, name, active);

  } else if (type === 'microphone') {
    let name  = param.deviceName || 'Mikrofon';
    // BUG FIX: getMicrophoneMuteState gibt { muted: boolean } zurück (nicht boolean)
    let muted = param.muteState || false;
    if (deviceControl.bridgeReady) {
      try {
        const result = await deviceControl.getMicrophoneMuteState(param.deviceId || null);
        muted = result.muted;
      } catch(e) { /* Bridge nicht bereit – gespeicherten Zustand behalten */ }
    }
    setMicIcon(context, name, muted);

  } else if (type === 'camera') {
    let name  = param.deviceName || 'Kamera';
    let muted = param.cameraMuted || false;
    if (deviceControl.bridgeReady) {
      try {
        const result = await deviceControl.getVirtualCamStatus();
        muted = result.muted;
      } catch(e) { /* Virtual-Cam-Dienst noch nicht bereit – gespeicherten Zustand behalten */ }
    }
    setCamIcon(context, name, muted);
  }
}

log('Plugin initialisiert.');
