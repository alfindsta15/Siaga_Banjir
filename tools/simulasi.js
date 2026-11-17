// Simulasi alat: kirim data banjir naik-turun ke server (tanpa perangkat keras)
// pakai: DEVICE_KEY=... node tools/simulasi.js [http://localhost:3000] [jeda_ms]
const url = process.argv[2] || 'http://localhost:3001', gap = +process.argv[3] || 1500, key = process.env.DEVICE_KEY, base = +process.env.BASE || 400;
const tinggi = [60, 100, 160, 160, 200, 260, 260, 330, 330, 300, 250, 250, 250, 200, 140, 140, 140, 90, 90, 90, 60];
(async () => {
  for (const h of tinggi) {
    const r = await fetch(url + '/api/device/telemetry', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Device-Key': key }, body: JSON.stringify({ id: 'sim', dist: base - h, rssi: -60 }) });
    const j = await r.json(); console.log(`tinggi ${h} cm -> level server ${j.level}`); await new Promise(s => setTimeout(s, gap));
  }
})();
