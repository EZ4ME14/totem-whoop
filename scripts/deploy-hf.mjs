// Deploys Totem to a free Hugging Face Docker Space with Upstash Redis as the
// durable token store. Secrets travel file -> API only; nothing is printed.
//
//   node scripts/deploy-hf.mjs            # create/update Space, push code + secrets
//   node scripts/deploy-hf.mjs --verify   # only run the remote checks
//
// Needs .env (from `totem auth`) and .env.deploy-hf with HF_TOKEN,
// UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN (filled in by hand).
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';
import { upsertEnvFile } from '../dist/lib/env_file.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const ENV = join(root, '.env');
const DEPLOY = join(root, '.env.deploy-hf');
const SPACE_NAME = 'totem-whoop';
const TOKEN_KEY = 'totem:whoop:tokens';

const env = parse(readFileSync(ENV, 'utf8'));
if (!existsSync(DEPLOY)) throw new Error('Missing .env.deploy-hf');
const dep = parse(readFileSync(DEPLOY, 'utf8'));
for (const k of ['HF_TOKEN', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']) {
  if (!dep[k]) throw new Error(`Fill ${k} in .env.deploy-hf`);
}
// Generated once, kept in the deploy file (the user reads AUTH_PASSWORD from there).
if (!dep.MCP_AUTH_TOKEN || !dep.AUTH_PASSWORD) {
  dep.MCP_AUTH_TOKEN ||= randomBytes(32).toString('hex');
  dep.AUTH_PASSWORD ||= randomBytes(12).toString('base64url');
  upsertEnvFile(DEPLOY, { MCP_AUTH_TOKEN: dep.MCP_AUTH_TOKEN, AUTH_PASSWORD: dep.AUTH_PASSWORD });
}

const hf = async (path, init = {}) => {
  const res = await fetch(`https://huggingface.co${path}`, {
    ...init,
    headers: { authorization: `Bearer ${dep.HF_TOKEN}`, 'content-type': 'application/json', ...init.headers },
  });
  const text = await res.text();
  if (!res.ok && !(init.allow ?? []).includes(res.status)) throw new Error(`HF ${init.method ?? 'GET'} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
};

const upstash = async (args) => {
  const res = await fetch(dep.UPSTASH_REDIS_REST_URL.replace(/\/+$/, ''), {
    method: 'POST',
    headers: { authorization: `Bearer ${dep.UPSTASH_REDIS_REST_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify(args),
  });
  const body = await res.json();
  if (!res.ok || body.error) throw new Error(`Upstash ${args[0]} -> ${res.status}: ${body.error}`);
  return body.result;
};

const { name: user } = await hf('/api/whoami-v2');
const repo = `${user}/${SPACE_NAME}`;
const publicUrl = `https://${user.toLowerCase()}-${SPACE_NAME}.hf.space`;
console.log(`HF user: ${user}\nSpace:   https://huggingface.co/spaces/${repo}\nURL:     ${publicUrl}`);

async function deploy() {
  // 1. Seed Upstash with the current tokens, unless a newer pair is already there.
  const existing = await upstash(['GET', TOKEN_KEY]);
  if (!existing) {
    await upstash(['SET', TOKEN_KEY, JSON.stringify({ accessToken: env.WHOOP_IOS_BEARER_TOKEN, refreshToken: env.WHOOP_COGNITO_REFRESH_TOKEN, savedAt: new Date().toISOString() })]);
    console.log('Upstash: seeded tokens');
  } else console.log('Upstash: tokens already present (kept)');

  // 2. Local stdio server shares the same store from now on.
  upsertEnvFile(ENV, {
    WHOOP_TOKEN_STORE: 'upstash',
    UPSTASH_REDIS_REST_URL: dep.UPSTASH_REDIS_REST_URL,
    UPSTASH_REDIS_REST_TOKEN: dep.UPSTASH_REDIS_REST_TOKEN,
  });
  console.log('Local .env: switched to the shared Upstash store');

  // 3. Space (public so claude.ai can reach /mcp; every route but /health is auth-gated).
  await hf('/api/repos/create', { method: 'POST', body: JSON.stringify({ type: 'space', name: SPACE_NAME, private: false, sdk: 'docker' }), allow: [409] });

  // 4. Secrets + variables (runtime env; overrides Dockerfile ENV defaults).
  const secrets = {
    WHOOP_EMAIL: env.WHOOP_EMAIL,
    WHOOP_IOS_BEARER_TOKEN: env.WHOOP_IOS_BEARER_TOKEN,
    WHOOP_COGNITO_REFRESH_TOKEN: env.WHOOP_COGNITO_REFRESH_TOKEN,
    WHOOP_USER_ID: env.WHOOP_USER_ID,
    WHOOP_INSTALLATION_ID: env.WHOOP_INSTALLATION_ID,
    MCP_AUTH_TOKEN: dep.MCP_AUTH_TOKEN,
    AUTH_PASSWORD: dep.AUTH_PASSWORD,
    UPSTASH_REDIS_REST_URL: dep.UPSTASH_REDIS_REST_URL,
    UPSTASH_REDIS_REST_TOKEN: dep.UPSTASH_REDIS_REST_TOKEN,
  };
  for (const [key, value] of Object.entries(secrets)) {
    if (value) await hf(`/api/spaces/${repo}/secrets`, { method: 'POST', body: JSON.stringify({ key, value }) });
  }
  const vars = { PORT: '7860', PUBLIC_URL: publicUrl, WHOOP_TOKEN_STORE: 'upstash', WHOOP_TIMEZONE: 'Europe/Madrid', MCP_TRANSPORT: 'http' };
  for (const [key, value] of Object.entries(vars)) {
    await hf(`/api/spaces/${repo}/variables`, { method: 'POST', body: JSON.stringify({ key, value }) });
  }
  console.log(`Secrets: ${Object.keys(secrets).filter(k => secrets[k]).length} set · variables: ${Object.keys(vars).length} set`);

  // 5. Code: package files + src + an HF-specific Dockerfile and README.
  const files = new Map();
  for (const f of ['package.json', 'package-lock.json', 'tsconfig.json', 'LICENSE']) files.set(f, readFileSync(join(root, f)));
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else files.set(relative(root, p).replaceAll('\\', '/'), readFileSync(p));
    }
  };
  walk(join(root, 'src'));
  const dockerfile = readFileSync(join(root, 'Dockerfile'), 'utf8')
    .replace(/HEALTHCHECK[\s\S]*?\|\| exit 1\n/, '')
    .replace('ENV PORT=3000', 'ENV PORT=7860')
    .replace('EXPOSE 3000', 'EXPOSE 7860');
  files.set('Dockerfile', Buffer.from(dockerfile));
  files.set('README.md', Buffer.from(`---\ntitle: Totem WHOOP\nemoji: ⌚\ncolorFrom: gray\ncolorTo: red\nsdk: docker\napp_port: 7860\npinned: false\nlicense: mit\n---\n\nPrivate Totem MCP server (WHOOP). Every route except /health requires auth.\nSource: https://github.com/thebriangao/totem (MIT) + an Upstash token store.\n`));

  const lines = [JSON.stringify({ key: 'header', value: { summary: 'Deploy Totem with Upstash token store', description: '' } })];
  for (const [path, buf] of files) lines.push(JSON.stringify({ key: 'file', value: { path, content: buf.toString('base64'), encoding: 'base64' } }));
  await hf(`/api/spaces/${repo}/commit/main`, { method: 'POST', headers: { 'content-type': 'application/x-ndjson' }, body: lines.join('\n') });
  console.log(`Code: ${files.size} files committed — Space is building`);
}

async function verify() {
  const runtime = await hf(`/api/spaces/${repo}/runtime`);
  console.log(`Runtime stage: ${runtime.stage}`);
  const health = await fetch(`${publicUrl}/health`).then(r => `${r.status}`).catch(e => e.message);
  console.log(`/health: ${health}`);
  const anon = await fetch(`${publicUrl}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).then(r => r.status).catch(e => e.message);
  console.log(`/mcp without auth: ${anon} (expected 401)`);
  const meta = await fetch(`${publicUrl}/.well-known/oauth-authorization-server`).then(r => r.status).catch(e => e.message);
  console.log(`OAuth metadata: ${meta}`);
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
  const client = new Client({ name: 'totem-verify', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${publicUrl}/mcp`), { requestInit: { headers: { authorization: `Bearer ${dep.MCP_AUTH_TOKEN}` } } }));
  const { tools } = await client.listTools();
  const r = await client.callTool({ name: 'whoop_recovery', arguments: {} }, undefined, { timeout: 90000 });
  console.log(`Remote tools: ${tools.length}; whoop_recovery: ${r.isError ? 'ERROR ' : ''}${r.content?.[0]?.text?.slice(0, 160)}`);
  await client.close();
}

if (!process.argv.includes('--verify')) await deploy();
else await verify();
