'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Penyimpanan JSON sederhana (tanpa dependensi tambahan).
 * Menulis lewat file sementara lalu rename supaya data tidak rusak
 * kalau aplikasi tertutup tepat saat menyimpan.
 */
class Store {
  constructor(filePath) {
    this.filePath = filePath;
    this._timer = null;
    this._pending = null;
  }

  load() {
    try {
      const text = fs.readFileSync(this.filePath, 'utf8');
      return JSON.parse(text);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        // File rusak: simpan salinannya agar data tidak hilang diam-diam.
        try {
          fs.copyFileSync(this.filePath, this.filePath + '.rusak-' + Date.now());
        } catch (_) {
          /* abaikan */
        }
      }
      return null;
    }
  }

  /** Jadwalkan simpan (debounce) supaya tidak menulis disk tiap detik. */
  save(data) {
    this._pending = data;
    if (this._timer) return;
    this._timer = setTimeout(() => {
      this._timer = null;
      this.flush();
    }, 500);
  }

  flush() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    if (!this._pending) return;
    const data = this._pending;
    this._pending = null;
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const tmp = this.filePath + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
      fs.renameSync(tmp, this.filePath);
    } catch (err) {
      console.error('Gagal menyimpan data:', err);
    }
  }
}

module.exports = { Store };
