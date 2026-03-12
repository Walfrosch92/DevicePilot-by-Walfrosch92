/// <reference path="eventEmitter.js"/>
/// <reference path="utils.js"/>

/**
 * UlanziStreamDeck – WebSocket-Verbindung und SDK-API
 * Protokoll: Ulanzi JS Plugin Development Protocol V1.2.2
 *
 * Verwendung (Hauptdienst, uuid hat genau 4 Segmente):
 *   $UD.connect('com.ulanzi.devcontrol');
 *
 * Verwendung (Action, uuid > 4 Segmente):
 *   $UD.connect('com.ulanzi.devcontrol.audiooutput');
 */
class UlanziStreamDeck {
  constructor() {
    this.key       = '';
    this.uuid      = '';
    this.actionid  = '';
    this.websocket = null;
    this.language  = 'en';
    this.localization = null;
    this.on        = EventEmitter.on;
    this.emit      = EventEmitter.emit;
    this.isMain    = false;
  }

  connect(uuid) {
    this.port     = Utils.getQueryParams('port')     || 3906;
    this.address  = Utils.getQueryParams('address')  || '127.0.0.1';
    this.actionid = Utils.getQueryParams('actionId') || '';
    this.key      = Utils.getQueryParams('key')      || '';
    this.language = Utils.adaptLanguage(Utils.getQueryParams('language') || Utils.getLanguage() || 'en');
    this.uuid     = uuid || Utils.getQueryParams('uuid') || '';

    if (this.websocket) { this.websocket.close(); this.websocket = null; }

    // Hauptdienst erkennen: uuid hat genau 4 Segmente (com.ulanzi.X.Y)
    this.isMain = this.uuid.split('.').length === 4;

    this.websocket = new WebSocket(`ws://${this.address}:${this.port}`);

    this.websocket.onopen = () => {
      this.websocket.send(JSON.stringify({
        code: 0, cmd: Events.CONNECTED,
        actionid: this.actionid, key: this.key, uuid: this.uuid
      }));
      this.emit(Events.CONNECTED, {});
      if (!this.isMain) this._localizeUI();
    };

    this.websocket.onerror = evt => {
      const msg = `[UlanziDeck] WebSocket-Fehler: ${evt}`;
      Utils.warn(msg);
      this.emit(Events.ERROR, msg);
    };

    this.websocket.onclose = () => {
      Utils.warn('[UlanziDeck] Verbindung geschlossen.');
      this.emit(Events.CLOSE);
    };

    this.websocket.onmessage = evt => {
      const data = evt && evt.data ? JSON.parse(evt.data) : null;
      if (!data || (typeof data.code !== 'undefined' && data.cmdType !== 'REQUEST')) return;

      if (!this.key     && data.uuid === this.uuid && data.key)      this.key      = data.key;
      if (!this.actionid && data.uuid === this.uuid && data.actionid) this.actionid = data.actionid;

      if (this.isMain) this._send(data.cmd, { code: 0, ...data });

      // Sonderfall clear: param ist ein Array
      if (data.cmd === 'clear') {
        if (data.param) data.param.forEach(p => { p.context = this.encodeContext(p); });
      } else {
        data.context = this.encodeContext(data);
      }

      this.emit(data.cmd, data);
    };
  }

  // ── Lokalisierung ──────────────────────────────────────────────────────────

  async _localizeUI() {
    const el = document.querySelector('.udpi-wrapper');
    if (!el) return;
    if (!this.localization) {
      try {
        const json = await Utils.readJson(`${Utils.getPluginPath()}/../${this.language}.json`);
        this.localization = json['Localization'] || null;
      } catch { Utils.warn('Lokalisierungsdatei nicht gefunden: ' + this.language); }
    }
    if (!this.localization) return;
    el.querySelectorAll('[data-localize]').forEach(e => {
      const dl = e.dataset.localize;
      const s  = e.innerText.trim();
      if (e.placeholder) e.placeholder = this.localization[dl || e.placeholder] || e.placeholder;
      if (e.textContent) e.textContent = this.localization[dl || s]  || e.textContent;
    });
  }

  t(key) { return (this.localization && this.localization[key]) || key; }

  // ── Context ────────────────────────────────────────────────────────────────

  encodeContext(jsn) { return `${jsn.uuid}___${jsn.key}___${jsn.actionid}`; }

  decodeContext(ctx) {
    const [uuid, key, actionid] = ctx.split('___');
    return { uuid, key, actionid };
  }

  // ── Senden ─────────────────────────────────────────────────────────────────

  _send(cmd, params = {}) {
    this.websocket && this.websocket.send(JSON.stringify({
      cmd, uuid: this.uuid, key: this.key, actionid: this.actionid, ...params
    }));
  }

  sendParamFromPlugin(settings, context) {
    const { uuid, key, actionid } = context ? this.decodeContext(context) : {};
    this._send(Events.PARAMFROMPLUGIN, {
      uuid:     uuid     || this.uuid,
      key:      key      || this.key,
      actionid: actionid || this.actionid,
      param:    settings
    });
  }

  // ── Icon setzen ────────────────────────────────────────────────────────────

  setStateIcon(context, state, text) {
    const { uuid, key, actionid } = this.decodeContext(context);
    this._send(Events.STATE, { param: { statelist: [{
      uuid, key, actionid, type: 0, state,
      textData: text || '', showtext: !!text
    }]}});
  }

  setBaseDataIcon(context, data, text) {
    const { uuid, key, actionid } = this.decodeContext(context);
    this._send(Events.STATE, { param: { statelist: [{
      uuid, key, actionid, type: 1, data,
      textData: text || '', showtext: !!text
    }]}});
  }

  setPathIcon(context, path, text) {
    const { uuid, key, actionid } = this.decodeContext(context);
    this._send(Events.STATE, { param: { statelist: [{
      uuid, key, actionid, type: 2, path,
      textData: text || '', showtext: !!text
    }]}});
  }

  // ── Hilfsmethoden ─────────────────────────────────────────────────────────

  toast(msg)            { this._send(Events.TOAST, { msg }); }
  openUrl(url, local, param)       { this._send(Events.OPENURL,  { url, local: !!local, param: param || null }); }
  selectFileDialog(filter)         { this._send(Events.SELECTDIALOG, { type: 'file', filter }); }
  selectFolderDialog()             { this._send(Events.SELECTDIALOG, { type: 'folder' }); }

  // ── Event-Listener ─────────────────────────────────────────────────────────

  onConnected(fn)       { this.on(Events.CONNECTED,      jsn => fn(jsn)); return this; }
  onClose(fn)           { this.on(Events.CLOSE,          jsn => fn(jsn)); return this; }
  onError(fn)           { this.on(Events.ERROR,          jsn => fn(jsn)); return this; }
  onAdd(fn)             { this.on(Events.ADD,            jsn => fn(jsn)); return this; }
  onParamFromApp(fn)    { this.on(Events.PARAMFROMAPP,   jsn => fn(jsn)); return this; }
  onParamFromPlugin(fn) { this.on(Events.PARAMFROMPLUGIN,jsn => fn(jsn)); return this; }
  onRun(fn)             { this.on(Events.RUN,            jsn => fn(jsn)); return this; }
  onSetActive(fn)       { this.on(Events.SETACTIVE,      jsn => fn(jsn)); return this; }
  onClear(fn)           { this.on(Events.CLEAR,          jsn => fn(jsn)); return this; }
  onSelectdialog(fn)    { this.on(Events.SELECTDIALOG,   jsn => fn(jsn)); return this; }
}

const $UD = new UlanziStreamDeck();
