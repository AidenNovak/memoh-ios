import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import WebSocket from 'ws';
import { MemohClient } from '../apps/mobile/src/api/client.ts';
import { MemohRealtime } from '../apps/mobile/src/api/realtime.ts';

const env = Object.fromEntries(
  readFileSync(`${homedir()}/.config/memoh-ios/dev.env`, 'utf8')
    .split('\n')
    .map((l) => l.trim().split('='))
    .filter((p) => p.length === 2 && p[0]),
);
const baseUrl = 'http://127.0.0.1:18080';
let token = null;
const client = new MemohClient({ baseUrl, getToken: () => token });
const login = await client.login('admin', env.MEMOH_ADMIN_PASSWORD);
token = login.access_token;
const bots = await client.listBots();
const bot = bots.items[0];
console.log('bot', bot.id);

const rt = new MemohRealtime({
  wsUrl: baseUrl,
  getToken: () => token,
  createSocket: (url, t) => {
    console.log('createSocket called with', url);
    const s = new WebSocket(url, { headers: { Authorization: `Bearer ${t}` } });
    s.on('unexpected-response', (_req, res) =>
      console.log('  unexpected-response status', res.statusCode),
    );
    s.on('error', (e) => console.log('  ws raw error:', e.message));
    return s;
  },
  listener: {
    onStateChange: (s) => console.log('  state ->', s),
    onSnapshot: () => console.log('  got snapshot'),
    onError: (e) => console.log('  listener onError:', e.message),
    onDelta: () => {},
  },
});
rt.connect();
setTimeout(() => {
  console.log('final state:', rt.connectionState);
  rt.dispose();
  process.exit(0);
}, 8000);
