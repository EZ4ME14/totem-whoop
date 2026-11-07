// After `totem auth`: push the fresh tokens from .env into the shared Upstash
// store (read by the Render server and the local stdio server). Prints no secrets.
//   node scripts/sync-tokens.mjs
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';

const root = fileURLToPath(new URL('..', import.meta.url));
const env = parse(readFileSync(join(root, '.env'), 'utf8'));
const url = env.UPSTASH_REDIS_REST_URL, token = env.UPSTASH_REDIS_REST_TOKEN;
if (!url || !token) throw new Error('UPSTASH_REDIS_REST_URL/TOKEN missing in .env');
if (!env.WHOOP_IOS_BEARER_TOKEN || !env.WHOOP_COGNITO_REFRESH_TOKEN) throw new Error('Run `node dist/cli/index.js auth` first');
const value = JSON.stringify({ accessToken: env.WHOOP_IOS_BEARER_TOKEN, refreshToken: env.WHOOP_COGNITO_REFRESH_TOKEN, savedAt: new Date().toISOString() });
const res = await fetch(url.replace(/\/+$/, ''), {
  method: 'POST',
  headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  body: JSON.stringify(['SET', 'totem:whoop:tokens', value]),
});
const body = await res.json();
if (!res.ok || body.error) throw new Error(`Upstash SET failed (${res.status}): ${body.error}`);
console.log('Tokens synced to Upstash. Render and the local server will pick them up on their next refresh.');
