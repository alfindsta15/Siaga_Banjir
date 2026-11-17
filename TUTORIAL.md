# TUTORIAL LENGKAP SIAGA BANJIR (MAKET + MQTT)

Satu berkas ini berisi semuanya, dari nol sampai maket bisa dipakai demo secara online lewat MQTT. Ikuti urut dari Bagian 1. Kalau Anda hanya ingin langsung ke MQTT, lompat ke **Bagian 5**, tetapi Bagian 3 dan 4 harus sudah selesai.

## Daftar isi

1. Gambaran sistem
2. Yang perlu disiapkan
3. Merakit maket (kabel dan pompa)
4. Menyalakan server di komputer
5. **MQTT dari awal sampai bisa dipakai** (inti tutorial)
6. Kalibrasi maket
7. Ganti Wi-Fi tanpa compile ulang
8. Menjalankan demo: isi air sampai tinggi tertentu
9. Pengaman yang bekerja otomatis
10. Membuka dashboard dari HP atau dari luar rumah
11. Keamanan
12. Pemecahan masalah
13. Pengujian dan batasan yang jujur
14. Lampiran: referensi cepat

---

## 1. Gambaran sistem

```
 [Sensor HC-SR04 + pompa] -- [ESP8266 NodeMCU] --Wi-Fi 2,4 GHz--> internet --> [BROKER MQTT]
                                                                                    ^   |
                                                              internet              |   v
                                                  [Server siaga-banjir (laptop)] ---+   dashboard di browser
                                                         |--> WhatsApp (peringatan level)
```

- **Maket** mengukur tinggi air, mengirim data tiap 3 detik, dan menjalankan pompa atas perintah.
- **Broker MQTT** adalah "kantor pos": alat dan server sama-sama menyambung *keluar* ke broker, jadi keduanya tidak perlu saling menemukan alamat. Server boleh tetap di laptop di rumah, tanpa IP publik atau port forwarding.
- **Server** menghitung level (NORMAL, WASPADA, SIAGA, AWAS), menampilkan dashboard, mengirim WhatsApp, dan memberi perintah pompa.
- **Dashboard** dibuka di browser: `http://localhost:3001`.

Istilah MQTT yang akan Anda temui:

| Istilah | Artinya |
|---|---|
| Broker | server pengantar pesan (HiveMQ Cloud, Mosquitto, dsb.) |
| Host dan port | alamat broker, mis. `abc123.s1.eu.hivemq.cloud` dan `8883` |
| TLS | enkripsi. Port 8883 memakai TLS, port 1883 tidak |
| Kredensial | pasangan user dan sandi untuk masuk ke broker |
| Topik | "alamat surat", mis. `siaga/maket-01/telemetry` |
| Awalan topik | bagian depan topik, bawaan `siaga` |

Jalur HTTP lama (alat langsung ke server) tetap tersedia: `PAKAI_MQTT 0` di `konfigurasi.h`. Tutorial ini fokus ke MQTT.

---

## 2. Yang perlu disiapkan

**Perangkat keras**

| Barang | Catatan |
|---|---|
| NodeMCU ESP8266 (ESP-12E) + kabel USB data | kabel pengisi daya saja tidak bisa dipakai upload |
| Sensor ultrasonik HC-SR04 | |
| Wadah tinwall 17 x 11 x 7,5 cm | tinggi dinding 7,5 cm |
| Pompa air DC kecil + selang | dengan catu daya sendiri (jangan dari NodeMCU) |
| Modul relay 1 kanal (atau MOSFET) | untuk menyalakan pompa |
| LED dan buzzer (opsional) | penanda level di maket |
| Penampung air + gelas ukur | sumber air dan pengukur debit |
| Dioda 1N4007 | untuk pompa DC, dipasang terbalik di terminal pompa |

**Perangkat lunak**

| Software | Dari mana |
|---|---|
| Node.js 18 atau lebih baru | nodejs.org (cek dengan `node -v`) |
| Arduino IDE | arduino.cc |
| Driver USB-serial | CH340 atau CP2102, tergantung chip pada NodeMCU Anda |
| Akun broker MQTT | HiveMQ Cloud (gratis) di Bagian 5, atau broker mini di laptop |

**Jaringan:** Wi-Fi atau hotspot HP **2,4 GHz** (ESP8266 tidak bisa 5 GHz). Matikan fitur hemat daya hotspot.

---

## 3. Merakit maket (kabel dan pompa)

### 3.1 Penyambungan pin

| Komponen | Pin NodeMCU |
|---|---|
| HC-SR04 TRIG | D1 |
| HC-SR04 ECHO | D2 (lewat pembagi tegangan, lihat di bawah) |
| LED | D5 |
| Buzzer | D6 |
| Relay (atau MOSFET) pompa, kaki IN | D7 |
| VCC sensor dan modul relay | VIN (5 V) |
| GND semua | GND NodeMCU |

HC-SR04 versi 5 V mengeluarkan sinyal ECHO 5 V, sedangkan pin ESP8266 hanya tahan 3,3 V. Pasang pembagi tegangan di jalur ECHO (misalnya 1 kΩ dari ECHO ke D2 dan 2 kΩ dari D2 ke GND), kecuali sensor Anda memang versi 3,3 V.

### 3.2 Pompa

- Pompa memakai **catu daya sendiri**, bukan pin 3V3 atau VIN NodeMCU, bukan USB laptop. Lonjakan arus pompa bisa mereset ESP.
- Relay hanya nyala atau mati: kecepatan pompa tidak bisa diatur. Jumlah air diatur oleh **lama pompa menyala**, dan sensor sebagai pengaman.
- Modul relay biasa umumnya **aktif-LOW**. Di `desa_siaga_banjir.ino` ada `RELAY_AKTIF_LOW`, bawaannya `false` (untuk MOSFET atau aktif-HIGH). **Untuk modul relay biasa ubah menjadi `true`.**
- Pompa DC: pasang dioda 1N4007 terbalik paralel di terminal pompa (garis dioda ke +).
- Jauhkan kabel pompa dan relay dari kabel sensor.

### 3.3 Memasang sensor dan selang

- Sensor tegak lurus ke bawah di **tengah** tangki, sekitar **10 cm di atas dasar**, jauh dari dinding dan dari selang.
- **Arahkan selang pompa ke dinding atau ke bawah permukaan air**, jangan menyemprot ke arah sensor. Percikan membuat bacaan palsu.
- Saat wadah penuh, jarak ke air tinggal 2,5 cm, mendekati batas dekat HC-SR04 (2 cm). Karena itu pompa dipaksa berhenti di 6,8 cm.

### 3.4 Ukur debit pompa (penting untuk demo)

Jalankan pompa 10 detik ke gelas ukur. Debit (ml/detik) = isi gelas ÷ 10. Dari sini Anda tahu waktu mengisi:

| Level | Tinggi maket | Tinggi nyata di dashboard | Air dari kosong | Waktu @ 20 ml/detik |
|---|---|---|---|---|
| WASPADA | 2,5 cm | 50 cm | ± 468 ml | ± 23 detik |
| SIAGA | 4,5 cm | 90 cm | ± 842 ml | ± 42 detik |
| AWAS | 6,0 cm | 120 cm | ± 1.122 ml | ± 56 detik |
| Batas aman pompa | 6,8 cm | 136 cm | ± 1.272 ml | |
| Penuh (bibir wadah) | 7,5 cm | 150 cm | ± 1.403 ml | |

Skala maket: 1 cm di maket = 20 cm sungai nyata. Luas dasar 187 cm², jadi 1 cm air = 187 ml.

---

## 4. Menyalakan server di komputer

1. Ekstrak `siaga-banjir-v9.zip`, misalnya ke `C:\Users\USER\Documents\PROJECT K3\siaga-banjir`.
2. Buka PowerShell di folder itu:
   ```powershell
   cd "C:\Users\USER\Documents\PROJECT K3\siaga-banjir"
   node server\server.js
   ```
3. Pada **pertama kali**, terminal menampilkan **kata sandi admin** dan **kunci alat** acak, hanya sekali. **Catat keduanya.** Kata sandi untuk login dashboard, kunci alat untuk `konfigurasi.h`. Keduanya bisa diganti di dashboard, tab Keamanan.
4. Buka `http://localhost:3001` di browser dan login.
5. Biarkan jendela PowerShell terbuka. Menutupnya mematikan server.

Mau menentukan sendiri kata sandi dan kunci alat? Isi sebelum menjalankan server (kata sandi minimal 8 karakter, kunci alat minimal 12):
```powershell
$env:ADMIN_PASSWORD = "kata-sandi-saya-panjang"
$env:DEVICE_KEY = "kunci-alat-saya-12345"
node server\server.js
```
Nilai ini hanya dipakai pertama kali.

---

## 5. MQTT dari awal sampai bisa dipakai

Pilih **satu** jalur broker:

| Jalur | Cocok untuk | Perlu internet di alat | Perlu daftar akun |
|---|---|---|---|
| **A. HiveMQ Cloud (gratis)** | online sungguhan, direkomendasikan | ya | ya |
| **B. Broker mini di laptop** | demo cepat satu Wi-Fi, tanpa instal apa pun | tidak | tidak |
| **C. Broker HiveMQ lewat Docker di laptop** | opsional bila Docker sudah terpasang | tidak | tidak |

Langkah 5.5 sampai 5.8 (firmware dan pengecekan) sama untuk semua jalur. Beda jalur hanya di isi `MQTT_HOST`, `MQTT_PORT`, `MQTT_TLS`, dan variabel server.

### 5.1 Jalur A: buat broker HiveMQ Cloud

1. Buka hivemq.com, daftar, lalu pilih **HiveMQ Cloud** dan buat cluster tipe **Serverless** (paket gratis). Nama menu bisa berubah; yang dicari hanya empat hal: **host, port, user, sandi**.
2. Di halaman cluster catat **Cluster URL**, bentuknya `xxxxxxxx.s1.eu.hivemq.cloud`. Port TLS-nya **8883**.
3. Buka **Access Management** (menu kredensial) dan buat **dua** kredensial terpisah:

   | Nama | Dipakai oleh |
   |---|---|
   | `siaga-server` + sandi panjang acak | server |
   | `siaga-alat` + sandi panjang acak | maket |

   Dua kredensial membuat Anda bisa mencabut salah satunya tanpa mengganggu yang lain. Jika menu Anda menyediakan pembatasan izin (publish saja, subscribe saja, per topik), batasi kredensial alat ke topik `siaga/maket-01/#`.
4. Tulis keempatnya di tempat aman (host, port 8883, dua pasang user dan sandi). Anda akan memakainya di langkah 5.3 dan 5.6.
5. **Tes broker tanpa alat** (opsional tapi disarankan): halaman cluster punya **Web Client**. Sambungkan dengan kredensial `siaga-server`, lalu subscribe topik `siaga/#`. Nanti di Bagian 5.8 Anda akan melihat pesan alat masuk di situ.

Paket gratis punya batas transfer bulanan; cek halaman harga HiveMQ. Perkiraan pemakaian alat ini bila menyala 24 jam: sekitar 0,6 GB per bulan (telemetri tiap 3 detik beserta balasannya). Untuk demo beberapa jam, jauh di bawah itu. Atur `DEMO_MODE false` di `.ino` bila mau interval 5 detik.

### 5.2 Jalur B: broker mini di laptop (tanpa instal apa pun)

Proyek ini membawa broker kecil untuk uji. Jalankan di PowerShell:

```powershell
cd "C:\Users\USER\Documents\PROJECT K3\siaga-banjir"
node tools\stub\mqtt-broker-mini.js 1883
```

Harus muncul `Broker mini aktif di port 1883`. Biarkan jendela terbuka. Broker ini **tanpa TLS dan tanpa login**, hanya cocok di Wi-Fi sendiri. Ia alat uji buatan saya, bukan broker produksi.

Lanjutkan dua hal di bawah:

1. **Cari IP laptop:** ketik `ipconfig`, catat IPv4 milik Wi-Fi (contoh `192.168.1.20`). Alat akan memakai angka ini.
2. **Buka firewall port 1883** (PowerShell sebagai Administrator):
   ```powershell
   New-NetFirewallRule -DisplayName "MQTT 1883" -Direction Inbound -Protocol TCP -LocalPort 1883 -Action Allow
   ```
   Saat Node pertama kali jalan, Windows mungkin menampilkan jendela izin firewall: pilih **Allow**.

Laptop dan maket harus satu Wi-Fi. Isi `konfigurasi.h` nanti: `MQTT_HOST` = IP laptop, `MQTT_PORT` = 1883, `MQTT_TLS` = false.

### 5.3 Menyalakan server dengan MQTT

Server memakai MQTT bila variabel **`MQTT_URL`** diisi. Hentikan server yang sedang jalan (Ctrl+C), lalu:

| Variabel | Isi | Wajib |
|---|---|---|
| `MQTT_URL` | `mqtts://HOST:8883` (TLS) atau `mqtt://HOST:1883` | ya |
| `MQTT_USER` | kredensial server (`siaga-server`) | bila broker meminta |
| `MQTT_PASS` | sandinya | bila broker meminta |
| `MQTT_PREFIX` | awalan topik, bawaan `siaga` | tidak |

**Windows PowerShell, jalur A (HiveMQ Cloud):**
```powershell
cd "C:\Users\USER\Documents\PROJECT K3\siaga-banjir"
$env:MQTT_URL  = "mqtts://xxxxxxxx.s1.eu.hivemq.cloud:8883"
$env:MQTT_USER = "siaga-server"
$env:MQTT_PASS = "SANDI-SERVER"
node server\server.js
```

**Windows PowerShell, jalur B (broker mini di laptop yang sama):**
```powershell
cd "C:\Users\USER\Documents\PROJECT K3\siaga-banjir"
$env:MQTT_URL = "mqtt://127.0.0.1:1883"
node server\server.js
```

**Linux atau Raspberry Pi:**
```bash
MQTT_URL=mqtts://xxxxxxxx.s1.eu.hivemq.cloud:8883 MQTT_USER=siaga-server MQTT_PASS='SANDI-SERVER' node server/server.js
```

Sandi yang mengandung karakter khusus lebih aman lewat `MQTT_PASS` daripada ditulis di dalam URL.

**Cek berhasil:**
- Terminal menampilkan `[mqtt] Tersambung ke broker ...`.
- Dashboard > **Koneksi** > kartu **Status sambungan**: baris **MQTT (broker)** hijau.
- Merah berarti ada pesan sebabnya, mis. user atau sandi salah, atau host salah. Perbaiki variabel lalu jalankan ulang.

Agar server jalan otomatis (systemd, Task Scheduler, pm2), tuliskan tiga variabel itu di `deploy/siaga-banjir.env.contoh` (disalin ke `/etc/siaga-banjir.env`), `deploy\jalankan-siaga.bat` (hapus `rem` di depan baris MQTT), atau `deploy/pm2.config.js`.

### 5.4 Memasang Arduino IDE untuk ESP8266

1. Pasang **Arduino IDE** dan driver USB (CH340 atau CP2102). Sambungkan NodeMCU; di Device Manager Windows harus muncul port COM baru.
2. Arduino IDE > **File > Preferences** > kolom *Additional boards manager URLs*, isi:
   ```
   http://arduino.esp8266.com/stable/package_esp8266com_index.json
   ```
3. **Tools > Board > Boards Manager**, cari **esp8266** (oleh ESP8266 Community), **Install**.
4. **Tools > Board > ESP8266 Boards > NodeMCU 1.0 (ESP-12E Module)**. Pilih **Port** COM milik NodeMCU. Upload Speed 115200 sudah aman.
5. **Sketch > Include Library > Manage Libraries**, pasang:
   - **ArduinoJson** versi **7.x** (oleh Benoit Blanchon). Versi 6 membuat compile gagal (`'JsonDocument' does not name a type`).
   - **PubSubClient** (oleh Nick O'Leary), versi 2.8 atau lebih baru. Tanpanya compile gagal dengan `PubSubClient.h: No such file or directory`.

### 5.5 Mengisi `konfigurasi.h`

Buka `firmware\desa_siaga_banjir\konfigurasi.h` (tab sebelah `.ino` di Arduino IDE) dan isi. Cara cepat: dashboard > Koneksi > Hubungkan alat > Maket, lalu salin hasilnya. **Isi berkas ini hanya ke `konfigurasi.h`.**

> **Peringatan:** jangan menempelkan isinya ke dalam `desa_siaga_banjir.ino`. Itu menyebabkan compile gagal dengan `redefinition of 'const char* WIFI_SSID'` dan `#pragma once in main file`. Kalau sudah terlanjur, hapus blok yang tertempel di `.ino` (mulai dari baris `#pragma once`) dan simpan nilainya di `konfigurasi.h`.

**Jalur A (HiveMQ Cloud):**
```cpp
#pragma once
const char* WIFI_SSID  = "NAMA_WIFI_ANDA";        // 2,4 GHz
const char* WIFI_PASS  = "SANDI_WIFI";
const char* DEVICE_KEY = "KUNCI_ALAT_DARI_SERVER"; // dari terminal server atau dashboard > Keamanan
const char* DEVICE_ID  = "maket-01";               // huruf, angka, - dan _ saja
#define SETUP_AP_PASS "siaga-setup"                // sandi hotspot setup (min. 8 karakter)

#define PAKAI_MQTT 1
const char*    MQTT_HOST   = "xxxxxxxx.s1.eu.hivemq.cloud";
const uint16_t MQTT_PORT   = 8883;
const bool     MQTT_TLS    = true;
const char*    MQTT_USER   = "siaga-alat";
const char*    MQTT_PASS   = "SANDI-ALAT";
const char*    MQTT_PREFIX = "siaga";               // harus sama dengan server
const char*    SERVER_URL  = "http://192.168.1.10:3001";  // dipakai hanya bila PAKAI_MQTT 0
```

**Jalur B atau C (broker di laptop, tanpa TLS):**
```cpp
#define PAKAI_MQTT 1
const char*    MQTT_HOST   = "192.168.1.20";   // IP laptop dari ipconfig
const uint16_t MQTT_PORT   = 1883;
const bool     MQTT_TLS    = false;            // wajib false untuk port 1883
const char*    MQTT_USER   = "alat";           // bebas bila broker tanpa login
const char*    MQTT_PASS   = "alat";
const char*    MQTT_PREFIX = "siaga";
```

Aturan penting:
- `DEVICE_KEY` **harus sama persis** dengan kunci alat di server.
- `DEVICE_ID` jangan memakai spasi atau karakter aneh (dipakai di nama topik).
- `MQTT_PREFIX` di alat dan di server harus sama.
- Wi-Fi di sini hanya **nilai awal**. Setelah alat menyala Anda bisa menggantinya tanpa compile (Bagian 7). Bahkan bila Wi-Fi di sini salah, alat akan membuka hotspot setup.
- **Jangan bagikan berkas ini** ke siapa pun (berisi sandi Wi-Fi, sandi broker, kunci alat). Sudah masuk `.gitignore`.

### 5.6 Mengunggah ke alat

1. Buka `firmware\desa_siaga_banjir\desa_siaga_banjir.ino` di Arduino IDE. Berkas `konfigurasi.h` dan `logika_maket.h` ikut terbuka sebagai tab.
2. Pastikan papan **NodeMCU 1.0** dan port COM benar, lalu klik **Upload** (panah kanan).
3. Compile gagal? Lihat Bagian 12 (tabel error compile).
4. Setelah berhasil, buka **Tools > Serial Monitor**, atur **115200 baud**. Bila layar kosong, tekan tombol RST pada NodeMCU.

### 5.7 Pesan yang benar di Serial Monitor

Urutan lengkap saat alat menyala:
```
DESA SIAGA BANJIR - V3.1 (MQTT, ISI SAMPAI TARGET, GANTI WI-FI TANPA COMPILE)
Jalur data: MQTT xxxxxxxx.s1.eu.hivemq.cloud:8883 (TLS), awalan topik "siaga"
Wi-Fi: mencoba "NAMA_WIFI_ANDA" ....
Wi-Fi tersambung ke "NAMA_WIFI_ANDA" (dari konfigurasi.h)
Perintah Serial: k = kalibrasi dasar (tangki KOSONG), p = uji relay, w = buka hotspot setup Wi-Fi, x = hapus Wi-Fi tersimpan
MQTT: menyambung ke xxxxxxxx.s1.eu.hivemq.cloud:8883 ...
MQTT tersambung. Telemetri: siaga/maket-01/telemetry | perintah: siaga/maket-01/cmd
```
Baris terakhir adalah tanda **berhasil tersambung ke broker**. Kalau yang muncul `MQTT gagal, kode ...`, lihat tabel di Bagian 12.

### 5.8 Memastikan semuanya bekerja (daftar periksa)

Centang satu per satu:

- [ ] Serial Monitor menampilkan `MQTT tersambung`.
- [ ] Dashboard > Koneksi > **Status sambungan**: **MQTT (broker)** hijau dan **Alat terhubung** hijau (menyebut `maket-01 v3.1-wifi` dan "lewat MQTT").
- [ ] Dashboard > Ringkasan: **Jarak sensor** berubah bila telapak tangan Anda didekatkan ke sensor.
- [ ] (Jalur A) Di Web Client HiveMQ, subscribe `siaga/#` dengan kredensial `siaga-server`: tampil `siaga/maket-01/telemetry` tiap 3 detik, `siaga/maket-01/cmd` sebagai balasan, dan `siaga/maket-01/status` berisi `online`. Pesan telemetri memuat `key` (kunci alat), jangan menyalin cuplikannya ke tempat umum.
- [ ] **Cabut daya alat.** Beberapa detik kemudian log server menulis `Alat maket-01: offline` (pesan wasiat broker). Hidupkan lagi: `online`.

Bila semuanya tercentang, **jalur MQTT sudah siap dipakai**. Lanjut ke kalibrasi.

### 5.9 Jalur C: broker HiveMQ lewat Docker (opsional)

Hanya bila Docker Desktop sudah terpasang dan berjalan (statusnya *running*). Bila `docker` tidak dikenali di PowerShell, Docker belum terpasang; pakai Jalur B saja.

```powershell
docker run --name hivemq -p 1883:1883 hivemq/hivemq-ce:latest
```
Image `hivemq-ce` (Community) tidak memerlukan license key. Lain kali cukup `docker start hivemq`. Lanjutkan seperti Jalur B: cari IP laptop, buka firewall port 1883, isi `konfigurasi.h` dengan port 1883 dan `MQTT_TLS false`, dan jalankan server dengan `MQTT_URL=mqtt://127.0.0.1:1883`. Jangan menempelkan license key HiveMQ Enterprise ke tempat umum atau chat; anggap bocor bila terlanjur.

---

## 6. Kalibrasi maket

Dilakukan sekali (dan ulangi bila sensor bergeser).

1. **Kosongkan wadah** sampai tidak ada air, tunggu permukaan tenang.
2. Di Serial Monitor kirim huruf **`k`**. Alat mengukur jarak sensor ke dasar sebagai dasar. (Alternatif: dashboard > Kalibrasi > **Tangki kosong: jadikan bacaan sekarang sebagai dasar**.)
3. Dashboard > **Kalibrasi** > pilih preset **Maket tinwall 17 x 11 x 7,5 cm** > **Simpan perubahan**. Preset mengisi dasar 200, WASPADA 50, SIAGA 90, AWAS 120 cm nyata.
4. Serial Monitor menampilkan volume tiap level dan jarak dasar yang dipakai.
5. Uji relay **tanpa air dan tanpa selang**: saat alat baru menyala relay harus diam. Kirim **`p`**: relay menyala 1,5 detik lalu mati. Bila terbalik, ubah `RELAY_AKTIF_LOW` di `.ino` dan unggah ulang.

Jarak dasar yang tepat menentukan semua angka lain; jangan hanya mengandalkan "sekitar 10 cm".

---

## 7. Ganti Wi-Fi tanpa compile ulang

Pindah tempat atau ganti hotspot? Jangan buka Arduino IDE. Wi-Fi yang diganti disimpan di memori alat (EEPROM), bukan di `konfigurasi.h`.

### 7.1 Cara A: dari dashboard (alat harus sedang online)

1. Dashboard > **Koneksi** > kartu **Wi-Fi alat** > **Cari Wi-Fi**. Alat memindai (beberapa detik); daftar muncul dengan keterangan sinyal kuat/sedang/lemah dan berkunci/terbuka.
2. Klik jaringan (atau ketik namanya), isi sandi, klik **Pakai Wi-Fi ini**.
3. Alat **mencoba dulu tanpa menyimpan**. Wi-Fi baru disimpan hanya bila alat tersambung *dan* server membalas lewat jalur baru. Bila gagal dalam sekitar 45 detik (sandi salah, sinyal lemah, broker tidak terjangkau dari Wi-Fi itu), alat **kembali ke Wi-Fi lama otomatis** dan dashboard menulis "Gagal". Mencabut daya saat percobaan juga aman: yang tersimpan tetap Wi-Fi lama.
4. Wi-Fi sebelumnya tersimpan sebagai **cadangan**. Bila yang aktif hilang, alat bergantian mencoba aktif, cadangan, lalu nilai awal di `konfigurasi.h`.

Sandi dikirim ke alat lewat broker dan **tidak disimpan di server** (tidak ada di `data.json`, log, maupun tampilan dashboard). Karena melewati broker, pakai broker ber-TLS (port 8883) bila lewat internet.

### 7.2 Cara B: hotspot setup milik alat (untuk alat yang tidak punya Wi-Fi sama sekali)

1. Bila Wi-Fi putus sekitar 40 detik, alat membuka hotspot **`SIAGA-SETUP`** (sandi bawaan `siaga-setup`, ubah lewat `SETUP_AP_PASS` di `konfigurasi.h`). Bisa juga dibuka paksa dengan mengirim huruf **`w`** di Serial Monitor.
2. Sambungkan HP ke hotspot itu, lalu buka **`http://192.168.4.1`** di browser.
3. Pilih Wi-Fi dari daftar (atau ketik namanya), isi sandi, **Simpan dan sambungkan**.
4. Bila berhasil, Wi-Fi disimpan dan hotspot padam sendiri. Bila gagal, hotspot tetap ada; ulangi.
5. Siapa pun yang tahu sandi hotspot dan berada dekat alat bisa mengganti Wi-Fi. Ganti `SETUP_AP_PASS` bila alat dipasang di tempat umum.

Perintah Serial: **`w`** buka hotspot setup, **`x`** hapus Wi-Fi tersimpan (alat memakai `konfigurasi.h` lagi setelah restart).

### 7.3 Apa yang sudah tersimpan dan cara mengubahnya

Dashboard > Koneksi > kartu **Pengaturan yang sudah tersimpan** menampilkan nilai sekarang, tempat tersimpan, dan cara mengubah tiap pengaturan:

| Pengaturan | Tersimpan di | Cara mengubah |
|---|---|---|
| Wi-Fi alat | memori alat (nilai awal dari `konfigurasi.h`) | **tanpa compile**: kartu Wi-Fi alat, atau hotspot SIAGA-SETUP |
| Kalibrasi dan ambang level | server, dengan salinan di alat | **tanpa compile**: tab Kalibrasi |
| Perintah pompa dan target | tidak disimpan (sementara) | **tanpa compile**: Demo maket di Ringkasan |
| Notifikasi WhatsApp dan lainnya | server | **tanpa compile**: tab Notifikasi |
| Broker MQTT di alat (host, user, sandi, awalan) | `konfigurasi.h` di alat | compile ulang (jarang berubah) |
| ID alat dan kunci alat | `konfigurasi.h` dan tab Keamanan | buat kunci baru, isi `konfigurasi.h`, compile ulang |
| Broker MQTT di server | variabel `MQTT_URL`, `MQTT_USER`, `MQTT_PASS` | ubah variabel lalu mulai ulang server |

---

## 8. Menjalankan demo: isi air sampai tinggi tertentu

Pompa mengisi wadah sampai tinggi yang Anda tentukan, **berhenti sendiri**, dan wadah **dikosongkan dengan tangan** setelah demo (tidak ada pompa buang).

### 8.1 Sebelum mulai

- Server hidup, alat online (daftar periksa 5.8 tercentang), kalibrasi sudah dilakukan.
- Wadah **kosong**, penampung air terisi cukup, selang mengarah ke dinding atau di bawah permukaan air.
- Ada orang yang mengawasi pompa. Jangan tinggalkan pompa menyala sendirian.
- Siapkan wadah untuk menuang air setelah demo.

### 8.2 Menjalankan

1. Dashboard > **Ringkasan** > **Demo maket: isi air sampai target**. Bagian ini **tertutup bawaan**; klik judulnya untuk membuka. Kontrolnya nonaktif sampai maket online.
2. Isi kolom **Isi sampai** dengan tinggi nyata, mis. `90` (= 4,5 cm di maket, level SIAGA), lalu klik **Isi sampai target**. Atau klik langsung **WASPADA**, **SIAGA**, atau **AWAS**.
3. Lewat MQTT perintah sampai ke alat seketika. Pompa menyala dan **berhenti sendiri** begitu tinggi tercapai. Status naik NORMAL, WASPADA, SIAGA, dan LED/buzzer mengikuti.
4. Di **Catatan kejadian** muncul "Target tercapai ... Kosongkan wadah secara manual". Serial Monitor menulis `Target tercapai: ... cm`.
5. Selesai presentasi: **kosongkan wadah dengan tangan** (tuang ke penampung). Status turun sendiri.
6. **Pompa tidak akan mengisi lagi** sebelum Anda memberi perintah baru. Mengosongkan wadah tidak memicu pengisian ulang. Mau demo lagi: klik **Isi sampai target** lagi.

Tombol **Matikan** membatalkan target di tengah jalan. **Nyalakan** adalah mode manual lama (berhenti sendiri setelah 120 detik).

### 8.3 Batas yang perlu Anda tahu

- Target di dashboard **5 sampai 130 cm nyata** (6,5 cm di maket). Di atasnya ditolak, karena pompa berhenti paksa di 6,8 cm.
- Pompa dipaksa berhenti bila satu kali jalan lebih dari **120 detik** (`PUMP_MAX_MS`). Pompa lambat (di bawah sekitar 10 ml/detik) bisa tidak sampai AWAS dalam 120 detik: naikkan `PUMP_MAX_MS` di `.ino`.
- Air berhenti **lebih tinggi** dari target? (air di selang masih mengalir, bacaan tersaring tertinggal sekitar 1 detik.) Isi `PUMP_ANTISIPASI_CM` dengan 0.05 sampai 0.15 di `.ino`. Berlaku untuk target "cm", bukan target level.
- Air tidak naik 0,25 cm dalam 25 detik: pompa berhenti (pompa kering, penampung kosong, atau sensor tertutup). Dashboard mencatat "Pompa dihentikan PENGAMAN ALAT"; rincinya di Serial Monitor.
- Perintah target kedaluwarsa sendiri setelah 3 menit bila alat tidak pernah melapor selesai.

### 8.4 Notifikasi saat demo

Preset maket memakai jeda minimum 1 menit dan pembaruan tiap naik 20 cm nyata (= 1 cm maket). Kenaikan level (WASPADA, SIAGA, AWAS) selalu dikirim langsung. WhatsApp diatur di tab Notifikasi.

---

## 9. Pengaman yang bekerja otomatis

| Kejadian | Yang dilakukan alat |
|---|---|
| Sambungan MQTT putus | Pompa dimatikan **sebelum** mencoba menyambung ulang (menyambung TLS bisa memblokir beberapa detik); mencoba lagi tiap 5 detik |
| Pompa diperintah tetapi 6 detik tanpa balasan server (server atau broker mati, Wi-Fi putus) | Pompa dimatikan |
| Sambungan pulih dan server masih menyuruh mengisi | Pengisian dilanjutkan dari tinggi sekarang sampai target |
| Sensor gagal, tinggi 6,8 cm atau lebih, lebih dari 120 detik, atau air tidak naik | Pompa dimatikan dan terkunci sampai ada perintah baru |
| Pompa berhenti di target | Server berhenti memerintah; tidak mengisi lagi |

LED dan buzzer lokal tetap bekerja walau internet mati. Hanya WhatsApp yang tidak terkirim.

Tinggi air tidak pernah minus atau melebihi tinggi wadah: bacaan mustahil ditolak, lonjakan akibat percikan diabaikan, derau di tangki kosong dianggap 0.

---

## 10. Membuka dashboard dari HP atau dari luar rumah

**Penting:** jalur MQTT hanya mengurus **alat ke server**. Dashboard tetap dibuka lewat server.

- **Di laptop yang sama:** `http://localhost:3001`.
- **Dari HP di Wi-Fi yang sama:** buka `http://IP-LAPTOP:3001`, dan izinkan port 3001 di firewall Windows (jendela izin muncul saat pertama kali Node berjalan, pilih Allow).
- **Dari luar rumah:** server harus bisa dijangkau lewat HTTPS. Pilihannya mini-PC dengan Cloudflare Tunnel (butuh domain) atau VPS dengan Caddy, dan server jalan otomatis (systemd, Task Scheduler, atau pm2; contohnya ada di folder `deploy`). Tunnel cepat tanpa domain (`cloudflared tunnel --url http://localhost:3001`) memberi alamat yang berubah tiap dijalankan, hanya cocok untuk percobaan sebentar. Untuk dashboard di internet wajib HTTPS dan jalankan `TRUST_PROXY=1` **hanya** bila server memang di belakang proxy tepercaya.
- Pakai kata sandi admin yang panjang; tidak ada 2FA. Login dikunci 15 menit setelah 5 kali salah.

---

## 11. Keamanan

- **Selalu TLS (port 8883)** di broker cloud. Tanpa TLS, sandi dan kunci alat lewat internet sebagai teks biasa. Broker di laptop (port 1883) hanya untuk jaringan sendiri.
- **Pakai dua kredensial broker** (server dan alat), sandi panjang acak. Satu hilang, cabut satu itu saja.
- **Kunci alat ikut di isi pesan telemetri.** Siapa pun yang berhak *subscribe* ke `siaga/+/telemetry` di broker Anda bisa melihatnya. Karena itu pengaman utama adalah kredensial broker; kunci alat adalah lapis kedua yang membuat server menolak pesan dari pihak lain yang memakai broker atau awalan yang sama. Jangan berbagi kredensial broker, dan batasi izin kredensial alat bila broker Anda bisa.
- Firmware memakai TLS **tanpa memeriksa sertifikat broker** (`setInsecure()`). Lalu lintas terenkripsi, tetapi tidak melindungi dari penyadap aktif yang menyamar sebagai broker. Cukup untuk demo; untuk pemasangan permanen pertimbangkan menyematkan sertifikat atau sidik jari broker. Server memeriksa sertifikat broker secara normal.
- **Jangan bagikan `konfigurasi.h`** (berisi sandi Wi-Fi, sandi broker, kunci alat). Kalau pernah tertempel di chat atau grup, buat kunci alat baru di dashboard > Keamanan, isi ulang `konfigurasi.h`, unggah ulang, dan ganti sandi yang ikut terlihat.
- Hotspot setup `SIAGA-SETUP`: ganti `SETUP_AP_PASS` bila alat berada di tempat umum.

---

## 12. Pemecahan masalah

### 12.1 Error compile di Arduino IDE

"exit status 1" hanyalah bungkus. Penyebab sebenarnya ada di baris merah yang mengandung kata `error:` di kotak hitam bagian bawah.

| Pesan error | Penyebab dan perbaikan |
|---|---|
| `PubSubClient.h: No such file or directory` | Pasang library **PubSubClient** (Bagian 5.4) |
| `'JsonDocument' does not name a type` | ArduinoJson masih versi 6; pasang versi **7.x** |
| `ESP8266WiFi.h: No such file or directory` atau error aneh pada pin `D1`, `D2` | Papan belum **NodeMCU 1.0 (ESP-12E Module)** atau paket board esp8266 belum dipasang |
| `redefinition of 'const char* WIFI_SSID'` dan `#pragma once in main file` | Isi `konfigurasi.h` tertempel ke dalam `.ino`. Hapus blok itu dari `.ino` (mulai dari `#pragma once`), simpan nilainya di `konfigurasi.h` |
| Upload gagal: `espcomm_open failed` atau port tidak muncul | Kabel USB hanya pengisi daya, driver CH340/CP2102 belum terpasang, atau port COM salah |

Uji cepat untuk memisahkan masalah: ubah `#define PAKAI_MQTT 1` menjadi `0` di `konfigurasi.h` lalu compile. Berhasil berarti masalahnya di library PubSubClient atau bagian MQTT; tetap gagal berarti di tempat lain (ArduinoJson atau papan).

### 12.2 MQTT di Serial Monitor

| Gejala | Penyebab dan perbaikan |
|---|---|
| `MQTT gagal, kode -2 (broker tidak terjangkau ...)` | Host atau port salah, Wi-Fi tanpa internet, port diblokir jaringan (hotspot kantor atau sekolah; coba hotspot HP), `MQTT_TLS` harus `true` untuk 8883 dan `false` untuk 1883. Untuk broker di laptop: IP salah, firewall port 1883 belum dibuka, atau laptop dan alat beda Wi-Fi |
| `kode 4 (user/sandi salah)` atau `kode 5 (tidak diizinkan)` | `MQTT_USER` atau `MQTT_PASS` di `konfigurasi.h` tidak cocok dengan kredensial broker, atau kredensial tidak punya izin publish dan subscribe. Bila broker lokal Anda meminta login, buat user di pengaturan keamanannya |
| `MQTT: publish gagal (paket lebih besar dari buffer?)` | Paket melebihi buffer alat (768 byte); laporkan. Penyebab biasanya nama Wi-Fi atau host sangat panjang |
| Sering `Fail-safe: sambungan MQTT putus` | Wi-Fi lemah (lihat sinyal di dashboard) atau broker memutus; dekatkan ke router, mulai ulang alat |
| Alat sering reset dengan pesan kehabisan memori | TLS di ESP8266 memakai memori besar; pakai broker tanpa TLS di jaringan tepercaya |

### 12.3 Dashboard

| Gejala | Penyebab dan perbaikan |
|---|---|
| Kartu **MQTT (broker)** merah, "user/sandi" | `MQTT_USER` atau `MQTT_PASS` di **server** salah |
| Kartu MQTT merah, "Tidak bisa tersambung ... ENOTFOUND" | Host salah, atau server tanpa internet |
| Kartu MQTT merah, "ECONNREFUSED" | Broker belum jalan (jalur B atau C: jalankan broker dulu) atau port salah |
| Alat `MQTT tersambung`, tetapi dashboard "Belum pernah mengirim data" | `MQTT_PREFIX` alat berbeda dari server, `DEVICE_ID` mengandung karakter di luar huruf, angka, `-`, `_`, atau **kunci alat salah**. Cari baris `Telemetri ditolak` di Catatan kejadian |
| Log: `Dasar alat berbeda dengan server; bacaan diabaikan` | Dashboard > Kalibrasi > preset **Maket tinwall** > Simpan (atau "Tangki kosong") |
| Serial: `Konfigurasi server DITOLAK` | Dasar atau ambang di dashboard tidak cocok dengan tinwall: klik preset Maket tinwall lalu Simpan |
| Cari Wi-Fi: "Alat sedang offline" | Alat belum online, jadi tidak bisa dipindai dari dashboard. Pakai hotspot SIAGA-SETUP (Bagian 7.2) |
| Ganti Wi-Fi dari dashboard: hasil "Gagal" | Sandi salah, Wi-Fi 5 GHz (alat hanya 2,4 GHz), sinyal lemah, atau broker tidak terjangkau dari Wi-Fi itu. Alat sudah otomatis kembali ke Wi-Fi lama |
| Hotspot SIAGA-SETUP tidak muncul | Muncul hanya bila Wi-Fi putus sekitar 40 detik, atau kirim `w` di Serial Monitor |
| Kontrol **Demo maket** nonaktif | Maket belum melapor pompa (belum online atau bukan maket). Aktif sendiri begitu online |

### 12.4 Pompa dan demo

| Gejala | Penyebab dan perbaikan |
|---|---|
| Klik **Isi sampai target**, pompa tidak jalan | Pada kartu Demo harus muncul "Perintah: isi sampai ...". Serial Monitor harus menulis `Perintah pompa baru -> mode=2 ...`. Bila tidak muncul, cek status MQTT. Bila muncul `Pompa berhenti: ...`, ikuti pesannya |
| Pompa menyala sebentar lalu mati, dashboard "PENGAMAN ALAT" | Lihat `Pompa berhenti: ...` di Serial Monitor: air tidak naik (penampung kosong, selang lepas, sensor tertutup), batas 6,8 cm, atau batas waktu 120 detik |
| Pompa tidak sampai AWAS, berhenti di batas waktu | Pompa lambat; naikkan `PUMP_MAX_MS` |
| Air berhenti lebih tinggi dari target | Isi `PUMP_ANTISIPASI_CM` 0.05 sampai 0.15 |
| Relay menyala saat alat baru menyala | `RELAY_AKTIF_LOW` terbalik; ubah, unggah ulang, uji dengan `p` |
| Bacaan melompat-lompat | Selang menyemprot ke arah sensor, atau sensor miring. Arahkan selang ke dinding |
| `Sensor: jarak ... di luar jendela` | Sensor miring atau tertutup, atau dasar belum dikalibrasi: kirim `k` saat wadah kosong |

### 12.5 Kembali ke HTTP bila MQTT tidak teratasi

`konfigurasi.h`: `#define PAKAI_MQTT 0` dan isi `SERVER_URL` dengan `http://IP-LAPTOP:3001`, lalu unggah ulang. MQTT di server boleh tetap menyala. Cara ini dipakai bila laptop dan alat satu Wi-Fi; bila hotspot memakai "isolasi klien" alat tetap gagal, matikan isolasi atau pakai router biasa.

---

## 13. Pengujian dan batasan yang jujur

Uji otomatis di komputer (tanpa internet, tanpa perangkat keras):

| Perintah | Isi |
|---|---|
| `npm test` | 102 pemeriksaan server: login, telemetri, level, template, WhatsApp, riwayat |
| `npm run uji:mqtt` | 57 pemeriksaan jalur MQTT: paket baku, telemetri dan balasan, isi sampai target (berhenti sendiri, tidak mengisi lagi), pengaman, kunci atau ID salah ditolak, pesan wasiat, sandi broker salah, alur Wi-Fi (sandi tidak pernah tersimpan di disk, log, atau state) |
| `npm run uji:keamanan` | 29 pemeriksaan keamanan dasar |
| `npm run uji:maket` | 29 pemeriksaan logika kalibrasi, ditambah pemeriksaan sintaks sketsa untuk tiga varian konfigurasi |
| `npm run uji:dashboard` | 90 pemeriksaan di browser (perlu `npm i playwright` dan `npx playwright install chromium`) |

**Yang belum teruji, dan mohon diuji lebih dulu sebelum presentasi:**

- **Broker sungguhan** (HiveMQ, EMQX) belum dicoba. Klien MQTT di server saya tulis sendiri (MQTT 3.1.1, QoS 0, tanpa WebSocket) agar proyek tetap tanpa dependensi, dan baru diuji dengan broker mini serta paket baku MQTT.
- **Alat ESP8266 sungguhan** belum dicoba: pemeriksaan firmware baru sebatas sintaks dengan header tiruan, **bukan compile untuk board**. Ini termasuk pemindaian Wi-Fi, hotspot SIAGA-SETUP, percobaan lalu simpan Wi-Fi, dan pompa.
- Uji dengan urutan ini sebelum hari presentasi: (1) kalibrasi, (2) uji relay `p` tanpa air, (3) isi sampai 50 cm dengan pengawasan, (4) ganti Wi-Fi dari dashboard satu kali, lalu sengaja salahkan sandi untuk melihat alat kembali ke Wi-Fi lama, (5) cabut daya alat dan lihat status offline.
- Broker mini hanya alat uji: tanpa TLS dan tanpa login.
- Bila ada masalah yang tidak teratasi, kembali ke HTTP (Bagian 12.5).

---

## 14. Lampiran: referensi cepat

### 14.1 Topik dan isi pesan

Awalan `siaga` dapat diganti lewat `MQTT_PREFIX` (di server dan di `konfigurasi.h`, harus sama). `<id>` adalah `DEVICE_ID`.

| Topik | Arah | Isi |
|---|---|---|
| `siaga/<id>/telemetry` | alat ke server | JSON data sensor dan status, ditambah `"key"` (kunci alat). Server menolak bila `key` salah atau `id` tidak sama dengan `<id>` di topik |
| `siaga/<id>/cmd` | server ke alat | `{"ok":true,"level":0,"pump":0,"pump_mode":"TARGET","target_lvl":0,"target_m":0.9,"cfg":{...}}`. `pump_mode`: `OFF`, `MANUAL`, `TARGET`. `target_m` dalam meter nyata, atau `target_lvl` 1 sampai 3. Dapat memuat `wifi_scan` dan `wifi_set` |
| `siaga/<id>/wifi` | alat ke server | daftar Wi-Fi hasil pindai untuk dashboard (maksimum 8 jaringan) |
| `siaga/<id>/status` | alat ke broker | `online` (retained) saat tersambung; `offline` (pesan wasiat, retained) bila alat mati mendadak |

### 14.2 Perintah Serial Monitor (115200 baud)

| Huruf | Fungsi |
|---|---|
| `k` | kalibrasi dasar (wadah harus **kosong**) |
| `p` | uji relay 1,5 detik |
| `w` | buka hotspot setup Wi-Fi SIAGA-SETUP |
| `x` | hapus Wi-Fi tersimpan di alat |

### 14.3 Pesan penting di Serial Monitor

| Pesan | Artinya |
|---|---|
| `MQTT tersambung. Telemetri: ...` | berhasil tersambung ke broker |
| `Perintah pompa baru -> mode=2 ...` | perintah isi sampai target diterima (2 = TARGET, 1 = MANUAL, 0 = OFF) |
| `Target tercapai: ... cm` | pompa berhenti di target |
| `Pompa berhenti: ...` | pengaman menghentikan pompa; ikuti alasannya |
| `Fail-safe: ...` | pompa dimatikan karena koneksi atau balasan server hilang |
| `Wi-Fi ... tersambung dan DISIMPAN di alat.` | Wi-Fi baru berhasil dan tersimpan |
| `Wi-Fi ... GAGAL ... Kembali ke ...` | percobaan Wi-Fi baru gagal, alat kembali ke yang lama |
| `Portal setup AKTIF: ...` | hotspot SIAGA-SETUP terbuka (alamat 192.168.4.1) |

### 14.4 Variabel lingkungan server

| Variabel | Fungsi |
|---|---|
| `MQTT_URL` | alamat broker; mengaktifkan MQTT di server |
| `MQTT_USER`, `MQTT_PASS` | kredensial server di broker |
| `MQTT_PREFIX` | awalan topik (bawaan `siaga`) |
| `ADMIN_PASSWORD`, `DEVICE_KEY` | kata sandi admin dan kunci alat awal (hanya pertama kali) |
| `PORT` | port server (bawaan 3001) |
| `TRUST_PROXY=1` | hanya bila server di belakang proxy HTTPS tepercaya |

### 14.5 Berkas penting

| Berkas | Fungsi |
|---|---|
| `server/server.js` | server dan dashboard |
| `server/mqtt_bridge.js` | penghubung MQTT di server (tanpa dependensi) |
| `firmware/desa_siaga_banjir/desa_siaga_banjir.ino` | firmware alat |
| `firmware/desa_siaga_banjir/konfigurasi.h` | konfigurasi alat, diisi sekali, jangan dibagikan |
| `tools/stub/mqtt-broker-mini.js` | broker mini untuk uji dan demo di satu Wi-Fi |
| `deploy/` | contoh jalan otomatis (systemd, Windows, pm2) dan variabel lingkungan |
| `TUTORIAL.md` | berkas ini |
