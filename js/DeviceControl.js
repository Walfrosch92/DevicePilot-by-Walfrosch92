/**
 * DeviceControl.js
 *
 * Koordiniert alle Windows-SystemgerÃ¤t-Operationen Ã¼ber die Native Bridge
 * (bridge.js auf http://localhost:3907).
 *
 * Die Native Bridge fÃ¼hrt PowerShell-Befehle aus, um:
 *   - AudiogerÃ¤te aufzulisten und das StandardgerÃ¤t zu wechseln
 *   - Mikrofone zu muten/unmuten
 *   - Kameras aufzulisten und zu aktivieren/deaktivieren
 *
 * Fallback: Falls die Bridge nicht erreichbar ist, versucht das Plugin
 * direkt Ã¼ber Electron's node integration zu arbeiten (falls aktiviert).
 */

class DeviceControl {
  constructor() {
    this.bridgeUrl     = 'http://127.0.0.1:3907';
    this.bridgeReady   = false;
    this.retryInterval = null;
    this._log = msg => console.log(`[DeviceControl] ${msg}`);
  }

  // â”€â”€ Bridge-Verbindung â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /**
   * PrÃ¼ft, ob die Native Bridge lÃ¤uft. Wiederholt die PrÃ¼fung bis zur
   * erfolgreichen Verbindung.
   */
  async waitForBridge(onReady, onFail) {
    const check = async () => {
      try {
        const r = await this._fetch('/ping', { method: 'GET' }, 2000);
        if (r.ok) {
          this.bridgeReady = true;
          clearInterval(this.retryInterval);
          this._log('Native Bridge verbunden.');
          onReady && onReady();
        }
      } catch {
        // noch nicht bereit
      }
    };

    await check();
    if (!this.bridgeReady) {
      onFail && onFail();
      this.retryInterval = setInterval(check, 3000);
    }
  }

  // â”€â”€ Audio Output â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async getAudioOutputDevices() {
    return this._api('/audio/outputs');
  }

  async setDefaultAudioOutput(deviceId) {
    return this._api('/audio/outputs/setdefault', { deviceId });
  }

  async getDefaultAudioOutput() {
    const devices = await this.getAudioOutputDevices();
    return devices.find(d => d.isDefault) || null;
  }

  // â”€â”€ Mikrofon â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async getAudioInputDevices() {
    return this._api('/audio/inputs');
  }

  async setDefaultAudioInput(deviceId) {
    return this._api('/audio/inputs/setdefault', { deviceId });
  }

  async getMicrophoneMuteState(deviceId = null) {
    // GET: deviceId als Query-Parameter (Body bei GET nicht verfÃ¼gbar)
    const qs = deviceId ? `?deviceId=${encodeURIComponent(deviceId)}` : '';
    const r  = await this._fetch(`/audio/inputs/mute${qs}`, { method: 'GET' }, 5000);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json(); // { muted: boolean }
  }

  async setMicrophoneMute(muted, deviceId = null) {
    return this._api('/audio/inputs/mute', { muted, deviceId });
  }

  async toggleMicrophoneMute(deviceId = null) {
    return this._api('/audio/inputs/togglemute', { deviceId });
    // returns { muted: boolean }
  }

  // â”€â”€ Kamera (Liste) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async getCameraDevices() {
    return this._api('/cameras');
  }

  // â”€â”€ Virtual Cam (Python-Dienst) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Steuert den Virtual-Cam-Dienst (native/webcam-mute/main.py).
  // Die Kamera bleibt immer aktiv; muted=true gibt ein schwarzes Bild aus.

  async getVirtualCamStatus() {
    return this._api('/cameras/virtual/status', null, 'GET');
    // returns { muted: boolean }
  }

  async toggleVirtualCam() {
    return this._api('/cameras/virtual/toggle', {});
    // returns { muted: boolean }
  }

  async muteVirtualCam() {
    return this._api('/cameras/virtual/mute', {});
    // returns { muted: true }
  }

  async unmuteVirtualCam() {
    return this._api('/cameras/virtual/unmute', {});
    // returns { muted: false }
  }

  // â”€â”€ HTTP-Helfer â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async _api(path, body = null, method = null) {
    const isGet = method === 'GET' || body === null;
    try {
      const r = await this._fetch(path, {
        method:  isGet ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    isGet ? undefined : JSON.stringify(body || {})
      }, 8000);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    } catch (e) {
      this._log(`API-Fehler ${path}: ${e.message}`);
      throw e;
    }
  }

  _fetch(path, opts, timeoutMs = 5000) {
    const ctrl = new AbortController();
    const id   = setTimeout(() => ctrl.abort(), timeoutMs);
    return fetch(`${this.bridgeUrl}${path}`, { ...opts, signal: ctrl.signal })
      .finally(() => clearTimeout(id));
  }
}

// Singleton
const deviceControl = new DeviceControl();


