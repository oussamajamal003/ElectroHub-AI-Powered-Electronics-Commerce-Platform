'use strict';
// Local capability channel. Never signal a PID read from disk: only its live,
// authenticated owner may stop its own ChildProcess handles.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { randomBytes, timingSafeEqual } = require('node:crypto');

async function openControl(file, identity, snapshot, stop) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const token = randomBytes(32).toString('hex');
  const fd = fs.openSync(file, 'wx', 0o600); // races and stale records fail closed
  let record;
  const server = http.createServer((req, res) => {
    const supplied = Buffer.from(req.headers.authorization ?? '');
    const expected = Buffer.from(`Bearer ${token}`);
    res.setHeader('Cache-Control', 'no-store');
    if (req.headers.origin || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      res.writeHead(404).end(); return;
    }
    if (req.method === 'GET' && req.url === '/status') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ identity, pid: process.pid, ...snapshot() }));
    } else if (req.method === 'POST' && req.url === '/stop') {
      res.writeHead(202).end(); setImmediate(() => { void stop(); });
    } else res.writeHead(404).end();
  });
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    record = { identity, pid: process.pid, port: server.address().port, token };
    fs.writeFileSync(fd, JSON.stringify(record));
  } catch (error) {
    server.close(); fs.unlinkSync(file); throw error;
  } finally { fs.closeSync(fd); }
  return { close: async () => {
    await new Promise(resolve => server.close(resolve));
    // Another owner must never lose its record during cleanup.
    try { if (JSON.parse(fs.readFileSync(file, 'utf8')).token === token) fs.unlinkSync(file); } catch { /* retained/unavailable */ }
  } };
}

async function controlRequest(file, identity, operation = 'status') {
  let record;
  try { record = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw new Error('Control record invalid; inspect it without killing recorded PIDs.'); }
  if (record.identity !== identity || !Number.isInteger(record.pid) || record.pid < 1 ||
      !Number.isInteger(record.port) || record.port < 1 || record.port > 65535 || !/^[a-f0-9]{64}$/.test(record.token)) {
    throw new Error('Control identity invalid; no process was stopped.');
  }
  const call = async method => {
    const response = await fetch(`http://127.0.0.1:${record.port}/${method}`, { method: method === 'stop' ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${record.token}` }, signal: AbortSignal.timeout(3000), redirect: 'error' });
    if (!response.ok) throw new Error('Control authentication refused.');
    return method === 'stop' ? true : response.json();
  };
  try {
    const value = await call('status');
    if (value.identity !== identity || value.pid !== record.pid) throw new Error('Owner mismatch.');
    return operation === 'stop' ? await call('stop') : value;
  } catch { throw new Error('Recorded owner is unavailable or mismatched; inspect stale control/lock files manually. No PID was signalled.'); }
}
module.exports = { openControl, controlRequest };
