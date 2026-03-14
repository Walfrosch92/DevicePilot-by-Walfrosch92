/**
 * bridge.js – Native Bridge für Windows-System-API-Zugriff
 *
 * Ein minimaler HTTP-Server (Port 3907), der systemweite Geräte-
 * operationen über Windows-APIs bereitstellt.
 *
 * Wird von app.html entweder direkt über Electron's node integration
 * gestartet, ODER über den Windows Task Scheduler / NSSM als
 * Hintergrunddienst ausgeführt (via installer/install.ps1).
 *
 * Endpunkte:
 *   GET  /ping                          - Health Check
 *   GET  /audio/outputs                 - Alle Ausgabegeräte
 *   POST /audio/outputs/setdefault      - Standard-Ausgabe setzen
 *   GET  /audio/inputs                  - Alle Eingabegeräte
 *   POST /audio/inputs/setdefault       - Standard-Eingabe setzen
 *   GET  /audio/inputs/mute             - Mute-Status abfragen
 *   POST /audio/inputs/mute             - Mute-Status setzen
 *   POST /audio/inputs/togglemute       - Mute umschalten
 *   GET  /cameras                       - Alle Kameras (nur Liste)
 *   GET  /cameras/virtual/status        - Virtual-Cam Mute-Status
 *   POST /cameras/virtual/toggle        - Mute umschalten (schwarz ↔ live)
 *   POST /cameras/virtual/mute          - Schwarzes Bild erzwingen
 *   POST /cameras/virtual/unmute        - Live-Bild wiederherstellen
 *   POST /notify                        - Windows-Benachrichtigung anzeigen
 */

'use strict';

const http        = require('http');
const path        = require('path');
const { spawn }   = require('child_process');
const fs          = require('fs');
const audio       = require('./AudioControl');
const camera      = require('./CameraControl');
const shell       = require('./PersistentShell');

const PORT      = 3907;
const HOST      = '127.0.0.1'; // Nur lokal, kein Netzwerkzugriff
const VCAM_PORT = 5000;        // Port des Python Virtual-Cam-Dienstes

// ── HTTP-Server ───────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  // CORS-Header für lokale HTML-Seiten
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const pathname = req.url.split('?')[0];

  try {
    const body   = await readBody(req);
    const result = await dispatch(req.method, pathname, body, req);
    res.writeHead(200);
    res.end(JSON.stringify(result));
  } catch (err) {
    const status = err.requiresAdmin ? 403 : (err.status || 500);
    res.writeHead(status);
    res.end(JSON.stringify({
      error:         err.message || 'Interner Fehler',
      requiresAdmin: err.requiresAdmin || false
    }));
    if (status !== 404)
      console.error(`[Bridge] Fehler ${pathname}: ${err.message}`);
  }
});

// ── Router ────────────────────────────────────────────────────────────────────

async function dispatch(method, path, body, req) {
  // ── Health ──────────────────────────────────────────────────────────────
  if (path === '/ping')
    return { status: 'ok', version: '1.0.0' };

  // ── Audio Output ────────────────────────────────────────────────────────
  if (method === 'GET'  && path === '/audio/outputs')
    return audio.getOutputDevices();

  if (method === 'POST' && path === '/audio/outputs/setdefault') {
    if (!body.deviceId) throw new Error('deviceId fehlt');
    return audio.setDefaultOutput(body.deviceId);
  }

  if (method === 'GET'  && path === '/audio/outputs/mute') {
    const qs       = new URL(req.url, `http://${HOST}`).searchParams;
    const deviceId = qs.get('deviceId') || null;
    return audio.getOutputMute(deviceId);
  }

  if (method === 'POST' && path === '/audio/outputs/mute') {
    if (typeof body.muted !== 'boolean') throw new Error('muted (boolean) fehlt');
    return audio.setOutputMute(body.muted, body.deviceId || null);
  }

  if (method === 'POST' && path === '/audio/outputs/togglemute')
    return audio.toggleOutputMute(body.deviceId || null);

  // ── Audio Input (Mikrofon) ──────────────────────────────────────────────
  if (method === 'GET'  && path === '/audio/inputs')
    return audio.getInputDevices();

  if (method === 'POST' && path === '/audio/inputs/setdefault') {
    if (!body.deviceId) throw new Error('deviceId fehlt');
    return audio.setDefaultInput(body.deviceId);
  }

  if (method === 'GET'  && path === '/audio/inputs/mute') {
    // deviceId wird als Query-Parameter übergeben (Body bei GET nicht verfügbar)
    const qs       = new URL(req.url, `http://${HOST}`).searchParams;
    const deviceId = qs.get('deviceId') || null;
    return audio.getMicrophoneMute(deviceId);
  }

  if (method === 'POST' && path === '/audio/inputs/mute') {
    if (typeof body.muted !== 'boolean') throw new Error('muted (boolean) fehlt');
    return audio.setMicrophoneMute(body.muted, body.deviceId || null);
  }

  if (method === 'POST' && path === '/audio/inputs/togglemute')
    return audio.toggleMicrophoneMute(body.deviceId || null);

  // ── Kameras auflisten (nur lesen, kein Enable/Disable mehr) ────────────
  if (method === 'GET'  && path === '/cameras')
    return camera.getCameras();

  // ── Virtual Cam (Python-Dienst auf Port 5000) ────────────────────────────
  // Hält die Kamera permanent aktiv; schaltet zwischen Live-Bild und
  // schwarzem Frame um. Kein Device-Enable/Disable, kein Admin-Recht nötig.

  if (method === 'GET'  && path === '/cameras/virtual/status')
    return vcamProxy('GET', '/status');

  if (method === 'POST' && path === '/cameras/virtual/toggle')
    return vcamProxy('POST', '/toggle');

  if (method === 'POST' && path === '/cameras/virtual/mute')
    return vcamProxy('POST', '/mute');

  if (method === 'POST' && path === '/cameras/virtual/unmute')
    return vcamProxy('POST', '/unmute');

  if (method === 'GET'  && path === '/cameras/virtual/cameras')
    return vcamProxy('GET', '/cameras');

  if (method === 'POST' && path === '/cameras/virtual/switch') {
    if (typeof body.index !== 'number') throw Object.assign(new Error('index (number) fehlt'), { status: 400 });
    return vcamProxy('POST', '/switch', body);
  }

  if (method === 'POST' && path === '/cameras/virtual/restart') {
    startVirtualCamService();
    return { started: true };
  }

  // ── Windows-Benachrichtigung ─────────────────────────────────────────────
  if (method === 'POST' && path === '/notify') {
    if (!body.message) throw new Error('message fehlt');
    return showWindowsNotification(body.title || 'Device Control', body.message);
  }

  const err404 = new Error(`Unbekannter Pfad: ${path}`);
  err404.status = 404;
  throw err404;
}

// ── Virtual Cam Proxy ─────────────────────────────────────────────────────────
// Leitet Anfragen an den Python Virtual-Cam-Dienst (localhost:5000) weiter.

function vcamProxy(method, vcamPath, body = null) {
  return new Promise((resolve, reject) => {
    const payload = (body && method !== 'GET') ? JSON.stringify(body) : null;
    const headers = payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {};
    const req = http.request(
      { hostname: '127.0.0.1', port: VCAM_PORT, path: vcamPath, method, headers },
      (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch { resolve({ raw: data }); }
        });
      }
    );
    req.setTimeout(5000, () => {
      req.destroy();
      reject(Object.assign(new Error('Virtual-Cam-Dienst nicht erreichbar (Timeout)'), { status: 503 }));
    });
    req.on('error', (e) => {
      reject(Object.assign(new Error('Virtual-Cam-Dienst nicht erreichbar: ' + e.message), { status: 503 }));
    });
    if (payload) req.write(payload);
    req.end();
  });
}

// ── Body Parser ───────────────────────────────────────────────────────────────

function readBody(req, maxBytes = 65536) {
  return new Promise((resolve, reject) => {
    if (req.method === 'GET' || req.method === 'HEAD') { resolve({}); return; }
    let data = '';
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > maxBytes) {
        req.destroy();
        reject(new Error('Request body zu gross'));
        return;
      }
      data += chunk;
    });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

// ── Windows Toast-Benachrichtigung ────────────────────────────────────────────

async function showWindowsNotification(title, message) {
  // XML-Sonderzeichen und PS-Anführungszeichen escapen
  const esc = s => String(s)
    .substring(0, 128)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

  const t = esc(title);
  const m = esc(message);

  const ps = `
[void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
[void][Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime]
$doc = [Windows.Data.Xml.Dom.XmlDocument]::new()
$doc.LoadXml('<toast><visual><binding template="ToastGeneric"><text>${t}</text><text>${m}</text></binding></visual></toast>')
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Device Control').Show([Windows.UI.Notifications.ToastNotification]::new($doc))
`;

  try {
    await shell.run(ps, 8000);
    return { success: true };
  } catch (e) {
    console.warn('[Bridge] Notification Fehler:', e.message);
    return { success: false, error: e.message };
  }
}

// ── Starten ───────────────────────────────────────────────────────────────────

// ── Virtual-Cam-Dienst (Python) starten ──────────────────────────────────────

function spawnPython(scriptPath, candidates) {
  if (!candidates.length) {
    console.warn('[Bridge] Kein Python-Interpreter gefunden. Kamera-Buttons deaktiviert.');
    return;
  }
  const cmd = candidates[0];
  const proc = spawn(cmd, [scriptPath], {
    detached:    true,
    stdio:       'ignore',
    windowsHide: true,
    env:         Object.assign({}, process.env),
  });
  proc.on('error', () => {
    console.warn('[Bridge] Python-Befehl fehlgeschlagen:', cmd, '– versuche naechsten...');
    spawnPython(scriptPath, candidates.slice(1));
  });
  proc.unref();
  console.log('[Bridge] Virtual-Cam-Dienst gestartet mit:', cmd);
}

function getPythonCandidates() {
  const appData   = process.env.LOCALAPPDATA || '';
  const userProg  = process.env.LOCALAPPDATA ? path.join(appData, 'Programs', 'Python') : '';
  const candidates = ['python', 'python3', 'py'];
  // Haeufige Windows-Installationspfade als Fallback
  const searchRoots = [
    userProg,
    'C:\\Python313', 'C:\\Python312', 'C:\\Python311', 'C:\\Python310',
    'C:\\Program Files\\Python313', 'C:\\Program Files\\Python312',
  ];
  for (const root of searchRoots) {
    if (!root) continue;
    // Entweder direkt oder in Unterordnern (Python313, Python312 ...)
    const dirs = fs.existsSync(root)
      ? (fs.statSync(root).isDirectory()
          ? (fs.readdirSync(root).filter(d => d.startsWith('Python')).map(d => path.join(root, d)).concat([root]))
          : [])
      : [];
    for (const dir of dirs) {
      const exe = path.join(dir, 'python.exe');
      if (fs.existsSync(exe) && !candidates.includes(exe)) candidates.push(exe);
    }
  }
  return candidates;
}

function startVirtualCamService() {
  const scriptPath = path.join(__dirname, 'webcam-mute', 'main.py');
  if (!fs.existsSync(scriptPath)) {
    console.warn('[Bridge] Virtual-Cam-Skript nicht gefunden:', scriptPath);
    return;
  }
  // Erst pruefen ob der Dienst bereits laeuft (z.B. per Task Scheduler)
  const check = http.get({ hostname: '127.0.0.1', port: VCAM_PORT, path: '/status' }, (res) => {
    if (res.statusCode === 200) {
      console.log('[Bridge] Virtual-Cam-Dienst laeuft bereits auf Port', VCAM_PORT);
    }
    res.resume();
  });
  check.setTimeout(1500, () => {
    check.destroy();
    console.log('[Bridge] Virtual-Cam-Dienst nicht aktiv – starte als Fallback...');
    spawnPython(scriptPath, getPythonCandidates());
  });
  check.on('error', () => spawnPython(scriptPath, getPythonCandidates()));
  check.end();
}

server.listen(PORT, HOST, () => {
  console.log(`[Bridge] Native Bridge läuft auf http://${HOST}:${PORT}`);
  shell.start();
  console.log('[Bridge] PowerShell-Session gestartet, C# wird kompiliert...');
  startVirtualCamService();
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.log(`[Bridge] Port ${PORT} bereits belegt – andere Bridge-Instanz läuft bereits.`);
    process.exit(0); // Keine zweite Instanz nötig
  } else {
    console.error('[Bridge] Serverfehler:', err);
  }
});

// Graceful Shutdown
process.on('SIGTERM', () => { shell.close(); server.close(); process.exit(0); });
process.on('SIGINT',  () => { shell.close(); server.close(); process.exit(0); });
