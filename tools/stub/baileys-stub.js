// Baileys TIRUAN untuk uji (bukan WhatsApp asli). Dikendalikan lewat berkas di folder STUB_DIR:
//   SCAN = "scan QR" (terhubung), DROP = putus koneksi, IN.jsonl = pesan masuk, OUT.jsonl = pesan keluar
const fs = require('fs'), path = require('path'), f = n => path.join(process.env.STUB_DIR, n);
function makeWASocket() {
  const h = {}, ev = { on: (k, fn) => (h[k] = h[k] || []).push(fn) }, emit = (k, v) => (h[k] || []).forEach(fn => fn(v)); let opened = false, pos = 0, iv;
  const sock = { ev, user: null,
    async groupFetchAllParticipating() { return { '120363111@g.us': { id: '120363111@g.us', subject: 'Warga RT 03 (Baileys)' }, '120363222@g.us': { id: '120363222@g.us', subject: 'Linmas Desa' } }; },
    async sendMessage(jid, c, o) { fs.appendFileSync(f('OUT.jsonl'), JSON.stringify({ jid, text: c.text, quoted: !!(o && o.quoted) }) + '\n'); },
    async sendPresenceUpdate(p, jid) { fs.appendFileSync(f('PRES.jsonl'), JSON.stringify({ p, jid }) + '\n'); },
    async logout() { clearInterval(iv); emit('connection.update', { connection: 'close', lastDisconnect: { error: { output: { statusCode: 401 } } } }); },
    end() { clearInterval(iv); } };
  setTimeout(() => emit('connection.update', { qr: 'STUB-QR-' + Date.now() }), 40);
  iv = setInterval(() => {
    if (!opened && fs.existsSync(f('SCAN'))) { opened = true; sock.user = { id: '6281200000000:12@s.whatsapp.net' }; emit('connection.update', { connection: 'open' }); }
    if (opened && fs.existsSync(f('DROP'))) { fs.unlinkSync(f('DROP')); opened = false; clearInterval(iv); emit('connection.update', { connection: 'close', lastDisconnect: { error: { output: { statusCode: 428 } } } }); return; }
    if (opened && fs.existsSync(f('IN.jsonl'))) { const L = fs.readFileSync(f('IN.jsonl'), 'utf8').split('\n').filter(Boolean); while (pos < L.length) { const m = JSON.parse(L[pos++]); const message = (m.mentions || m.quotedParticipant) ? { extendedTextMessage: { text: m.text, contextInfo: { mentionedJid: m.mentions || [], participant: m.quotedParticipant } } } : { conversation: m.text }; emit('messages.upsert', { type: 'notify', messages: [{ key: { remoteJid: m.jid, fromMe: !!m.fromMe, participant: m.participant }, message }] }); } }
  }, 40);
  return sock;
}
module.exports = { default: makeWASocket, makeWASocket, DisconnectReason: { loggedOut: 401 }, fetchLatestBaileysVersion: async () => ({ version: [2, 3000, 1] }),
  useMultiFileAuthState: async dir => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'creds.json'), '{}'); return { state: {}, saveCreds: async () => {} }; } };
