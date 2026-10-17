// Deploys Totem to a Render free web service (Docker) from a GitHub repo, with
// Upstash Redis as the durable token store. Secrets go file -> API only.
//
//   node scripts/deploy-render.mjs <github-repo-url>   # create/update service
//   node scripts/deploy-render.mjs --verify            # remote checks only
//
// Needs .env (from `totem auth`) and .env.deploy-hf with RENDER_API_KEY,
// UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN, MCP_AUTH_TOKEN, AUTH_PASSWORD.
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';
import { upsertEnvFile } from '../dist/lib/env_file.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const DEPLOY = join(root, '.env.deploy-hf');
const SERVICE_NAME = 'totem-whoop';
const env = parse(readFileSync(join(root, '.env'), 'utf8'));
const dep = parse(readFileSync(DEPLOY, 'utf8'));
for (const k of ['RENDER_API_KEY', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']) {
  if (!dep[k]) throw new Error(`Fill ${k} in .env.deploy-hf`);
}
if (!dep.MCP_AUTH_TOKEN || !dep.AUTH_PASSWORD) {
  dep.MCP_AUTH_TOKEN ||= randomBytes(32).toString('hex');
  dep.AUTH_PASSWORD ||= randomBytes(12).toString('base64url');
  upsertEnvFile(DEPLOY, { MCP_AUTH_TOKEN: dep.MCP_AUTH_TOKEN, AUTH_PASSWORD: dep.AUTH_PASSWORD });
}

const render = async (path, init = {}) => {
  const res = await fetch(`https://api.render.com/v1${path}`, {
    ...init,
    headers: { authorization: `Bearer ${dep.RENDER_API_KEY}`, accept: 'application/json', 'content-type': 'application/json' },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Render ${init.method ?? 'GET'} ${path} -> ${res.status}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : {};
};

async function findService() {
  const list = await render(`/services?name=${SERVICE_NAME}&limit=20`);
  return list.map(x => x.service).find(s => s.name === SERVICE_NAME);
}

async function deploy(repo) {
  if (!repo) throw new Error('Pass the GitHub repo URL');
  const envVars = {
    MCP_TRANSPORT: 'http',
    WHOOP_TOKEN_STORE: 'upstash',
    WHOOP_TIMEZONE: 'Europe/Madrid',
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
  let svc = await findService();
  if (!svc) {
    const [{ owner }] = await render('/owners?limit=1');
    const created = await render('/services', {
      method: 'POST',
      body: JSON.stringify({
        type: 'web_service',
        name: SERVICE_NAME,
        ownerId: owner.id,
        repo,
        branch: 'main',
        autoDeploy: 'yes',
        envVars: Object.entries(envVars).filter(([, v]) => v).map(([key, value]) => ({ key, value })),
        serviceDetails: {
          runtime: 'docker',
          plan: 'free',
          region: 'frankfurt',
          healthCheckPath: '/health',
          envSpecificDetails: { dockerfilePath: './Dockerfile', dockerContext: '.' },
        },
      }),
    });
    svc = created.service ?? created;
    console.log('Render: service created');
  } else console.log('Render: service exists');
  const url = svc.serviceDetails?.url;
  // PUBLIC_URL is only known after creation; setting it triggers a redeploy.
  await render(`/services/${svc.id}/env-vars/PUBLIC_URL`, { method: 'PUT', body: JSON.stringify({ value: url }) });
  await render(`/services/${svc.id}/deploys`, { method: 'POST', body: JSON.stringify({ clearCache: 'do_not_clear' }) });
  upsertEnvFile(DEPLOY, { RENDER_SERVICE_URL: url });
  console.log(`URL: ${url}\nDashboard: https://dashboard.render.com/web/${svc.id}\nDeploy started (build takes ~3-5 min).`);
}

async function verify() {
  const svc = await findService();
  const url = svc.serviceDetails.url;
  const [d] = await render(`/services/${svc.id}/deploys?limit=1`);
  console.log(`Latest deploy: ${d?.deploy?.status}`);
  const t0 = Date.now();
  const health = await fetch(`${url}/health`, { signal: AbortSignal.timeout(120000) }).then(r => r.status).catch(e => e.message);
  console.log(`/health: ${health} (${Math.round((Date.now() - t0) / 1000)}s, includes cold start)`);
  const http = await fetch(url.replace('https://', 'http://') + '/health', { redirect: 'manual' }).then(r => `${r.status} -> ${r.headers.get('location') ?? ''}`).catch(e => e.message);
  console.log(`plain http: ${http}`);
  const anon = await fetch(`${url}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).then(r => r.status);
  console.log(`/mcp without auth: ${anon} (expected 401)`);
  const wrong = await fetch(`${url}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer wrong' }, body: '{}' }).then(r => r.status);
  console.log(`/mcp wrong token: ${wrong} (expected 401)`);
  const meta = await fetch(`${url}/.well-known/oauth-authorization-server`).then(r => r.status);
  console.log(`OAuth metadata: ${meta} (expected 200)`);
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
  const client = new Client({ name: 'totem-verify', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${url}/mcp`), { requestInit: { headers: { authorization: `Bearer ${dep.MCP_AUTH_TOKEN}` } } }));
  const { tools } = await client.listTools();
  const r = await client.callTool({ name: 'whoop_recovery', arguments: {} }, undefined, { timeout: 90000 });
  console.log(`Remote tools: ${tools.length}\nwhoop_recovery: ${r.isError ? 'ERROR ' : ''}${r.content?.[0]?.text?.slice(0, 200)}`);
  await client.close();
}

if (process.argv.includes('--verify')) await verify();
else await deploy(process.argv[2]);
