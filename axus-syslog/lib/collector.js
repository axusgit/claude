'use strict';

const dgram = require('dgram');
const { EventEmitter } = require('events');
const { parse } = require('./parser');
const db = require('./db');
const alerts = require('./alerts');
const devices = require('./devices');

// UDP syslog collector. Receives datagrams, parses them, buffers them for the DB,
// and emits a 'message' event so the web layer can push live-tail updates.

class Collector extends EventEmitter {
  constructor({ port = 514, bind = '0.0.0.0', flushMs = 400 } = {}) {
    super();
    this.port = port;
    this.bind = bind;
    this.flushMs = flushMs;
    this.received = 0;
    this.lastMessageTs = Date.now(); // for the silence watchdog (grace at startup)
    this.socket = null;
    this.flushTimer = null;
  }

  start() {
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    this.socket = socket;
    this.lastMessageTs = Date.now();

    socket.on('message', (buf, rinfo) => {
      const now = Date.now();
      let row;
      try {
        row = parse(buf.toString('utf8'), rinfo.address, now);
      } catch (err) {
        row = {
          ts: now, eventTs: null, sourceIp: rinfo.address, host: null,
          facility: 1, severity: 5, app: null, procid: null, msgid: null,
          message: buf.toString('utf8'), raw: buf.toString('utf8'),
        };
      }
      this.received++;
      this.lastMessageTs = now;
      db.enqueue(row);
      // Keyword alerts (e.g. "No Service") — never let this break ingest.
      try { alerts.maybeAlert(row); } catch (err) { console.error('[collector] alert error:', err.message); }
      // Per-device dead-man: stamp last-seen for any monitored device this matches.
      try { devices.observe(row); } catch (err) { console.error('[collector] device observe error:', err.message); }
      // Only fan out to live-tail listeners when someone is watching.
      if (this.listenerCount('message') > 0) this.emit('message', row);
    });

    socket.on('error', (err) => {
      console.error('[collector] socket error:', err.message);
      this.emit('sock-error', err);
    });

    socket.on('listening', () => {
      const a = socket.address();
      console.log(`[collector] listening for syslog on udp://${a.address}:${a.port}`);
    });

    socket.bind(this.port, this.bind);

    // Periodic flush of the write buffer.
    this.flushTimer = setInterval(() => {
      try {
        db.flush();
      } catch (err) {
        console.error('[collector] flush error:', err.message);
      }
    }, this.flushMs);
    this.flushTimer.unref();
  }

  stop() {
    if (this.flushTimer) clearInterval(this.flushTimer);
    try { db.flush(); } catch (_) { /* ignore */ }
    if (this.socket) this.socket.close();
  }
}

module.exports = { Collector };
