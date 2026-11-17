# Maket tinwall untuk presentasi

Wadah **tinwall**: tinggi **7,5 cm**, panjang **17 cm**, lebar **11 cm**. Sensor HC-SR04 di atasnya, sekitar **10 cm dari dasar** (mewakili sungai). Skala maket **1 cm = 20 cm sungai nyata** (bisa diubah di `desa_siaga_banjir.ino`, konstanta `SKALA`).

## Ukuran dan volume air
Luas dasar 17 × 11 = **187 cm²**, jadi **1 cm tinggi air = 187 ml**.

| Level | Tinggi maket | Tinggi nyata (dashboard) | Air yang dibutuhkan dari kosong |
|---|---|---|---|
| WASPADA | 2,5 cm | 50 cm | ± 468 ml |
| SIAGA | 4,5 cm | 90 cm | ± 842 ml |
| AWAS | 6,0 cm | 120 cm | ± 1.122 ml |
| Batas aman pompa | 6,8 cm | 136 cm | ± 1.272 ml |
| Penuh (bibir tinwall) | 7,5 cm | 150 cm | ± 1.403 ml |

Waktu mengisi = volume ÷ debit pompa. Contoh pompa 20 ml/detik: WASPADA ± 23 detik, AWAS ± 56 detik. Ukur debit pompa Anda sendiri (jalankan 10 detik ke gelas ukur).

## Isi sampai tinggi tertentu (wadah dikosongkan manual)
Dashboard > Ringkasan > kartu **Pompa maket**: isi tinggi nyata (mis. 90 cm = 4,5 cm maket) lalu **Isi sampai target**, atau klik WASPADA / SIAGA / AWAS. Pompa menyala, **berhenti sendiri** di target, dan tidak mengisi lagi sebelum ada perintah baru. Tidak ada pompa buang: **kosongkan wadah dengan tangan setelah demo** (tuang ke penampung); mengosongkan wadah tidak memicu pengisian ulang.

- Target di dashboard 5 sampai 130 cm nyata (6,5 cm maket); pompa tetap berhenti paksa di 6,8 cm.
- Satu kali jalan maksimum 120 detik (`PUMP_MAX_MS`). Pompa lambat (< ± 10 ml/detik) perlu nilai itu dinaikkan untuk target tinggi.
- Air berhenti lebih tinggi dari target? Isi `PUMP_ANTISIPASI_CM` 0.05 sampai 0.15 di `.ino` (untuk target "cm").
- Lewat MQTT perintah sampai seketika; lewat HTTP menunggu kiriman alat berikutnya (maks. 3 detik). Panduan online lewat MQTT dan SOP demo: [TUTORIAL.md](../TUTORIAL.md).

## Pemasangan sensor
- Tegak lurus ke bawah, di **tengah** tangki, jauh dari dinding dan dari selang pompa. Sensor HC-SR04 "melihat" kerucut sekitar 15°; pada jarak 10 cm lebarnya ± 2,7 cm.
- **Arahkan selang pompa ke dinding atau ke bawah permukaan air**, jangan menyemprot ke arah sensor. Percikan dan gelembung membuat pantulan palsu.
- Saat penuh, jarak ke air tinggal 2,5 cm, mendekati batas dekat HC-SR04 (2 cm). Itu sebabnya pompa berhenti di 6,8 cm.

## Langkah pemasangan (sekali)
1. Buka `firmware/desa_siaga_banjir/konfigurasi.h`, isi Wi-Fi 2,4 GHz, `SERVER_URL`, `DEVICE_KEY`, `DEVICE_ID` (paling mudah: Dashboard > Koneksi > Hubungkan alat > Maket, lalu salin hasilnya). **Jangan bagikan berkas ini** (masuk `.gitignore`).
2. Arduino IDE: papan **NodeMCU 1.0 (ESP-12E)**, library **ArduinoJson v7**. Unggah `desa_siaga_banjir.ino` (berkas `logika_maket.h` dan `konfigurasi.h` ikut terbuka sebagai tab).
3. **Kalibrasi dasar:** kosongkan tangki, tunggu air tenang, lalu kirim huruf `k` di Serial Monitor (115200). Atau di dashboard > Kalibrasi klik **Tangki kosong: jadikan bacaan sekarang sebagai dasar**. Jarak dasar yang tepat menentukan semua angka lain; jangan hanya mengandalkan "sekitar 10 cm".
4. Dashboard > Kalibrasi > **Maket tinwall 17 x 11 x 7,5 cm** > Simpan perubahan (dasar 200, waspada 50, siaga 90, awas 120 cm nyata).
5. Serial Monitor saat menyala menampilkan volume tiap level dan jarak dasar yang dipakai.

## Pompa dengan relay
Relay hanya nyala atau mati: **kecepatan pompa tidak bisa diatur** (tidak ada PWM). Air selalu mengalir dengan debit penuh pompa; jumlah air diatur dengan **lama pompa menyala** (waktu = ml ÷ debit) dan sensor sebagai pengaman. Untuk membuat air naik lebih pelan, kecilkan selang/keran pada jalur keluar, bukan menyalakan-mematikan relay cepat-cepat (relay mekanis aus dan berisik).

Pemasangan:
- **Jenis relay:** modul relay 1 kanal biasanya **aktif-LOW** (IN diberi LOW = relay nyala). Di `desa_siaga_banjir.ino` ada `RELAY_AKTIF_LOW`; bawaannya `false` (cocok untuk MOSFET/aktif-HIGH seperti sebelumnya). **Untuk modul relay biasa ubah menjadi `true`.**
- **Uji dulu tanpa air dan tanpa selang:** nyalakan ESP; relay harus diam (tidak klik, lampu relay mati). Lalu kirim `p` di Serial Monitor: relay menyala 1,5 detik lalu mati. Bila terbalik, ubah `RELAY_AKTIF_LOW`.
- **Catu daya:** pompa dari catu sendiri (bukan pin 3V3/VIN NodeMCU atau USB laptop). Lonjakan arus pompa menurunkan tegangan dan mereset ESP. Modul relay: VCC ke 5 V (VIN), GND ke GND NodeMCU, IN ke D7. Pilih modul dengan optocoupler yang bisa digerakkan 3,3 V.
- **Pompa DC:** pasang dioda (mis. 1N4007) **terbalik** paralel di terminal pompa (garis dioda ke +), agar lonjakan saat dimatikan tidak merusak kontak relay dan tidak menimbulkan derau.
- **Derau:** kabel pompa/relay dijauhkan dari kabel sensor HC-SR04. Lonjakan saat relay berpindah bisa menimbulkan bacaan palsu atau reset; penyaring lonjakan membantu, tetapi pemasangan yang rapi lebih baik.
- Relay tidak mengubah pengaman: pompa tetap berhenti di 6,8 cm, setelah 120 detik, atau bila air tidak naik dalam 25 detik.

## Kenapa tidak lagi minus atau "halusinasi"
Beberapa lapis pengaman, di alat **dan** di server:

| Lapis | Yang dilakukan |
|---|---|
| Jendela jarak | Bacaan di luar rentang yang mungkin (lebih jauh dari dasar + 1 cm, atau lebih dekat dari batas HC-SR04) **ditolak dan dihitung gagal baca**, bukan dijadikan "air minus" |
| Batas 0 .. tinggi tangki | Tinggi air tidak pernah minus dan tidak pernah melebihi tinggi tangki |
| Zona nol | Derau ± 0,25 cm di tangki kosong dianggap 0, tidak menjadi "air" |
| Penyaring lonjakan | Loncatan > 1 cm antar bacaan (percikan, pantulan ganda) diabaikan sampai 3 kali beruntun; bila bertahan baru diikuti sebagai perubahan nyata |
| Penghalusan | Meredam riak air sehingga level tidak naik-turun di sekitar ambang |
| Tren statistik (server) | "Naik/turun" dan laju hanya dilaporkan bila perubahan nyata secara statistik; derau sensor menghasilkan "stabil, 0 cm/jam" |
| Pemeriksaan kecocokan | Alat menolak kalibrasi dari server yang tidak cocok dengan tinwall (mis. preset maket lama 22 cm); server menolak menghitung bila dasar alat dan server berbeda |

Hasil uji (komputer): tangki kosong dengan derau ± 0,3 cm selama 3.000 bacaan tidak pernah menghasilkan tinggi di atas 0 atau minus; pada simulasi pengisian 0 → 6,5 cm dengan derau dan 3% percikan, galat tinggi tersaring maksimum 0,41 cm dan setiap level terdeteksi paling lambat 3 detik dari kenyataan.

## Pesan di Serial Monitor
| Pesan | Artinya |
|---|---|
| `Sensor: jarak ... di luar jendela (lebih jauh dari dasar ...)` | sensor miring/tertutup, atau jarak dasar belum dikalibrasi: kirim `k` saat tangki kosong |
| `Sensor: jarak ... terlalu dekat` | percikan, bibir wadah, atau sesuatu menghalangi sensor |
| `Lonjakan ... diabaikan` | satu bacaan aneh ditolak; normal sesekali, terus-menerus berarti sensor terganggu |
| `Konfigurasi server DITOLAK` | dasar/ambang di dashboard tidak cocok dengan tinwall: klik preset **Maket tinwall** lalu Simpan |
| `Pompa berhenti: air tidak naik` | pompa nyala 25 detik tetapi air tidak naik ≥ 0,25 cm: cek air di penampung, selang, atau sensor tertutup |
| `Pompa berhenti: batas aman tangki / sensor tercapai` | tinggi ≥ 6,8 cm atau sensor bermasalah |

## Notifikasi saat demo
Preset maket memakai jeda minimum **1 menit** dan pembaruan tiap **naik 20 cm nyata (= 1 cm maket)**. Kenaikan level (WASPADA → SIAGA → AWAS) selalu dikirim langsung. Tidak ada pengingat berkala. Detail: `docs/TEMPLATE_FONNTE.md`.

## Pengujian
`npm run uji:maket` menjalankan uji logika kalibrasi di komputer (derau, lonjakan, simulasi pengisian) dan memeriksa sintaks sketsa dengan header tiruan. **Itu bukan compile untuk board.** Selalu unggah dan lihat Serial Monitor.
