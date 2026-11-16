const { main: stripeGate } = require('./stripe-browser-gate.cjs');

function main(argv = process.argv.slice(2), dependencies) {
  const scenarios = ['--success', '--capture-recovery', '--decline', '--sca', '--sca-cancel'];
  return stripeGate(argv.some(argument => scenarios.includes(argument)) ? argv : [...argv, '--success'], dependencies);
}

if (require.main === module) main().then(code => { process.exitCode = code; });
module.exports = { main };
