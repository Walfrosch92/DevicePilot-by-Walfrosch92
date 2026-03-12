/**
 * PersistentShell.js
 *
 * Hält einen einzigen powershell.exe-Prozess dauerhaft offen.
 *
 * Warum -EncodedCommand statt "-Command -":
 *   Mit gepipter stdin liest "-Command -" den GESAMTEN stdin als ein Skript
 *   und wartet auf stdin.end() – kein zeilenweiser REPL-Modus möglich.
 *   Stattdessen: Der Loop-Script läuft via -EncodedCommand, liest Base64-
 *   kodierte Befehle zeilenweise und führt sie via Invoke-Expression aus.
 *
 * Init-Gate:
 *   API-Anfragen werden erst nach Abschluss der C#-Kompilierung ausgeführt.
 *   Dadurch gibt es keine Timeouts durch parallele lange Add-Type Aufrufe.
 */

'use strict';

const { spawn } = require('child_process');

const MARKER   = '__PS_DONE_7F3A9B2C__';
const ERR_PFX  = '__PSERR__:';
const CMD_EXIT = '__PS_EXIT__';

// ── Loop-Skript (wird base64-kodiert via -EncodedCommand übergeben) ───────────
// Liest Base64-kodierte Befehle von stdin, führt sie aus, schreibt Marker.
// Kein Quoting-Problem da -EncodedCommand alle Sonderzeichen korrekt behandelt.
const LOOP_PS = `
$marker = '${MARKER}'
$errPfx = '${ERR_PFX}'
while ($true) {
    $b64 = [Console]::In.ReadLine()
    if ($null -eq $b64 -or $b64 -eq '${CMD_EXIT}') { break }
    $script = [System.Text.Encoding]::Unicode.GetString([System.Convert]::FromBase64String($b64))
    try {
        Invoke-Expression $script
    } catch {
        Write-Output ($errPfx + $_.Exception.Message)
    }
    Write-Output $marker
}
`;

const ENCODED_LOOP = Buffer.from(LOOP_PS, 'utf16le').toString('base64');

class PersistentShell {
  constructor() {
    this._proc      = null;
    this._queue     = [];     // { resolve, reject, timer } – wartende Befehle
    this._outBuf    = '';
    this._errBuf    = '';
    this._initFn    = null;   // Wird nach (Re-)Start aufgerufen (C#-Kompilierung)
    // Init-Gate: API-Anfragen warten bis initialized = true
    this._initialized  = false;
    this._initWaiters  = [];  // Promises die auf Init warten
  }

  // ── Prozess starten ─────────────────────────────────────────────────────────

  _spawn() {
    if (this._proc) return;

    this._initialized = false; // Reset bei (Neu-)Start

    const proc = spawn('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-EncodedCommand', ENCODED_LOOP
    ], {
      stdio:       ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    });

    proc.stdout.setEncoding('utf8');
    proc.stderr.setEncoding('utf8');

    proc.stdout.on('data', chunk => {
      this._outBuf += chunk;
      this._drain();
    });

    proc.stderr.on('data', chunk => {
      this._errBuf += chunk;
    });

    proc.on('exit', code => {
      console.warn(`[Shell] PowerShell beendet (Code ${code ?? 'null'}). Neustart in 2s...`);
      this._proc        = null;
      this._initialized = false;

      // Wartende Befehle abbrechen
      this._queue.splice(0).forEach(item => {
        clearTimeout(item.timer);
        item.reject(new Error('PowerShell-Prozess unerwartet beendet'));
      });

      // Nach Neustart re-initialisieren
      setTimeout(() => {
        this._spawn();
        if (this._initFn) this._initFn().then(() => this._onInitDone());
      }, 2000);
    });

    proc.on('error', err => {
      console.error('[Shell] Spawn-Fehler:', err.message);
    });

    this._proc = proc;

    // Initialisierung (C#-Kompilierung) sofort starten
    if (this._initFn) {
      this._initFn().then(() => this._onInitDone());
    } else {
      this._onInitDone(); // Kein Initialisierer → sofort bereit
    }
  }

  // ── Init-Gate ──────────────────────────────────────────────────────────────

  _onInitDone() {
    this._initialized = true;
    const waiters = this._initWaiters.splice(0);
    waiters.forEach(resolve => resolve());
    console.log('[Shell] Bereit. C# kompiliert oder geladen.');
  }

  _waitForInit() {
    if (this._initialized) return Promise.resolve();
    return new Promise(resolve => this._initWaiters.push(resolve));
  }

  // ── Ausgabe-Demultiplexer ───────────────────────────────────────────────────

  _drain() {
    let idx;
    while ((idx = this._outBuf.indexOf(MARKER)) !== -1) {
      const output = this._outBuf.slice(0, idx).trim();
      // Marker + nachfolgenden Zeilenumbruch (CRLF oder LF) überspringen
      const nl     = this._outBuf.indexOf('\n', idx);
      this._outBuf = nl === -1 ? '' : this._outBuf.slice(nl + 1);

      const item = this._queue.shift();
      if (!item) continue;

      clearTimeout(item.timer);
      const stderr  = this._errBuf.trim();
      this._errBuf  = '';

      if (output.startsWith(ERR_PFX)) {
        item.reject(new Error(output.slice(ERR_PFX.length).trim()));
      } else {
        item.resolve({ output, stderr });
      }
    }
  }

  // ── Befehl senden ─────────────────────────────────────────────────────────

  _send(script, timeoutMs) {
    if (!this._proc) this._spawn();

    return new Promise((resolve, reject) => {
      const item = { resolve, reject, timer: null };

      item.timer = setTimeout(() => {
        const i = this._queue.indexOf(item);
        if (i !== -1) this._queue.splice(i, 1);
        reject(new Error(`PowerShell-Timeout (${timeoutMs / 1000}s)`));
      }, timeoutMs);

      this._queue.push(item);

      // Skript als UTF-16LE Base64 kodieren (PowerShell-natives Format)
      const b64 = Buffer.from(script, 'utf16le').toString('base64');
      this._proc.stdin.write(b64 + '\n');
    });
  }

  // ── Öffentliche API ────────────────────────────────────────────────────────

  /**
   * Registriert eine asynchrone Initialisierungsfunktion.
   * Muss ein Promise zurückgeben. API-Aufrufe warten bis es resolved.
   * @param {() => Promise<void>} fn
   */
  setInitializer(fn) {
    this._initFn = fn;
    if (this._proc) {
      fn().then(() => this._onInitDone());
    }
  }

  /** Startet den Prozess und die Initialisierung. */
  start() {
    this._spawn();
  }

  /**
   * Führt ein PowerShell-Skript aus. Wartet auf Init-Abschluss.
   * @param {string} script
   * @param {number} [timeoutMs=20000]
   * @returns {Promise<string>}
   */
  async run(script, timeoutMs = 20000) {
    await this._waitForInit();
    const { output } = await this._send(script, timeoutMs);
    return output;
  }

  /**
   * Führt ein Skript aus und parst die JSON-Ausgabe.
   * @param {string} script
   * @param {number} [timeoutMs=20000]
   * @returns {Promise<any>}
   */
  async runJson(script, timeoutMs = 20000) {
    const output = await this.run(script, timeoutMs);
    if (!output) return null;
    try {
      return JSON.parse(output);
    } catch {
      throw new Error(`Ungültiges JSON: ${output.slice(0, 300)}`);
    }
  }

  /**
   * Führt einen Befehl OHNE Init-Gate aus (für den Initialisierer selbst).
   * @param {string} script
   * @param {number} [timeoutMs=120000]
   * @returns {Promise<string>}
   */
  async runInit(script, timeoutMs = 120000) {
    if (!this._proc) this._spawn();
    const { output } = await this._send(script, timeoutMs);
    return output;
  }

  /** Schließt den Prozess sauber. */
  close() {
    if (this._proc) {
      try {
        this._proc.stdin.write(CMD_EXIT + '\n');
        this._proc.stdin.end();
      } catch {}
      this._proc = null;
    }
  }
}

// Singleton – eine Shell für den gesamten Bridge-Prozess
module.exports = new PersistentShell();
