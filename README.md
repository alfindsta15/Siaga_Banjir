# SIAGA BANJIR - paket lengkap

> **Mulai dari [TUTORIAL.md](TUTORIAL.md)**: satu berkas berisi semua langkah (rakit maket, server, MQTT online dari awal, kalibrasi, ganti Wi-Fi, demo, pemecahan masalah).

Sistem peringatan dini banjir: alat sensor (sungai atau maket) -> server -> grup WhatsApp warga,
dengan dashboard web khusus admin untuk monitoring dan kalibrasi. Peringatan lokal (LED/sirine) tetap
bekerja walau internet mati.

## Isi paket
```
siaga-banjir/
  README.md                       panduan ini
  package.json
  server/
    server.js                     server (Node.js 18+, tanpa npm install)
    template_fonnte.json          gaya template pesan siap pakai (Ringkas, Tegas)
    public/login.html, admin.html halaman login dan dashboard admin
  server/wa_baileys.js            penghubung WhatsApp lewat Baileys (opsional)
  server/mqtt_bridge.js           penghubung MQTT alat <-> server (aktif bila MQTT_URL diisi, tanpa dependensi)
  docs/TEMPLATE_FONNTE.md         template pesan WhatsApp + daftar isian
  TUTORIAL.md                     TUTORIAL LENGKAP SATU BERKAS: rakit maket, server, MQTT online, demo, pemecahan masalah
  docs/ONLINE.md                  alat dan server online bersamaan, jalan otomatis, putus-sambung
  docs/BAILEYS.md                 WhatsApp lewat Baileys (tanpa webhook)
  deploy/                         systemd, Caddy, Cloudflare Tunnel, pm2, skrip Windows
  tools/simulasi.js               simulasi alat tanpa perangkat keras
  tools/uji.js, uji_dashboard.js  uji otomatis server dan dashboard (npm test)
  tools/uji_mqtt.js               uji MQTT end-to-end dengan broker mini (npm run uji:mqtt)
  firmware/
    siaga_node/                   ESP32 + sensor A02YYUW (versi sungai)  [siaga_node.ino, config.h]
    desa_siaga_banjir/            ESP8266 + HC-SR04 + pompa (versi MAKET) [desa_siaga_banjir.ino]
      asli/                       berkas .ino asli dari Anda (arsip)
  cetak-3d/                       STL boks, tutup, klem probe, pelindung sensor, dudukan tiang + skrip parametrik
```

## 1. Menjalankan server
Butuh Node.js 18 ke atas (`node -v`). Di folder `siaga-banjir`, cukup jalankan:
```
node server/server.js
```
Tanpa pengaturan apa pun, server membuat **kata sandi admin** dan **kunci alat** acak dan menampilkannya **sekali** di terminal. Catat keduanya
(kata sandi untuk login, kunci alat untuk config.h/.ino), lalu ganti kapan saja di dashboard, tab Keamanan.
Bila ingin menentukan sendiri: `ADMIN_PASSWORD="..." DEVICE_KEY="..." node server/server.js` (PowerShell: `$env:ADMIN_PASSWORD="..."; node server/server.js`),
kata sandi minimal 8 karakter dan kunci alat minimal 12. Nilai ini hanya dipakai pertama kali.

Alamat: `http://localhost:3001` membuka halaman **/login** terpisah; setelah masuk Anda diarahkan ke dashboard **/admin**.
Halaman dashboard tidak dikirim ke siapa pun yang belum login.

Port bawaan **3001** (ubah dengan `PORT`; `SERVER_URL` di alat harus memakai port yang sama).
Variabel opsional: `PORT`, `DATA_DIR` (folder data), `SECRET_KEY` (kunci enkripsi token), `WEBHOOK_KEY` (mengaktifkan webhook Fonnte),
`TRUST_PROXY=1` (bila di belakang proxy HTTPS).

Coba tanpa alat: `DEVICE_KEY="kunci-alat" node tools/simulasi.js http://localhost:3001 1500`

## 2. Dashboard admin (khusus admin, warga tidak punya akses)
| Tab | Fungsi |
|---|---|
| Ringkasan | Panduan awal 4 langkah, level, tangki air, grafik ringkas, status alat, catatan kejadian, kontrol pompa maket |
| Riwayat | Grafik ketinggian air 1 jam sampai 14 hari (rata-rata, rentang terendah-tertinggi, ambang, statistik, unduh CSV) |
| Kalibrasi | **Preset sungai/maket**, ambang utama, bantuan hitung jarak dasar, simulasi level, pengaturan lanjutan (sudah punya nilai bawaan) |
| Notifikasi | Token Fonnte/Telegram, pilih grup WhatsApp otomatis, **template pesan** (gaya Standar/Ringkas/Tegas), laporan harian, asisten AI, tanya jawab AI, contoh pesan |
| Koneksi | **Wizard Hubungkan alat** (pilih alat, isi Wi-Fi, buat kunci, config.h siap salin, deteksi alat tersambung), kesiapan online, panduan mengonlinekan |
| Keamanan | Ganti kata sandi, buat kunci alat baru |

Warga memantau hanya lewat WhatsApp: pesan saat ada perubahan berarti (bukan berkala), laporan harian, ketik `STATUS`, atau `TANYA <pertanyaan>` (juga dengan menyebut/membalas pesan bot bila memakai Baileys). Aturan kapan pesan dikirim ada di [docs/TEMPLATE_FONNTE.md](docs/TEMPLATE_FONNTE.md).

## 3. Keamanan (sekali dimasukkan, tidak bisa dilihat lagi)
- Token Fonnte, Telegram, dan kunci AI disimpan **terenkripsi** (AES-256-GCM). Kunci enkripsi ada di berkas `server/secret.key`
  (atau variabel `SECRET_KEY`). Jangan hilangkan dan cadangkan terpisah dari `data.json`; tanpa itu token harus diisi ulang.
- Kata sandi admin dan kunci alat disimpan sebagai hash dan tidak pernah ditampilkan. Kunci alat baru hanya tampil sekali saat dibuat.
- Login dikunci 15 menit setelah 5 kali salah. Jika diakses dari internet, wajib HTTPS (Cloudflare Tunnel, Caddy, atau Nginx).
- Server tetap bisa memakai token untuk mengirim pesan; perlindungan ini untuk dashboard, cadangan, dan berkas yang tersalin.

## 4. WhatsApp: Baileys atau Fonnte
Dashboard > Notifikasi > WhatsApp > **Penyedia**: pilih salah satu.
- **Baileys** (langsung dari server, scan QR, tanpa webhook, daftar grup selalu lengkap; tidak resmi): lihat [docs/BAILEYS.md](docs/BAILEYS.md). Perlu `npm install`. Fonnte bisa dibiarkan sebagai **cadangan otomatis**.
- **Fonnte** (layanan pihak ketiga): langkah di bawah.

### Fonnte
1. Daftar di fonnte.com, cek paket dan harga terbaru. Sambungkan **nomor khusus** sampai status **Connected**, lalu masukkan nomor itu ke grup warga.
2. **Token dan grup.** Dashboard > Notifikasi: isi token perangkat Fonnte, Simpan, klik **Ambil daftar grup**. Bila kosong, klik **Perbarui daftar dari WhatsApp** (bisa sampai +-20 detik). Pilih grup dengan **Pakai**, Simpan, lalu **Tes WhatsApp**.
   Pembaruan dari WhatsApp dibatasi sekali per jam agar nomor tidak dibatasi; percobaan yang gagal (mis. perangkat terputus) tidak memakai jatah itu.
3. **Daftar grup masih kosong?**
   - Pesan "perangkat Fonnte sedang terputus": buka fonnte.com > Device, scan ulang QR sampai Connected, lalu coba lagi.
   - Nomor Fonnte belum menjadi anggota grup warga: masukkan dulu, lalu Perbarui.
   - Cadangan: isi kolom **ID grup** manual (bentuk `1203630xxxxxxxxxx@g.us`), atau aktifkan webhook (poin 4) lalu ketik apa saja di grup; ID grup itu otomatis muncul di daftar, bertanda "tertangkap dari webhook".
4. **Webhook** (untuk balasan `STATUS` dan `TANYA`; opsional). Webhook adalah alamat server ini yang dipanggil Fonnte setiap ada pesan masuk. Pesan keluar (peringatan, laporan harian) tidak membutuhkannya.
   - Server harus terjangkau dari internet lewat **HTTPS** (Cloudflare Tunnel atau VPS, bagian 8). `localhost` dan IP lokal tidak bisa dijangkau Fonnte.
   - Jalankan server dengan kunci webhook: `WEBHOOK_KEY=kata-acak-panjang node server/server.js` (PowerShell: `$env:WEBHOOK_KEY="kata-acak-panjang"; node server/server.js`).
   - Di fonnte.com > Device > pengaturan perangkat, isi kolom **Webhook** dengan `https://ALAMAT-SERVER/webhook/fonnte?key=kata-acak-panjang`. Nama dan letak menu Fonnte bisa berubah; bila kolomnya tidak ada, cek paket Anda.
   - Uji: ketik `STATUS` di grup, bot membalas. Ringkasan > Catatan kejadian menampilkan baris **Webhook** untuk setiap pesan yang sampai. Tidak ada baris = Fonnte tidak menjangkau server; "key salah" = bagian `?key=` tidak sama dengan `WEBHOOK_KEY`; ada baris tapi tak dibalas = ID grup di Notifikasi belum sama dengan grup tempat Anda mengetik. Hanya grup yang terdaftar di kolom ID grup yang dilayani.
5. Fonnte tidak resmi; kirim seperlunya. Pesan bisa tertahan bila perangkat Fonnte terputus, jadi jangan menjadikan WhatsApp satu-satunya jalur.

## 5. Template pesan
Bentuk pesan bisa diubah di Dashboard > Notifikasi > **Template pesan WhatsApp**: enam template (NORMAL, WASPADA, SIAGA, AWAS, laporan harian, alat tidak mengirim data), pratinjau langsung, isian `{tinggi}`, `{lokasi}`, dll. yang bisa disisipkan dengan satu klik, tombol **Gaya siap pakai** (Standar, Ringkas, Tegas), dan **Kirim contoh ke grup** untuk menguji tanpa menyimpan. Daftar isian dan semua gaya ada di [docs/TEMPLATE_FONNTE.md](docs/TEMPLATE_FONNTE.md). Template AWAS wajib memuat `{tindakan}` atau kata "evakuasi".

## 5b. Aturan pesan
- Pesan dikirim **saat level berubah**, bukan tiap pengukuran. Isi ringkas: level, tinggi air, tren, tindakan, waktu.
- **Laporan harian** sekali sehari (jam diatur, bawaan 06.00 WIB). Saat level WASPADA ke atas laporan harian dilewati karena
  pembaruan berkala berjalan (jeda WASPADA/SIAGA dan AWAS diatur di tab Kalibrasi).
- Kalimat penutup pesan opsional (bawaan kosong). Simbol emoji di pesan WhatsApp bisa dimatikan di tab Notifikasi (dashboard sendiri tidak memakai emoji, hanya ikon). Pesan "alat tidak mengirim data" otomatis bila alat diam melebihi batas.

## 6. Asisten AI (opsional, Groq atau Gemini)
- Dashboard > Notifikasi > Asisten AI: isi kunci API, pilih penyedia, aktifkan, klik **Tes AI**.
- **Penjelasan edukasi:** AI hanya merapikan bahasa (opsional + Jawa) untuk level NORMAL/WASPADA/SIAGA. Pesan standar tidak menunggu AI,
  AWAS tidak memakai AI, keluaran yang menambah angka atau menyebut evakuasi pada level rendah ditolak.
- **Tanya jawab:** warga mengetik `TANYA ...` atau `bot ...` di grup; dengan Baileys, cukup menyebut (@) nomor bot atau membalas pesan bot. Jawaban dikirim sebagai balasan yang mengutip pertanyaan, memakai kondisi sungai dan "panduan desa" yang Anda isi; angka karangan ditolak; pada AWAS balasan berupa tindakan tetap. Pembatas (bisa diubah di Notifikasi): jeda per orang 30 detik, batas 30 pertanyaan/jam ke AI, dan pertanyaan yang sama dalam 10 menit memakai jawaban tersimpan.
- Nama model bisa berubah; isi kolom "Nama model" bila muncul galat model tidak ditemukan. Jangan kirim data pribadi warga ke layanan AI.

## 7. Hardware
### A. Versi sungai (ESP32 + A02YYUW) - `firmware/siaga_node/`
| Dari | Ke ESP32 |
|---|---|
| Sensor VCC / GND / TX | 3V3 / GND / GPIO 16 (cek lembar data modul) |
| LED hijau, kuning, merah (+220 ohm) | GPIO 25, 26, 27 |
| Buzzer aktif | GPIO 14 -> 1 kohm -> basis NPN (2N2222); buzzer antara 5V dan kolektor |
| Tombol uji | GPIO 33 ke GND |
Isi `config.h` (SSID, kata sandi, SERVER_URL, DEVICE_KEY), pasang library **ArduinoJson v7**, papan ESP32 Dev Module, unggah, buka Serial Monitor 115200.

### B. Versi maket (ESP8266 NodeMCU + HC-SR04 + pompa) - `firmware/desa_siaga_banjir/`
Pin: D1 TRIG, D2 ECHO (lewat pembagi 1k/2k), D5 LED, D6 buzzer, D7 MOSFET pompa. Isi `konfigurasi.h` (Wi-Fi, DEVICE_KEY, broker MQTT atau SERVER_URL; **jangan dibagikan**). Kalibrasi tinwall 17 x 11 x 7,5 cm dengan sensor 10 cm di atas dasar: tangki kosong lalu kirim `k` di Serial Monitor (atau tombol "Tangki kosong" di dashboard), kemudian Kalibrasi > preset **Maket tinwall** > Simpan. Lengkapnya di [docs/MAKET.md](docs/MAKET.md).
Pompa dikontrol dari dashboard (kartu "Pompa maket"): **Isi sampai target** (tinggi nyata atau level; pompa berhenti sendiri, wadah dikosongkan manual setelah demo) atau Nyalakan manual, dengan pengaman di alat. Firmware v3.0 online **lewat MQTT** (`PAKAI_MQTT 1` di `konfigurasi.h`) atau HTTP (`PAKAI_MQTT 0`). Uji pompa dengan wadah penampung, jangan ditinggal. **Ganti Wi-Fi tanpa compile ulang:** dashboard > Koneksi > Wi-Fi alat (cari, pilih, sandi), atau hotspot `SIAGA-SETUP` milik alat (192.168.4.1); `konfigurasi.h` cukup diisi sekali. Tutorial lengkap: [TUTORIAL.md](TUTORIAL.md).

## 8. Mengonlinekan: hardware dan software saling terhubung
Semua sambungan dimulai dari alat atau dari server ke luar, jadi tidak ada port yang perlu dibuka di alat.
```
 [Sensor + ESP] --(1) POST /api/device/telemetry, header X-Device-Key--------> [Server]
 [Sensor + ESP] <--(2) balasan: level, perintah pompa, ambang (cfg)----------- [Server]
 [Server] --(3) kirim pesan--> [API Fonnte] --> [Grup WhatsApp warga]
 [Grup WhatsApp] --STATUS/TANYA--> [Fonnte] --(4) webhook /webhook/fonnte?key=...--> [Server]
```
**Hardware ke software (1):** alat mengirim jarak sensor tiap interval (5 dtk maket, 60 dtk sungai). Syarat: Wi-Fi 2,4 GHz berinternet (atau satu jaringan dengan server saat demo), `SERVER_URL` sama dengan alamat dashboard (tanpa garis miring di akhir, port sama), dan `DEVICE_KEY` sama dengan kunci alat. Berhasil bila Serial Monitor menunjukkan **HTTP 200**.
**Software ke hardware (2):** server tidak bisa menghubungi alat langsung (alat di belakang router/hotspot), jadi perintah **dititipkan di balasan** kiriman alat. Ubah ambang/jarak dasar/interval di Kalibrasi lalu Simpan: alat menerimanya pada kiriman berikutnya dan menyimpannya. Tombol pompa maket di Ringkasan: alat membacanya pada kiriman berikutnya, perintah kedaluwarsa sendiri setelah 120 detik. Bila alat offline perintah tidak sampai; alat memakai angka terakhir dan LED/sirine lokal tetap bekerja.
**Webhook (4)** hanya untuk balasan perintah warga; lihat bagian 4 poin 4.

Lengkapnya, termasuk jalan otomatis saat listrik hidup, Cloudflare Tunnel tetap, VPS, dan apa yang terjadi bila ada yang putus: [docs/ONLINE.md](docs/ONLINE.md).

**Alternatif yang paling mudah untuk online: MQTT.** Alat dan server sama-sama menyambung *keluar* ke broker (mis. HiveMQ Cloud gratis), jadi server boleh tetap di laptop tanpa IP publik atau tunnel untuk jalur alat, dan perintah pompa sampai seketika:
```
 [Maket ESP] --siaga/<id>/telemetry--> [BROKER MQTT] --> [Server]
 [Maket ESP] <--siaga/<id>/cmd-------- [BROKER MQTT] <-- [Server]   (perintah pompa + kalibrasi)
```
Server aktif di MQTT bila `MQTT_URL`, `MQTT_USER`, `MQTT_PASS` diisi (lihat `deploy/siaga-banjir.env.contoh`); alat memakai `PAKAI_MQTT 1`. Langkah demi langkah: [TUTORIAL.md](TUTORIAL.md).

Langkah menyalakan lewat HTTP:
1. **Demo (hotspot HP 2,4 GHz):** server di laptop yang tersambung ke hotspot yang sama; `SERVER_URL` = `http://IP-LAPTOP:3001` (wizard Koneksi > Hubungkan alat mengisinya otomatis); izinkan port 3001 di firewall.
2. **Online publik:** Cloudflare Tunnel (`cloudflared tunnel --url http://localhost:3001`, alamat sementara) atau VPS + Caddy (HTTPS otomatis).
   Isi `SERVER_URL` dengan alamat `https://...`; jalankan server dengan `TRUST_PROXY=1`; jangan membuka port 3001 langsung ke internet.
3. **Cek berhasil:** dashboard > Koneksi & Online: "Alat terhubung" hijau dalam satu menit; Serial Monitor menunjukkan HTTP 200.
Tanpa modul GSM: pakai hotspot HP, MiFi/router 4G, atau Wi-Fi balai desa. Tanpa internet sama sekali, WhatsApp tidak terkirim; LED/sirine lokal tetap bekerja.

## 9. Cetak 3D (`cetak-3d/`)
`boks_dasar.stl` (atau `boks_dasar_klem.stl` dengan klem probe), `tutup_boks.stl`, `pelindung_sensor.stl`, `dudukan_tiang.stl`,
`spacer_dudukan.stl` (4 buah). PETG atau ASA, layer 0,2 mm, 3-4 dinding, infill 30-40%, tanpa support. **Ukur diameter probe** dan komponen Anda,
ubah angka di `boks_siaga_banjir.py` (butuh `pip install manifold3d trimesh numpy`). Belum pernah dicetak: uji pas dulu.

## 10. Pengujian
- `npm test` (atau `node tools/uji.js`): 102 pemeriksaan otomatis tanpa internet dan tanpa perangkat keras, memakai Fonnte tiruan. Mencakup login/akses, telemetri dan level, template, daftar grup (termasuk perangkat terputus), webhook, riwayat dan CSV, Baileys tiruan (QR, terhubung, kirim, terima, putus, cadangan Fonnte), simpan-ulang setelah restart, dan simulator.
- `npm i playwright && npx playwright install chromium`, lalu `npm run uji:dashboard`: 90 pemeriksaan di browser sungguhan (login, semua tab, grafik, template, daftar grup, tampilan HP) dan menyimpan tangkapan layar di `tools/hasil-uji/`. Memuat juga wizard Hubungkan alat (kunci yang dibuat benar-benar diterima server, kunci lama ditolak), panel Baileys, dan spanduk.
- `npm run uji:maket`: 29 pemeriksaan logika kalibrasi maket di komputer (g++ dibutuhkan) ditambah pemeriksaan sintaks sketsa dengan header tiruan untuk tiga varian konfigurasi (MQTT, HTTP, `konfigurasi.h` lama); **bukan** compile untuk board.
- `npm run uji:mqtt`: 57 pemeriksaan jalur MQTT tanpa internet (broker mini + server asli + alat tiruan): paket baku MQTT, telemetri dan balasan, isi sampai target (berhenti sendiri, tidak mengisi lagi setelah wadah dikosongkan), pengaman alat, kunci/ID salah ditolak, pesan wasiat, sandi broker salah.
- `npm run uji:keamanan`: 29 pemeriksaan keamanan dasar dengan serangan sederhana ke server sungguhan: endpoint admin tanpa login, kuki, tebak kata sandi dan kunci alat, body raksasa dan JSON rusak, prototype pollution, unduh berkas server lewat URL, izin berkas rahasia, token terenkripsi, header CSP, dan XSS di browser dengan data berbahaya dari alat, grup, dan pengaturan. Ini **bukan** pengganti audit profesional.
- Uji manual dengan alat nyata (urut): (1) `node server/server.js`, login; (2) alat menyala, Serial Monitor HTTP 200, "Alat terhubung" hijau; (3) tab Riwayat mulai menampilkan garis; (4) Notifikasi > Tes WhatsApp masuk ke grup percobaan; (5) Kalibrasi > ubah ambang, Simpan, alat memakai nilai baru pada kiriman berikutnya; (6) turunkan jarak sensor (dekatkan tangan/penghalang) sampai level naik dan pesan masuk; (7) cabut internet alat: LED/sirine lokal tetap bekerja, setelah batas menit muncul pesan "alat tidak mengirim data".
- Uji sistem tanpa alat: `DEVICE_KEY="kunci-alat" node tools/simulasi.js http://localhost:3001 1500`.

## 11. Pemecahan masalah
| Gejala | Penyebab / perbaikan |
|---|---|
| HTTP -1 di Serial Monitor | Alat tidak menjangkau server: SSID/kata sandi, hotspot 2,4 GHz, SERVER_URL, firewall, isolasi klien hotspot |
| HTTP 401 | DEVICE_KEY di alat tidak sama dengan di server (atau kunci sudah diganti) |
| `MQTT gagal, kode ...` di Serial Monitor | Host/port/TLS broker salah (kode -2), atau user/sandi salah (4, 5). Tabel lengkap: [TUTORIAL.md](TUTORIAL.md) bagian 12 |
| Alat `MQTT tersambung` tetapi dashboard tidak menerima data | `MQTT_PREFIX` atau `DEVICE_ID` berbeda, atau kunci alat salah: lihat "Telemetri ditolak" di Catatan kejadian |
| Tes AI: "Tidak ada balasan dari Groq/Gemini dalam batas waktu" | Server tidak bisa menjangkau penyedia AI: cek internet server, `curl -I https://api.groq.com` dari komputer server, VPN/firewall/DNS. Tes memberi waktu 25 dtk; pesan peringatan menunggu AI maksimal 6 dtk lalu tetap terkirim tanpa AI (AWAS tidak pernah menunggu AI). Batas bisa diubah dengan `AI_TIMEOUT_MS` / `AI_TEST_TIMEOUT_MS` |
| Daftar grup kosong | Lihat bagian 4 poin 3: perangkat Fonnte terputus, nomor belum masuk grup, atau isi ID grup manual / tangkap lewat webhook |
| Webhook tidak membalas STATUS | Bagian 4 poin 4: server harus HTTPS publik, `WEBHOOK_KEY` sama dengan `?key=`, lihat baris Webhook di Catatan kejadian |
| Pesan WhatsApp tidak masuk | Cek "Catatan kejadian"; token, ID grup, perangkat Fonnte connected, nomor masih anggota grup |
| Token hilang setelah pindah server | `secret.key`/`SECRET_KEY` berbeda; isi ulang token di dashboard |
| Tombol Salin tidak bekerja | Hanya di HTTPS/localhost; salin manual |

## Batasan jujur
- **Firmware maket v3.0 (MQTT)** belum dikompilasi untuk board dan belum dicoba di perangkat; hanya logikanya diuji di komputer dan sintaksnya diperiksa dengan header tiruan buatan saya. **Jalur MQTT belum dicoba dengan broker sungguhan** (HiveMQ/EMQX): klien MQTT server saya tulis sendiri (MQTT 3.1.1, QoS 0, tanpa WebSocket) dan baru diuji dengan broker mini. Uji dengan broker Anda sebelum presentasi; `PAKAI_MQTT 0` mengembalikan jalur HTTP. Unggah, buka Serial Monitor, dan uji dengan tangki kosong lebih dulu sebelum presentasi.
- **Keamanan:** gunakan **HTTPS** untuk akses lewat internet (di HTTP biasa kata sandi dan kunci alat terkirim terbuka; aman hanya di jaringan lokal tepercaya). Pakai kata sandi admin yang panjang; tidak ada 2FA. Jalankan `TRUST_PROXY=1` **hanya** bila server benar-benar di belakang proxy/tunnel; bila salah, pembatas login bisa dilewati atau malah mengunci admin sendiri. Wi-Fi dan kunci alat tersimpan di flash alat, jadi orang yang memegang alatnya bisa membacanya; buat kunci baru bila alat hilang. Baileys memakai paket pihak ketiga: setelah berhasil terpasang, kunci versinya (`package-lock.json`, jangan biarkan `latest`) dan jangan memperbarui tanpa mencoba lagi.
- **Baileys** hanya diuji dengan Baileys **tiruan**; belum dengan pustaka dan WhatsApp asli (lihat docs/BAILEYS.md). Nomor yang dipakai bisa dibatasi WhatsApp.
- Langkah Cloudflare Tunnel, systemd, dan Caddy di docs/ONLINE.md belum dijalankan di perangkat nyata dari sini; ikuti urut dan periksa kartu Status sambungan.
- Pengujian otomatis memakai Fonnte **tiruan** yang saya tulis berdasarkan dokumentasi publik; belum dicoba ke akun Fonnte asli. Bentuk balasan asli bisa sedikit berbeda (kode sudah menerima beberapa bentuk, dan log "Catatan kejadian" mencatat jumlah grup yang diterima untuk membantu menelusuri).
- Letak kolom webhook di situs Fonnte dan nama kolom ID grup pada kiriman webhook tidak bisa saya pastikan dari sini; periksa baris Webhook di Catatan kejadian.
- Firmware belum dikompilasi di perangkat keras sebenarnya dan belum diuji di lapangan; uji bertahap lewat Serial Monitor.
- Panggilan ke Fonnte, Telegram, Groq, dan Gemini belum diuji dengan layanan aslinya; coba dulu dengan grup percobaan dan tombol Tes.
- Model 3D belum dicetak. Mode modem 4G/SMS belum termasuk. Ambang, harga, dan jarak adalah contoh: kalibrasi dengan data lokal (BPBD, Linmas).
- Alat ini pendamping, bukan pengganti peringatan resmi BPBD.
