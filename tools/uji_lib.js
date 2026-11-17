// Pembantu uji: server Fonnte tiruan + menjalankan server siaga dengan data sementara
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), { spawn } = require('child_process');
const ROOT = path.join(__dirname, '..');

function mockFonnte() {   // meniru api.fonnte.com seperlunya; state bisa diatur dari uji
  const m = { sends: [], calls: [], connected: false, fetched: false, polls: 0, dataAsString: false, groups: [{ id: '120363000000000001@g.us', name: 'Warga RT 03' }, { id: '120363000000000002@g.us', name: 'Linmas Desa' }] };
  m.srv = http.createServer((req, res) => {
    let d = ''; req.on('data', c => d += c); req.on('end', () => {
      const p = req.url.split('?')[0], j = o => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
      m.calls.push(p);
      if (req.headers.authorization !== 'TOKEN-UJI') return j({ status: false, reason: 'invalid token' });
      if (p === '/send') { m.sends.push(Object.fromEntries(new URLSearchParams(d))); return j({ status: true, detail: 'success! message in queue' }); }
      if (p === '/fetch-group') { if (!m.connected) return j({ status: false, detail: 'cannot fetch with disconnected device' }); m.fetched = true; m.polls = 0; return j({ status: true, detail: 'update whatsapp group list finished' }); }
      if (p === '/get-whatsapp-group') {
        if (!m.fetched) return j({ status: false, detail: 'no whatsapp group, please fetch group first' });
        if (++m.polls < 2) return j({ status: true, data: [] });   // fetch-group berjalan di latar belakang: poll pertama masih kosong
        return j({ status: true, data: m.dataAsString ? JSON.stringify(m.groups) : m.groups });
      }
      res.writeHead(404); res.end('{}');
    });
  });
  return new Promise(ok => m.srv.listen(0, '127.0.0.1', () => { m.url = 'http://127.0.0.1:' + m.srv.address().port; ok(m); }));
}

async function startServer(mock, opt = {}) {
  const dir = opt.dir || fs.mkdtempSync(path.join(os.tmpdir(), 'siaga-uji-')), port = opt.port || 3900 + Math.floor(Math.random() * 90);
  if (opt.seed) fs.writeFileSync(path.join(dir, 'data.json'), JSON.stringify(opt.seed));
  const env = { ...process.env, PORT: port, DATA_DIR: dir, ADMIN_PASSWORD: 'sandi-uji-123', DEVICE_KEY: 'kunci-alat-uji-123', WEBHOOK_KEY: 'kunci-webhook-uji',
    FONNTE_URL: mock ? mock.url : 'http://127.0.0.1:9', GROUP_POLL_MS: '30', GROUP_COOLDOWN_MS: '3600000', DAILY_TICK_MS: '600000', ...opt.env };
  const proc = spawn('node', [path.join(ROOT, 'server', 'server.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; proc.stdout.on('data', d => log += d); proc.stderr.on('data', d => log += d);
  const base = 'http://127.0.0.1:' + port;
  for (let i = 0; i < 60; i++) { try { if ((await fetch(base + '/healthz')).ok) break; } catch (e) {} await new Promise(r => setTimeout(r, 100)); }
  return { base, dir, port, proc, log: () => log, stop: () => new Promise(r => { proc.once('exit', r); proc.kill('SIGTERM'); }) };
}

function client(base) {
  let cookie = '';
  const call = async (method, p, body, hdr) => {
    const r = await fetch(base + p, { method, redirect: 'manual', headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...hdr }, body: body !== undefined ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) {}
    return { status: r.status, json: j, text: t, headers: r.headers };
  };
  return { get: (p, h) => call('GET', p, undefined, h), post: (p, b, h) => call('POST', p, b === undefined ? {} : b, h), login: () => call('POST', '/api/admin/login', { password: 'sandi-uji-123' }) };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
function reporter() {
  let pass = 0, fail = 0; const rows = [];
  const t = (name, ok, extra) => { ok ? pass++ : fail++; rows.push(`${ok ? 'LULUS' : 'GAGAL'}  ${name}${!ok && extra ? '  -> ' + extra : ''}`); console.log(rows[rows.length - 1]); };
  return { t, done: () => { console.log(`\n${pass} lulus, ${fail} gagal`); return fail === 0; } };
}
module.exports = { mockFonnte, startServer, client, sleep, reporter, ROOT };
