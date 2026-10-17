// Modmail listener: keeps a connection to Discord's gateway open, and forwards every direct message sent to the bot
// to the relay (POST /api/dm). Replies are sent from Discord with the Reply button on the forwarded message.
//
// Needs Node 18+ and `npm install` (one dependency: ws). Environment variables:
//   DISCORD_BOT_TOKEN   the bot's token
//   RELAY_SECRET        the same value as DM_RELAY_SECRET in Vercel
//   RELAY_URL           optional, defaults to https://kite-login-notify-sanfranrps.vercel.app/api/dm
// No privileged intent is needed: bots always receive the content of messages sent to them in DMs.

const WebSocket = require('ws');

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const SECRET = process.env.RELAY_SECRET;
const RELAY = process.env.RELAY_URL || 'https://kite-login-notify-sanfranrps.vercel.app/api/dm';
const GATEWAY = process.env.GATEWAY_URL || 'wss://gateway.discord.gg/?v=10&encoding=json';
const INTENTS = 1 << 12; // DIRECT_MESSAGES
if (!TOKEN || !SECRET) { console.error('Set DISCORD_BOT_TOKEN and RELAY_SECRET.'); process.exit(1); }

let ws = null, hb = null, seq = null, session = null, resumeUrl = null, acked = true, stopping = false, backoff = 1000;
const log = (...a) => console.log(new Date().toISOString(), ...a);
const send = (op, d) => { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ op, d })); };

async function forward(m) {
  if (m.guild_id || !m.author || m.author.bot) return; // only DMs from people
  const body = {
    userId: m.author.id, messageId: m.id, username: m.author.username, name: m.author.global_name || m.author.username,
    avatar: m.author.avatar || null, content: m.content || '', attachments: (m.attachments || []).map((a) => a.url),
  };
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(RELAY, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + SECRET }, body: JSON.stringify(body) });
      if (r.ok) { log('forwarded DM', m.id); return; }
      log('relay answered', r.status);
      if (r.status < 500) return;
    } catch (e) { log('relay unreachable', String(e.message || e)); }
    await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
  }
}

function connect() {
  ws = new WebSocket(resumeUrl && session ? resumeUrl + '/?v=10&encoding=json' : GATEWAY);
  ws.on('open', () => log('connected'));
  ws.on('message', (raw) => {
    let p; try { p = JSON.parse(raw); } catch (e) { return; }
    if (p.s != null) seq = p.s;
    switch (p.op) {
      case 10: { // Hello
        clearInterval(hb); acked = true;
        const every = p.d.heartbeat_interval;
        setTimeout(() => send(1, seq), Math.random() * every);
        hb = setInterval(() => { if (!acked) { log('no heartbeat ack, reconnecting'); ws.terminate(); return; } acked = false; send(1, seq); }, every);
        if (session) send(6, { token: TOKEN, session_id: session, seq });
        else send(2, { token: TOKEN, intents: INTENTS, properties: { os: process.platform, browser: 'kite-modmail', device: 'kite-modmail' } });
        break;
      }
      case 11: acked = true; break;
      case 1: send(1, seq); break;
      case 7: log('gateway asked to reconnect'); ws.close(4000); break;
      case 9: log('session invalid'); if (!p.d) { session = null; resumeUrl = null; seq = null; } setTimeout(() => ws.close(4000), 1500); break;
      case 0:
        if (p.t === 'READY') { session = p.d.session_id; resumeUrl = p.d.resume_gateway_url; backoff = 1000; log('ready as', p.d.user.username); }
        else if (p.t === 'MESSAGE_CREATE') forward(p.d);
        break;
    }
  });
  ws.on('close', (code) => {
    clearInterval(hb);
    if (stopping) return;
    if ([4004, 4010, 4011, 4012, 4013, 4014].includes(code)) { log('fatal gateway close', code, '- check the token / intents'); process.exit(1); }
    log('closed', code, 'reconnecting in', backoff, 'ms');
    setTimeout(connect, backoff); backoff = Math.min(backoff * 2, 30000);
  });
  ws.on('error', (e) => log('socket error', String(e.message || e)));
}

process.on('SIGTERM', () => { stopping = true; clearInterval(hb); if (ws) ws.close(1000); setTimeout(() => process.exit(0), 500); });
process.on('SIGINT', () => process.exit(0));
connect();
