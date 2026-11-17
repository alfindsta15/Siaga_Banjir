// Uji keamanan dasar (serangan sederhana ke server sungguhan): node tools/uji_keamanan.js
// Bukan pengganti audit profesional; hanya memastikan celah umum tertutup.
const fs = require('fs'), os = require('os'), path = require('path');
const { mockFonnte, startServer, client, sleep, reporter, ROOT } = require('./uji_lib');
let chromium; try { ({ chromium } = require('playwright')); } catch (e) {}
(async () => {
  const R = reporter(), t = R.t, mock = await mockFonnte(), sd = fs.mkdtempSync(path.join(os.tmpdir(), 'stub-sec-'));
  const S = await startServer(mock, { env: { BAILEYS_MODULE: path.join(ROOT, 'tools', 'stub', 'baileys-stub.js'), QRCODE_MODULE: path.join(ROOT, 'tools', 'stub', 'qrcode-stub.js'), STUB_DIR: sd, WA_SEND_GAP_MS: '0', WA_START_WAIT_MS: '200' } });
  const anon = client(S.base), adm = client(S.base); await adm.login();
  const raw = (p, o = {}) => fetch(S.base + p, { redirect: 'manual', ...o });

  console.log('== Akses tanpa login ==');
  const adminPaths = ['/api/admin/state', '/api/admin/history?range=24h', '/api/admin/history.csv?range=24h', '/api/admin/health', '/api/admin/connection'];
  const adminPosts = ['/api/admin/config', '/api/admin/test', '/api/admin/tpl-test', '/api/admin/fonnte-groups', '/api/admin/wa/start', '/api/admin/wa/stop', '/api/admin/devicekey', '/api/admin/password', '/api/admin/pump', '/api/admin/ai-test', '/api/admin/qa-test'];
  let open = []; for (const p of adminPaths) { const r = await anon.get(p); if (r.status !== 401) open.push(p + '=' + r.status); } for (const p of adminPosts) { const r = await anon.post(p, {}); if (r.status !== 401 && r.status !== 404) open.push(p + '=' + r.status); }
  t('semua endpoint admin menolak tanpa login (401)', !open.length, open.join(' '));
  t('/admin dialihkan ke /login tanpa sesi', (await raw('/admin')).status === 302);
  t('kuki palsu ditolak', (await client(S.base).get('/api/admin/state', { Cookie: 'sid=abcdef' })).status === 401);

  console.log('== Login dan sesi ==');
  const lr = await raw('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'sandi-uji-123' }) }), ck = lr.headers.get('set-cookie') || '';
  t('kuki sesi: HttpOnly, SameSite=Strict, ada batas umur', /HttpOnly/.test(ck) && /SameSite=Strict/.test(ck) && /Max-Age=\d+/.test(ck), ck);
  const lr2 = await raw('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-Proto': 'https' }, body: JSON.stringify({ password: 'sandi-uji-123' }) }); t('di belakang HTTPS kuki ditandai Secure', /Secure/.test(lr2.headers.get('set-cookie') || ''));
  console.log('== Kunci alat dan webhook ==');
  const tel = (k, b) => raw('/api/device/telemetry', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(k ? { 'X-Device-Key': k } : {}) }, body: b || JSON.stringify({ id: 'x', dist: 200 }) });
  t('telemetri tanpa kunci / kunci salah = 401', (await tel('')).status === 401 && (await tel('salah')).status === 401);
  let ds = []; for (let i = 0; i < 40; i++) ds.push((await tel('tebakan' + i)).status); t('menebak kunci alat berkali-kali: tetap 401, server tidak crash (tercatat: ' + [...new Set(ds)].join(',') + ')', ds.every(x => x === 401 || x === 429) && (await raw('/healthz')).status === 200);
  t('webhook key salah = 403', (await raw('/webhook/fonnte?key=salah', { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } })).status === 403);
  t('webhook tanpa key = 403', (await raw('/webhook/fonnte', { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } })).status === 403);

  console.log('== Masukan jahat ==');
  t('body sangat besar (5 MB) ditolak tanpa mematikan server', await (async () => { try { await raw('/api/device/telemetry', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Device-Key': 'kunci-alat-uji-123' }, body: 'x'.repeat(5e6) }); } catch (e) {} await sleep(200); return (await raw('/healthz')).status === 200; })());
  t('JSON rusak tidak mematikan server', await (async () => { await tel('kunci-alat-uji-123', '{rusak'); return (await raw('/healthz')).status === 200; })());
  const bad = []; for (const b of [{ dist: 'abc' }, { dist: -5 }, { dist: 1e12 }, { dist: null }, { dist: {} }, { dist: [1] }, {}]) { const r = await tel('kunci-alat-uji-123', JSON.stringify({ id: 'x', ...b })); if (r.status >= 500) bad.push(JSON.stringify(b) + '=' + r.status); }
  t('nilai jarak aneh (teks, negatif, raksasa, objek) tidak menyebabkan galat 500', !bad.length, bad.join(' '));
  const pp = await adm.post('/api/admin/config', JSON.parse('{"__proto__":{"polluted":"ya"},"constructor":{"prototype":{"polluted":"ya"}},"lokasi":"Aman"}')); t('upaya prototype pollution lewat config tidak berhasil', ({}).polluted === undefined && (await adm.get('/api/admin/state')).json.config.polluted === undefined && pp.status < 500);
  const nm = await adm.post('/api/admin/config', { waspada: 'abc', siaga: -1, awas: 1e9, interval: 0 }); t('angka ambang tidak valid ditolak (bukan disimpan)', nm.status === 400, nm.text);
  const trav = []; for (const u of ['/../server.js', '/%2e%2e/server.js', '/..%2fdata.json', '/server.js', '/data.json', '/secret.key', '/public/admin.html', '/wa-session/creds.json', '/.env']) { const r = await raw(u); const tx = await r.text(); if (r.status === 200 && !/<html/i.test(tx) === false && /require\(|SECKEY|"config"/.test(tx)) trav.push(u); else if (r.status === 200 && /require\(|SECKEY|"config"/.test(tx)) trav.push(u); } t('berkas server/data/rahasia tidak bisa diunduh lewat URL', !trav.length, trav.join(' '));

  console.log('== Rahasia dan berkas ==');
  const mode = f => (fs.statSync(f).mode & 0o777).toString(8);
  await sleep(5500);   // tunggu simpan berkala
  t('data.json dan secret.key hanya bisa dibaca pemilik (mode 600)', mode(path.join(S.dir, 'data.json')) === '600' && mode(path.join(S.dir, 'secret.key')) === '600', mode(path.join(S.dir, 'data.json')) + ' / ' + mode(path.join(S.dir, 'secret.key')));
  await adm.post('/api/admin/config', { fonnte_token: 'RAHASIA-FONNTE-123', ai_key: 'RAHASIA-AI-456', tg_token: 'RAHASIA-TG-789' }); await sleep(5500);
  const dj = fs.readFileSync(path.join(S.dir, 'data.json'), 'utf8'); t('token Fonnte/AI/Telegram terenkripsi di disk (tidak terbaca di data.json)', !/RAHASIA-(FONNTE|AI|TG)/.test(dj));
  const cfgTxt = JSON.stringify((await adm.get('/api/admin/state')).json); t('token tidak pernah dikirim balik ke dashboard (hanya ********)', !/RAHASIA-(FONNTE|AI|TG)/.test(cfgTxt));
  t('kata sandi admin dan kunci alat hanya tersimpan sebagai hash', !/sandi-uji-123|kunci-alat-uji-123/.test(dj));
  const lg = JSON.stringify((await adm.get('/api/admin/state')).json.events); t('log kejadian tidak memuat token atau kunci', !/RAHASIA|sandi-uji|kunci-alat-uji/.test(lg));
  await adm.post('/api/admin/config', { wa_provider: 'baileys' }); await sleep(600); fs.writeFileSync(path.join(sd, 'SCAN'), '1'); await sleep(500);
  t('folder sesi WhatsApp (Baileys) tertutup untuk pengguna lain (mode 700)', fs.existsSync(path.join(S.dir, 'wa-session')) && mode(path.join(S.dir, 'wa-session')) === '700', fs.existsSync(path.join(S.dir, 'wa-session')) ? mode(path.join(S.dir, 'wa-session')) : 'tidak ada');
  await adm.post('/api/admin/wa/stop', { logout: true });

  console.log('== Header ==');
  const h = (await raw('/login')).headers; t('CSP ketat (skrip hanya dengan nonce, tanpa unsafe-inline), X-Frame-Options=DENY, nosniff, Referrer-Policy terpasang', /frame-ancestors 'none'/.test(h.get('content-security-policy') || '') && /script-src 'nonce-[A-Za-z0-9+\/=]+'/.test(h.get('content-security-policy') || '') && !/script-src[^;]*unsafe-inline/.test(h.get('content-security-policy') || '') && h.get('x-frame-options') === 'DENY' && h.get('x-content-type-options') === 'nosniff' && h.get('referrer-policy') === 'no-referrer');
  t('respons API tidak boleh di-cache (no-store)', /no-store/.test((await adm.get('/api/admin/state')).headers.get('cache-control') || ''));

  console.log('== XSS (browser): data berbahaya dari alat, grup, dan pengaturan ==');
  if (!chromium) t('(dilewati) Playwright belum terpasang', true); else {
    const X = '<img src=x onerror="window.__xss=1"><script>window.__xss=1</script>', X2 = '"><svg onload=window.__xss=1>';
    await adm.post('/api/admin/config', { wa_provider: 'fonnte', lokasi: X, pesan_tambahan: X2, tpl_siaga: X + ' {tinggi}' }); mock.groups = [{ id: '120363000000000009@g.us', name: X }]; mock.connected = true; mock.fetched = true; mock.polls = 9;
    await adm.post('/api/admin/config', { fonnte_token: 'TOKEN-UJI' });
    await raw('/api/device/telemetry', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Device-Key': 'kunci-alat-uji-123' }, body: JSON.stringify({ id: X, dist: 200, fw: X2, rssi: -50 }) });
    await raw('/webhook/fonnte?key=kunci-webhook-uji', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sender: '120363777@g.us', message: X, groupname: X }) });
    const br = await chromium.launch(), pg = await (await br.newContext()).newPage(); let dialogs = 0; pg.on('dialog', d => { dialogs++; d.dismiss(); });
    await pg.goto(S.base + '/login'); await sleep(2500); await pg.fill('#pw', 'sandi-uji-123'); await Promise.all([pg.waitForURL('**/admin', { timeout: 15000 }), pg.click('#go')]).catch(() => {});
    t('(syarat uji XSS) berhasil login ke dashboard', pg.url().endsWith('/admin'), pg.url());
    for (const tab of ['mon', 'rir', 'kal', 'not', 'kon', 'sec']) { await pg.click(`#nav [data-p=${tab}]`).catch(() => {}); await sleep(400); if (tab === 'not') { await pg.click('#gl1').catch(() => {}); await sleep(700); } }
    const dump = await pg.evaluate(() => document.body.innerHTML);
    t('data berbahaya benar-benar sampai ke halaman (uji ini bermakna): nama lokasi tampil sebagai teks', /&lt;img src=x onerror/.test(dump) || /&lt;img/.test(dump), dump.length + ' byte');
    t('tidak ada skrip dari data berbahaya yang berjalan di semua tab (window.__xss kosong, tanpa dialog)', (await pg.evaluate(() => window.__xss)) === undefined && dialogs === 0);
    t('tidak ada elemen <img onerror> / <script> / <svg onload> yang tertanam dari data tersebut', await pg.evaluate(() => !document.querySelector('img[onerror], svg[onload], .content script')));
    await br.close();
  }
  console.log('== Pembatas percobaan login (dijalankan terakhir karena menahan IP ini sementara) ==');
  let st = []; for (let i = 0; i < 8; i++) st.push((await anon.post('/api/admin/login', { password: 'salah' + i })).status); t('tebak kata sandi dibatasi (muncul 429): ' + st.join(','), st.includes(429));
  t('setelah dibatasi, kata sandi benar dari IP yang sama juga ditahan sementara', (await client(S.base).login()).status === 429);

  await S.stop(); mock.srv.close(); process.exit(R.done() ? 0 : 1);
})().catch(e => { console.error('UJI BERHENTI:', e); process.exit(2); });
