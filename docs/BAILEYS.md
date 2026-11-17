# WhatsApp lewat Baileys (alternatif Fonnte)

Baileys adalah pustaka Node.js yang menyambungkan server ini ke WhatsApp **seperti WhatsApp Web** (perangkat tertaut), cukup dengan scan QR sekali. Ini opsional; Fonnte tetap bisa dipakai.

## Kenapa lebih enak
| | Fonnte | Baileys |
|---|---|---|
| Biaya | paket berbayar (cek harga terbaru) | tanpa biaya layanan |
| Daftar grup | harus "Perbarui" dengan batas per jam, kadang kosong | langsung dari WhatsApp, selalu lengkap |
| Balasan `STATUS` / `TANYA` | perlu webhook: server wajib HTTPS publik dan diatur di situs Fonnte | **tanpa webhook**, server menerima pesan grup langsung |
| Pemasangan | token di dashboard | `npm install` + scan QR |
| Risiko | layanan tidak resmi | **tidak resmi**: nomor bisa dibatasi atau diblokir; versi WhatsApp baru kadang merusak pustaka sampai diperbarui |
| Ketahanan | dikelola penyedia | sesi hidup di server ini; server mati = tidak ada pesan |

**Saran:** pakai Baileys sebagai jalur utama dan biarkan **Cadangan lewat Fonnte** aktif (isi token Fonnte). Bila Baileys terputus atau pesan gagal, pesan otomatis dikirim lewat Fonnte ke ID grup yang sama. Untuk peringatan keselamatan, jangan bergantung pada satu jalur WhatsApp saja.

## Memasang
Di folder `siaga-banjir` (Node.js 20 atau lebih baru disarankan; cek persyaratan versi Baileys yang terpasang):
```bash
npm install
```
Perintah itu memasang `@whiskeysockets/baileys` dan `qrcode` (keduanya opsional; server tetap jalan tanpa keduanya selama Baileys tidak dipilih). Beberapa versi Baileys membutuhkan **git** terpasang. Bila dashboard menjawab "Paket Baileys belum terpasang", jalankan `npm install @whiskeysockets/baileys qrcode` langsung agar pesan galatnya terlihat, lalu mulai ulang server.

Setelah terpasang dan berhasil dicoba, **kunci versinya**: simpan `package-lock.json` dan ganti `latest` di `package.json` dengan nomor versi yang terpasang. Pustaka ini pihak ketiga yang tidak resmi; jangan memperbaruinya otomatis tanpa mencoba lagi dengan grup percobaan.

## Memakai
1. Dashboard > **Notifikasi > WhatsApp**: Penyedia = **Baileys**, **Simpan perubahan**.
2. Klik **Hubungkan (tampilkan QR)**. Di ponsel (nomor khusus): WhatsApp > Setelan > **Perangkat tertaut** > Tautkan perangkat > pindai kode.
3. Status berubah **Terhubung** dan daftar grup muncul sendiri. Klik **Pakai** pada grup warga, **Simpan perubahan**, lalu **Tes WhatsApp**.
4. (Disarankan) isi token Fonnte dan biarkan **Cadangan lewat Fonnte** menyala.
5. Ketik `STATUS` di grup: server membalas langsung, tanpa webhook.

Sesi tersimpan di folder `wa-session/` di dalam `DATA_DIR`. Jaga seperti kata sandi: siapa pun yang memilikinya dapat mengendalikan WhatsApp nomor itu. Jangan menjalankan dua server dengan sesi yang sama. Untuk memutus: tombol **Putuskan dan hapus sesi** (atau hapus dari Perangkat tertaut di ponsel).

## Mengurangi risiko diblokir
- Pakai **nomor khusus** yang sudah beberapa waktu aktif, bukan nomor pribadi dan bukan nomor yang baru dibeli.
- Kirim seperlunya (pesan saat level berubah dan laporan harian sudah cukup). Jangan kirim ke banyak nomor pribadi atau pesan berulang yang sama.
- Server menjeda 1,5 detik antarpesan. Masukkan nomor ke grup secara manual dari ponsel.
- Bila terkena pembatasan, dashboard akan menunjukkan status terputus/keluar; jalur cadangan Fonnte tetap bisa mengirim.

## Pemecahan masalah
| Gejala | Penyebab / perbaikan |
|---|---|
| "Paket Baileys belum terpasang" | jalankan `npm install` (atau pasang langsung seperti di atas), mulai ulang server |
| "Paket qrcode belum terpasang" | `npm install qrcode` |
| QR tidak muncul / terus "Memulai" | lihat log server; versi WhatsApp Web berubah, perbarui Baileys: `npm install @whiskeysockets/baileys@latest` |
| "Sesi dikeluarkan" | perangkat dihapus dari Perangkat tertaut atau nomor dibatasi; scan QR ulang |
| Sering terputus | koneksi internet server tidak stabil; sambung ulang otomatis dengan jeda bertahap sampai 60 detik |
| Pesan tidak masuk grup | ID grup belum dipilih/disimpan, nomor bukan anggota grup, atau Baileys belum "Terhubung" |

## Batas pengujian (jujur)
Lapisan penyambung (`server/wa_baileys.js`) diuji otomatis memakai **Baileys tiruan** (QR, terhubung, daftar grup, kirim, terima, putus, cadangan, keluar). Belum diuji dengan pustaka dan WhatsApp **asli**, karena lingkungan pengembangan tidak punya internet. Saat pertama dipakai, coba dulu dengan grup percobaan. Bila versi Baileys Anda mengubah API, bagian yang perlu disesuaikan hanya di `wa_baileys.js`: `makeWASocket`, `useMultiFileAuthState`, kejadian `connection.update` dan `messages.upsert`, `groupFetchAllParticipating`, dan `sendMessage`.
