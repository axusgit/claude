'use strict';

// Tiny JSON-file datastore. No native deps, safe for a single small app.
// Shape: {
//   links: [ { id, token, label, note, createdAt, expiresAt, maxUses,
//              revoked, uploads: [ { storedName, originalName, size,
//              uploaderName, uploadedAt, ip } ] } ],           // inbound (people upload TO admin)
//   sends: [ { id, token, label, note, createdAt, expiresAt, maxDownloads,
//              revoked, downloadCount, files: [ { storedName, originalName,
//              size, addedAt } ] } ],                          // outbound (admin shares files OUT)
// }

const fs = require('fs');
const path = require('path');

class Store {
  constructor(file) {
    this.file = file;
    this.data = { links: [], sends: [] };
    this._load();
  }

  _load() {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      this.data = JSON.parse(raw);
      if (!Array.isArray(this.data.links)) this.data.links = [];
      if (!Array.isArray(this.data.sends)) this.data.sends = [];
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

  // --- Outbound "send" (download) links -----------------------------------
  sends() {
    return this.data.sends;
  }

  findSendByToken(token) {
    return this.data.sends.find((s) => s.token === token) || null;
  }

  findSendById(id) {
    return this.data.sends.find((s) => s.id === id) || null;
  }

  addSend(send) {
    send.files = send.files || [];
    send.downloadCount = send.downloadCount || 0;
    this.data.sends.unshift(send);
    this._save();
    return send;
  }

  removeSend(id) {
    const before = this.data.sends.length;
    this.data.sends = this.data.sends.filter((s) => s.id !== id);
    if (this.data.sends.length !== before) this._save();
    return before !== this.data.sends.length;
  }

  updateSend(id, patch) {
    const send = this.findSendById(id);
    if (!send) return null;
    Object.assign(send, patch);
    this._save();
    return send;
  }

  incrementSendDownload(token) {
    const send = this.findSendByToken(token);
    if (!send) return null;
    send.downloadCount = (send.downloadCount || 0) + 1;
    this._save();
    return send;
  }

  // Returns { ok, reason } for whether a token may currently be downloaded.
  sendStatus(send) {
    if (!send) return { ok: false, reason: 'notfound' };
    if (send.revoked) return { ok: false, reason: 'revoked' };
    if (send.expiresAt && Date.now() > send.expiresAt) {
      return { ok: false, reason: 'expired' };
    }
    if (send.maxDownloads && (send.downloadCount || 0) >= send.maxDownloads) {
      return { ok: false, reason: 'maxed' };
    }
    return { ok: true };
  }
}

module.exports = Store;
