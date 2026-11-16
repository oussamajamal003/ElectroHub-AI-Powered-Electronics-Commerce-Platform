#!/usr/bin/env node
/**
 * Safe replacement for `cat .env`. Prints every variable NAME with its status and length, never its value,
 * so the output can be pasted into chats, tickets, CI logs or shared terminal transcripts.
 *
 *   npm run env:show            # apps/backend/.env
 *   npm run env:show -- path    # another env file
 */
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const file = resolve(process.argv[2] ?? '.env');
let text;
try { text = readFileSync(file, 'utf8'); } catch { console.error(`Cannot read ${file}`); process.exit(1); }
console.log(`# ${file} (values hidden)`);
text.split(/\r?\n/).forEach((line, index) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  if (trimmed.startsWith('#')) { console.log(`${String(index + 1).padStart(3)}: ${trimmed.slice(0, 80)}`); return; }
  const at = trimmed.indexOf('=');
  if (at < 1) { console.log(`${String(index + 1).padStart(3)}: <unparseable line, ${trimmed.length} chars>`); return; }
  const key = trimmed.slice(0, at).trim(); const value = trimmed.slice(at + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
  console.log(`${String(index + 1).padStart(3)}: ${key}=${value ? `<set, ${value.length} chars>` : '<empty>'}`);
});
