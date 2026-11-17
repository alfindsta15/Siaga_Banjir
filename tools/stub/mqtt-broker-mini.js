// Broker MQTT 3.1.1 MINI untuk uji (BUKAN pengganti Mosquitto/HiveMQ). Mendukung: CONNECT (cek user/sandi bila diatur),
// SUBSCRIBE dengan wildcard + dan #, PUBLISH QoS 0/1, retained, pesan wasiat (LWT), PING, DISCONNECT.
// Dipakai: tools/uji_mqtt.js. Bisa juga dijalankan sendiri:  node tools/stub/mqtt-broker-mini.js 1883 [user] [sandi]
const net = require('net');
function match(filter, topic) {
  const f = filter.split('/'), t = topic.split('/');
  for (let i = 0; i < f.length; i++) { if (f[i] === '#') return true; if (i >= t.length) return false; if (f[i] !== '+' && f[i] !== t[i]) return false; }
  return f.length === t.length;
}
function start(port, creds, host) {
  const clients = new Set(), retained = new Map(), log = [];
  const rl = n => { const o = []; do { let d = n % 128; n = Math.floor(n / 128); if (n) d |= 128; o.push(d); } while (n); return Buffer.from(o); };
  const str = s => { const b = Buffer.from(s); return Buffer.concat([Buffer.from([b.length >> 8, b.length & 255]), b]); };
  const pub = (topic, payload, retain) => Buffer.concat([Buffer.from([0x30 | (retain ? 1 : 0)]), rl(2 + Buffer.byteLength(topic) + payload.length), str(topic), payload]);
  function route(topic, payload, retain) {
    log.push({ topic, payload: payload.toString() });
    if (retain) { if (payload.length) retained.set(topic, payload); else retained.delete(topic); }
    for (const c of clients) if (c.subs.some(f => match(f, topic))) c.sock.write(pub(topic, payload, false));
  }
  const srv = net.createServer(sock => {
    const c = { sock, subs: [], will: null, ok: false }; let buf = Buffer.alloc(0);
    sock.on('error', () => {});
    sock.on('close', () => { clients.delete(c); if (c.will && c.ok && !c.clean) route(c.will.topic, c.will.payload, c.will.retain); });
    sock.on('data', d => {
      buf = Buffer.concat([buf, d]);
      for (;;) {
        if (buf.length < 2) return; let m = 1, len = 0, i = 1, b;
        do { if (i >= buf.length) return; b = buf[i++]; len += (b & 127) * m; m *= 128; } while (b & 128);
        if (buf.length < i + len) return; const first = buf[0], body = buf.subarray(i, i + len); buf = buf.subarray(i + len);
        const type = first >> 4;
        if (type === 1) {   // CONNECT
          let p = 0; const rs = () => { const l = body.readUInt16BE(p); p += 2; const s = body.toString('utf8', p, p + l); p += l; return s; };
          rs(); p += 1; const flags = body[p++]; p += 2; c.id = rs(); let will = null;
          if (flags & 4) { const topic = rs(); const l = body.readUInt16BE(p); p += 2; will = { topic, payload: body.subarray(p, p + l), retain: !!(flags & 0x20) }; p += l; }
          const user = flags & 0x80 ? rs() : '', pass = flags & 0x40 ? rs() : '';
          if (creds && (user !== creds.user || pass !== creds.pass)) { sock.write(Buffer.from([0x20, 2, 0, 5])); sock.end(); return; }
          c.ok = true; c.will = will; clients.add(c); sock.write(Buffer.from([0x20, 2, 0, 0]));
        } else if (!c.ok) { sock.destroy(); return; }
        else if (type === 3) {   // PUBLISH
          const qos = (first >> 1) & 3; let p = 0; const tl = body.readUInt16BE(0); p = 2; const topic = body.toString('utf8', p, p + tl); p += tl;
          if (qos) { sock.write(Buffer.from([0x40, 2, body[p], body[p + 1]])); p += 2; }
          route(topic, body.subarray(p), !!(first & 1));
        } else if (type === 8) {   // SUBSCRIBE
          const pid = body.subarray(0, 2); let p = 2; const rc = [];
          while (p < body.length) { const l = body.readUInt16BE(p); p += 2; const f = body.toString('utf8', p, p + l); p += l; p += 1; c.subs.push(f); rc.push(0); for (const [t, pl] of retained) if (match(f, t)) sock.write(pub(t, pl, true)); }
          sock.write(Buffer.concat([Buffer.from([0x90, 2 + rc.length]), pid, Buffer.from(rc)]));
        } else if (type === 12) sock.write(Buffer.from([0xd0, 0]));
        else if (type === 14) { c.clean = true; sock.end(); }
      }
    });
  });
  return new Promise(ok => srv.listen(port || 0, host || '127.0.0.1', () => ok({ port: srv.address().port, log, retained, close: () => { for (const c of clients) c.sock.destroy(); srv.close(); } })));
}
module.exports = { start };
if (require.main === module) { const [port, user, pass] = process.argv.slice(2); start(+port || 1883, user ? { user, pass: pass || '' } : null, '0.0.0.0').then(b => console.log('Broker mini aktif di port ' + b.port + ' (semua antarmuka jaringan)' + (user ? ', user/sandi diperiksa' : ', tanpa autentikasi') + '. Biarkan jendela ini terbuka; Ctrl+C untuk berhenti.')); }
