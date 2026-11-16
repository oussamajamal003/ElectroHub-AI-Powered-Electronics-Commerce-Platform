const fs = require('node:fs');
const allowed = new Set(['timestampUtc', 'listenerPid', 'sequence', 'eventId', 'eventType', 'status', 'phase',
  'correlationId', 'signature', 'database', 'outcome', 'inserted', 'scheduled', 'durationMs', 'failure', 'forwardingDestination', 'apiPid']);
const secret = /(?:sk|rk|pk)_(?:test|live)_|whsec_|_secret_|eyJ[A-Za-z0-9_-]+\./;
function createReceiptSink(file, { maxBytes = 1024 * 1024, io = fs, onFailure = () => {} } = {}) {
  let failed = false;
  return {
    get failed() { return failed; },
    write(input) {
      const row = {};
      for (const [key, value] of Object.entries(input)) {
        if (!allowed.has(key) || !['string', 'number', 'boolean'].includes(typeof value)) continue;
        if (typeof value === 'string' && (value.length > 160 || secret.test(value))) continue;
        if (key === 'forwardingDestination' && !/^https?:\/\/(localhost|127\.0\.0\.1):\d+\/api\/webhooks\/stripe$/.test(value)) continue;
        row[key] = value;
      }
      const line = JSON.stringify(row) + '\n';
      try {
        // Stop rather than truncate old receipts: missing evidence is explicit.
        const size = io.existsSync(file) ? io.statSync(file).size : 0;
        if (size + Buffer.byteLength(line) > maxBytes) throw new Error('Receipt size limit');
        io.appendFileSync(file, line, { mode: 0o600 });
        return true;
      } catch {
        failed = true; try { onFailure(); } catch { /* Never disturb financial processing. */ }
        return false;
      }
    },
  };
}
module.exports = { createReceiptSink };
