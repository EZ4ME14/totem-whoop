// Usage: node scripts/mcp-call.mjs <tool> '<json-args>'
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const [tool, rawArgs = '{}'] = process.argv.slice(2);
const client = new Client({ name: 'totem-check', version: '1.0.0' });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [root + 'dist/server.js'],
  cwd: root,
  env: { ...process.env, WHOOP_TIMEZONE: 'Europe/Madrid' },
  stderr: 'pipe',
});
let errText = '';
transport.stderr?.on('data', d => { errText += d; });
try {
  await client.connect(transport);
  const r = await client.callTool({ name: tool, arguments: JSON.parse(rawArgs) }, undefined, { timeout: 120000 });
  for (const c of r.content ?? []) if (c.type === 'text') console.log(c.text);
  if (r.isError) process.exitCode = 2;
} catch (e) {
  console.error('ERROR:', e.message);
  process.exitCode = 1;
} finally {
  await client.close();
  if (process.exitCode) console.error('stderr:', errText.replace(/(eyJ|ey)[A-Za-z0-9._-]{20,}/g, '[redacted]').slice(-1500));
}
