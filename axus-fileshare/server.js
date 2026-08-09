'use strict';

require('dotenv').config();

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const cookieSession = require('cookie-session');
const multer = require('multer');

const Store = require('./lib/store');
const views = require('./lib/views');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const PORT = parseInt(process.env.PORT || '3210', 10);
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const SESSION_SECRET =
  process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const MAX_UPLOAD_MB = parseInt(process.env.MAX_UPLOAD_MB || '0', 10); // 0 = unlimited
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const BASE_URL = (process.env.BASE_URL || '').replace(/\/$/, ''); // optional override

if (!ADMIN_PASSWORD) {
  console.error(
    '\n[FATAL] ADMIN_PASSWORD is not set. Copy .env.example to .env and set a password.\n'
  );
  process.exit(1);
}

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const store = new Store(path.join(DATA_DIR, 'db.json'));

const app = express();
app.set('trust proxy', 1); // behind nginx
app.use(express.urlencoded({ extended: false }));
app.use(
  cookieSession({
    name: 'axfs',
    secret: SESSION_SECRET,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 12 * 60 * 60 * 1000, // 12h
  })
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function baseUrl(req) {
  if (BASE_URL) return BASE_URL;
  return `${req.protocol}://${req.get('host')}`;
}

function statusOf(link) {
  return store.linkStatus(link);
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.admin) return next();
  return res.redirect('/admin/login');
}

function timingSafeEq(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) {
    // still compare to reduce timing signal, then fail
    crypto.timingSafeEqual(ab, ab);
    return false;
  }
  return crypto.timingSafeEqual(ab, bb);
}

function newToken() {
  return crypto.randomBytes(18).toString('base64url'); // ~24 chars, url-safe
}

function newId() {
  return crypto.randomBytes(6).toString('hex');
}

function sanitizeName(name) {
  const base = path.basename(String(name || 'file'));
  const clean = base.replace(/[^a-zA-Z0-9._ ()-]/g, '_').slice(0, 180);
  return clean || 'file';
}

// ---------------------------------------------------------------------------
// Multer (per-token disk storage)
// ---------------------------------------------------------------------------
// No file-size or file-count caps by default. Files stream straight to disk
// (diskStorage), so large uploads don't buffer in memory. Set MAX_UPLOAD_MB in
// .env to reinstate a per-file cap; leave it 0/unset for unlimited.
const uploadLimits = {};
if (MAX_UPLOAD_MB > 0) uploadLimits.fileSize = MAX_UPLOAD_MB * 1024 * 1024;

const upload = multer({
  storage: multer.diskStorage({
    destination(req, file, cb) {
      const dir = path.join(UPLOAD_DIR, req.uploadLink.token);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename(req, file, cb) {
      const safe = sanitizeName(file.originalname);
      const stamp = Date.now() + '-' + crypto.randomBytes(3).toString('hex');
      cb(null, `${stamp}__${safe}`);
    },
  }),
  limits: uploadLimits,
}).array('files'); // no cap on number of files (folder uploads)

// ---------------------------------------------------------------------------
// Public: landing
// ---------------------------------------------------------------------------
app.get('/', (req, res) => {
  res.redirect(req.session && req.session.admin ? '/admin' : '/admin/login');
});

// ---------------------------------------------------------------------------
// Admin auth
// ---------------------------------------------------------------------------
app.get('/admin/login', (req, res) => {
  if (req.session && req.session.admin) return res.redirect('/admin');
  res.send(views.loginPage({}));
});

app.post('/admin/login', (req, res) => {
  const { username, password } = req.body;
  const ok =
    timingSafeEq(username || '', ADMIN_USER) &&
    timingSafeEq(password || '', ADMIN_PASSWORD);
  if (!ok) {
    return res.send(
      views.loginPage({ error: 'Incorrect username or password.', user: username })
    );
  }
  req.session.admin = true;
  res.redirect('/admin');
});

app.get('/admin/logout', (req, res) => {
  req.session = null;
  res.redirect('/admin/login');
});

// ---------------------------------------------------------------------------
// Admin dashboard
// ---------------------------------------------------------------------------
app.get('/admin', requireAdmin, (req, res) => {
  const flash = req.session.flash;
  if (flash) req.session.flash = null;
  res.send(
    views.adminPage({
      links: store.links(),
      baseUrl: baseUrl(req),
      statusOf,
      flash,
      maxUploadMb: MAX_UPLOAD_MB,
    })
  );
});

app.post('/admin/links', requireAdmin, (req, res) => {
  const { label, note, expiresIn, maxUses } = req.body;
  const hours = parseInt(expiresIn, 10);
  const max = parseInt(maxUses, 10);
  const link = {
    id: newId(),
    token: newToken(),
    label: (label || '').trim().slice(0, 120) || 'Untitled link',
    note: (note || '').trim().slice(0, 300),
    createdAt: Date.now(),
    expiresAt: Number.isFinite(hours) && hours > 0 ? Date.now() + hours * 3600 * 1000 : null,
    maxUses: Number.isFinite(max) && max > 0 ? max : null,
    revoked: false,
    uploads: [],
  };
  store.add(link);
  req.session.flash = { type: 'ok', msg: `Link created: ${baseUrl(req)}/u/${link.token}` };
  res.redirect('/admin');
});

app.post('/admin/links/:id/revoke', requireAdmin, (req, res) => {
  const link = store.findById(req.params.id);
  if (link) {
    store.update(link.id, { revoked: true });
    req.session.flash = { type: 'ok', msg: 'Link disabled.' };
  }
  res.redirect('/admin');
});

app.post('/admin/links/:id/enable', requireAdmin, (req, res) => {
  const link = store.findById(req.params.id);
  if (link) {
    store.update(link.id, { revoked: false });
    req.session.flash = { type: 'ok', msg: 'Link enabled.' };
  }
  res.redirect('/admin');
});

app.post('/admin/links/:id/delete', requireAdmin, (req, res) => {
  const link = store.findById(req.params.id);
  if (link) {
    const dir = path.join(UPLOAD_DIR, link.token);
    fs.rm(dir, { recursive: true, force: true }, () => {});
    store.remove(link.id);
    req.session.flash = { type: 'ok', msg: 'Link deleted.' };
  }
  res.redirect('/admin');
});

app.get('/admin/links/:id/edit', requireAdmin, (req, res) => {
  const link = store.findById(req.params.id);
  if (!link) return res.redirect('/admin');
  const flash = req.session.flash;
  if (flash) req.session.flash = null;
  res.send(views.editPage({ link, flash }));
});

app.post('/admin/links/:id/edit', requireAdmin, (req, res) => {
  const link = store.findById(req.params.id);
  if (!link) return res.redirect('/admin');
  const { label, note, expiresIn, maxUses } = req.body;
  const patch = {
    label: (label || '').trim().slice(0, 120) || 'Untitled link',
    note: (note || '').trim().slice(0, 300),
  };
  // Expiry: 'keep' leaves it, 'none' clears it, a number sets hours from now.
  if (expiresIn === 'none') {
    patch.expiresAt = null;
  } else if (expiresIn && expiresIn !== 'keep') {
    const h = parseInt(expiresIn, 10);
    if (Number.isFinite(h) && h > 0) patch.expiresAt = Date.now() + h * 3600 * 1000;
  }
  const max = parseInt(maxUses, 10);
  patch.maxUses = Number.isFinite(max) && max > 0 ? max : null;
  store.update(link.id, patch);
  req.session.flash = { type: 'ok', msg: 'Link updated.' };
  res.redirect('/admin');
});

// Download a received file
app.get('/admin/files/:token/:stored', requireAdmin, (req, res) => {
  const link = store.findByToken(req.params.token);
  if (!link) return res.status(404).send('Not found');
  const up = link.uploads.find((u) => u.storedName === req.params.stored);
  if (!up) return res.status(404).send('Not found');
  const filePath = path.join(UPLOAD_DIR, link.token, up.storedName);
  if (!filePath.startsWith(path.join(UPLOAD_DIR, link.token))) {
    return res.status(400).send('Bad path');
  }
  res.download(filePath, up.originalName);
});

app.post('/admin/files/:token/:stored/delete', requireAdmin, (req, res) => {
  const link = store.findByToken(req.params.token);
  if (link) {
    const up = link.uploads.find((u) => u.storedName === req.params.stored);
    if (up) {
      const filePath = path.join(UPLOAD_DIR, link.token, up.storedName);
      fs.rm(filePath, { force: true }, () => {});
      store.removeUpload(link.token, up.storedName);
      req.session.flash = { type: 'ok', msg: 'File deleted.' };
    }
  }
  res.redirect('/admin');
});

// ---------------------------------------------------------------------------
// Public upload
// ---------------------------------------------------------------------------
app.get('/u/:token', (req, res) => {
  const link = store.findByToken(req.params.token);
  const status = statusOf(link);
  res.send(
    views.uploadPage({
      link: link || { token: req.params.token },
      status,
      baseUrl: baseUrl(req),
      maxUploadMb: MAX_UPLOAD_MB,
    })
  );
});

app.post('/u/:token', (req, res) => {
  const link = store.findByToken(req.params.token);
  const status = statusOf(link);
  if (!status.ok) {
    const map = {
      expired: 'This link has expired.',
      revoked: 'This link has been disabled.',
      maxed: 'This link has reached its file limit.',
      notfound: 'Invalid link.',
    };
    return res.status(403).json({ error: map[status.reason] || 'Link unavailable.' });
  }
  req.uploadLink = link;
  upload(req, res, (err) => {
    if (err) {
      const msg =
        err.code === 'LIMIT_FILE_SIZE' && MAX_UPLOAD_MB > 0
          ? `A file exceeds the ${MAX_UPLOAD_MB} MB limit.`
          : 'Upload failed. Please try again.';
      return res.status(400).json({ error: msg });
    }
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: 'No files were received.' });
    const uploaderName = (req.body.uploaderName || '').toString().trim().slice(0, 120);
    const ip = req.ip;
    for (const f of files) {
      store.addUpload(link.token, {
        storedName: f.filename,
        originalName: f.originalname,
        size: f.size,
        uploaderName,
        uploadedAt: Date.now(),
        ip,
      });
    }
    res.json({ ok: true, count: files.length });
  });
});

// ---------------------------------------------------------------------------
app.use((req, res) => res.status(404).send('Not found'));

app.listen(PORT, () => {
  console.log(`Axus File Share running on http://localhost:${PORT}`);
  console.log(`Data dir: ${DATA_DIR}`);
});
