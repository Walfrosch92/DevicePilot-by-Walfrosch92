/**
 * IconRenderer.js
 *
 * Erstellt Button-Icons zur Laufzeit auf einem HTML5-Canvas.
 * Alle Icons werden als Base64-PNG-String zurückgegeben und per
 * $UD.setBaseDataIcon() auf die Buttons gesetzt.
 *
 * Auflösung: 72×72 Pixel (Ulanzi D200 Standard)
 */

class IconRenderer {
  constructor(size = 72) {
    this.size   = size;
    this.canvas = document.createElement('canvas');
    this.canvas.width  = size;
    this.canvas.height = size;
    this.ctx    = this.canvas.getContext('2d');
  }

  // ── Hintergrund ────────────────────────────────────────────────────────────

  _clear(bg = '#282828') {
    this.ctx.clearRect(0, 0, this.size, this.size);
    this.ctx.fillStyle = bg;
    this.ctx.beginPath();
    this.ctx.roundRect(0, 0, this.size, this.size, 10);
    this.ctx.fill();
  }

  // ── Text zentriert ─────────────────────────────────────────────────────────

  _text(text, y, color = '#ffffff', size = 11, weight = 'normal') {
    this.ctx.fillStyle   = color;
    this.ctx.font        = `${weight} ${size}px 'Segoe UI', sans-serif`;
    this.ctx.textAlign   = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText(text, this.size / 2, y);
  }

  // ── Großes Emoji/Symbol ────────────────────────────────────────────────────

  _icon(emoji, y = 30) {
    this.ctx.font        = '28px sans-serif';
    this.ctx.textAlign   = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText(emoji, this.size / 2, y);
  }

  // ── Status-Balken (unten) ─────────────────────────────────────────────────

  _statusBar(color) {
    this.ctx.fillStyle    = color;
    this.ctx.beginPath();
    this.ctx.roundRect(6, this.size - 8, this.size - 12, 4, 2);
    this.ctx.fill();
  }

  // ── Export ─────────────────────────────────────────────────────────────────

  toBase64() {
    return this.canvas.toDataURL('image/png').split(',')[1];
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Öffentliche Icon-Methoden
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Audio-Output-Icon: Lautsprecher + Gerätename
   * @param {string} name   - Kurzname des Geräts
   * @param {boolean} active - Ob dies das aktive Standardgerät ist
   */
  renderAudioOutput(name, active = true) {
    this._clear(active ? '#1a2a3a' : '#282828');
    this._icon('🔊', 28);
    const short = this._shorten(name, 10);
    this._text(short, 52, active ? '#4a9eff' : '#888', 10);
    if (active) this._statusBar('#4a9eff');
    return this.toBase64();
  }

  /**
   * Mikrofon-Icon: aktiv oder stummgeschaltet
   * @param {string}  name  - Kurzname des Geräts
   * @param {boolean} muted - Ob das Mikrofon stummgeschaltet ist
   */
  renderMicrophone(name, muted = false) {
    this._clear(muted ? '#2a1a1a' : '#1a2a1a');
    this._icon(muted ? '🔇' : '🎤', 28);
    const short = this._shorten(name, 10);
    this._text(short, 52, muted ? '#e05252' : '#52c252', 10);
    this._statusBar(muted ? '#e05252' : '#52c252');
    return this.toBase64();
  }

  /**
   * Kamera-Icon: aktiv oder deaktiviert
   * @param {string}  name     - Kurzname der Kamera
   * @param {boolean} disabled - Ob die Kamera deaktiviert ist
   */
  renderCamera(name, disabled = false) {
    this._clear(disabled ? '#2a1a1a' : '#1a1a2a');
    this._icon(disabled ? '📷' : '🎥', 28);
    if (disabled) {
      // Durchgestrichen
      this.ctx.strokeStyle = '#e05252';
      this.ctx.lineWidth   = 2.5;
      this.ctx.beginPath();
      this.ctx.moveTo(16, 16);
      this.ctx.lineTo(56, 44);
      this.ctx.stroke();
    }
    const short = this._shorten(name, 10);
    this._text(short, 52, disabled ? '#e05252' : '#a0a0ff', 10);
    this._statusBar(disabled ? '#e05252' : '#a0a0ff');
    return this.toBase64();
  }

  /**
   * Lade-/Fehler-Icon
   */
  renderLoading(msg = 'Laden...') {
    this._clear();
    this._icon('⏳', 28);
    this._text(msg, 52, '#888', 10);
    return this.toBase64();
  }

  renderError(msg = 'Fehler') {
    this._clear('#2a1a1a');
    this._icon('⚠️', 28);
    this._text(msg, 52, '#e05252', 10);
    this._statusBar('#e05252');
    return this.toBase64();
  }

  // ── Hilfsfunktion ─────────────────────────────────────────────────────────

  _shorten(str, maxLen) {
    if (!str) return '';
    return str.length > maxLen ? str.substring(0, maxLen - 1) + '…' : str;
  }
}

// Singleton
const iconRenderer = new IconRenderer(72);
