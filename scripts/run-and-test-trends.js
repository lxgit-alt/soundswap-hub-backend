import { spawn } from 'child_process';
import fetch from 'node-fetch';

const SERVER_CMD = 'node';
const SERVER_ARGS = ['server.js'];
const BASE = 'http://localhost:3000';
const HEALTH_URL = `${BASE}/health`;
const ENDPOINTS = [
  { name: 'Music Trends', url: `${BASE}/api/trends/music` },
  { name: 'Content Ideas', url: `${BASE}/api/trends/content-ideas` },
  { name: 'Trends Health', url: `${BASE}/api/trends/health` }
];

const WAIT_TIMEOUT_MS = 20000; // wait up to 20s for server health
const POLL_INTERVAL_MS = 500;

function sleep(ms) { return new Promise(res => setTimeout(res, ms)); }

async function waitForHealth(url, timeout = WAIT_TIMEOUT_MS) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const res = await fetch(url, { method: 'GET' });
      if (res.ok) {
        return true;
      }
    } catch (err) {
      // ignore
    }
    await sleep(POLL_INTERVAL_MS);
  }
  return false;
}

async function fetchJson(url) {
  try {
    const res = await fetch(url, { method: 'GET', timeout: 10000 });
    const body = await res.text();
    let parsed;
    try { parsed = JSON.parse(body); } catch { parsed = body; }
    return { ok: res.ok, status: res.status, body: parsed };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

async function run() {
  console.log('🧪 Starting server and testing Trends endpoints...\n');

  // Spawn server.js
  const server = spawn(SERVER_CMD, SERVER_ARGS, {
    cwd: process.cwd(), // expected to be backend folder
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  server.stdout.on('data', (d) => {
    process.stdout.write(`[server] ${d}`);
  });
  server.stderr.on('data', (d) => {
    process.stderr.write(`[server][err] ${d}`);
  });

  server.on('exit', (code, signal) => {
    console.log(`\n[server] exited with code=${code} signal=${signal}`);
  });

  // Wait for /health
  process.stdout.write('Waiting for server health endpoint...');
  const healthy = await waitForHealth(HEALTH_URL, WAIT_TIMEOUT_MS);
  if (!healthy) {
    console.error('\n❌ Server did not become healthy within timeout.');
    console.error('Check server logs above for errors. If using ES modules, ensure "type":"module" is set in package.json and Node version supports ESM.');
    // Kill server
    try { server.kill(); } catch {}
    process.exit(1);
  }
  console.log(' OK\n');

  // Run tests
  let allOk = true;
  for (const ep of ENDPOINTS) {
    process.stdout.write(`Testing ${ep.name} -> ${ep.url} ... `);
    const r = await fetchJson(ep.url);
    if (r.ok) {
      console.log(`OK (${r.status})`);
      // Print a small summary for content-ideas/trends
      if (ep.name === 'Content Ideas' && r.body && typeof r.body === 'object') {
        if (r.body.count !== undefined) {
          console.log(`  count: ${r.body.count}`);
        }
      }
    } else {
      allOk = false;
      if (r.status) {
        console.log(`FAILED (${r.status})`);
        console.log(r.body);
      } else {
        console.log('ERROR');
        console.error(r.error);
      }
    }
    await sleep(200);
  }

  // Clean up server
  try { server.kill(); } catch (err) { /* ignore */ }
  console.log('\n🛑 Server stopped.');

  if (!allOk) {
    console.error('❌ One or more tests failed.');
    process.exit(2);
  }

  console.log('🎉 All trends tests passed.');
  process.exit(0);
}

run().catch(err => {
  console.error('Unexpected error running tests:', err);
  process.exit(99);
});
