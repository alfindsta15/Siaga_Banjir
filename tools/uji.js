// Uji otomatis server (tanpa internet, tanpa perangkat keras): node tools/uji.js   atau   npm test
const path = require('path'), fs = require('fs'), { spawnSync } = require('child_process');
const { mockFonnte, startServer, client, sleep, reporter, ROOT } = require('./uji_lib');
(async () => {
  const R = reporter(), t = R.t, mock = await mockFonnte();
  // data awal: riwayat 14 hari (ada celah 3 jam) supaya grafik riwayat bisa diuji
  const BK = 300000, now = Date.now(), hist = []; for (let b = Math.floor((now - 14 * 864e5) / BK) * BK; b < now - 6 * 3600000; b += BK) { if (b > now - 5 * 864e5 && b < now - 5 * 864e5 + 3 * 3600000) continue; const h = Math.round(150 + 100 * Math.sin(b / 7e6)); hist.push({ t: b, min: h - 3, max: h + 3, sum: h * 2, n: 2 }); }
  let S = await startServer(mock, { seed: { rev: 1, hist, readings: [] } }), c = client(S.base);

  console.log('== Akses dan login ==');
  t('healthz', (await c.get('/healthz')).status === 200);
  let r = await c.get('/'); t('/ mengarah ke /login saat belum login', r.status === 302 && r.headers.get('location') === '/login');
  r = await c.get('/admin'); t('/admin tanpa login dialihkan', r.status === 302 && r.headers.get('location') === '/login');
  t('API admin tanpa login = 401', (await c.get('/api/admin/state')).status === 401);
  t('API riwayat tanpa login = 401', (await c.get('/api/admin/history?range=24h')).status === 401);
  t('kata sandi salah = 401', (await c.post('/api/admin/login', { password: 'salah' })).status === 401);
  t('login benar', (await c.login()).status === 200);
  t('/admin terbuka setelah login', (await c.get('/admin')).status === 200);

  console.log('== Alat -> server (telemetri) dan level ==');
  const tele = (dist, key) => c.post('/api/device/telemetry', { id: 'uji', dist, rssi: -55 }, { 'X-Device-Key': key || 'kunci-alat-uji-123' });
  t('kunci alat salah = 401', (await tele(300, 'salah')).status === 401);
  await c.post('/api/admin/config', { fonnte_token: 'TOKEN-UJI', wa_target: '120363000000000001@g.us', lokasi: 'Sungai Uji' });
  const lv = []; for (const h of [60, 160, 260, 330]) { const x = await tele(400 - h); lv.push(x.json.level); await sleep(120); }
  t('level naik 0,1,2,3 sesuai ambang 150/250/320', lv.join() === '0,1,2,3', lv.join());
  await sleep(300);
  const sends = mock.sends.map(x => x.message);
  t('pesan WA terkirim saat level berubah (3 kali: WASPADA, SIAGA, AWAS)', sends.length === 3, 'dapat ' + sends.length);
  t('pesan WA ke ID grup yang benar', mock.sends.every(x => x.target === '120363000000000001@g.us'));
  t('isi pesan AWAS memakai template standar: judul, tindakan evakuasi, lokasi, tinggi', /PERINGATAN BAHAYA/.test(sends[2]) && /POTENSI BANJIR/.test(sends[2]) && /evakuasi/i.test(sends[2]) && /Sungai Uji/.test(sends[2]) && /330 cm/.test(sends[2]) && /Balas STATUS/.test(sends[2]), sends[2]);
  t('balasan telemetri membawa cfg dan perintah pompa', (await tele(300)).json.cfg.rev > 0);

  console.log('== Template pesan ==');
  let st = (await c.get('/api/admin/state')).json;
  t('state memuat template bawaan', st.tplDefaults && /\{tinggi\}/.test(st.tplDefaults.tpl_siaga));
  r = await c.post('/api/admin/config', { tpl_siaga: 'SIAGA {foo}' }); t('isian tidak dikenal ditolak', r.status === 400 && /foo/.test(r.json.error), r.text);
  r = await c.post('/api/admin/config', { tpl_awas: 'Air tinggi {tinggi} cm' }); t('template AWAS tanpa tindakan/evakuasi ditolak', r.status === 400, r.text);
  r = await c.post('/api/admin/config', { tpl_siaga: '{emoji} SIAGA di {lokasi}: {tinggi} cm\n{penutup}\nBawa tas siaga.', pesan_tambahan: '' }); t('template kustom tersimpan', r.status === 200, r.text);
  mock.sends.length = 0; r = await c.post('/api/admin/tpl-test', { which: 'siaga', text: '{emoji} SIAGA di {lokasi}: {tinggi} cm\n{penutup}\nBawa tas siaga.' });
  t('kirim contoh template: baris {penutup} kosong dibuang', r.json.ok && !/\n\n/.test(r.json.text) && /SIAGA di Sungai Uji: 280 cm/.test(r.json.text), r.text);
  t('contoh template sampai ke mock Fonnte', mock.sends.length === 1 && /CONTOH TEMPLATE/.test(mock.sends[0].message));
  r = await c.post('/api/admin/tpl-test', { which: 'siaga', text: 'x {salah}' }); t('contoh template tidak valid ditolak', r.status === 400);
  r = await c.post('/api/admin/config', { tpl_siaga: '' }); st = (await c.get('/api/admin/state')).json; t('template kosong kembali ke bawaan', r.status === 200 && st.config.tpl_siaga === st.tplDefaults.tpl_siaga);
  await c.post('/api/admin/config', { tpl_daily: 'Harian {lokasi}: {min24}-{max24} cm, alat {alat}. {waktu}' });
  t('template harian tersimpan', (await c.get('/api/admin/state')).json.config.tpl_daily.startsWith('Harian'));

  st = (await c.get('/api/admin/state')).json;
  for (const nm of ['standar', 'ringkas', 'tegas']) { r = await c.post('/api/admin/config', st.tplPresets[nm]); t(`gaya siap pakai "${nm}" lolos validasi dan tersimpan`, r.status === 200 && (await c.get('/api/admin/state')).json.config.tpl_awas === st.tplPresets[nm].tpl_awas, r.text); }
  const md = fs.readFileSync(path.join(ROOT, 'docs', 'TEMPLATE_FONNTE.md'), 'utf8'), blocks = [...md.matchAll(/\*\*(tpl_\w+)\*\*[^\n]*\n```\n([\s\S]*?)\n```/g)]; let bad = [];
  for (const [, k, txt] of blocks) { r = await c.post('/api/admin/config', { [k]: txt }); if (r.status !== 200) bad.push(k + ': ' + r.text); }
  t(`semua ${blocks.length} template di docs/TEMPLATE_FONNTE.md valid`, blocks.length === 18 && !bad.length, bad.join(' | ') || blocks.length);
  await c.post('/api/admin/config', st.tplPresets.standar); await c.post('/api/admin/config', { tpl_daily: 'Harian {lokasi}: {min24}-{max24} cm, alat {alat}. {waktu}' });

  console.log('== Daftar grup Fonnte ==');
  let g = await c.post('/api/admin/fonnte-groups', { refresh: false }); t('ambil daftar sebelum pernah diperbarui: ok, kosong, ada petunjuk', g.json.ok && g.json.groups.length === 0 && /Perbarui/.test(g.json.hint), g.text);
  g = await c.post('/api/admin/fonnte-groups', { refresh: true }); t('perangkat terputus: pesan jelas (bukan galat umum)', !g.json.ok && /terputus/i.test(g.json.error), g.text);
  mock.connected = true;
  g = await c.post('/api/admin/fonnte-groups', { refresh: true }); t('percobaan gagal tadi TIDAK memakai jatah 1 jam (perbaikan bug)', g.json.ok, g.text);
  t('daftar muncul walau poll pertama kosong (menunggu latar belakang Fonnte)', g.json.ok && g.json.groups.length === 2 && g.json.groups[0].name === 'Warga RT 03', g.text);
  g = await c.post('/api/admin/fonnte-groups', { refresh: true }); t('pembaruan kedua dalam 1 jam ditahan dengan pesan menit', !g.json.ok && /menit/.test(g.json.error), g.text);
  g = await c.post('/api/admin/fonnte-groups', { refresh: false }); t('ambil daftar biasa tetap bisa', g.json.ok && g.json.groups.length === 2);
  mock.dataAsString = true; g = await c.post('/api/admin/fonnte-groups', { refresh: false }); t('format data berupa teks JSON juga terbaca', g.json.ok && g.json.groups.length === 2, g.text);

  console.log('== Webhook Fonnte ==');
  const wh = (key, body) => c.post('/webhook/fonnte?key=' + key, body);
  t('webhook key salah = 403', (await wh('salah', { sender: 'x', message: 'STATUS' })).status === 403);
  mock.sends.length = 0; await wh('kunci-webhook-uji', { sender: '6281234@s.whatsapp.net', message: 'STATUS' }); await sleep(150);
  t('pengirim di luar grup terdaftar diabaikan', mock.sends.length === 0);
  await wh('kunci-webhook-uji', { sender: '120363000000000001@g.us', message: 'STATUS' }); await sleep(250);
  t('STATUS dari grup terdaftar dibalas ke grup itu', mock.sends.length === 1 && mock.sends[0].target === '120363000000000001@g.us' && /Tinggi air/.test(mock.sends[0].message), JSON.stringify(mock.sends));
  await wh('kunci-webhook-uji', { sender: '120363999999999999@g.us', message: 'halo' });
  g = await c.post('/api/admin/fonnte-groups', { refresh: false }); t('ID grup yang mengetik tertangkap dan tampil di daftar', g.json.groups.some(x => x.id === '120363999999999999@g.us' && x.src === 'webhook'), g.text);
  t('catatan kejadian memuat baris Webhook', (await c.get('/api/admin/state')).json.events.some(e => e.type === 'hook'));

  console.log('== Riwayat ketinggian air ==');
  for (const rg of ['1h', '6h', '24h', '7d', '14d']) { const h = (await c.get('/api/admin/history?range=' + rg)).json; t(`riwayat ${rg}: ada titik, maks 400, statistik benar`, h.ok && h.points.length > 0 && h.points.length <= 400 && h.stats && h.stats.max >= h.stats.min, `${h.points && h.points.length} titik`); }
  let h14 = (await c.get('/api/admin/history?range=14d')).json; t('14 hari dari data awal: titik diringkas dan ada riwayat lama', h14.points.length > 100 && h14.points[0].t < now - 10 * 864e5, h14.points.length);
  t('rentang tidak valid jatuh ke 24 jam', (await c.get('/api/admin/history?range=ngawur')).json.range === '24h');
  let h1 = (await c.get('/api/admin/history?range=1h')).json; t('1 jam memakai bacaan mentah dari alat (tinggi 60-330)', h1.points.some(p => p.max === 330) && h1.stats.max === 330, JSON.stringify(h1.stats));
  const csv = await c.get('/api/admin/history.csv?range=24h'); t('CSV: header, rentang waktu WIB, unduhan', csv.status === 200 && /^waktu_wib,min_cm,maks_cm,rata_cm,jumlah_bacaan\n\d{4}-\d\d-\d\d \d\d:\d\d:\d\d,/.test(csv.text) && /attachment/.test(csv.headers.get('content-disposition')), csv.text.slice(0, 120));

  console.log('== Tinggi tidak minus, tren, dan kalibrasi dasar ==');
  {
    const CK = { env: { TEST_CLOCK: '1' } }, NS = await startServer(mock, CK), nc = client(NS.base); await nc.login(), adv = (c, ms) => c.post('/api/admin/test-advance', { ms });
    await nc.post('/api/admin/config', { base: 200, waspada: 50, siaga: 90, awas: 120, laju: 100000, hys: 2, offline: 10 });
    const T = async d => { await adv(nc, 3000); return nc.post('/api/device/telemetry', { id: 'maket', dist: d, rssi: -50 }, { 'X-Device-Key': 'kunci-alat-uji-123' }); };
    await T(200); let st0 = (await nc.get('/api/admin/state')).json; t('jarak = dasar: tinggi 0', st0.state.hs && st0.state.hs.h === 0, JSON.stringify(st0.state.hs));
    await T(205); st0 = (await nc.get('/api/admin/state')).json; t('jarak sedikit melewati dasar (derau): tinggi tetap 0, bukan minus', st0.state.hs.h === 0 && st0.readings.every(r => r.h >= 0), JSON.stringify(st0.state.hs));
    const e0 = st0.state.errN; await T(260); st0 = (await nc.get('/api/admin/state')).json; t('jarak jauh melewati dasar (260 > 200+tol): bukan "air minus", dianggap gagal baca', st0.state.errN === e0 + 1 && st0.state.hs.h === 0 && st0.readings.every(r => r.h >= 0), JSON.stringify([st0.state.errN, st0.state.hs]));
    await T(200);
    for (const d of [-5, 0, 1e9, 'abc']) { const r = await nc.post('/api/device/telemetry', { id: 'm', dist: d }, { 'X-Device-Key': 'kunci-alat-uji-123' }); if (r.status >= 500) t('jarak aneh ' + d + ' tidak menyebabkan 500', false, r.text); }
    t('jarak aneh (negatif, nol, raksasa, teks) tidak merusak data', (await nc.get('/api/admin/state')).json.readings.every(r => r.h >= 0 && isFinite(r.h)));
    // derau saja => tren 0 (tidak "naik/turun" palsu)
    const NT = await startServer(mock, CK), ntc = client(NT.base); await ntc.login(); await ntc.post('/api/admin/config', { base: 200, waspada: 50, siaga: 90, awas: 120, laju: 100000 });
    const TN = async d => { await adv(ntc, 3000); return ntc.post('/api/device/telemetry', { id: 'maket', dist: d, rssi: -50 }, { 'X-Device-Key': 'kunci-alat-uji-123' }); };
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 20; i++) await TN(200 - 20 - 3 * (rnd() - 0.5));
    st0 = (await ntc.get('/api/admin/state')).json; t('air diam dengan derau sensor +-1,5 cm: laju 0, tren stabil (tidak halusinasi)', st0.state.hs.lj === 0, JSON.stringify(st0.state.hs));
    for (let i = 0; i < 12; i++) await TN(200 - 20 - i * 6);
    st0 = (await ntc.get('/api/admin/state')).json; t('air benar-benar naik (6 cm tiap 3 dtk): laju positif terdeteksi', st0.state.hs.lj > 0, JSON.stringify(st0.state.hs)); await NT.stop();
    // kalibrasi dasar otomatis
    const NS2 = await startServer(mock, CK), n2 = client(NS2.base); await n2.login();
    let cb = await n2.post('/api/admin/calibrate-base', {}); t('kalibrasi dasar tanpa bacaan alat: ditolak dengan pesan jelas', !cb.json.ok && /bacaan/i.test(cb.json.error), cb.text);
    const T2 = async d => { await adv(n2, 3000); return n2.post('/api/device/telemetry', { id: 'maket', dist: d, rssi: -50 }, { 'X-Device-Key': 'kunci-alat-uji-123' }); };
    for (const d of [391, 405, 390, 410, 380, 399]) await T2(d); cb = await n2.post('/api/admin/calibrate-base', {}); t('bacaan tidak stabil: kalibrasi dasar ditolak', !cb.json.ok && /stabil/i.test(cb.json.error), cb.text);
    const NS3 = await startServer(mock, CK), n3 = client(NS3.base); await n3.login(); const T3 = async d => { await adv(n3, 3000); return n3.post('/api/device/telemetry', { id: 'maket', dist: d, rssi: -50 }, { 'X-Device-Key': 'kunci-alat-uji-123' }); };
    for (const d of [200.4, 200.1, 199.8, 200.0, 200.2, 199.9, 200.3]) await T3(d);
    cb = await n3.post('/api/admin/calibrate-base', {}); const cs = (await n3.get('/api/admin/state')).json; t('bacaan stabil: dasar diubah ke median dan dikirim ke alat', cb.json.ok && Math.abs(cb.json.base - 200.1) < 0.4 && cs.config.base === cb.json.base, cb.text);
    const rr = await T3(200.1); t('balasan telemetri membawa dasar baru ke alat', rr.json.cfg.base === cb.json.base, JSON.stringify(rr.json.cfg));
    await NS3.stop(); await NS2.stop();

    // ---- anti-spam: pesan hanya saat ada perubahan berarti ----
    mock.sends.length = 0; const wait = ms => new Promise(r => setTimeout(r, ms));
    await nc.post('/api/admin/config', { fonnte_token: 'TOKEN-UJI', wa_target: '120363000000000001@g.us', notif_gap: 5, notif_delta: 20, hys: 2 }); await T(200); await T(200); await wait(150);
    const sent = () => mock.sends.length, send = async h => { await T(200 - h); await wait(120); };
    // pakai skala: tinggi h cm = dist 200-h
    mock.sends.length = 0; await send(30); t('di bawah WASPADA: tidak ada pesan', sent() === 0);
    await send(55); t('naik ke WASPADA: 1 pesan', sent() === 1 && /STATUS WASPADA/.test(mock.sends[0].message), mock.sends[0] && mock.sends[0].message.slice(0, 40));
    for (const h of [56, 58, 57, 59, 60, 58, 61, 60]) await send(h); t('level sama, air bergerak kecil (8 bacaan): tidak ada pesan tambahan (anti-spam)', sent() === 1, 'pesan=' + sent());
    await send(80); t('naik signifikan (+25) di level sama tetapi masih dalam jeda 5 menit: ditahan', sent() === 1, 'pesan=' + sent());
    await nc.post('/api/admin/config', { notif_gap: 0 }); await send(82); t('jeda dimatikan + naik signifikan: 1 pesan PEMBARUAN', sent() === 2 && /PEMBARUAN KONDISI/.test(mock.sends[1].message), mock.sends[1] && mock.sends[1].message.slice(0, 50));
    await send(84); t('naik kecil lagi (+2): tidak ada pesan', sent() === 2);
    await nc.post('/api/admin/config', { notif_gap: 5 }); await send(95); t('naik ke SIAGA: langsung terkirim walau dalam jeda (eskalasi tidak ditunda)', sent() === 3 && /STATUS SIAGA/.test(mock.sends[2].message), 'pesan=' + sent());
    await send(125); t('naik ke AWAS: langsung terkirim', sent() === 4 && /PERINGATAN BAHAYA/.test(mock.sends[3].message), 'pesan=' + sent());
    for (const h of [20, 20, 20]) await send(h); t('turun ke NORMAL dalam jeda 5 menit: tidak dikirim (naik-turun cepat tidak membanjiri)', sent() === 4, 'pesan=' + sent());
    await nc.post('/api/admin/config', { notif_gap: 0 }); await send(20); t('jeda selesai: kabar "kondisi normal" terkirim satu kali', sent() === 5 && /KONDISI NORMAL/.test(mock.sends[4].message), 'pesan=' + sent());
    for (let i = 0; i < 6; i++) await send(20); t('tetap normal: tidak ada pesan lagi', sent() === 5);
    await nc.post('/api/admin/config', { remind: 1, remind_awas: 1 }); await send(20); t('pengaturan "pengingat" lama tidak lagi menyebabkan pesan berulang', sent() === 5);
    await NS.stop();
  }

  console.log('== Migrasi template lama ==');
  { const OLD = '{emoji} *{level}* - {lokasi}\nTinggi air: {tinggi} cm ({tren}, {laju} cm/jam)\n{tindakan}\n{penutup}\n{waktu} WIB'; const MS = await startServer(mock, { seed: { rev: 1, config: { tpl_awas: OLD, tpl_waspada: OLD, tpl_siaga: 'SIAGA buatan saya: {tinggi} cm' }, readings: [], hist: [] } }), mc2 = client(MS.base); await mc2.login();
    const sx = (await mc2.get('/api/admin/state')).json; t('template yang masih bawaan lama otomatis diganti bawaan baru', sx.config.tpl_awas === sx.tplDefaults.tpl_awas && /PERINGATAN BAHAYA/.test(sx.config.tpl_awas) && sx.config.tpl_waspada === sx.tplDefaults.tpl_waspada);
    t('template yang sudah diubah pengguna tidak disentuh', sx.config.tpl_siaga === 'SIAGA buatan saya: {tinggi} cm'); await MS.stop(); }
  console.log('== Kesiapan dan sambungan alat ==');
  const hl = (await c.get('/api/admin/health')).json; t('health: uptime, folder data bisa ditulis, daftar IP LAN', hl.ok && hl.uptime >= 0 && hl.writable === true && Array.isArray(hl.lan) && hl.webhookKey === true && hl.port === S.port, JSON.stringify(hl));
  t('health perlu login', (await client(S.base).get('/api/admin/health')).status === 401);

  console.log('== Baileys (memakai Baileys tiruan; WhatsApp asli belum diuji) ==');
  const sd = fs.mkdtempSync(path.join(require('os').tmpdir(), 'stub-')), sf = n => path.join(sd, n), outs = () => (fs.existsSync(sf('OUT.jsonl')) ? fs.readFileSync(sf('OUT.jsonl'), 'utf8').split('\n').filter(Boolean).map(JSON.parse) : []);
  const BENV = { BAILEYS_MODULE: path.join(ROOT, 'tools', 'stub', 'baileys-stub.js'), QRCODE_MODULE: path.join(ROOT, 'tools', 'stub', 'qrcode-stub.js'), STUB_DIR: sd, WA_SEND_GAP_MS: '0', WA_START_WAIT_MS: '300' };
  const aiHits = { n: 0 }, qaAI = require('http').createServer((q, res) => { let d = ''; q.on('data', x => d += x); q.on('end', () => { aiHits.n++; res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { content: 'Tetap tenang, pantau informasi dari petugas, dan siapkan tas siaga.' } }] })); }); }); await new Promise(r => qaAI.listen(0, '127.0.0.1', r));
  const B = await startServer(mock, { env: { ...BENV, GROQ_URL: 'http://127.0.0.1:' + qaAI.address().port + '/v1' } }), bc = client(B.base); await bc.login(); mock.sends.length = 0;
  await bc.post('/api/admin/config', { fonnte_token: 'TOKEN-UJI', wa_target: '120363111@g.us', wa_provider: 'baileys', wa_fallback: true }); await sleep(500);
  let w = (await bc.get('/api/admin/state')).json.wa; t('memilih Baileys menyalakan sambungan dan menampilkan QR', w.state === 'menunggu-scan' && /^data:image/.test(w.qr), JSON.stringify(w).slice(0, 120));
  fs.writeFileSync(sf('SCAN'), '1'); await sleep(400); w = (await bc.get('/api/admin/state')).json.wa; t('setelah scan: terhubung, QR hilang, nomor terbaca', w.state === 'terhubung' && !w.qr && w.me === '6281200000000', JSON.stringify(w).slice(0, 140));
  const nc = mock.calls.length; let g2 = await bc.post('/api/admin/fonnte-groups', { refresh: true }); t('daftar grup langsung dari WhatsApp (tanpa Fonnte, tanpa webhook)', g2.json.ok && g2.json.groups.length === 2 && g2.json.groups[0].name === 'Warga RT 03 (Baileys)' && mock.calls.length === nc, g2.text);   // tidak ada panggilan baru ke Fonnte
  const bt = async (dist) => bc.post('/api/device/telemetry', { id: 'uji', dist, rssi: -50 }, { 'X-Device-Key': 'kunci-alat-uji-123' });
  await bt(340); await bt(240); await sleep(300); let o = outs(); t('peringatan level terkirim lewat Baileys ke ID grup, bukan Fonnte', o.some(x => x.jid === '120363111@g.us' && /WASPADA/.test(x.text)) && mock.sends.length === 0, JSON.stringify(o).slice(0, 160));
  const n0 = outs().length; fs.appendFileSync(sf('IN.jsonl'), JSON.stringify({ jid: '120363111@g.us', text: 'STATUS' }) + '\n' + JSON.stringify({ jid: '120363111@g.us', text: 'STATUS', fromMe: true }) + '\n' + JSON.stringify({ jid: '120363999@g.us', text: 'STATUS' }) + '\n'); await sleep(400);
  o = outs().slice(n0); t('STATUS di grup terdaftar dibalas lewat Baileys (tanpa webhook); pesan sendiri dan grup lain diabaikan', o.length === 1 && o[0].jid === '120363111@g.us' && /Tinggi air/.test(o[0].text), JSON.stringify(o));
  t('pesan masuk tercatat dengan keterangan Baileys', (await bc.get('/api/admin/state')).json.events.some(e => e.type === 'hook' && /Baileys/.test(e.text)));
  // ---- tanya jawab AI lewat Baileys ----
  await bc.post('/api/admin/config', { qa_on: true, ai_provider: 'groq', ai_key: 'kunci-ai-uji', kb: 'Titik kumpul: Balai Desa.', qa_gap: 30, qa_budget: 30 });
  const G = '120363111@g.us', BOT = '6281200000000@s.whatsapp.net', inn = o => fs.appendFileSync(sf('IN.jsonl'), JSON.stringify({ jid: G, ...o }) + '\n'), n1 = () => outs().length;
  let b0 = n1(); inn({ text: 'TANYA kalau air naik saya harus bagaimana', participant: '6281@s.whatsapp.net' }); await sleep(500); o = outs().slice(b0);
  t('TANYA di grup terdaftar dijawab AI sebagai balasan yang mengutip pertanyaan', o.length === 1 && /Tetap tenang/.test(o[0].text) && o[0].quoted === true && aiHits.n === 1, JSON.stringify(o) + ' ai=' + aiHits.n);
  t('indikator "sedang mengetik" dikirim sebelum menjawab', fs.existsSync(sf('PRES.jsonl')) && /composing/.test(fs.readFileSync(sf('PRES.jsonl'), 'utf8')));
  b0 = n1(); inn({ text: 'TANYA apa lagi yang perlu disiapkan', participant: '6281@s.whatsapp.net' }); await sleep(400);
  t('orang yang sama bertanya lagi sebelum jeda 30 detik: tidak dibalas (anti-spam)', n1() === b0 && aiHits.n === 1);
  b0 = n1(); inn({ text: 'TANYA kalau air naik saya harus bagaimana', participant: '6282@s.whatsapp.net' }); await sleep(500); o = outs().slice(b0);
  t('orang lain menanyakan hal yang sama: dijawab dari simpanan (AI tidak dipanggil lagi)', o.length === 1 && /Tetap tenang/.test(o[0].text) && aiHits.n === 1, JSON.stringify(o) + ' ai=' + aiHits.n);
  b0 = n1(); inn({ text: '@6281200000000 kapan air surut', mentions: [BOT], participant: '6283@s.whatsapp.net' }); await sleep(500); o = outs().slice(b0);
  t('menyebut nomor bot (@mention) dianggap pertanyaan dan dijawab', o.length === 1 && o[0].quoted === true && aiHits.n === 2, JSON.stringify(o) + ' ai=' + aiHits.n);
  b0 = n1(); inn({ text: 'terima kasih infonya, apakah sudah aman?', quotedParticipant: BOT, participant: '6284@s.whatsapp.net' }); await sleep(500); o = outs().slice(b0);
  t('membalas pesan bot dianggap pertanyaan dan dijawab', o.length === 1 && aiHits.n === 3, JSON.stringify(o) + ' ai=' + aiHits.n);
  b0 = n1(); inn({ text: 'selamat pagi semuanya', participant: '6285@s.whatsapp.net' }); inn({ text: 'TANYA apa itu banjir', participant: '6286@s.whatsapp.net', jid: '120363999@g.us' }); await sleep(500);
  t('obrolan biasa dan grup yang tidak terdaftar diabaikan', n1() === b0 && aiHits.n === 3);
  await bc.post('/api/admin/config', { qa_on: false });
  r = await bc.post('/api/admin/test', { channel: 'wa' }); t('Tes WhatsApp lewat Baileys', r.json.wa === 'ok' && outs().some(x => /UJI COBA/.test(x.text)));
  fs.unlinkSync(sf('SCAN')); fs.writeFileSync(sf('DROP'), '1'); await sleep(400); w = (await bc.get('/api/admin/state')).json.wa; mock.sends.length = 0;
  t('koneksi putus: status berubah dan mencoba menyambung lagi sendiri', ['terputus', 'memulai', 'menunggu-scan'].includes(w.state), w.state);
  r = await bc.post('/api/admin/test', { channel: 'wa' }); await sleep(100); t('Baileys putus + cadangan aktif: pesan tetap terkirim lewat Fonnte', r.json.wa === 'ok' && mock.sends.length === 1 && mock.sends[0].target === '120363111@g.us', JSON.stringify(mock.sends).slice(0, 100));
  await bc.post('/api/admin/config', { wa_fallback: false }); mock.sends.length = 0; r = await bc.post('/api/admin/test', { channel: 'wa' }); t('cadangan dimatikan: tidak diam-diam memakai Fonnte', r.json.wa !== 'ok' && mock.sends.length === 0, r.text);
  await bc.post('/api/admin/wa/stop', { logout: true }); w = (await bc.get('/api/admin/state')).json.wa; t('keluar + hapus sesi: status mati dan folder sesi terhapus', w.state === 'mati' && !fs.existsSync(path.join(B.dir, 'wa-session')), JSON.stringify(w));
  await bc.post('/api/admin/config', { wa_provider: 'fonnte' }); mock.sends.length = 0; await bc.post('/api/admin/test', { channel: 'wa' }); t('kembali ke Fonnte: pesan lewat Fonnte lagi', mock.sends.length === 1);
  await B.stop(); qaAI.close();
  const M = await startServer(mock, { env: { ...BENV, BAILEYS_MODULE: '/tidak/ada/baileys.js' } }), mc = client(M.base); await mc.login(); await mc.post('/api/admin/config', { wa_provider: 'baileys' }); await sleep(500);
  w = (await mc.get('/api/admin/state')).json.wa; g2 = await mc.post('/api/admin/fonnte-groups', { refresh: false });
  t('paket Baileys belum terpasang: pesan jelas "npm install", server tidak mati', w.state === 'galat' && /npm install/.test(w.err) && !g2.json.ok && /npm install/.test(g2.json.error), JSON.stringify(w).slice(0, 160));
  await M.stop();

  console.log('== Asisten AI: timeout dan sukses ==');
  const http = require('http'); const hang = http.createServer(() => {}); await new Promise(r => hang.listen(0, '127.0.0.1', r));
  const good = http.createServer((q, res) => { let d = ''; q.on('data', x => d += x); q.on('end', () => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { content: 'Air naik ke 260 cm, siapkan tas siaga dan pantau terus.' } }] })); }); }); await new Promise(r => good.listen(0, '127.0.0.1', r));
  let A = await startServer(mock, { env: { GROQ_URL: 'http://127.0.0.1:' + hang.address().port + '/v1', AI_TIMEOUT_MS: '300', AI_TEST_TIMEOUT_MS: '700' } }), ac = client(A.base); await ac.login(); await ac.post('/api/admin/config', { ai_provider: 'groq', ai_key: 'kunci-ai-uji' });
  const t0 = Date.now(); r = await ac.post('/api/admin/ai-test', {}); t('tes AI saat penyedia tidak membalas: pesan jelas (bukan teks mentah Node)', !r.json.ok && /Tidak ada balasan dari Groq/.test(r.json.error) && /curl -I https:\/\/api\.groq\.com/.test(r.json.error) && !/aborted/.test(r.json.error), r.text);
  t('tes AI memakai batas waktu tes (lebih longgar dari batas peringatan)', Date.now() - t0 >= 650, (Date.now() - t0) + ' ms');
  r = await ac.post('/api/admin/qa-test', { q: 'apa yang harus dilakukan?' }); t('tes tanya-jawab saat timeout dilaporkan sebagai gagal (bukan "sukses" semu)', !r.json.ok && /Tidak ada balasan/.test(r.json.error), r.text);
  const lvl = []; for (const h of [60, 160]) { const x = await ac.post('/api/device/telemetry', { id: 'uji', dist: 400 - h, rssi: -50 }, { 'X-Device-Key': 'kunci-alat-uji-123' }); lvl.push(x.json.level); }
  await A.stop(); A = await startServer(mock, { env: { GROQ_URL: 'http://127.0.0.1:' + good.address().port + '/v1' } }); ac = client(A.base); await ac.login(); await ac.post('/api/admin/config', { ai_provider: 'groq', ai_key: 'kunci-ai-uji' });
  r = await ac.post('/api/admin/ai-test', {}); t('tes AI saat penyedia membalas: sukses dan lolos validasi keamanan', r.json.ok && /260 cm/.test(r.json.text), r.text);
  await A.stop(); hang.close(); good.close();

  console.log('== Simpan ke disk dan hidup ulang ==');
  const before = (await c.get('/api/admin/history?range=14d')).json.stats.n, tplBefore = (await c.get('/api/admin/state')).json.config.tpl_daily;
  await S.stop(); S = await startServer(mock, { dir: S.dir, port: S.port }); c = client(S.base); await c.login();
  t('riwayat tetap ada setelah server dihidupkan ulang', (await c.get('/api/admin/history?range=14d')).json.stats.n >= before);
  const st2 = (await c.get('/api/admin/state')).json; t('template dan grup tetap tersimpan setelah restart', st2.config.tpl_daily === tplBefore && st2.config.wa_target === '120363000000000001@g.us');
  t('token Fonnte tersimpan terenkripsi di data.json', !fs.readFileSync(path.join(S.dir, 'data.json'), 'utf8').includes('TOKEN-UJI'));

  console.log('== Simulator ==');
  const sim = spawnSync('node', [path.join(ROOT, 'tools', 'simulasi.js'), S.base, '20'], { env: { ...process.env, DEVICE_KEY: 'kunci-alat-uji-123' }, encoding: 'utf8' });
  t('simulasi.js berjalan sampai selesai dan mencapai level 3', sim.status === 0 && /level server 3/.test(sim.stdout), sim.stdout.slice(-120) + sim.stderr);
  await S.stop(); mock.srv.close(); const ok = R.done(); process.exit(ok ? 0 : 1);
})().catch(e => { console.error('UJI BERHENTI:', e); process.exit(2); });
