# Template pesan WhatsApp

Pesan peringatan dikirim server ke grup warga lewat Baileys (atau Fonnte). Bentuknya bisa diubah di **Dashboard > Notifikasi > Template pesan WhatsApp**, atau pilih gaya siap pakai (tombol **Standar / Ringkas / Tegas**), periksa pratinjau, lalu **Simpan perubahan**. Tombol **Kirim contoh ke grup** mengirim satu pesan uji tanpa perlu menyimpan dulu.

Semua gaya disimpan di `server/template_fonnte.json` (gaya **standar** = bawaan). Dokumen ini dibuat dari berkas itu: ubah JSON-nya lalu jalankan `node tools/buat_docs_template.js`.

## Isian yang tersedia

| Isian | Diganti dengan | Berlaku di |
|---|---|---|
| `{lokasi}` | nama lokasi (tab Kalibrasi) | semua |
| `{level}` | NORMAL / WASPADA / SIAGA / AWAS | level, harian |
| `{emoji}` | lingkaran warna sesuai level | level, harian |
| `{tinggi}` | tinggi air (cm) | level, harian |
| `{tren}` | naik / turun / stabil | level |
| `{laju}` | kecepatan perubahan (cm/jam), 0 bila perubahan hanya derau sensor | level |
| `{tindakan}` | satu kalimat tindakan sesuai level | level |
| `{penutup}` | kalimat penutup (tab Notifikasi); barisnya hilang bila kosong | level |
| `{waktu}` | tanggal dan jam WIB | semua |
| `{min24}`, `{max24}` | terendah dan tertinggi 24 jam | harian |
| `{alat}` | online / tidak mengirim data | harian |
| `{menit}` | batas menit alat dianggap mati | alat offline |

Aturan: isian yang tidak berlaku atau salah ketik (mis. `{tinggii}`) ditolak saat menyimpan. Template **AWAS** wajib memuat `{tindakan}` atau kata "evakuasi". Template dikosongkan = kembali ke bawaan. Panjang maksimal 600 karakter. Baris yang hanya berisi satu isian kosong dibuang otomatis. Tanda `*teks*` membuat huruf tebal di WhatsApp. Matikan "Simbol emoji" di tab Notifikasi bila ingin teks polos (emoji dibuang saat kirim).

## Kapan pesan dikirim (anti-spam)
Pesan **tidak** dikirim berkala. Pesan level hanya terkirim saat ada perubahan yang berarti:

| Kejadian | Pesan |
|---|---|
| Level naik (NORMAL → WASPADA → SIAGA → AWAS) | **langsung**, tanpa jeda |
| Level turun (setelah beberapa bacaan aman) | dikirim bila sudah lewat jeda minimum (bawaan 5 menit; maket 1 menit). Naik-turun cepat di sekitar ambang tidak membanjiri grup |
| Air naik berarti di level yang sama (≥ batas "pembaruan", bawaan 20 cm) | satu pesan berawalan "🔄 PEMBARUAN KONDISI", juga mengikuti jeda minimum |
| Air bergerak kecil, atau turun di level yang sama | tidak ada pesan |
| Level sama dan air tetap | tidak ada pesan (tidak ada pengingat berkala) |

Pengaturannya di **Kalibrasi > Pengaturan lanjutan**: "Kirim pembaruan bila air naik lagi sebesar (cm)" dan "Jeda minimum antar pesan non-darurat (menit)". Pesan "alat tidak mengirim data" dikirim satu kali per kejadian. Laporan harian satu kali per hari.

Yang tidak bisa diubah (tetap standar): pesan "sensor tidak dapat membaca" dan "alat kembali mengirim data". Balasan perintah `STATUS` memakai template level yang sedang aktif.

## Contoh hasil (gaya Standar, level AWAS)

```
🔴 PERINGATAN BAHAYA
🚨🚨 POTENSI BANJIR!
━━━━━━━━━━━━━━━━━━
📍 Lokasi: Maket Desa
💧 Tinggi air: 120 cm
📈 Tren: naik
⚡ Laju perubahan: 540 cm/jam
🆘 TINDAKAN DARURAT:
• Segera menjauh dari area sungai.
• Lakukan evakuasi ke tempat yang lebih aman sesuai arahan petugas.
• Bantu anak-anak, lansia, dan warga yang membutuhkan bantuan.
• Jangan menerobos arus banjir.
• Ikuti instruksi petugas penanggulangan bencana.
⛔ UTAMAKAN KESELAMATAN JIWA!
Balas STATUS untuk melihat kondisi terbaru.
🕒 14/11/2026, 22.19 WIB
```

## Gaya Standar (bawaan)

**tpl_normal** (Level NORMAL)
```
🟢 KONDISI NORMAL
━━━━━━━━━━━━━━━━━━
📍 Lokasi: {lokasi}
💧 Tinggi air: {tinggi} cm
📈 Tren: {tren}
✅ Air sungai dalam batas aman. Tetap pantau informasi dari petugas.
{penutup}
Balas STATUS untuk melihat kondisi terbaru.
🕒 {waktu} WIB
```

**tpl_waspada** (Level WASPADA)
```
🟡 STATUS WASPADA
⚠️ AIR SUNGAI MULAI NAIK
━━━━━━━━━━━━━━━━━━
📍 Lokasi: {lokasi}
💧 Tinggi air: {tinggi} cm
📈 Tren: {tren}
⚡ Laju perubahan: {laju} cm/jam
📢 IMBAUAN:
• Tetap tenang dan jangan panik.
• Pantau kondisi sungai secara berkala.
• Siapkan dokumen penting dan perlengkapan darurat.
• Hindari beraktivitas di bantaran sungai.
{penutup}
Balas STATUS untuk melihat kondisi terbaru.
🕒 {waktu} WIB
```

**tpl_siaga** (Level SIAGA)
```
🟠 STATUS SIAGA
🚨 AIR SUNGAI TERUS MENINGKAT!
━━━━━━━━━━━━━━━━━━
📍 Lokasi: {lokasi}
💧 Tinggi air: {tinggi} cm
📈 Tren: {tren}
⚡ Laju perubahan: {laju} cm/jam
⚠️ TINDAKAN SEGERA:
• Siapkan tas siaga dan perlengkapan evakuasi.
• Pindahkan barang berharga ke tempat yang lebih tinggi.
• Perhatikan anak-anak, lansia, dan warga yang membutuhkan bantuan.
• Bersiap menuju titik kumpul bila diminta petugas.
{penutup}
Balas STATUS untuk melihat kondisi terbaru.
🕒 {waktu} WIB
```

**tpl_awas** (Level AWAS)
```
🔴 PERINGATAN BAHAYA
🚨🚨 POTENSI BANJIR!
━━━━━━━━━━━━━━━━━━
📍 Lokasi: {lokasi}
💧 Tinggi air: {tinggi} cm
📈 Tren: {tren}
⚡ Laju perubahan: {laju} cm/jam
🆘 TINDAKAN DARURAT:
• Segera menjauh dari area sungai.
• Lakukan evakuasi ke tempat yang lebih aman sesuai arahan petugas.
• Bantu anak-anak, lansia, dan warga yang membutuhkan bantuan.
• Jangan menerobos arus banjir.
• Ikuti instruksi petugas penanggulangan bencana.
{penutup}
⛔ UTAMAKAN KESELAMATAN JIWA!
Balas STATUS untuk melihat kondisi terbaru.
🕒 {waktu} WIB
```

**tpl_daily** (Laporan harian)
```
📋 LAPORAN HARIAN
━━━━━━━━━━━━━━━━━━
📍 Lokasi: {lokasi}
{emoji} Status: {level}
💧 Tinggi air: {tinggi} cm
📊 24 jam terakhir: {min24} - {max24} cm
🔧 Alat: {alat}
🕒 {waktu} WIB
```

**tpl_offline** (Alat tidak mengirim data)
```
⚠️ PERANGKAT TIDAK MENGIRIM DATA
━━━━━━━━━━━━━━━━━━
📍 Lokasi: {lokasi}
⏱️ Tidak ada data selama lebih dari {menit} menit.
🔧 Periksa daya, Wi-Fi, dan sensor alat.
👀 Pantau tinggi air secara langsung sampai alat kembali normal.
🕒 {waktu} WIB
```

## Gaya Ringkas

**tpl_normal** (Level NORMAL)
```
🟢 *INFO KONDISI AIR*
📍 Lokasi: {lokasi}
Status: *{level}*
Tinggi air: {tinggi} cm ({tren})
🕒 {waktu} WIB
```

**tpl_waspada** (Level WASPADA)
```
🟡 *PERINGATAN WASPADA*
📍 Lokasi: {lokasi}
━━━━━━━━━━━━━━
Tinggi air: *{tinggi} cm*
Kondisi: {tren}

⚠️ Tindakan:
{tindakan}

🕒 {waktu} WIB
```

**tpl_siaga** (Level SIAGA)
```
🟠 *PERINGATAN SIAGA*
📍 Lokasi: {lokasi}
━━━━━━━━━━━━━━
Tinggi air: *{tinggi} cm*
Kondisi: {tren}

🚨 Tindakan segera:
{tindakan}

🕒 {waktu} WIB
```

**tpl_awas** (Level AWAS)
```
🔴 *PERINGATAN AWAS BANJIR*
📍 Lokasi: {lokasi}
━━━━━━━━━━━━━━
Tinggi air: *{tinggi} cm*

🚨 *SEGERA LAKUKAN EVAKUASI SESUAI ARAHAN PETUGAS!*

Tindakan:
{tindakan}

🕒 {waktu} WIB
```

**tpl_daily** (Laporan harian)
```
📋 *LAPORAN HARIAN*
📍 Lokasi: {lokasi}
━━━━━━━━━━━━━━
Status: *{level}*
Tinggi air: *{tinggi} cm*

📊 Rekapitulasi 24 jam:
Minimum: {min24} cm
Maksimum: {max24} cm

🔧 Kondisi alat: {alat}
━━━━━━━━━━━━━━
🕒 {waktu} WIB
```

**tpl_offline** (Alat tidak mengirim data)
```
⚠️ *PERINGATAN GANGGUAN PERANGKAT*
📍 Lokasi: {lokasi}
━━━━━━━━━━━━━━
Perangkat tidak mengirimkan data selama lebih dari *{menit} menit*.

🔧 Tindakan:
Periksa sumber daya, koneksi Wi-Fi, dan kondisi sensor.

Lakukan pemantauan tinggi air secara langsung sampai perangkat kembali normal.

🕒 {waktu} WIB
```

## Gaya Tegas

**tpl_normal** (Level NORMAL)
```
🟢 *INFORMASI KONDISI AIR*
📍 Lokasi: {lokasi}
━━━━━━━━━━━━━━
Status: *{level}*
Tinggi air: *{tinggi} cm*
Tren: {tren}

{tindakan}

{penutup}

🕒 Pembaruan: {waktu} WIB
```

**tpl_waspada** (Level WASPADA)
```
🟡 *PERINGATAN WASPADA BANJIR*
📍 Lokasi: {lokasi}
━━━━━━━━━━━━━━
Tinggi air: *{tinggi} cm*
Tren: {tren}
Laju perubahan: {laju} cm/jam

⚠️ *TINDAKAN YANG PERLU DILAKUKAN*
{tindakan}

Siapkan kebutuhan darurat dan pantau perkembangan kondisi air.
Ikuti informasi resmi dari BPBD dan petugas setempat.

{penutup}

🕒 {waktu} WIB
```

**tpl_siaga** (Level SIAGA)
```
🟠 *PERINGATAN SIAGA BANJIR*
📍 Lokasi: {lokasi}
━━━━━━━━━━━━━━
Tinggi air: *{tinggi} cm*
Tren: {tren}
Laju perubahan: {laju} cm/jam

🚨 *TINDAKAN SEGERA*
{tindakan}

Amankan barang penting, periksa jalur evakuasi, dan bantu warga yang membutuhkan.
Tetap pantau informasi dari petugas setempat.

{penutup}

🕒 {waktu} WIB
```

**tpl_awas** (Level AWAS)
```
🔴 *PERINGATAN AWAS BANJIR*
📍 Lokasi: {lokasi}
━━━━━━━━━━━━━━
Tinggi air: *{tinggi} cm*
Tren: {tren}
Laju perubahan: {laju} cm/jam

🚨 *SEGERA LAKUKAN EVAKUASI!*

{tindakan}

Utamakan keselamatan jiwa.
Bantu anak-anak, lansia, ibu hamil, dan penyandang disabilitas menuju tempat aman.
Jangan menerobos arus banjir dan ikuti arahan petugas.

{penutup}

🕒 {waktu} WIB
```

**tpl_daily** (Laporan harian)
```
📋 *LAPORAN PEMANTAUAN HARIAN*
📍 Lokasi: {lokasi}
━━━━━━━━━━━━━━
📊 *KONDISI TERKINI*
Status: *{level}*
Tinggi air: *{tinggi} cm*

📈 *REKAPITULASI 24 JAM*
Tinggi minimum: {min24} cm
Tinggi maksimum: {max24} cm

🔧 *KONDISI PERANGKAT*
Status alat: {alat}
━━━━━━━━━━━━━━
Laporan diperbarui:
🕒 {waktu} WIB
```

**tpl_offline** (Alat tidak mengirim data)
```
⚠️ *PERINGATAN PERANGKAT OFFLINE*
📍 Lokasi: {lokasi}
━━━━━━━━━━━━━━
Perangkat pemantauan tidak mengirimkan data selama lebih dari *{menit} menit*.

🔧 *TINDAKAN YANG DIPERLUKAN*
1. Periksa sumber daya perangkat.
2. Periksa koneksi Wi-Fi.
3. Periksa sensor dan kondisi perangkat.
4. Lakukan pemantauan tinggi air secara langsung.

⚠️ *PENTING:*
Jangan menganggap kondisi air aman selama data pemantauan belum tersedia.

🕒 {waktu} WIB
```

## Perintah warga

| Ketik di grup | Balasan |
|---|---|
| `STATUS` (atau `info`, `air`, `level`, `cek`) | kondisi terkini memakai template level aktif |
| `BANTUAN` | cara memakai perintah |
| `TANYA <pertanyaan>` atau `bot <pertanyaan>` | jawaban asisten AI (bila diaktifkan) |
| menyebut (@) nomor bot, atau membalas pesan bot (Baileys) | dijawab sebagai pertanyaan |

Tanya jawab AI: jawaban dikirim sebagai **balasan yang mengutip pertanyaan**. Satu orang tidak dilayani lagi sebelum jeda (bawaan 30 detik) selesai; pertanyaan yang sama dalam 10 menit memakai jawaban tersimpan; batas pertanyaan yang diproses AI per jam bisa diatur (bawaan 30). Saat level AWAS, jawaban memakai tindakan darurat standar, bukan AI.
