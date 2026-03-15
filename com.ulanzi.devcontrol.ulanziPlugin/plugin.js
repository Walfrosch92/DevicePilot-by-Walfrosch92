/**
 * plugin.js – Device Pilot Plugin Hauptdienst (Node.js)
 *
 * Wird von Ulanzi Studio gestartet:
 *   node plugin.js <address> <port> <language>
 *
 * Verbindet sich per WebSocket mit Ulanzi und steuert
 * Audio/Mikrofon über die native Bridge (Port 3907).
 */

import UlanzideckApi from './libs/node/ulanzideckApi.js';
import http from 'http';
import { exec } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PLUGIN_UUID = 'com.ulanzi.devcontrol';
const BRIDGE_HOST = '127.0.0.1';
const BRIDGE_PORT = 3907;

const $UD = new UlanzideckApi();

// Pro Button-Kontext: { actionUuid, param }
const buttonStates = new Map();

// ── Bridge HTTP-Client ────────────────────────────────────────────────────────

function bridgeRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const options = {
      hostname: BRIDGE_HOST,
      port:     BRIDGE_PORT,
      path,
      method,
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': payload ? Buffer.byteLength(payload) : 0
      }
    };
    const req = http.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve({}); }
      });
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('Bridge Timeout')); });
    if (payload) req.write(payload);
    req.end();
  });
}

let bridgeReady = false;
let bridgeLaunchCooldown = 0;

function launchBridge() {
  const now = Date.now();
  if (bridgeLaunchCooldown > now) return;
  bridgeLaunchCooldown = now + 30000;

  console.log('[Plugin] Bridge nicht aktiv – starte...');
  exec('schtasks /run /tn "UlanziDevControlBridge"', err => {
    if (err) {
      const vbs = join(__dirname, 'native', 'start-hidden.vbs');
      exec(`wscript.exe "${vbs}"`, err2 => {
        if (err2) console.error('[Plugin] Bridge-Start fehlgeschlagen:', err2.message);
        else console.log('[Plugin] Bridge direkt gestartet.');
      });
    } else {
      console.log('[Plugin] Bridge-Task gestartet.');
    }
  });
}

async function checkBridge() {
  try {
    const r = await bridgeRequest('GET', '/ping');
    if (r.status === 'ok' && !bridgeReady) {
      bridgeReady = true;
      console.log('[Plugin] Bridge verbunden.');
      updateAllButtons();
    }
  } catch {
    if (bridgeReady) {
      bridgeReady = false;
      console.log('[Plugin] Bridge getrennt.');
    }
    launchBridge();
  }
}

// Bridge-Verbindung alle 3s prüfen
setInterval(checkBridge, 3000);
checkBridge();

// ── Globale Benachrichtigung ──────────────────────────────────────────────────

function notify(msg) {
  $UD.toast(msg);
  if (bridgeReady)
    bridgeRequest('POST', '/notify', { title: 'Device Pilot', message: msg }).catch(() => {});
}

// ── Action-Typ erkennen ───────────────────────────────────────────────────────

function getActionType(actionUuid) {
  if (!actionUuid) return null;
  if (actionUuid.endsWith('.audiooutput')) return 'audiooutput';
  if (actionUuid.endsWith('.microphone'))  return 'microphone';
  if (actionUuid.endsWith('.camera'))      return 'camera';
  if (actionUuid.includes('audiooutput')) return 'audiooutput';
  if (actionUuid.includes('microphone'))  return 'microphone';
  if (actionUuid.includes('camera'))      return 'camera';
  return null;
}

// ── Icon-Helfer ───────────────────────────────────────────────────────────────

function setAudioIcon(context, name, active) {
  $UD.setPathIcon(
    context,
    active ? './assets/icons/speaker_on.png' : './assets/icons/speaker_off.png',
    (name || 'Audio').substring(0, 16)
  );
}

function setMicIcon(context, name, muted) {
  $UD.setPathIcon(
    context,
    muted ? './assets/icons/mic_off.png' : './assets/icons/mic_on.png',
    (name || 'Microphone').substring(0, 16)
  );
}

function setCamIcon(context, name, disabled) {
  $UD.setPathIcon(
    context,
    disabled ? './assets/icons/cam_off.png' : './assets/icons/cam_on.png',
    (name || 'Camera').substring(0, 16)
  );
}

// ── Button aktualisieren ──────────────────────────────────────────────────────

async function updateButton(context, actionUuid, param) {
  param = param || {};
  const type = getActionType(actionUuid);
  const mode = param.actionMode;

  try {
    if (type === 'audiooutput') {
      if (mode === 'toggle-device') {
        let label = param.deviceName || 'Audio';
        if (bridgeReady) {
          const devices = await bridgeRequest('GET', '/audio/outputs');
          const list = Array.isArray(devices) ? devices : [];
          const ids = [param.deviceId, param.deviceId2].filter(Boolean);
          const active = list.find(d => ids.includes(d.id) && d.isDefault)
                      || list.find(d => d.isDefault);
          if (active) label = active.name;
          console.log('[Plugin] audio toggle-device label:', label);
        }
        $UD.setPathIcon(context, './assets/icons/speaker_change.png', label.substring(0, 16));
      } else if (mode === 'toggle-mute') {
        let name = param.deviceName || 'Audio';
        let muted = false;
        if (bridgeReady) {
          const devices = await bridgeRequest('GET', '/audio/outputs');
          const list = Array.isArray(devices) ? devices : [];
          const def = list.find(d => d.isDefault) || list[0];
          if (def) name = def.name;
          const r = await bridgeRequest('GET', '/audio/outputs/mute');
          if (typeof r.muted === 'boolean') muted = r.muted;
          console.log('[Plugin] audio name:', name, 'muted:', muted);
        }
        setAudioIcon(context, name, !muted);
      } else {
        let name = param.deviceName || 'Audio';
        let active = false;
        if (bridgeReady && param.deviceId) {
          const devices = await bridgeRequest('GET', '/audio/outputs');
          const dev = (Array.isArray(devices) ? devices : []).find(d => d.id === param.deviceId);
          if (dev) { name = dev.name; active = dev.isDefault; }
        }
        setAudioIcon(context, name, active);
      }

    } else if (type === 'microphone') {
      if (mode === 'toggle-device') {
        let label = param.deviceName || 'Microphone';
        if (bridgeReady) {
          const inputs = await bridgeRequest('GET', '/audio/inputs');
          const list = Array.isArray(inputs) ? inputs : [];
          const ids = [param.deviceId, param.deviceId2].filter(Boolean);
          const active = list.find(d => ids.includes(d.id) && d.isDefault)
                      || list.find(d => d.isDefault);
          if (active) label = active.name;
          console.log('[Plugin] mic toggle-device label:', label);
        }
        $UD.setPathIcon(context, './assets/icons/mic_change.png', label.substring(0, 16));
      } else {
        let name = param.deviceName || 'Microphone';
        let muted = param.muteState || false;
        if (bridgeReady) {
          const inputs = await bridgeRequest('GET', '/audio/inputs');
          const list = Array.isArray(inputs) ? inputs : [];
          const def = list.find(d => d.isDefault) || list[0];
          if (def) name = def.name;
          const r = await bridgeRequest('GET', '/audio/inputs/mute');
          if (typeof r.muted === 'boolean') muted = r.muted;
          console.log('[Plugin] mic name:', name, 'muted:', muted);
        }
        setMicIcon(context, name, muted);
      }

    } else if (type === 'camera') {
      const name = param.deviceName || 'Camera';
      if (mode === 'toggle-device') {
        $UD.setPathIcon(context, './assets/icons/cam_change.png', name.substring(0, 16));
      } else {
        let muted = true;
        if (bridgeReady) {
          const r = await bridgeRequest('GET', '/cameras/virtual/status');
          if (typeof r.muted === 'boolean') muted = r.muted;
          console.log('[Plugin] vcam muted:', muted);
        }
        setCamIcon(context, name, muted);
      }
    }
  } catch (e) {
    console.error('[Plugin] updateButton error:', e.message);
  }
}

async function updateAllButtons() {
  for (const [context, state] of buttonStates.entries()) {
    await updateButton(context, state.actionUuid, state.param);
  }
}

// ── Ulanzi Events ─────────────────────────────────────────────────────────────

$UD.connect(PLUGIN_UUID);

$UD.onConnected(() => {
  console.log('[Plugin] Ulanzi WebSocket connected.');
});

$UD.onAdd(msg => {
  const { context, uuid: actionUuid, param } = msg;
  console.log('[Plugin] Button added:', actionUuid);
  buttonStates.set(context, { actionUuid, param: param || {} });
  updateButton(context, actionUuid, param || {});
});

$UD.onClear(msg => {
  if (!msg.param) return;
  msg.param.forEach(item => buttonStates.delete(item.context));
});

$UD.onParamFromApp(msg => {
  const { context, uuid: actionUuid, param } = msg;
  const prev = buttonStates.get(context) || { param: {} };
  const merged = Object.assign({}, prev.param, param || {});
  buttonStates.set(context, { actionUuid, param: merged });
  updateButton(context, actionUuid, merged);
});

$UD.onParamFromPlugin(msg => {
  const { context, uuid: actionUuid, param } = msg;
  if (!param) return;
  const prev = buttonStates.get(context) || { param: {} };
  const merged = Object.assign({}, prev.param, param);
  buttonStates.set(context, { actionUuid, param: merged });
  // Icon sofort setzen fuer Kamera-Modus-Wechsel
  if (getActionType(actionUuid) === 'camera' && merged.actionMode === 'toggle-device') {
    $UD.setPathIcon(context, './assets/icons/cam_change.png', (merged.deviceName || 'Camera').substring(0, 16));
  } else {
    updateButton(context, actionUuid, merged);
  }
  $UD.sendParamFromPlugin(merged, context);
});

$UD.onRun(async msg => {
  const { context, uuid: actionUuid } = msg;
  const state = buttonStates.get(context) || {};
  const param = state.param || {};

  console.log('[Plugin] Button pressed:', actionUuid);

  if (!bridgeReady) {
    $UD.toast('Bridge not ready – please run the installer');
    return;
  }

  try {
    const type = getActionType(actionUuid);

    if (type === 'audiooutput') {
      const mode = param.actionMode || 'setdefault';
      if (mode === 'toggle-mute') {
        const result = await bridgeRequest('POST', '/audio/outputs/togglemute', { deviceId: null });
        const muted = result.muted;
        const merged = Object.assign({}, param, { muteState: muted });
        buttonStates.set(context, { actionUuid, param: merged });
        const outputs = await bridgeRequest('GET', '/audio/outputs');
        const def = (Array.isArray(outputs) ? outputs : []).find(d => d.isDefault);
        setAudioIcon(context, def ? def.name : 'Audio', !muted);
        notify((def ? def.name : 'Audio') + (muted ? ' – Muted' : ' – Active'));
        console.log('[Plugin] Audio', muted ? 'muted' : 'active');
      } else if (mode === 'toggle-device') {
        if (!param.deviceId) { $UD.toast('No device configured'); return; }
        const outputs = await bridgeRequest('GET', '/audio/outputs');
        const current = Array.isArray(outputs) ? outputs.find(d => d.isDefault) : null;
        const currentId = current ? current.id : null;
        const targetId = (currentId === param.deviceId && param.deviceId2)
          ? param.deviceId2 : param.deviceId;
        const targetName = (targetId === param.deviceId2 && param.deviceName2)
          ? param.deviceName2 : (param.deviceName || 'Audio');
        await bridgeRequest('POST', '/audio/outputs/setdefault', { deviceId: targetId });
        notify(targetName);
        await updateButton(context, actionUuid, param);
      } else {
        if (!param.deviceId) { $UD.toast('No device configured'); return; }
        await bridgeRequest('POST', '/audio/outputs/setdefault', { deviceId: param.deviceId });
        notify(param.deviceName || 'Device activated');
        await updateButton(context, actionUuid, param);
      }

    } else if (type === 'microphone') {
      const mode = param.actionMode || 'toggle-mute';
      if (mode === 'toggle-mute') {
        const result = await bridgeRequest('POST', '/audio/inputs/togglemute', { deviceId: null });
        const muted = result.muted;
        const merged = Object.assign({}, param, { muteState: muted });
        buttonStates.set(context, { actionUuid, param: merged });
        const inputs = await bridgeRequest('GET', '/audio/inputs');
        const def = (Array.isArray(inputs) ? inputs : []).find(d => d.isDefault);
        setMicIcon(context, def ? def.name : 'Microphone', muted);
        notify((def ? def.name : 'Microphone') + (muted ? ' – Muted' : ' – Active'));
        console.log('[Plugin] Microphone', muted ? 'muted' : 'active');
      } else if (mode === 'toggle-device') {
        if (!param.deviceId) { $UD.toast('No device configured'); return; }
        const inputs = await bridgeRequest('GET', '/audio/inputs');
        const current = Array.isArray(inputs) ? inputs.find(d => d.isDefault) : null;
        const currentId = current ? current.id : null;
        const targetId = (currentId === param.deviceId && param.deviceId2)
          ? param.deviceId2 : param.deviceId;
        const targetName = (targetId === param.deviceId2 && param.deviceName2)
          ? param.deviceName2 : (param.deviceName || 'Microphone');
        await bridgeRequest('POST', '/audio/inputs/setdefault', { deviceId: targetId });
        notify(targetName);
        await updateButton(context, actionUuid, param);
      } else {
        if (!param.deviceId) { $UD.toast('No device configured'); return; }
        await bridgeRequest('POST', '/audio/inputs/setdefault', { deviceId: param.deviceId });
        notify(param.deviceName || 'Microphone active');
        await updateButton(context, actionUuid, param);
      }

    } else if (type === 'camera') {
      const mode = param.actionMode || 'toggle-mute';
      const name = param.deviceName || 'Camera';
      if (mode === 'toggle-device') {
        const idx1 = param.camIndex1 !== undefined ? parseInt(param.camIndex1, 10) : 0;
        const idx2 = param.camIndex2 !== undefined ? parseInt(param.camIndex2, 10) : 1;
        if (isNaN(idx1) || isNaN(idx2)) { $UD.toast('Camera indices not configured'); return; }
        const status = await bridgeRequest('GET', '/cameras/virtual/status');
        const targetIdx = (status.cameraIndex === idx1) ? idx2 : idx1;
        $UD.setPathIcon(context, './assets/icons/cam_change.png', name.substring(0, 16));
        await bridgeRequest('POST', '/cameras/virtual/switch', { index: targetIdx });
        notify(name + ' – Camera ' + targetIdx);
      } else {
        const result = await bridgeRequest('POST', '/cameras/virtual/toggle', {});
        const merged = Object.assign({}, param, { cameraMuted: result.muted });
        buttonStates.set(context, { actionUuid, param: merged });
        setCamIcon(context, name, result.muted);
        notify(name + (result.muted ? ' – MUTED' : ' – LIVE'));
      }

    } else {
      console.log('[Plugin] Unknown action:', actionUuid);
    }
  } catch (e) {
    console.error('[Plugin] Error:', e.message);
    $UD.toast('Error: ' + e.message);
  }
});

$UD.onClose(() => console.log('[Plugin] WebSocket disconnected.'));
$UD.onError(err => console.error('[Plugin] WebSocket error:', err));

console.log('[Plugin] Device Pilot started.');
