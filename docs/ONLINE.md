# Membuat alat dan software online bersamaan

> **Cara paling mudah untuk maket: MQTT.** Alat dan server cukup menyambung ke broker (mis. HiveMQ Cloud gratis), tanpa IP publik, port forwarding, atau tunnel untuk jalur alat. Panduan lengkap: [TUTORIAL.md](../TUTORIAL.md) (Bagian 5). Dokumen ini membahas jalur HTTP langsung.

Sistem hanya "online" bila dua hal terpenuhi sekaligus:

1. **Server hidup terus** (tidak ikut mati bersama laptop yang ditutup, dan hidup sendiri setelah mati lampu).
2. **Alat bisa menjangkau alamat server** lewat internet atau jaringan yang sama.

Urutan menyalakan alat dan server **tidak penting**: alat mencoba menyambung ulang Wi-Fi tiap 10-15 detik dan mengirim ulang tiap interval, jadi boleh menyalakan salah satunya lebih dulu.

```
 [Sensor+ESP] --Wi-Fi 2,4 GHz--> [Router/hotspot] --internet--> [Cloudflare/VPS] --> [Server siaga-banjir]
                                                                                        |--> WhatsApp (Baileys atau Fonnte)
 Dashboard admin (browser) -----------------------------------------------------------> [Server siaga-banjir]
```

## Pilih jalur

| Jalur | Cocok untuk | Yang dibutuhkan | Alamat di alat (`SERVER_URL`) |
|---|---|---|---|
| **A. Satu jaringan (demo)** | uji coba, sidang, pameran | laptop dan alat di hotspot/Wi-Fi yang sama | `http://IP-LAPTOP:3001` |
| **B. Mini-PC di balai desa + Cloudflare Tunnel** | pemakaian nyata (disarankan) | mini-PC/STB/Raspberry Pi, internet, **domain** yang DNS-nya dikelola Cloudflare | `https://siaga.contohdesa.id` |
| **C. VPS + Caddy** | bila tidak mau menjaga komputer sendiri | sewa VPS kecil, domain | `https://siaga.contohdesa.id` |

Tunnel "cepat" tanpa domain (`cloudflared tunnel --url ...`) memberi alamat yang **berubah tiap dijalankan**; hanya cocok untuk percobaan sebentar, karena alat harus diunggah ulang tiap alamatnya berganti.

---

## Jalur A: demo di satu jaringan
1. Hidupkan hotspot HP **2,4 GHz** (matikan hemat daya hotspot). Sambungkan laptop dan alat ke hotspot itu.
2. Cari IP laptop: `ipconfig` (Windows) atau `ip a` (Linux/Mac), mis. `192.168.43.5`.
3. Jalankan `node server/server.js`. Izinkan port 3001 di firewall (Windows akan bertanya saat pertama kali).
4. Buka dashboard > **Koneksi > Hubungkan alat**: pilih jenis alat, isi Wi-Fi, klik IP laptop pada kolom alamat, **Buat kunci alat baru**, salin hasilnya ke alat, unggah.
5. Langkah 4 pada wizard berubah hijau dalam satu menit.

Catatan: sebagian hotspot memakai "isolasi klien" sehingga laptop dan alat tidak saling melihat; bila alat tetap `HTTP -1`, matikan isolasi atau pakai router biasa.

## Jalur B: mini-PC + Cloudflare Tunnel (tanpa membuka port)

### 1. Pasang server
```bash
# Linux (Debian/Ubuntu/Armbian). Node.js 18 atau lebih baru.
sudo adduser --system --group --home /opt/siaga-banjir siaga
sudo cp -r siaga-banjir/* /opt/siaga-banjir/ && sudo chown -R siaga:siaga /opt/siaga-banjir
sudo mkdir -p /var/lib/siaga-banjir && sudo chown siaga:siaga /var/lib/siaga-banjir
```

### 2. Jalan otomatis saat menyala (systemd)
```bash
sudo cp /opt/siaga-banjir/deploy/siaga-banjir.service /etc/systemd/system/
sudo cp /opt/siaga-banjir/deploy/siaga-banjir.env.contoh /etc/siaga-banjir.env
sudo chmod 600 /etc/siaga-banjir.env && sudo nano /etc/siaga-banjir.env     # isi sesuai kebutuhan
sudo systemctl daemon-reload && sudo systemctl enable --now siaga-banjir
journalctl -u siaga-banjir -f      # lihat log; kata sandi admin awal tampil di sini sekali
```
Server hidup lagi sendiri setelah mati lampu atau jika berhenti (`Restart=always`).

**Windows:** pakai Task Scheduler: Create Task > Trigger *At startup* > Action *Start a program* `deploy\jalankan-siaga.bat` > centang *Run whether user is logged on or not*. Skrip itu juga memulai ulang server bila berhenti. (Alternatif: pm2, lihat `deploy/pm2.config.js`.)

### 3. Cloudflare Tunnel bernama (alamat tetap)
Butuh domain yang sudah ditambahkan ke Cloudflare. Pasang `cloudflared` dari situs Cloudflare lalu:
```bash
cloudflared tunnel login                           # buka tautan, pilih domain
cloudflared tunnel create siaga                    # mencatat UUID dan berkas kredensial
cloudflared tunnel route dns siaga siaga.contohdesa.id
nano ~/.cloudflared/config.yml                     # isi dari deploy/cloudflared-config.yml (ganti UUID dan domain)
sudo cloudflared service install                   # jalan otomatis saat menyala
```
Server harus dijalankan dengan `TRUST_PROXY=1` (sudah ada di berkas env contoh). Buka `https://siaga.contohdesa.id`; halaman login harus tampil.

### 4. Isi alat
Di dashboard buka **Koneksi > Hubungkan alat**, isi alamat `https://siaga.contohdesa.id`, buat kunci, salin ke alat, unggah.
- Alat memakai HTTPS **tanpa memeriksa sertifikat** (`setInsecure`) agar ringan. Kunci alat tetap terkirim terenkripsi, tetapi alat tidak bisa membedakan server asli dari server palsu. Untuk keamanan lebih, tanam sertifikat akar di firmware (belum disediakan).
- ESP8266 (maket) memakai memori cukup besar untuk TLS; bila sering gagal, jalankan server maket di jaringan lokal dengan `http://` (jalur A).

## Jalur C: VPS + Caddy
```bash
# di VPS (Debian/Ubuntu), setelah memasang Node.js dan Caddy
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile      # ganti siaga.contohdesa.id dengan domain Anda
sudo systemctl reload caddy
```
Lalu pasang server seperti langkah B.1 dan B.2. Caddy mengurus sertifikat HTTPS otomatis. Jangan membuka port 3001 ke internet; cukup 80 dan 443.

---

## Memastikan keduanya online bersamaan
Buka **Koneksi**. Kartu **Status sambungan** harus hijau semua:

| Baris | Artinya bila hijau | Bila merah/kuning |
|---|---|---|
| Server hidup | server berjalan; angka lama berjalan tidak terus kembali ke nol | server sering mati-hidup: periksa systemd/Task Scheduler, listrik |
| Alat terhubung | alat mengirim dalam 1-2 interval terakhir | wizard langkah 4: `HTTP -1` alamat/Wi-Fi/firewall, `HTTP 401` kunci berbeda |
| Sensor membaca | sensor memberi jarak valid | kabel sensor, catu daya, jarak minimal sensor |
| WhatsApp | Baileys terhubung atau token Fonnte+grup terisi | tab Notifikasi |
| Folder data | riwayat dan pengaturan tersimpan | izin folder `DATA_DIR` |

Uji sistem tanpa alat dari komputer lain: `DEVICE_KEY="kunci-alat" node tools/simulasi.js https://siaga.contohdesa.id 1500` (level naik, pesan WhatsApp masuk ke grup percobaan).
Uji dari luar jaringan: buka `https://alamat-anda/healthz` di HP dengan data seluler; harus menjawab `{"ok":true}`.

## Bila ada yang putus
| Kejadian | Akibat | Alat |
|---|---|---|
| Internet/hotspot alat mati | data tidak sampai; riwayat berlubang (garis putus); setelah batas menit, server mengirim "alat tidak mengirim data" | LED/sirine lokal tetap bekerja; alat mencoba menyambung ulang sendiri |
| Server mati/mati lampu | **tidak ada pesan WhatsApp sama sekali**, termasuk peringatan "alat mati" | LED/sirine lokal tetap bekerja; alat terus mencoba kirim |
| Internet server mati | pesan WhatsApp tidak terkirim | alat dan server tetap berjalan; pesan baru tidak dikirim ulang otomatis |
| Baileys terputus | pesan lewat Fonnte bila cadangan aktif; bila tidak, tidak terkirim | tidak berpengaruh |

Server adalah titik tunggal kegagalan. Kurangi risikonya:
- **Catu daya cadangan** (UPS atau power bank) untuk server, router/modem, dan alat.
- **Pemantau dari luar**: daftarkan `https://alamat-anda/healthz` di layanan pemantau gratis (mis. UptimeRobot) agar Anda dikabari lewat email atau HP bila server tidak bisa dijangkau.
- **Cadangkan data**: salin berkas `data.json`, `secret.key`, dan folder `wa-session/` (bila memakai Baileys) di `DATA_DIR` secara berkala ke tempat lain. Tanpa `secret.key`, token yang tersimpan tidak bisa dibuka lagi.
- Pastikan jam komputer server tepat (NTP), karena grafik dan pesan memakai jam server.
- Pasang peringatan resmi BPBD sebagai sumber utama; alat ini pendamping.
