// Uji dashboard di browser sungguhan (opsional, butuh Playwright): node tools/uji_dashboard.js
// Butuh:  npm i playwright && npx playwright install chromium     Hasil tangkapan layar: tools/hasil-uji/
const fs = require('fs'), os = require('os'), path = require('path');
let chromium; try { ({ chromium } = require('playwright')); } catch (e) { console.error('Playwright belum terpasang. Jalankan: npm i playwright && npx playwright install chromium'); process.exit(2); }
const { mockFonnte, startServer, client, sleep, reporter } = require('./uji_lib');
(async () => {
  const R = reporter(), t = R.t, mock = await mockFonnte(), out = path.join(__dirname, 'hasil-uji'); fs.mkdirSync(out, { recursive: true });
  const BK = 300000, now = Date.now(), hist = []; for (let b = Math.floor((now - 14 * 864e5) / BK) * BK; b < now - 70 * 60000; b += BK) { if (b > now - 5 * 864e5 && b < now - 5 * 864e5 + 3 * 3600000) continue; const h = Math.round(140 + 110 * Math.sin(b / 9e6) + 25 * Math.sin(b / 9e5)); hist.push({ t: b, min: h - 6, max: h + 8, sum: h * 3, n: 3 }); }
  const readings = []; for (let i = 60; i >= 0; i--) { const h = 120 + (60 - i) * 2.2 + 8 * Math.sin(i / 3); readings.push({ t: now - i * 60000, d: +(400 - h).toFixed(1), h: +h.toFixed(1), lj: 0, l: h >= 250 ? 2 : h >= 150 ? 1 : 0, r: -60 }); }
  const sd = fs.mkdtempSync(path.join(os.tmpdir(), 'stub-ui-')), sf = n => path.join(sd, n), ROOT = path.join(__dirname, '..');
  const S = await startServer(mock, { env: { BAILEYS_MODULE: path.join(ROOT, 'tools', 'stub', 'baileys-stub.js'), QRCODE_MODULE: path.join(ROOT, 'tools', 'stub', 'qrcode-stub.js'), STUB_DIR: sd, WA_SEND_GAP_MS: '0', WA_START_WAIT_MS: '300' }, seed: { rev: 1, hist, readings, state: { level: 1, hs: { h: 252, lj: 60 }, lastSeen: now - 20000, dev: { id: 'sim', rssi: -58, fw: '1.0', up: 5000 } } } });
  const br = await chromium.launch(), ctx = await br.newContext({ viewport: { width: 1280, height: 900 } }), pg = await ctx.newPage(), errs = [];
  pg.on('pageerror', e => errs.push('pageerror: ' + e.message)); pg.on('console', m => { if (m.type() === 'error' && !/Failed to load resource.*status of 4\d\d/.test(m.text())) errs.push('console: ' + m.text()); });   // 4xx sengaja dipicu (sandi salah, template tidak valid)
  pg.on('response', r => { if (r.status() >= 500) errs.push('HTTP ' + r.status() + ' ' + r.url()); });
  pg.on('dialog', d => d.accept());
  const vis = async sel => pg.locator(sel).isVisible();
  console.log('== Login ==');
  await pg.goto(S.base + '/'); t('halaman /login tampil', pg.url().endsWith('/login') && await vis('#pw'));
  await pg.fill('#pw', 'salah'); await pg.click('#go'); await sleep(500); t('kata sandi salah tetap di /login', pg.url().endsWith('/login'));
  await pg.fill('#pw', 'sandi-uji-123'); await Promise.all([pg.waitForURL('**/admin'), pg.click('#go')]); t('login benar masuk /admin', pg.url().endsWith('/admin'));
  await pg.waitForSelector('#hh'); await sleep(800);
  console.log('== Navigasi tab ==');
  for (const [p, id] of [['rir', '#p_rir'], ['kal', '#p_kal'], ['not', '#p_not'], ['kon', '#p_kon'], ['sec', '#p_sec'], ['mon', '#p_mon']]) { await pg.click(`#nav [data-p=${p}]`); await sleep(150); t('tab ' + p + ' terbuka', await vis(id)); }
  await pg.screenshot({ path: out + '/1-ringkasan.png' });

  console.log('== Grafik riwayat ==');
  await pg.click('#nav [data-p=rir]'); await pg.waitForSelector('#hch polyline'); await sleep(300);
  t('grafik 24 jam menggambar garis', await pg.locator('#hch polyline').count() >= 1);
  t('ada kotak statistik (5)', await pg.locator('#hst .k').count() === 5);
  t('garis ambang waspada/siaga/awas tergambar', /waspada/.test(await pg.locator('#hch').innerHTML()) && /awas/.test(await pg.locator('#hch').innerHTML()));
  const box = await pg.locator('#hov').boundingBox(); await pg.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2); await sleep(150);
  const tip = await pg.locator('#hxt2').textContent(); t('tooltip muncul saat kursor di grafik: "' + tip + '"', await pg.locator('#hx').getAttribute('visibility') === 'visible' && /cm/.test(tip));
  await pg.screenshot({ path: out + '/2-riwayat-24jam.png' });
  for (const r of ['1h', '6h', '7d', '14d']) { await pg.click(`[data-hr="${r}"]`); await sleep(600); t('rentang ' + r + ' tergambar tanpa galat', await pg.locator('#hch polyline, #hch circle#hxc').count() >= 1 && await pg.locator(`[data-hr="${r}"].on`).count() === 1); }
  t('tautan CSV mengikuti rentang', (await pg.getAttribute('#hcsv', 'href')).endsWith('range=14d'));
  await pg.screenshot({ path: out + '/3-riwayat-14hari.png' });
  await pg.click('[data-hr="7d"]'); await sleep(600); const gaps = await pg.locator('#hch polyline').count(); t('celah data 3 jam memecah garis pada 7 hari (segmen: ' + gaps + ')', gaps >= 2);
  await pg.click('#nav [data-p=mon]'); await pg.click('[data-go=rir]'); await sleep(200); t('tombol "Riwayat lengkap" di Ringkasan membuka tab Riwayat', await vis('#p_rir'));

  console.log('== Template pesan ==');
  await pg.click('#nav [data-p=not]'); await sleep(200);
  t('6 kotak template terisi bawaan', await pg.locator('#f-tpl textarea').count() === 6 && (await pg.inputValue('#d_tpl_siaga')).includes('{tinggi}'));
  t('pratinjau template menampilkan nilai contoh (bukan kurung kurawal)', /280 cm/.test(await pg.locator('#pv_tpl_siaga').textContent()) && !/\{/.test(await pg.locator('#pv_tpl_siaga').textContent()));
  await pg.fill('#d_tpl_siaga', 'SIAGA {lokasi}\n{penutup}\nAir {tinggi} cm'); await sleep(100);
  const pv = await pg.locator('#pv_tpl_siaga').innerText(); t('pratinjau langsung berubah; baris {penutup} kosong dibuang', /Air 280 cm/.test(pv) && !/\n\s*\n/.test(pv), JSON.stringify(pv));
  await pg.focus('#d_tpl_siaga'); await pg.click('[data-ph="{waktu}"]'); t('klik isian menyisipkan {waktu} ke kotak terakhir', (await pg.inputValue('#d_tpl_siaga')).includes('{waktu}'));
  await pg.fill('#d_tpl_siaga', 'SIAGA {salah}'); await pg.click('#save'); await sleep(500); t('simpan template tidak valid menampilkan galat', /salah/.test(await pg.locator('#toast').innerText()));
  await pg.click('[data-treset="tpl_siaga"]'); t('Kembalikan bawaan', (await pg.inputValue('#d_tpl_siaga')) === await pg.evaluate(() => S.tplDefaults.tpl_siaga));
  await pg.fill('#d_tpl_awas', 'Air tinggi'); await pg.click('#save'); await sleep(500); t('template AWAS tanpa tindakan ditolak di UI', /AWAS/.test(await pg.locator('#toast').innerText()));
  await pg.click('[data-tpreset="ringkas"]'); await sleep(150); t('tombol gaya "Ringkas" mengisi keenam template dengan isi gaya itu', (await pg.inputValue('#d_tpl_siaga')) === await pg.evaluate(() => S.tplPresets.ringkas.tpl_siaga) && (await pg.inputValue('#d_tpl_awas')) === await pg.evaluate(() => S.tplPresets.ringkas.tpl_awas) && /280 cm/.test(await pg.locator('#pv_tpl_siaga').innerText()));
  await pg.click('[data-tpreset="tegas"]'); await pg.click('#save'); await sleep(600); t('gaya "Tegas" bisa disimpan', /disimpan/.test(await pg.locator('#toast').innerText()));
  await pg.screenshot({ path: out + '/4b-gaya-tegas.png' });
  await pg.click('[data-tpreset="standar"]'); await pg.click('#save'); await sleep(500);
  await pg.click('[data-treset="tpl_awas"]'); await pg.fill('#d_tpl_siaga', '{emoji} *SIAGA* {lokasi}\nAir {tinggi} cm. {tindakan}'); await pg.click('#save'); await sleep(600); t('template valid tersimpan', /disimpan/.test(await pg.locator('#toast').innerText()));
  await pg.screenshot({ path: out + '/4-template.png', fullPage: false });

  console.log('== WhatsApp: token, grup, uji ==');
  await pg.fill('#d_fonnte_token', 'TOKEN-UJI'); await pg.click('#save'); await sleep(600);
  await pg.click('#gl1'); await sleep(600); t('ambil daftar sebelum pernah diperbarui: tampil petunjuk (bukan kosong membisu)', /Perbarui daftar/.test(await pg.locator('#gl').innerText()), await pg.locator('#gl').innerText());
  await pg.click('#gl2'); await sleep(700); t('perangkat terputus: pesan galat tetap tampil di halaman', /terputus/i.test(await pg.locator('#gl').innerText()), await pg.locator('#gl').innerText());
  mock.connected = true; await pg.click('#gl2'); await pg.waitForSelector('#gl [data-id]', { timeout: 8000 }); t('daftar grup muncul dengan tombol Pakai', await pg.locator('#gl [data-id]').count() === 2);
  await pg.screenshot({ path: out + '/5-daftar-grup.png' });
  await pg.locator('#gl [data-id]').first().click(); t('tombol Pakai mengisi ID grup', (await pg.inputValue('#d_wa_target')).endsWith('@g.us')); await pg.click('#save'); await sleep(600);
  mock.sends.length = 0; await pg.click('[data-tsend="tpl_siaga"]'); await sleep(700); t('"Kirim contoh ke grup" sampai ke Fonnte tiruan', mock.sends.length === 1 && /CONTOH TEMPLATE/.test(mock.sends[0].message) && mock.sends[0].target.endsWith('@g.us'));
  mock.sends.length = 0; await pg.click('[data-t=wa]'); await sleep(700); t('"Tes WhatsApp" terkirim', mock.sends.length === 1 && /UJI COBA/.test(mock.sends[0].message));

  console.log('== Koneksi ==');
  await pg.click('#nav [data-p=kon]'); await sleep(300);
  t('alamat webhook ditampilkan', /\/webhook\/fonnte\?key=/.test(await pg.locator('#wh').textContent()));
  t('panduan F (dua arah) tersedia', await pg.locator('text=F. Hardware dan software saling terhubung').count() === 1);
  await pg.locator('details.dd', { hasText: 'D. Webhook' }).locator('summary').click(); await pg.screenshot({ path: out + '/6-koneksi-webhook.png', fullPage: true });

  console.log('== Spanduk ==');
  await pg.click('#nav [data-p=mon]'); await sleep(200);
  t('spanduk menampilkan lokasi dan tinggi air', /Titik Pantau/.test(await pg.locator('#bnl').textContent()) && /\d+ cm/.test(await pg.locator('#bnh').textContent()));
  t('spanduk tinggi di Ringkasan, ramping di tab lain', await pg.locator('#bn.tall').count() === 1 && (await pg.click('#nav [data-p=kon]'), await pg.locator('#bn.tall').count()) === 0);

  console.log('== Wizard Hubungkan alat ==');
  await sleep(300); t('wizard tampil dengan dua kartu alat, Sungai terpilih', await vis('#wz') && await pg.locator('#wz .dvc').count() === 2 && await pg.locator('#wz .dvc.on[data-dv=sungai]').count() === 1);
  await pg.fill('#wz_ssid', 'Hotspot "Desa"'); await pg.fill('#wz_pass', 'sandi\\1');
  let out1 = await pg.locator('#wz_out').textContent(); t('config.h Sungai: format #define dan karakter khusus di-escape', /#define WIFI_SSID  "Hotspot \\"Desa\\""/.test(out1) && /#define WIFI_PASS  "sandi\\\\1"/.test(out1), out1);
  await pg.click('[data-dv=maket]'); out1 = await pg.locator('#wz_out').textContent(); t('pilih Maket: format .ino dan ID otomatis maket-01', /const char\* WIFI_SSID/.test(out1) && await pg.inputValue('#wz_id') === 'maket-01', out1);
  await pg.click('[data-dv=sungai]'); t('kembali ke Sungai: ID node-1', await pg.inputValue('#wz_id') === 'node-1');
  t('kolom alamat terisi otomatis (IP jaringan atau alamat halaman)', /^https?:\/\/.+/.test(await pg.inputValue('#wz_url')));
  const warn = async u => { await pg.fill('#wz_url', u); return (await pg.locator('#wz_warn').innerText()); };
  t('alamat localhost diperingatkan (alat tidak bisa menjangkau)', /localhost/.test(await warn(S.base)));
  t('alamat https diterima', /https:/.test(await warn('https://siaga.contoh.id')) && await pg.locator('#wz_warn .note.er').count() === 0);
  t('alamat http publik diperingatkan tidak terenkripsi', /tidak terenkripsi/.test(await warn('http://203.0.113.5:3001')));
  t('alamat tanpa http(s) ditolak', /diawali http/.test(await warn('siaga.contoh.id')));
  await pg.fill('#wz_url', 'http://192.168.1.20:3001');
  t('sebelum kunci dibuat: ada peringatan kunci belum diisi', /Kunci alat belum diisi/.test(await pg.locator('#wz_warn').innerText()) && /KUNCI_ALAT_BELUM_DIBUAT/.test(await pg.locator('#wz_out').textContent()));
  await pg.click('#wz_gen'); await sleep(600); const out2 = await pg.locator('#wz_out').textContent(), nk = (/DEVICE_KEY "([^"]+)"/.exec(out2) || [])[1] || '';
  t('buat kunci: kunci masuk ke config.h (' + nk.length + ' karakter)', nk.length >= 20 && !/BELUM_DIBUAT/.test(out2));
  const tele = k => fetch(S.base + '/api/device/telemetry', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Device-Key': k }, body: JSON.stringify({ id: 'node-1', dist: 150, rssi: -58, fw: '1.0', up: 30 }) });
  t('kunci dari wizard benar-benar diterima server (200)', (await tele(nk)).status === 200); t('kunci lama langsung tidak berlaku (401)', (await tele('kunci-alat-uji-123')).status === 401);
  await pg.waitForFunction(() => /Tersambung/.test(document.querySelector('#wzb').textContent) && !/Belum/.test(document.querySelector('#wzb').textContent), null, { timeout: 12000 }); t('indikator wizard berubah "Tersambung" otomatis saat alat mengirim', true);
  t('daftar langkah 4 menampilkan ID dan sinyal alat', /node-1/.test(await pg.locator('#wz_live').innerText()) && /-58 dBm/.test(await pg.locator('#wz_live').innerText()), await pg.locator('#wz_live').innerText());
  await pg.screenshot({ path: out + '/8-wizard-alat.png', fullPage: true });
  t('kartu Status sambungan memuat Server hidup dan Folder data', /Server hidup/.test(await pg.locator('#chk').innerText()) && /Folder data/.test(await pg.locator('#chk').innerText()));

  console.log('== Kalibrasi maket tinwall, notifikasi anti-spam, tanya jawab ==');
  await pg.click('#nav [data-p=kal]'); await sleep(300);
  await pg.click('[data-pre=maket]'); await sleep(200);
  t('preset maket tinwall: dasar 200, waspada 50, siaga 90, awas 120', await pg.inputValue('#d_base') === '200' && await pg.inputValue('#d_waspada') === '50' && await pg.inputValue('#d_siaga') === '90' && await pg.inputValue('#d_awas') === '120');
  t('preset maket mengisi pembatas notifikasi (jeda 1 menit, pembaruan 20 cm)', await pg.inputValue('#d_notif_gap') === '1' && await pg.inputValue('#d_notif_delta') === '20');
  t('kolom pengingat berkala lama sudah tidak ada', await pg.locator('#d_remind, #d_remind_awas').count() === 0);
  await pg.click('#save'); await sleep(600); t('preset maket tersimpan', /disimpan/.test(await pg.locator('#toast').innerText()));
  t('tab Kalibrasi memuat tombol kalibrasi dasar otomatis', await vis('#cb'));
  await pg.click('#cb'); await sleep(700); t('kalibrasi dasar tanpa bacaan segar: ditolak dengan pesan jelas', /bacaan/i.test(await pg.locator('#cbr').textContent()), await pg.locator('#cbr').textContent());
  for (let i = 0; i < 12; i++) await fetch(S.base + '/api/device/telemetry', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Device-Key': nk }, body: JSON.stringify({ id: 'maket-01', dist: 200 + (i % 3) * 0.1, rssi: -55 }) });
  await pg.click('#cb'); await sleep(1500); t('tangki kosong dengan bacaan stabil: dasar tersimpan dan kolom ikut terbarui', /Dasar 200 -> 200/.test(await pg.locator('#cbr').textContent()) || /Dasar [\d.]+ -> 200/.test(await pg.locator('#cbr').textContent()), await pg.locator('#cbr').textContent());
  await pg.click('#nav [data-p=not]'); await sleep(250);
  t('pengaturan tanya jawab: jeda per orang dan batas per jam tersedia', await vis('#d_qa_gap') && await vis('#d_qa_budget'));
  await pg.screenshot({ path: out + '/8b-notifikasi.png', fullPage: true });

  console.log('== WhatsApp Baileys (Baileys tiruan) ==');
  await pg.click('#nav [data-p=not]'); await sleep(200);
  t('mode Fonnte: panel Baileys tersembunyi', !(await vis('#wa_bail')) && await vis('#gl2'));
  await pg.selectOption('#d_wa_provider', 'baileys'); await sleep(150); t('pilih Baileys: panel muncul, tombol Perbarui Fonnte tersembunyi', await vis('#wa_bail') && !(await vis('#gl2')));
  await pg.click('#save'); await sleep(500); await pg.click('#wb_go'); await pg.waitForSelector('#wb_qr:not([hidden])', { timeout: 12000 }); t('klik Hubungkan: QR tampil', /^data:image/.test(await pg.getAttribute('#wb_img', 'src')) && /Menunggu scan/.test(await pg.locator('#wb_st').textContent()));
  await pg.screenshot({ path: out + '/9-baileys-qr.png' });
  fs.writeFileSync(sf('SCAN'), '1'); await pg.waitForFunction(() => /Terhubung/.test(document.querySelector('#wb_st').textContent), null, { timeout: 15000 }); t('setelah scan: status Terhubung dan nomor tampil', /6281200000000/.test(await pg.locator('#wb_me').textContent()) && !(await vis('#wb_qr')));
  await pg.waitForSelector('#gl [data-id]', { timeout: 8000 }); t('daftar grup otomatis muncul begitu terhubung (2 grup)', await pg.locator('#gl [data-id]').count() === 2);
  await pg.screenshot({ path: out + '/10-baileys-terhubung.png' });
  await pg.locator('#gl [data-id]').first().click(); await pg.click('#save'); await sleep(500);
  await pg.click('[data-t=wa]'); await sleep(800); t('Tes WhatsApp lewat Baileys', fs.existsSync(sf('OUT.jsonl')) && /UJI COBA/.test(fs.readFileSync(sf('OUT.jsonl'), 'utf8')));
  await pg.click('#nav [data-p=kon]'); await sleep(300); t('Status sambungan: WhatsApp (Baileys) hijau dan webhook "tidak diperlukan"', /WhatsApp \(Baileys\)/.test(await pg.locator('#chk').innerText()) && /Tidak diperlukan/.test(await pg.locator('#chk').innerText()));
  await pg.click('#nav [data-p=not]'); await pg.click('#wb_out'); await pg.waitForFunction(() => /Belum dihidupkan/.test(document.querySelector('#wb_st').textContent), null, { timeout: 8000 }); t('Putuskan dan hapus sesi: status kembali Belum dihidupkan', true);

  console.log('== Pompa: isi sampai target ==');
  const teleP = o => fetch(S.base + '/api/device/telemetry', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Device-Key': nk }, body: JSON.stringify({ id: 'maket-01', dist: 200, base: 200, rssi: -58, fw: '3.0-mqtt', up: 30, pump: 0, ...o }) }).then(r => r.json());
  await teleP({}); await pg.click('#nav [data-p=mon]'); await sleep(300);
  t('Demo maket ada di Ringkasan tetapi TERSEMBUNYI (tertutup) secara bawaan', await vis('#pumpc') && !(await vis('#ptc')) && !(await vis('#ptg')));
  await pg.click('#pumpc summary'); await sleep(200);
  t('klik judul membuka kontrol "Isi sampai target" (3 tombol level)', await vis('#ptc') && await vis('#ptg') && await pg.locator('[data-pl]').count() === 3);
  await pg.fill('#ptc', '90'); await pg.click('#ptg'); await sleep(500);
  let pr = await teleP({}); t('klik "Isi sampai target" 90 cm: alat dibalas mode TARGET, 0,9 m', pr.pump_mode === 'TARGET' && pr.target_m === 0.9 && pr.pump === 0, JSON.stringify(pr));
  t('dashboard menulis perintah dan pengingat kosongkan manual', /berhenti sendiri/.test(await pg.locator('#pter').innerText()) && /kosongkan wadah/i.test(await pg.locator('#pter').innerText()));
  await pg.waitForFunction(() => /isi sampai 90 cm/.test(document.querySelector('#pst').textContent), null, { timeout: 12000 }); t('status pompa: "Perintah: isi sampai 90 cm"', true);
  await pg.fill('#ptc', '999'); await pg.click('#ptg'); await sleep(400); t('target tidak masuk akal (999) ditolak dengan pesan', /Target harus/.test(await pg.locator('#pter').innerText()));
  await pg.click('[data-pl="2"]'); await sleep(400); pr = await teleP({}); t('tombol SIAGA: alat dibalas target_lvl 2', pr.pump_mode === 'TARGET' && pr.target_lvl === 2, JSON.stringify(pr));
  await pg.click('#poff'); await sleep(400); pr = await teleP({}); t('tombol Matikan membatalkan target', pr.pump_mode === 'OFF');
  await pg.screenshot({ path: out + '/9-pompa-target.png', fullPage: true });

  console.log('== Wi-Fi alat dan pengaturan tersimpan ==');
  await teleP({ ssid: 'Wifi Lama', ssid_b: 'Wifi Cadangan', wsrc: 'alat', via: 'mqtt', mqh: 'broker.contoh:8883' });
  await pg.click('#nav [data-p=kon]'); await sleep(500); await pg.waitForFunction(() => /Wifi Lama/.test(document.querySelector('#wfs').textContent), null, { timeout: 12000 });
  t('kartu Wi-Fi alat menyebut Wi-Fi sekarang dan "tersimpan di alat"', /Wifi Lama/.test(await pg.locator('#wfs').innerText()) && /tersimpan di alat/.test(await pg.locator('#wfs').innerText()));
  await pg.click('#wfscan'); await sleep(500); let wr = await teleP({ ssid: 'Wifi Lama' });
  t('klik Cari Wi-Fi: alat diperintah memindai (wifi_scan di balasan)', Number.isInteger(wr.wifi_scan), JSON.stringify(wr).slice(0, 200));
  await fetch(S.base + '/api/device/wifi', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Device-Key': nk }, body: JSON.stringify({ tok: wr.wifi_scan, list: [{ s: 'Warung K3', r: -50, e: 1 }, { s: 'Hotspot "HP" <x>', r: -75, e: 0 }] }) });
  await pg.waitForFunction(() => document.querySelectorAll('#wfl .wfi').length === 2, null, { timeout: 12000 });
  t('daftar hasil pindai tampil sebagai tombol (sinyal dan berkunci/terbuka), nama aneh aman', /sinyal kuat/.test(await pg.locator('#wfl .wfi').first().innerText()) && /terbuka/.test(await pg.locator('#wfl .wfi').nth(1).innerText()) && (await pg.locator('#wfl .wfi').nth(1).getAttribute('data-s')) === 'Hotspot "HP" <x>');
  await pg.locator('#wfl .wfi').first().click(); t('klik jaringan mengisi kolom nama Wi-Fi', (await pg.inputValue('#wfn')) === 'Warung K3');
  await pg.fill('#wfp', 'sandi-rahasia-9'); await pg.click('#wfgo'); await sleep(500);
  t('sandi dikosongkan dari kolom setelah dikirim; status menunggu alat', (await pg.inputValue('#wfp')) === '' && /Menunggu alat/.test(await pg.locator('#wfr').innerText()));
  wr = await teleP({ ssid: 'Wifi Lama' }); t('alat menerima perintah wifi_set lengkap', wr.wifi_set && wr.wifi_set.ssid === 'Warung K3' && wr.wifi_set.pass === 'sandi-rahasia-9', JSON.stringify(wr.wifi_set));
  await teleP({ ssid: 'Warung K3', wsrc: 'alat', wifi_tok: wr.wifi_set.tok, wifi_res: 'ok' });
  await pg.waitForFunction(() => /Berhasil/.test(document.querySelector('#wfr').textContent), null, { timeout: 12000 }); t('dashboard menampilkan "Berhasil" setelah alat melapor', true);
  const stgTxt = await pg.locator('#stg').innerText();
  t('kartu "Pengaturan yang sudah tersimpan": Wi-Fi, broker, kunci, kalibrasi, pompa; ada keterangan "Disimpan di" dan "Cara mengubah"', ['Wi-Fi alat', 'Broker MQTT di alat', 'ID dan kunci alat', 'Kalibrasi', 'Perintah pompa'].every(x => stgTxt.includes(x)) && /Disimpan di/.test(stgTxt) && /Cara mengubah/.test(stgTxt) && /Tanpa compile/i.test(stgTxt));
  await pg.screenshot({ path: out + '/10-wifi-alat.png', fullPage: true });

  console.log('== Tampilan HP ==');
  await pg.setViewportSize({ width: 390, height: 800 }); await pg.click('#nav [data-p=rir]'); await sleep(700);
  t('tidak ada gulir ke samping di HP', await pg.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), await pg.evaluate(() => document.documentElement.scrollWidth + ' vs ' + window.innerWidth));
  await pg.screenshot({ path: out + '/7-riwayat-hp.png' });
  t('tidak ada galat JavaScript/konsol selama uji: ' + (errs.length ? errs.join(' | ') : 'bersih'), errs.length === 0);
  await br.close(); await S.stop(); mock.srv.close(); process.exit(R.done() ? 0 : 1);
})().catch(e => { console.error('UJI BERHENTI:', e); process.exit(2); });
