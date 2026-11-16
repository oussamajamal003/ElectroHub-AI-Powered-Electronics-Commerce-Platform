function finishLifecycle(primary, failures) {
  if (primary) {
    primary.cleanupFailureCount = failures.length;
    throw primary;
  }
  if (failures.length) throw Object.assign(new Error('Owned cleanup failed; preserve financial evidence.'), { gateStatus: 'FAILED_ACCEPTANCE', cleanupFailureCount: failures.length });
}
async function withOwnedCleanup(operation, cleanup) {
  let primary, result;
  try { result = await operation(); } catch (error) { primary = error; }
  const failures = [];
  try { await cleanup(); } catch (error) { failures.push(error); }
  finishLifecycle(primary, failures);
  return result;
}
module.exports = { finishLifecycle, withOwnedCleanup };
