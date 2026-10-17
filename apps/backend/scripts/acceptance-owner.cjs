const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { finishLifecycle } = require('./acceptance-lifecycle.cjs');
function claimOwner(directory, role, identity, restartOfProcessId) {
  assert.equal(process.env.NODE_ENV, 'test'); assert.ok(['api', 'runner'].includes(role));
  assert.equal(identity.pid, process.pid);
  const ownerFile = path.join(directory, `${role}.owner.json`), lock = `${ownerFile}.startup-lock`;
  const token = randomUUID(), fd = fs.openSync(lock, 'wx', 0o600);
  let primary;
  try {
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, token })); fs.fsyncSync(fd);
    if (fs.existsSync(ownerFile)) {
      assert.equal(fs.lstatSync(ownerFile).isSymbolicLink(), false);
      const previous = JSON.parse(fs.readFileSync(ownerFile, 'utf8'));
      for (const key of ['runId', 'attemptId', 'workId', 'sourceFingerprint']) assert.equal(previous[key], identity[key]);
      assert.equal(restartOfProcessId, previous.pid);
      let exited = false;
      try { process.kill(previous.pid, 0); } catch (error) { exited = error.code === 'ESRCH'; }
      assert.equal(exited, true, 'Previous owner still active or unverifiable');
      fs.renameSync(ownerFile, `${ownerFile}.${randomUUID()}.preserved`);
    }
    const ownerFd = fs.openSync(ownerFile, 'wx', 0o600);
    try { fs.writeFileSync(ownerFd, JSON.stringify(identity)); fs.fsyncSync(ownerFd); } finally { fs.closeSync(ownerFd); }
  } catch (error) { primary = error; }
  const failures = [];
  try { fs.closeSync(fd); } catch (error) { failures.push(error); }
  try {
    const held = JSON.parse(fs.readFileSync(lock, 'utf8')); assert.equal(held.pid, process.pid); assert.equal(held.token, token);
    fs.unlinkSync(lock); // Only this call's transient lock, never accounting/financial evidence.
  } catch (error) { failures.push(error); }
  finishLifecycle(primary, failures);
  return ownerFile;
}
module.exports = { claimOwner };
