// Uji firmware maket di komputer (tanpa board):
//  1) logika kalibrasi (logika_maket.h) diuji dengan derau, lonjakan, dan simulasi pengisian
//  2) sketsa .ino diperiksa sintaksnya dengan header tiruan (BUKAN pengganti compile di Arduino IDE)
const { spawnSync } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path');
const R = path.join(__dirname, '..'), FW = path.join(R, 'firmware', 'desa_siaga_banjir'), tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'maket-'));
let ok = true; const run = (cmd, args, label) => { const r = spawnSync(cmd, args, { encoding: 'utf8' }); if (r.error && r.error.code === 'ENOENT') { console.log('LEWATI  ' + label + ' (g++ tidak ada)'); return null; } return r; };
let r = run('g++', ['-std=c++11', '-Wall', '-Wextra', '-Wno-misleading-indentation', '-I', FW, path.join(__dirname, 'uji_logika_maket.cpp'), '-o', path.join(tmp, 'logika')], 'kompilasi logika');
if (r) { if (r.status !== 0) { console.log('GAGAL  kompilasi logika_maket.h\n' + r.stderr); ok = false; } else { const x = spawnSync(path.join(tmp, 'logika'), [], { encoding: 'utf8' }); process.stdout.write(x.stdout.split('\n').filter(l => !/^LULUS/.test(l)).join('\n')); if (x.status !== 0) ok = false; } }
// sintaks .ino: tambahkan prototipe otomatis seperti Arduino IDE
const ino = fs.readFileSync(path.join(FW, 'desa_siaga_banjir.ino'), 'utf8'), protos = [];
for (const m of ino.matchAll(/^((?:const\s+)?[A-Za-z_][\w:]*[\s*&]+)([A-Za-z_]\w*)\(([^;{)]*)\)\s*\{/gm)) { if (!/^(if|for|while|switch|else|return)$/.test(m[2])) protos.push(`${m[1].trim()} ${m[2]}(${m[3]});`); }
fs.writeFileSync(path.join(tmp, 'sketch.cpp'), ino.replace(/(#include "logika_maket\.h"\n)/, '$1\n' + protos.join('\n') + '\n'));
const cfgAsli = fs.readFileSync(path.join(FW, 'konfigurasi.h'), 'utf8');
const varian = [   // sketsa harus lolos untuk: MQTT, HTTP, dan konfigurasi.h lama (tanpa baris MQTT sama sekali)
  ['MQTT (PAKAI_MQTT 1)', cfgAsli],
  ['HTTP (PAKAI_MQTT 0)', cfgAsli.replace('#define PAKAI_MQTT 1', '#define PAKAI_MQTT 0')],
  ['konfigurasi.h lama tanpa MQTT', cfgAsli.split('\n').filter(l => !/PAKAI_MQTT|MQTT_|^\/\/ ----/.test(l)).join('\n')]];
varian.forEach(([nama, isi], i) => {
  const vd = path.join(tmp, 'v' + i); fs.mkdirSync(vd); fs.writeFileSync(path.join(vd, 'konfigurasi.h'), isi);
  const rv = run('g++', ['-std=c++11', '-fsyntax-only', '-Wall', '-Wno-unused-variable', '-Wno-unused-function', '-Wno-unused-parameter', '-x', 'c++', '-I', vd, '-I', path.join(__dirname, 'mock_arduino'), '-I', FW, path.join(tmp, 'sketch.cpp')], 'sintaks .ino ' + nama);
  if (rv) { if (rv.status !== 0) { console.log('GAGAL  sintaks desa_siaga_banjir.ino, varian ' + nama + ' (header tiruan)\n' + rv.stderr.split('\n').slice(0, 30).join('\n')); ok = false; } else console.log('LULUS  sintaks desa_siaga_banjir.ino varian ' + nama + ' (' + protos.length + ' prototipe otomatis)' + (rv.stderr ? '\n(peringatan)\n' + rv.stderr.split('\n').slice(0, 12).join('\n') : '')); }
});
process.exit(ok ? 0 : 1);
