// Waits for the Render deploy that adds report_claim, then checks it (mode=check only).
import { readFileSync } from 'node:fs';
import { parse } from 'dotenv';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const dep = parse(readFileSync(new URL('../.env.deploy-hf', import.meta.url), 'utf8'));
const url = new URL(`${dep.RENDER_SERVICE_URL}/mcp`);
for (let i = 0; i < 40; i++) {
  const client = new Client({ name: 'claim-check', version: '1.0.0' });
  try {
    await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { authorization: `Bearer ${dep.MCP_AUTH_TOKEN}` } } }));
    const { tools } = await client.listTools();
    if (tools.some(t => t.name === 'report_claim')) {
      const r = await client.callTool({ name: 'report_claim', arguments: { kind: 'evening', date: '2000-01-01', mode: 'check' } });
      console.log(`tools: ${tools.length}; report_claim check: ${r.content?.[0]?.text}`);
      await client.close();
      process.exit(0);
    }
    console.log(`attempt ${i + 1}: ${tools.length} tools, new version not live yet`);
  } catch (e) {
    console.log(`attempt ${i + 1}: ${e.message}`);
  }
  await client.close().catch(() => {});
  await new Promise(r => setTimeout(r, 20000));
}
console.log('TIMEOUT');
process.exit(1);
