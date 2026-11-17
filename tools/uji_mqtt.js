// Uji MQTT end-to-end tanpa internet:  node tools/uji_mqtt.js   atau   npm run uji:mqtt
// Broker mini (tools/stub) + server asli + "alat" tiruan yang memakai paket MQTT yang dikodekan sendiri (bukan kode server).
const net = require('net'), path = require('path');
const { startServer, client, sleep, reporter } = require('./uji_lib');
const broker = require('./stub/mqtt-broker-mini'), bridge = require('../server/mqtt_bridge');

const S_ = s => { const b = Buffer.from(s); return Buffer.concat([Buffer.from([b.length >> 8, b.length & 255]), b]); };
const RL = n => { const o = []; do { let d = n % 128; n = Math.floor(n / 128); if (n) d |= 128; o.push(d); } while (n); return Buffer.from(o); };
const P = (f, b) => Buffer.concat([Buffer.from([f]), RL(b.length), b]);

// "Alat" tiruan: seperti PubSubClient di ESP8266 (dengan pesan wasiat retained di <prefix>/<id>/status)
function fakeDevice(port, id, user, pass) {
  const d = { got: [], sock: net.connect(port, '127.0.0.1'), ready: null }; let buf = Buffer.alloc(0), connack;
  d.ready = new Promise(ok => { connack = ok; });
  const will = { t: `siaga/${id}/status`, m: 'offline' };
  d.sock.on('connect', () => d.sock.write(P(0x10, Buffer.concat([Buffer.from([0, 4, 0x4d, 0x51, 0x54, 0x54, 4, 0x02 | 0x04 | 0x20 | 0x80 | 0x40, 0, 15]), S_('esp-' + id), S_(will.t), Buffer.concat([Buffer.from([0, will.m.length]), Buffer.from(will.m)]), S_(user), S_(pass)]))));
  d.sock.on('error', () => {});
  d.sock.on('data', x => {
    buf = Buffer.concat([buf, x]);
    while (buf.length >= 2) {
      let m = 1, len = 0, i = 1, b; do { b = buf[i++]; len += (b & 127) * m; m *= 128; } while (b & 128);
      if (buf.length < i + len) break; const first = buf[0], body = buf.subarray(i, i + len); buf = buf.subarray(i + len);
      if (first >> 4 === 2) connack(body[1]);
      if (first >> 4 === 3) { const tl = body.readUInt16BE(0), topic = body.toString('utf8', 2, 2 + tl); let j = null; try { j = JSON.parse(body.toString('utf8', 2 + tl)); } catch (e) {} d.got.push({ topic, json: j }); }
    }
  });
  d.sub = t => d.sock.write(P(0x82, Buffer.concat([Buffer.from([0, 1]), S_(t), Buffer.from([0])])));
  d.pub = (t, payload, retain) => d.sock.write(P(0x30 | (retain ? 1 : 0), Buffer.concat([S_(t), Buffer.from(typeof payload === 'string' ? payload : JSON.stringify(payload))])));
  d.cmds = () => d.got.filter(g => g.topic === `siaga/${id}/cmd`).map(g => g.json);
  d.wait = async (n, ms) => { for (let i = 0; i < ms / 25 && d.cmds().length < n; i++) await sleep(25); return d.cmds().length >= n; };
  return d;
}

(async () => {
  const R = reporter(), t = R.t;

  console.log('== Paket MQTT (kodekan sendiri, vektor baku MQTT 3.1.1) ==');
  t('CONNECT klien "a" tanpa user = vektor baku', bridge.connectPkt('a', '', '', 60).toString('hex') === '100d00044d5154540402003c000161');
  t('PUBLISH QoS0 "a/b" "hi" = vektor baku', bridge.publishPkt('a/b', 'hi').toString('hex') === '30070003612f626869');
  const got = []; const feed = bridge.makeParser((f, b) => got.push([f, b.toString('hex')]));
  const big = bridge.publishPkt('siaga/x/cmd', 'z'.repeat(300)), small = bridge.publishPkt('a/b', 'hi'), all = Buffer.concat([big, small]);
  for (let i = 0; i < all.length; i += 7) feed(all.subarray(i, i + 7));   // dipotong-potong 7 byte (TCP bisa memotong paket)
  t('pengurai: paket besar (panjang 2 byte) dan kecil, dipotong 7 byte, keluar utuh', got.length === 2 && got[0][0] === 0x30 && got[0][1].length / 2 === big.length - 3 && got[1][1] === small.subarray(2).toString('hex'), JSON.stringify(got.map(g => g[1].length)));
  const got2 = []; bridge.makeParser((f, b) => got2.push(f))(Buffer.concat([small, small, small]));
  t('pengurai: tiga paket menempel dalam satu potongan terbaca semua', got2.length === 3);

  console.log('== Server tersambung ke broker ==');
  const B = await broker.start(0, { user: 'srv', pass: 'sandi-broker' });
  const S = await startServer(null, { env: { MQTT_URL: `mqtt://127.0.0.1:${B.port}`, MQTT_USER: 'srv', MQTT_PASS: 'sandi-broker', MQTT_PREFIX: 'siaga' } });
  const c = client(S.base); await c.login();
  for (let i = 0; i < 80 && !/Tersambung ke broker/.test(S.log()); i++) await sleep(50);
  t('server melapor tersambung ke broker', /Tersambung ke broker/.test(S.log()), S.log().slice(-300));
  let h = (await c.get('/api/admin/health')).json;
  t('health: mqtt aktif, tersambung, host tanpa user/sandi', h.mqtt && h.mqtt.enabled && h.mqtt.connected && h.mqtt.host === `127.0.0.1:${B.port}` && !JSON.stringify(h.mqtt).includes('sandi-broker'), JSON.stringify(h.mqtt));
  await c.post('/api/admin/config', { base: 200, waspada: 50, siaga: 90, awas: 120 });

  console.log('== Alat -> broker -> server -> broker -> alat ==');
  const dev = fakeDevice(B.port, 'maket-01', 'srv', 'sandi-broker'); t('alat tiruan diterima broker', (await dev.ready) === 0);
  dev.sub('siaga/maket-01/cmd'); dev.pub('siaga/maket-01/status', 'online', true); await sleep(150);
  const tele = (o = {}) => dev.pub('siaga/maket-01/telemetry', { id: 'maket-01', key: 'kunci-alat-uji-123', rssi: -50, fw: '2.9-tinwall', up: 10, pump: 0, base: 200, dist: 200, ...o });
  tele(); t('server membalas lewat <prefix>/<id>/cmd', await dev.wait(1, 2000));
  let cmd = dev.cmds()[0] || {};
  t('balasan: ok, mode OFF, kalibrasi (cfg.base 200, awas 120) dan level', cmd.ok === true && cmd.pump_mode === 'OFF' && cmd.pump === 0 && cmd.cfg && cmd.cfg.base === 200 && cmd.cfg.awas === 120 && cmd.level === 0, JSON.stringify(cmd));
  let st = (await c.get('/api/admin/state')).json;
  t('server mencatat alat: id, firmware, asal "mqtt"', st.state.dev.id === 'maket-01' && st.state.dev.fw === '2.9-tinwall' && st.state.dev.ip === 'mqtt', JSON.stringify(st.state.dev));
  const DJ = path.join(S.dir, 'data.json'); for (let i = 0; i < 200 && !require('fs').existsSync(DJ); i++) await sleep(50);   // server menyimpan berkala
  t('kunci alat tidak ikut tersimpan di data.json', require('fs').existsSync(DJ) && !require('fs').readFileSync(DJ, 'utf8').includes('kunci-alat-uji-123'));
  tele({ dist: 200 - 95 }); await dev.wait(2, 2000); st = (await c.get('/api/admin/state')).json;
  t('tinggi 95 cm nyata diproses (level SIAGA = 2)', st.state.level === 2 && st.readings.length && st.readings[st.readings.length - 1].h === 95, `level ${st.state.level}`);
  tele({ dist: 200 }); await sleep(100);

  console.log('== Keamanan ==');
  const n0 = dev.cmds().length, r0 = (await c.get('/api/admin/health')).json.mqtt.rejected;
  tele({ key: 'salah' }); tele({ id: 'lain' }); dev.pub('siaga/maket-01/telemetry', 'bukan json'); dev.pub('siaga/maket-01/telemetry', '[1,2]'); await sleep(500);
  t('kunci salah / ID tidak cocok / bukan JSON: tidak dibalas', dev.cmds().length === n0, `balasan ${dev.cmds().length - n0}`);
  t('semuanya dihitung ditolak dan dicatat', (await c.get('/api/admin/health')).json.mqtt.rejected - r0 === 4 && /Telemetri ditolak/.test(S.log()));

  console.log('== Isi sampai tinggi tertentu (wadah dikosongkan manual) ==');
  t('target di luar batas (200 cm) ditolak 400', (await c.post('/api/admin/pump', { mode: 'TARGET', target_cm: 200 })).status === 400);
  t('target 135 cm (di atas batas aman 130) ditolak 400', (await c.post('/api/admin/pump', { mode: 'TARGET', target_cm: 135 })).status === 400);
  t('target terlalu kecil (1 cm) ditolak 400', (await c.post('/api/admin/pump', { mode: 'TARGET', target_cm: 1 })).status === 400);
  t('level 5 ditolak 400', (await c.post('/api/admin/pump', { mode: 'TARGET', target_lvl: 5 })).status === 400);
  t('tanpa admin login = 401', (await client(S.base).post('/api/admin/pump', { mode: 'TARGET', target_cm: 90 })).status === 401);
  let k = dev.cmds().length;
  t('target 90 cm diterima', (await c.post('/api/admin/pump', { mode: 'TARGET', target_cm: 90 })).json.ok === true);
  t('perintah DIDORONG seketika ke alat tanpa menunggu telemetri berikutnya', (await dev.wait(k + 1, 1000)) && dev.cmds()[k].pump_mode === 'TARGET' && dev.cmds()[k].target_m === 0.9);
  k = dev.cmds().length; tele({ dist: 200 }); await dev.wait(k + 1, 2000); cmd = dev.cmds().pop();
  t('balasan MQTT: mode TARGET, target 0,9 m, pump 0 (alat yang memutuskan nyala/mati)', cmd.pump_mode === 'TARGET' && cmd.target_m === 0.9 && cmd.target_lvl === 0 && cmd.pump === 0, JSON.stringify(cmd));
  const hr = await c.post('/api/device/telemetry', { id: 'maket-01', base: 200, dist: 200, rssi: -50 }, { 'X-Device-Key': 'kunci-alat-uji-123' });
  t('balasan HTTP juga memuat mode TARGET dan target_m (jalur lama tetap jalan)', hr.json.pump_mode === 'TARGET' && hr.json.target_m === 0.9, JSON.stringify(hr.json));
  k = dev.cmds().length; tele({ dist: 110, pump: 1, pump_done: 0 }); await dev.wait(k + 1, 2000);
  t('selama mengisi, perintah TARGET tetap dikirim', dev.cmds().pop().pump_mode === 'TARGET');
  await sleep(4200);   // laporan "selesai" dalam 4 detik pertama dianggap basi; tunggu lewat itu
  k = dev.cmds().length; tele({ dist: 200 - 92, pump: 0, pump_done: 1 }); await dev.wait(k + 1, 2000); cmd = dev.cmds().pop();
  t('alat lapor target tercapai -> server berhenti memerintah (mode OFF), tidak mengisi lagi', cmd.pump_mode === 'OFF' && cmd.pump === 0 && cmd.target_m === 0, JSON.stringify(cmd));
  st = (await c.get('/api/admin/state')).json;
  t('peristiwa "Target tercapai ... Kosongkan wadah secara manual" tercatat', st.events.some(e => e.type === 'pump' && /Target tercapai.*Kosongkan wadah/.test(e.text)), JSON.stringify(st.events.slice(0, 3)));
  t('perintah target sudah bersih di state', !st.state.pumpTarget && st.state.pumpCmd.pump_mode === 'OFF');
  k = dev.cmds().length; tele({ dist: 200 }); await dev.wait(k + 1, 2000);   // wadah dikosongkan manual: air turun ke 0
  t('setelah wadah dikosongkan manual pompa TIDAK dinyalakan lagi', dev.cmds().pop().pump_mode === 'OFF');
  await c.post('/api/admin/pump', { mode: 'TARGET', target_lvl: 2 }); k = dev.cmds().length; tele(); await dev.wait(k + 1, 2000); cmd = dev.cmds().pop();
  t('target level SIAGA (2) -> target_lvl 2, target_m 0', cmd.pump_mode === 'TARGET' && cmd.target_lvl === 2 && cmd.target_m === 0, JSON.stringify(cmd));
  await sleep(4200); k = dev.cmds().length; tele({ pump: 0, pump_lock: 1 }); await dev.wait(k + 1, 2000);
  st = (await c.get('/api/admin/state')).json;
  t('pengaman alat menghentikan pompa sebelum target: server berhenti memerintah dan mencatat alasannya', dev.cmds().pop().pump_mode === 'OFF' && st.events.some(e => e.type === 'pump' && /PENGAMAN ALAT/.test(e.text)));
  await c.post('/api/admin/pump', { mode: 'TARGET', target_cm: 60 }); await sleep(100);
  await c.post('/api/admin/pump', { on: false }); k = dev.cmds().length; tele(); await dev.wait(k + 1, 2000);
  t('tombol Matikan membatalkan target di tengah jalan', dev.cmds().pop().pump_mode === 'OFF');
  await c.post('/api/admin/pump', { on: true }); k = dev.cmds().length; tele(); await dev.wait(k + 1, 2000); cmd = dev.cmds().pop();
  t('pompa manual (Nyalakan) tetap bekerja: MANUAL, pump 1', cmd.pump_mode === 'MANUAL' && cmd.pump === 1);
  await c.post('/api/admin/pump', { mode: 'OFF' }); k = dev.cmds().length; tele(); await dev.wait(k + 1, 2000);
  t('mode OFF mematikan', dev.cmds().pop().pump === 0);

  console.log('== Wi-Fi alat: cari dan ganti dari dashboard ==');
  const lastCmd = () => dev.cmds()[dev.cmds().length - 1] || {};
  k = dev.cmds().length; let sr = await c.post('/api/admin/wifi/scan');
  t('Cari Wi-Fi: perintah didorong ke alat dengan token pindai', sr.json.ok === true && (await dev.wait(k + 1, 1500)) && Number.isInteger(lastCmd().wifi_scan) && lastCmd().wifi_scan > 0, JSON.stringify(lastCmd()));
  const scanTok = lastCmd().wifi_scan; st = (await c.get('/api/admin/state')).json; t('dashboard: status "sedang memindai"', st.wifi.scanning === true);
  dev.pub('siaga/maket-01/wifi', { id: 'maket-01', key: 'salah', tok: scanTok, list: [{ s: 'PALSU', r: -10, e: 0 }] }); await sleep(300);
  t('daftar Wi-Fi dengan kunci salah ditolak', (await c.get('/api/admin/state')).json.wifi.list.length === 0);
  dev.pub('siaga/maket-01/wifi', { id: 'maket-01', key: 'kunci-alat-uji-123', tok: scanTok, list: [{ s: 'Warung K3', r: -48, e: 1 }, { s: 'Hotspot HP', r: -61, e: 1 }, { s: 'Wifi Desa', r: -77, e: 0 }, { s: '', r: -80, e: 0 }] }); await sleep(300);
  st = (await c.get('/api/admin/state')).json;
  t('daftar Wi-Fi hasil pindai alat tampil di dashboard (3 jaringan, nama kosong dibuang)', st.wifi.list.length === 3 && st.wifi.list[0].s === 'Warung K3' && st.wifi.list[0].r === -48 && st.wifi.scanning === false, JSON.stringify(st.wifi));
  k = dev.cmds().length; tele(); await dev.wait(k + 1, 2000); t('setelah daftar diterima perintah pindai tidak dikirim lagi', lastCmd().wifi_scan === undefined);
  t('ssid kosong ditolak 400', (await c.post('/api/admin/wifi/set', { ssid: '', pass: '12345678' })).status === 400);
  t('nama Wi-Fi 40 karakter ditolak 400', (await c.post('/api/admin/wifi/set', { ssid: 'x'.repeat(40), pass: '12345678' })).status === 400);
  t('sandi 5 karakter ditolak 400', (await c.post('/api/admin/wifi/set', { ssid: 'Warung K3', pass: 'pendek' })).status === 400);
  t('tanpa login = 401', (await client(S.base).post('/api/admin/wifi/set', { ssid: 'Warung K3', pass: '12345678' })).status === 401);
  k = dev.cmds().length; sr = await c.post('/api/admin/wifi/set', { ssid: 'Warung K3', pass: 'rahasia-wifi-123' });
  t('Ganti Wi-Fi: perintah wifi_set (ssid, sandi, token) didorong ke alat', sr.json.ok === true && (await dev.wait(k + 1, 1500)) && lastCmd().wifi_set && lastCmd().wifi_set.ssid === 'Warung K3' && lastCmd().wifi_set.pass === 'rahasia-wifi-123' && lastCmd().wifi_set.tok > 0, JSON.stringify(lastCmd()));
  const setTok = lastCmd().wifi_set.tok; k = dev.cmds().length; tele(); await dev.wait(k + 1, 2000);
  t('perintah diulang di balasan berikutnya sampai alat melapor (alat mengabaikan token yang sama)', lastCmd().wifi_set && lastCmd().wifi_set.tok === setTok);
  st = (await c.get('/api/admin/state')).json;
  t('state dashboard: menunggu hasil, TANPA sandi', st.wifi.pending && st.wifi.pending.ssid === 'Warung K3' && !JSON.stringify(st).includes('rahasia-wifi-123'));
  tele({ ssid: 'Lama', ssid_b: 'Cadangan', wsrc: 'alat', via: 'mqtt', mqh: 'broker.contoh', wifi_tok: setTok, wifi_res: 'gagal' }); await sleep(300);
  st = (await c.get('/api/admin/state')).json;
  t('alat melapor GAGAL: dashboard menampilkan hasil gagal, perintah dibersihkan', st.wifi.result && st.wifi.result.res === 'gagal' && st.wifi.pending === null && st.events.some(e => e.type === 'wifi' && /GAGAL/.test(e.text)));
  t('info alat tercatat: Wi-Fi sekarang, cadangan, sumber, jalur, broker', st.state.dev.ssid === 'Lama' && st.state.dev.ssidB === 'Cadangan' && st.state.dev.wsrc === 'alat' && st.state.dev.via === 'mqtt' && st.state.dev.mqh === 'broker.contoh', JSON.stringify(st.state.dev));
  k = dev.cmds().length; tele(); await dev.wait(k + 1, 2000); t('setelah dilaporkan, balasan tidak lagi membawa wifi_set (sandi hilang dari memori server)', lastCmd().wifi_set === undefined);
  k = dev.cmds().length; await c.post('/api/admin/wifi/set', { ssid: 'Hotspot HP', pass: '' }); await dev.wait(k + 1, 1500); const tok2 = lastCmd().wifi_set && lastCmd().wifi_set.tok;
  tele({ ssid: 'Hotspot HP', wsrc: 'alat', wifi_tok: tok2, wifi_res: 'ok' }); await sleep(300); st = (await c.get('/api/admin/state')).json;
  t('jaringan terbuka (tanpa sandi) diterima; alat lapor BERHASIL: hasil ok dan tercatat', tok2 > 0 && st.wifi.result.res === 'ok' && st.events.some(e => e.type === 'wifi' && /berganti ke "Hotspot HP"/.test(e.text)));
  await sleep(5600);   // server menyimpan berkala: sandi tidak boleh ikut tersimpan
  const dj = require('fs').readFileSync(DJ, 'utf8');
  t('sandi Wi-Fi tidak ada di data.json, di log server, maupun di catatan kejadian', !dj.includes('rahasia-wifi-123') && !S.log().includes('rahasia-wifi-123') && !JSON.stringify(st.events).includes('rahasia'));
  const hw = await c.post('/api/device/wifi', { list: [{ s: 'Via HTTP', r: -50, e: 1 }] }, { 'X-Device-Key': 'kunci-alat-uji-123' });
  t('jalur HTTP: /api/device/wifi menerima daftar, kunci salah = 401', hw.status === 200 && (await c.get('/api/admin/state')).json.wifi.list[0].s === 'Via HTTP' && (await c.post('/api/device/wifi', { list: [] }, { 'X-Device-Key': 'salah' })).status === 401);

  console.log('== Alat mati mendadak (pesan wasiat) ==');
  dev.sock.destroy(); for (let i = 0; i < 60 && !/Alat maket-01: offline/.test(S.log()); i++) await sleep(50);
  t('server tahu alat offline dari pesan wasiat broker', /Alat maket-01: offline/.test(S.log()));
  t('status offline tersimpan (retained) di broker', String(B.retained.get('siaga/maket-01/status')) === 'offline');

  console.log('== Sambungan broker bermasalah ==');
  const S2 = await startServer(null, { env: { MQTT_URL: `mqtt://127.0.0.1:${B.port}`, MQTT_USER: 'srv', MQTT_PASS: 'SALAH' } });
  for (let i = 0; i < 60 && !/Broker menolak/.test(S2.log()); i++) await sleep(50);
  const c2 = client(S2.base); await c2.login(); h = (await c2.get('/api/admin/health')).json;
  t('sandi broker salah: pesan jelas di log dan di health, server tetap hidup', /Broker menolak sambungan: .*user\/sandi/.test(S2.log()) && h.mqtt.connected === false && /Periksa MQTT_USER/.test(h.mqtt.error) && h.ok, h.mqtt && h.mqtt.error);
  await S2.stop();
  const S3 = await startServer(null, { env: { MQTT_URL: 'http://salah' } }); const c3 = client(S3.base); await c3.login();
  t('MQTT_URL salah skema: server tetap hidup dan memberi tahu', /harus diawali mqtt/.test(S3.log()) && (await c3.get('/api/admin/health')).json.ok);
  await S3.stop();
  const S4 = await startServer(null); const c4 = client(S4.base); await c4.login();
  t('tanpa MQTT_URL: MQTT mati dan server berjalan seperti biasa', (await c4.get('/api/admin/health')).json.mqtt.enabled === false);
  t('alat belum pernah online: cari/ganti Wi-Fi dijawab jelas (arahkan ke hotspot SIAGA-SETUP)', /SIAGA-SETUP/.test((await c4.post('/api/admin/wifi/scan')).json.error) && /offline/.test((await c4.post('/api/admin/wifi/set', { ssid: 'X', pass: '12345678' })).json.error));
  await S4.stop();
  B.close(); await S.stop();
  process.exit(R.done() ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
