// Forces one Cognito refresh through Totem's own TokenManager and reports
// (without printing secrets) whether the new token was persisted to .env.
import 'dotenv/config';
import { readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { TokenManager } from '../dist/whoop/token_manager.js';
import { decodeJwtExp } from '../dist/whoop/cognito.js';
const envPath = new URL('../.env', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const h = s => createHash('sha256').update(s).digest('hex').slice(0, 8);
const before = { exp: new Date(decodeJwtExp(process.env.WHOOP_IOS_BEARER_TOKEN) * 1000).toISOString(), at: h(process.env.WHOOP_IOS_BEARER_TOKEN), rt: h(process.env.WHOOP_COGNITO_REFRESH_TOKEN), mtime: statSync(envPath).mtime.toISOString() };
const tm = new TokenManager({ email: process.env.WHOOP_EMAIL, accessToken: process.env.WHOOP_IOS_BEARER_TOKEN, refreshToken: process.env.WHOOP_COGNITO_REFRESH_TOKEN, envPath });
await tm['doRefresh']();
const env = Object.fromEntries(readFileSync(envPath, 'utf8').split(/\r?\n/).filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, '')]; }));
const after = { exp: new Date(decodeJwtExp(env.WHOOP_IOS_BEARER_TOKEN) * 1000).toISOString(), at: h(env.WHOOP_IOS_BEARER_TOKEN), rt: h(env.WHOOP_COGNITO_REFRESH_TOKEN), mtime: statSync(envPath).mtime.toISOString() };
console.log(JSON.stringify({ before, after, access_token_changed: before.at !== after.at, refresh_token_rotated: before.rt !== after.rt }, null, 1));
