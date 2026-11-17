'use strict';
// Penghubung WhatsApp Web memakai Baileys (OPSIONAL). Tidak ada dependensi saat dimuat:
// paket baru dibaca saat dihidupkan, jadi server tetap jalan tanpa `npm install` bila Baileys tidak dipakai.
const fs = require('fs'), path = require('path');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const quiet = { level: 'silent', child() { return quiet; }, trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {} };

function create({ dir, log, onMessage, env }) {
  const SESS = path.join(dir, 'wa-session'), S = { state: 'mati', qr: '', err: '', me: '', since: 0, groups: [], groupsAt: 0 };
  let sock = null, mod = null, qrlib = null, stopping = false, timer = null, retry = 0, chain = Promise.resolve(), gen = 0;
  const GAP = env.WA_SEND_GAP_MS !== undefined ? +env.WA_SEND_GAP_MS : 1500;   // jeda antarpesan agar tidak terlihat seperti spam

  async function load() {
    if (mod) return mod;
    let m; try { const spec = env.BAILEYS_MODULE || '@whiskeysockets/baileys'; m = await import(path.isAbsolute(spec) ? require('url').pathToFileURL(spec).href : spec); }   // jalur absolut (uji, Windows C:\...) harus berupa URL file:// untuk import()
    catch (e) { throw new Error('Paket Baileys belum terpasang. Jalankan "npm install" di folder siaga-banjir lalu mulai ulang server.'); }
    const d = m.default, pick = k => m[k] || (d && d[k]);
    mod = { make: typeof d === 'function' ? d : (d && d.default) || m.makeWASocket, auth: pick('useMultiFileAuthState'), DR: pick('DisconnectReason') || { loggedOut: 401 }, ver: pick('fetchLatestBaileysVersion') };
    if (!mod.make || !mod.auth) throw new Error('Bentuk paket Baileys tidak dikenali (versi baru?). Lihat README bagian Baileys.');
    return mod;
  }
  async function qrImage(text) {
    if (!qrlib) { try { qrlib = require(env.QRCODE_MODULE || 'qrcode'); } catch (e) { throw new Error('Paket "qrcode" belum terpasang (npm install).'); } }
    return qrlib.toDataURL(text, { margin: 1, width: 280 });
  }
  const wipe = () => { try { fs.rmSync(SESS, { recursive: true, force: true }); } catch (e) {} };

  async function start() {
    if (sock || S.state === 'memulai') return;
    stopping = false; clearTimeout(timer); S.err = ''; S.state = 'memulai'; const my = ++gen;
    try {
      const b = await load(); fs.mkdirSync(SESS, { recursive: true, mode: 0o700 }); try { fs.chmodSync(SESS, 0o700); } catch (e) {}   // berisi kunci sesi WhatsApp: hanya pemilik
      const { state, saveCreds } = await b.auth(SESS); let version;
      if (b.ver) { try { version = (await b.ver()).version; } catch (e) {} }   // versi WhatsApp Web terbaru; versi usang membuat koneksi ditolak
      if (my !== gen) return;
      const s = sock = b.make({ auth: state, version, logger: quiet, browser: ['Siaga Banjir', 'Chrome', '1.0'], markOnlineOnConnect: false, syncFullHistory: false });
      s.ev.on('creds.update', saveCreds);
      s.ev.on('connection.update', async u => {
        if (s !== sock) return;
        if (u.qr) { try { S.qr = await qrImage(u.qr); S.state = 'menunggu-scan'; } catch (e) { S.err = e.message; S.state = 'galat'; } }
        if (u.connection === 'open') { S.state = 'terhubung'; S.qr = ''; S.err = ''; S.since = Date.now(); retry = 0; S.me = String((s.user && s.user.id) || '').split(':')[0].split('@')[0]; log('wa', 'Baileys terhubung' + (S.me ? ' sebagai ' + S.me : '')); groups(true).catch(() => {}); }
        if (u.connection === 'close') {
          const code = u.lastDisconnect && u.lastDisconnect.error && u.lastDisconnect.error.output && u.lastDisconnect.error.output.statusCode; sock = null; S.qr = '';
          if (stopping) { S.state = 'mati'; return; }
          if (code === b.DR.loggedOut) { wipe(); S.state = 'keluar'; S.err = 'Sesi dikeluarkan dari ponsel (Perangkat tertaut). Hubungkan ulang dengan scan QR.'; log('wa', 'Baileys: sesi dikeluarkan'); return; }
          S.state = 'terputus'; S.err = 'Terputus (kode ' + (code || '?') + '), mencoba lagi otomatis'; const wait = Math.min(60000, 2000 * 2 ** retry++); log('wa', `Baileys terputus (kode ${code || '?'}), ulang ${Math.round(wait / 1000)} dtk`);
          timer = setTimeout(() => { S.state = 'mati'; start().catch(e => { S.state = 'galat'; S.err = e.message; }); }, wait);
        }
      });
      s.ev.on('messages.upsert', ({ messages, type }) => {
        if (type !== 'notify') return;
        const num = j => String(j || '').split('@')[0].split(':')[0], me = new Set([num(s.user && s.user.id), num(s.user && s.user.lid)].filter(Boolean));   // nomor dan LID bot (Baileys 7 memakai LID)
        for (const m of messages || []) { if (!m.message || (m.key && m.key.fromMe)) continue;
          const em = m.message.extendedTextMessage, ctx = (em && em.contextInfo) || {}, text = m.message.conversation || (em && em.text) || '';
          if (text && m.key && m.key.remoteJid) { const g = S.groups.find(x => x.id === m.key.remoteJid);
            try { onMessage({ sender: m.key.remoteJid, message: text, groupname: g ? g.name : '', participant: m.key.participant || m.participant || '', mentionsBot: (ctx.mentionedJid || []).some(j => me.has(num(j))), repliesToBot: !!ctx.participant && me.has(num(ctx.participant)), _raw: m }); } catch (e) {} } }
      });
    } catch (e) { sock = null; S.state = 'galat'; S.err = e.message; log('wa', 'Baileys gagal mulai: ' + e.message.slice(0, 120)); }
  }
  async function stop(hapus) {
    stopping = true; gen++; clearTimeout(timer); const s = sock; sock = null;
    if (s) { try { hapus ? await s.logout() : s.end(undefined); } catch (e) {} }
    if (hapus) wipe(); S.state = 'mati'; S.qr = ''; S.me = ''; S.err = ''; S.groups = [];
  }
  async function groups(refresh) {
    if (!sock || S.state !== 'terhubung') throw new Error('WhatsApp belum terhubung');
    if (refresh || !S.groups.length) { if (Date.now() - S.groupsAt > 20000 || !S.groups.length) { const g = await sock.groupFetchAllParticipating(); S.groups = Object.values(g || {}).map(x => ({ id: String(x.id), name: String(x.subject || '') })); S.groupsAt = Date.now(); } }
    return S.groups;
  }
  const jid = t => (/@/.test(t) ? t : String(t).replace(/\D/g, '') + '@s.whatsapp.net');
  async function typing(to) { try { if (sock && S.state === 'terhubung') await sock.sendPresenceUpdate('composing', jid(to)); } catch (e) {} }   // indikator "sedang mengetik" (opsional)
  function send(targets, text, opts) {   // antre satu per satu dengan jeda; hasil 'ok' bila semua tujuan terkirim; opts.quoted = balas sebagai kutipan
    const run = async () => { if (!sock || S.state !== 'terhubung') return 'belum terhubung'; let bad = 0;
      for (const t of String(targets).split(',').map(x => x.trim()).filter(Boolean)) { try { await sock.sendMessage(jid(t), { text }, opts && opts.quoted ? { quoted: opts.quoted } : undefined); } catch (e) { bad++; log('wa', 'Baileys gagal kirim: ' + String(e.message).slice(0, 100)); } if (GAP) await sleep(GAP); }
      return bad ? 'gagal' : 'ok'; };
    return (chain = chain.then(run, run));
  }
  return { start, stop, groups, send, typing, info: () => ({ ...S, groups: undefined, nGroups: S.groups.length }) };
}
module.exports = { create };
