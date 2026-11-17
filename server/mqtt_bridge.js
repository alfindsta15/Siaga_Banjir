'use strict';
// SIAGA BANJIR - jembatan MQTT (tanpa dependensi, Node >= 18)
// Alat memublikasikan telemetri ke   <prefix>/<id>/telemetry
// Server membalas perintah ke        <prefix>/<id>/cmd      (isi sama dengan balasan HTTP /api/device/telemetry)
// Alat melapor hasil pindai Wi-Fi ke  <prefix>/<id>/wifi   (daftar jaringan untuk dashboard)
// Alat memberi tahu hidup/mati lewat <prefix>/<id>/status   ("online"/"offline", offline = pesan wasiat broker)
// Klien MQTT 3.1.1 minimal: CONNECT (user/sandi), SUBSCRIBE, PUBLISH QoS 0/1 (menerima), PING, sambung ulang otomatis, TLS (mqtts://).
const net = require('net'), tls = require('tls');

const ID_OK = /^[A-Za-z0-9_-]{1,40}$/;

// ---------- pengkodean paket ----------
const str = s => { const b = Buffer.from(s, 'utf8'); return Buffer.concat([Buffer.from([b.length >> 8, b.length & 255]), b]); };
function remLen(n) { const o = []; do { let d = n % 128; n = Math.floor(n / 128); if (n > 0) d |= 128; o.push(d); } while (n > 0); return Buffer.from(o); }
const pkt = (first, body) => Buffer.concat([Buffer.from([first]), remLen(body.length), body]);
function connectPkt(clientId, user, pass, keepalive) {
  let flags = 0x02; if (user) flags |= 0x80; if (user && pass) flags |= 0x40;   // clean session + user + sandi
  const parts = [Buffer.from([0, 4, 0x4d, 0x51, 0x54, 0x54, 4, flags, keepalive >> 8, keepalive & 255]), str(clientId)];
  if (user) parts.push(str(user)); if (user && pass) parts.push(str(pass));
  return pkt(0x10, Buffer.concat(parts));
}
const subscribePkt = (pid, filter) => pkt(0x82, Buffer.concat([Buffer.from([pid >> 8, pid & 255]), str(filter), Buffer.from([0])]));
const publishPkt = (topic, payload) => pkt(0x30, Buffer.concat([str(topic), Buffer.from(payload)]));   // QoS 0, tidak retained

// Pengurai aliran byte -> paket utuh (paket bisa terpotong atau bergabung di TCP)
function makeParser(onPacket) {
  let buf = Buffer.alloc(0);
  return chunk => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      if (buf.length < 2) return;
      let mult = 1, len = 0, i = 1, b;
      do { if (i >= buf.length) return; b = buf[i++]; len += (b & 127) * mult; mult *= 128; if (mult > 128 * 128 * 128 * 128) throw new Error('panjang paket tidak valid'); } while (b & 128);
      if (len > 65536) throw new Error('paket terlalu besar');
      if (buf.length < i + len) return;
      onPacket(buf[0], buf.subarray(i, i + len)); buf = buf.subarray(i + len);
    }
  };
}

function create(o) {
  const E = o.env || {}, log = o.log || (() => {});
  const url = E.MQTT_URL || '', prefix = (E.MQTT_PREFIX || 'siaga').replace(/^\/+|\/+$/g, '') || 'siaga';
  const st = { enabled: !!url, connected: false, host: '', last: 0, rx: 0, rejected: 0, error: '', devices: {} };
  let sock = null, timer = null, ping = null, stopped = false, tries = 0, pid = 1, u = null, lastErr = '', badKey = 0;
  if (!url) return { info: () => ({ enabled: false }), start() {}, stop() {}, push() {}, prefix };
  try { u = new URL(url); } catch (e) { st.error = 'MQTT_URL tidak valid'; }
  if (u && !/^mqtts?:$/.test(u.protocol)) { st.error = 'MQTT_URL harus diawali mqtt:// atau mqtts://'; u = null; }
  if (u) st.host = u.hostname + ':' + (u.port || (u.protocol === 'mqtts:' ? 8883 : 1883));
  const user = E.MQTT_USER || (u && decodeURIComponent(u.username)) || '', pass = E.MQTT_PASS || (u && decodeURIComponent(u.password)) || '';

  const send = b => { try { if (sock && !sock.destroyed) sock.write(b); } catch (e) {} };
  const warn = t => { if (t !== lastErr) { lastErr = t; log('mqtt', t); } st.error = t; };

  async function onMessage(topic, payload) {
    const m = topic.split('/'); if (m.length < 3 || m.slice(0, -2).join('/') !== prefix) return;
    const id = m[m.length - 2], kind = m[m.length - 1];
    if (!ID_OK.test(id)) return;
    if (kind === 'status') { const s = payload.toString('utf8').trim().slice(0, 20); if (st.devices[id] !== s) { st.devices[id] = s; log('mqtt', `Alat ${id}: ${s}`); } return; }
    if (kind !== 'telemetry' && kind !== 'wifi') return;
    let b; try { b = JSON.parse(payload.toString('utf8')); } catch (e) { st.rejected++; return; }
    if (!b || typeof b !== 'object' || Array.isArray(b)) { st.rejected++; return; }
    // kunci alat sama dengan yang dipakai HTTP; dibuang dari data sebelum diproses/disimpan
    const key = String(b.key || ''); delete b.key;
    if (!o.checkDev(key) || String(b.id || '') !== id) { st.rejected++; if (++badKey === 1 || badKey % 50 === 0) log('mqtt', `Telemetri ditolak (kunci alat salah atau ID tidak cocok dengan topik "${id}")`); return; }
    badKey = 0;
    if (kind === 'wifi') { try { o.handleWifi && o.handleWifi(b); } catch (e) { log('error', 'MQTT: ' + e.message); } return; }   // daftar Wi-Fi hasil pindai: tanpa balasan
    st.last = Date.now(); st.rx++;
    let reply; try { reply = await o.handle({ ...b, _ip: 'mqtt' }); } catch (e) { log('error', 'MQTT: ' + e.message); return; }
    send(publishPkt(`${prefix}/${id}/cmd`, JSON.stringify(reply)));
  }

  function onPacket(first, body) {
    const type = first >> 4;
    if (type === 2) {   // CONNACK
      const rc = body[1];
      if (rc !== 0) { const why = { 1: 'versi protokol ditolak', 2: 'ID klien ditolak', 3: 'broker tidak tersedia', 4: 'user/sandi salah', 5: 'tidak diizinkan (user/sandi salah atau tanpa izin)' }[rc] || 'kode ' + rc; warn(`Broker menolak sambungan: ${why}. Periksa MQTT_USER dan MQTT_PASS.`); try { sock.destroy(); } catch (e) {} return; }
      st.connected = true; tries = 0; st.error = ''; lastErr = ''; log('mqtt', `Tersambung ke broker ${st.host}, topik ${prefix}/+/telemetry`);
      send(subscribePkt(pid++ & 0xffff || 1, `${prefix}/+/telemetry`)); send(subscribePkt(pid++ & 0xffff || 1, `${prefix}/+/status`)); send(subscribePkt(pid++ & 0xffff || 1, `${prefix}/+/wifi`));
    } else if (type === 3) {   // PUBLISH masuk
      const qos = (first >> 1) & 3; let p = 0; const tl = body.readUInt16BE(0); p = 2;
      const topic = body.toString('utf8', p, p + tl); p += tl;
      if (qos > 0) { const id = body.readUInt16BE(p); p += 2; if (qos === 1) send(pkt(0x40, Buffer.from([id >> 8, id & 255]))); else return; }
      onMessage(topic, body.subarray(p)).catch(e => log('error', 'MQTT: ' + e.message));
    }
    // SUBACK (9), PINGRESP (13): tidak perlu ditangani
  }

  function connect() {
    if (stopped || !u) return;
    const port = +u.port || (u.protocol === 'mqtts:' ? 8883 : 1883), parse = makeParser(onPacket);
    const s = u.protocol === 'mqtts:' ? tls.connect({ host: u.hostname, port, servername: u.hostname }) : net.connect({ host: u.hostname, port });
    sock = s; s.setNoDelay(true); s.setTimeout(30000, () => s.destroy());
    s.on(u.protocol === 'mqtts:' ? 'secureConnect' : 'connect', () => { s.setTimeout(0); send(connectPkt(`siaga-server-${process.pid}-${Math.random().toString(16).slice(2, 8)}`, user, pass, 30)); });
    s.on('data', d => { try { parse(d); } catch (e) { warn('Paket MQTT rusak: ' + e.message); s.destroy(); } });
    s.on('error', e => warn(`Tidak bisa tersambung ke broker ${st.host}: ${e.code || e.message}`));
    s.on('close', () => {
      if (sock === s) { if (st.connected) log('mqtt', 'Sambungan ke broker terputus, mencoba lagi'); st.connected = false; sock = null; }
      clearInterval(ping); if (!stopped) { tries++; timer = setTimeout(connect, Math.min(30000, 1000 * 2 ** Math.min(tries, 5))); }
    });
    clearInterval(ping); ping = setInterval(() => send(Buffer.from([0xc0, 0])), 15000);
  }
  return {
    prefix,
    push(id, obj) { if (st.connected && ID_OK.test(String(id || ''))) send(publishPkt(`${prefix}/${id}/cmd`, JSON.stringify(obj))); },
    start() { if (st.error) { warn(st.error); return; } stopped = false; connect(); },
    stop() { stopped = true; clearTimeout(timer); clearInterval(ping); try { send(Buffer.from([0xe0, 0])); sock && sock.end(); } catch (e) {} st.connected = false; },
    info: () => ({ ...st, prefix, devices: { ...st.devices } })
  };
}
module.exports = { create, connectPkt, subscribePkt, publishPkt, makeParser, ID_OK };
