// Membuat docs/TEMPLATE_FONNTE.md dari server/template_fonnte.json (satu sumber, supaya dokumen selalu cocok): node tools/buat_docs_template.js
const fs = require('fs'), path = require('path'), R = path.join(__dirname, '..'), P = JSON.parse(fs.readFileSync(path.join(R, 'server', 'template_fonnte.json'), 'utf8'));
const NM = { tpl_normal: 'Level NORMAL', tpl_waspada: 'Level WASPADA', tpl_siaga: 'Level SIAGA', tpl_awas: 'Level AWAS', tpl_daily: 'Laporan harian', tpl_offline: 'Alat tidak mengirim data' };
const blk = o => Object.keys(NM).map(k => `**${k}** (${NM[k]})\n\`\`\`\n${o[k]}\n\`\`\`\n`).join('\n');
const sample = P.standar.tpl_awas.replace(/\{lokasi\}/g, 'Maket Desa').replace(/\{tinggi\}/g, '120').replace(/\{tren\}/g, 'naik').replace(/\{laju\}/g, '540').replace(/\{waktu\}/g, '14/11/2026, 22.19').replace(/^\{penutup\}\n/m, '');
const md = `# Template pesan WhatsApp

Pesan peringatan dikirim server ke grup warga lewat Baileys (atau Fonnte). Bentuknya bisa diubah di **Dashboard > Notifikasi > Template pesan WhatsApp**, atau pilih gaya siap pakai (tombol **Standar / Ringkas / Tegas**), periksa pratinjau, lalu **Simpan perubahan**. Tombol **Kirim contoh ke grup** mengirim satu pesan uji tanpa perlu menyimpan dulu.

Semua gaya disimpan di \`server/template_fonnte.json\` (gaya **standar** = bawaan). Dokumen ini dibuat dari berkas itu: ubah JSON-nya lalu jalankan \`node tools/buat_docs_template.js\`.

## Isian yang tersedia

| Isian | Diganti dengan | Berlaku di |
|---|---|---|
| \`{lokasi}\` | nama lokasi (tab Kalibrasi) | semua |
| \`{level}\` | NORMAL / WASPADA / SIAGA / AWAS | level, harian |
| \`{emoji}\` | lingkaran warna sesuai level | level, harian |
| \`{tinggi}\` | tinggi air (cm) | level, harian |
| \`{tren}\` | naik / turun / stabil | level |
| \`{laju}\` | kecepatan perubahan (cm/jam), 0 bila perubahan hanya derau sensor | level |
| \`{tindakan}\` | satu kalimat tindakan sesuai level | level |
| \`{penutup}\` | kalimat penutup (tab Notifikasi); barisnya hilang bila kosong | level |
| \`{waktu}\` | tanggal dan jam WIB | semua |
| \`{min24}\`, \`{max24}\` | terendah dan tertinggi 24 jam | harian |
| \`{alat}\` | online / tidak mengirim data | harian |
| \`{menit}\` | batas menit alat dianggap mati | alat offline |

Aturan: isian yang tidak berlaku atau salah ketik (mis. \`{tinggii}\`) ditolak saat menyimpan. Template **AWAS** wajib memuat \`{tindakan}\` atau kata "evakuasi". Template dikosongkan = kembali ke bawaan. Panjang maksimal 600 karakter. Baris yang hanya berisi satu isian kosong dibuang otomatis. Tanda \`*teks*\` membuat huruf tebal di WhatsApp. Matikan "Simbol emoji" di tab Notifikasi bila ingin teks polos (emoji dibuang saat kirim).

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

Yang tidak bisa diubah (tetap standar): pesan "sensor tidak dapat membaca" dan "alat kembali mengirim data". Balasan perintah \`STATUS\` memakai template level yang sedang aktif.

## Contoh hasil (gaya Standar, level AWAS)

\`\`\`
${sample}
\`\`\`

## Gaya Standar (bawaan)

${blk(P.standar)}
## Gaya Ringkas

${blk(P.ringkas)}
## Gaya Tegas

${blk(P.tegas)}
## Perintah warga

| Ketik di grup | Balasan |
|---|---|
| \`STATUS\` (atau \`info\`, \`air\`, \`level\`, \`cek\`) | kondisi terkini memakai template level aktif |
| \`BANTUAN\` | cara memakai perintah |
| \`TANYA <pertanyaan>\` atau \`bot <pertanyaan>\` | jawaban asisten AI (bila diaktifkan) |
| menyebut (@) nomor bot, atau membalas pesan bot (Baileys) | dijawab sebagai pertanyaan |

Tanya jawab AI: jawaban dikirim sebagai **balasan yang mengutip pertanyaan**. Satu orang tidak dilayani lagi sebelum jeda (bawaan 30 detik) selesai; pertanyaan yang sama dalam 10 menit memakai jawaban tersimpan; batas pertanyaan yang diproses AI per jam bisa diatur (bawaan 30). Saat level AWAS, jawaban memakai tindakan darurat standar, bukan AI.
`;
fs.writeFileSync(path.join(R, 'docs', 'TEMPLATE_FONNTE.md'), md); console.log('docs/TEMPLATE_FONNTE.md dibuat (' + md.length + ' karakter)');
