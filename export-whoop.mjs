import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const client = new Client({ name: 'whoop-personal-report', version: '1.0.0' });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [fileURLToPath(new URL('dist/server.js', import.meta.url))],
  cwd: root,
  env: { ...process.env, WHOOP_TIMEZONE: 'Europe/Madrid' },
  stderr: 'ignore',
});
const requests = [
  ['whoop_today', {}],
  ['whoop_daily_brief', { detail: 'standard', sections: ['recovery', 'sleep', 'strain', 'sleep_plan', 'activity'] }],
  ['whoop_trend_pack', { metrics: ['HRV', 'RHR', 'RECOVERY', 'SLEEP_PERFORMANCE', 'DAY_STRAIN'], window: 'month', include_points: true }],
];
const report = { generated_at: new Date().toISOString(), timezone: 'Europe/Madrid', results: {} };
let successes = 0;
try {
  await client.connect(transport);
  for (const [name, args] of requests) {
    console.log('Reading ' + name + '...');
    try {
      const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 90000 });
      report.results[name] = result;
      if (!result.isError) successes++;
      else console.log('Request returned an error: ' + name);
    } catch (error) {
      report.results[name] = { isError: true, error: error.message };
    }
  }
  if (!successes) throw new Error('No WHOOP data received. Check internet access and authentication.');
  const output = fileURLToPath(new URL('whoop-report.json', import.meta.url));
  await writeFile(output, JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log('Saved ' + output + ' (' + successes + '/3 requests successful).');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await client.close();
}
