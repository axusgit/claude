'use strict';

// Tiny JSON-file datastore. No native deps, safe for a single small app.
// Shape: { links: [ { id, token, label, note, createdAt, expiresAt, maxUses,
//                     revoked, uploads: [ { storedName, originalName, size,
//                     uploaderName, uploadedAt, ip } ] } ] }

const fs = require('fs');
const path = require('path');

class Store {
  constructor(file) {
    this.file = file;
    this.data = { links: [] };
    this._load();
  }

  _load() {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      this.data = JSON.parse(raw);
      if (!Array.isArray(this.data.links)) this.data.links = [];
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      this._save();
    }
  }

  _save() {
    const tmp = this.file + '.tmp';
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file); // atomic replace
  }

  links() {
    return this.data.links;
  }

  findByToken(token) {
    return this.data.links.find((l) => l.token === token) || null;
  }

  findById(id) {
    return this.data.links.find((l) => l.id === id) || null;
  }

  add(link) {
    link.uploads = link.uploads || [];
    this.data.links.unshift(link);
    this._save();
    return link;
  }

  remove(id) {
    const before = this.data.links.length;
    this.data.links = this.data.links.filter((l) => l.id !== id);
    if (this.data.links.length !== before) this._save();
    return before !== this.data.links.length;
  }

  update(id, patch) {
    const link = this.findById(id);
    if (!link) return null;
    Object.assign(link, patch);
    this._save();
    return link;
  }

  addUpload(token, upload) {
    const link = this.findByToken(token);
    if (!link) return null;
    link.uploads.push(upload);
    this._save();
    return upload;
  }

  removeUpload(token, storedName) {
    const link = this.findByToken(token);
    if (!link) return null;
    link.uploads = link.uploads.filter((u) => u.storedName !== storedName);
    this._save();
    return link;
  }

  // Returns { ok, reason } for whether a token may currently receive uploads.
  linkStatus(link) {
    if (!link) return { ok: false, reason: 'notfound' };
    if (link.revoked) return { ok: false, reason: 'revoked' };
    if (link.expiresAt && Date.now() > link.expiresAt) {
      return { ok: false, reason: 'expired' };
    }
    if (link.maxUses && link.uploads.length >= link.maxUses) {
      return { ok: false, reason: 'maxed' };
    }
    return { ok: true };
  }
}

module.exports = Store;
