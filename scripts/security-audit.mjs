import { execSync } from 'child_process';

/**
 * Approved Security Exceptions
 *
 * Each entry must contain:
 * - id: Advisory identifier (e.g. GHSA or CVE)
 * - package: The root vulnerable package name
 * - severity: The severity level
 * - reason: Explicit architectural and security justification
 */
const APPROVED_EXCEPTIONS = [
  {
    id: 'GHSA-ggr8-5vv4-36mx',
    package: 'deepmerge-ts',
    severity: 'high',
    reason:
      'Required strictly by @prisma/config@6.19.3 (pins deepmerge-ts@7.1.5). ' +
      'Overriding deepmerge-ts to >=8.0.0 causes npm to report an invalid dependency tree (ELSPROBLEMS). ' +
      'Prisma must remain locked to 6.19.3 per project architectural standards. ' +
      'Package is dev-only CLI tooling, not reachable in runtime application code.'
  }
];

console.log('Running npm security audit check...');

let stdout = '';
try {
  stdout = execSync('npm audit --json', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
} catch (error) {
  // npm audit exits with non-zero code when vulnerabilities are present
  stdout = error.stdout || '';
}

if (!stdout.trim()) {
  console.error('Error: Failed to obtain audit output from npm audit --json');
  process.exit(1);
}

let report;
try {
  report = JSON.parse(stdout);
} catch (err) {
  console.error('Error parsing npm audit JSON output:', err);
  process.exit(1);
}

const vulnerabilities = report.vulnerabilities || {};
const unapproved = [];
const approvedMatched = [];

for (const [pkgName, details] of Object.entries(vulnerabilities)) {
  const severity = details.severity?.toLowerCase();
  // We enforce high and critical severity checks
  if (severity !== 'high' && severity !== 'critical') {
    continue;
  }

  // Find root advisory sources in the "via" array
  const advisories = Array.isArray(details.via)
    ? details.via.filter(v => typeof v === 'object' && v !== null)
    : [];

  const directPkgAdvisories = advisories.map(a => a.url || a.title || a.name);

  // Helper function to trace if a vulnerability originates from an approved exception package
  function tracesToException(name, visited = new Set()) {
    if (visited.has(name)) return false;
    visited.add(name);
    return APPROVED_EXCEPTIONS.some(exc => {
      if (name === exc.package) return true;
      const vNode = vulnerabilities[name];
      if (!vNode || !Array.isArray(vNode.via)) return false;
      return vNode.via.some(viaItem => {
        if (typeof viaItem === 'string') {
          return tracesToException(viaItem, visited);
        }
        if (typeof viaItem === 'object' && viaItem !== null) {
          return viaItem.name === exc.package || viaItem.url?.includes(exc.id);
        }
        return false;
      });
    });
  }

  const isApproved = tracesToException(pkgName);

  if (isApproved) {
    approvedMatched.push({
      package: pkgName,
      severity: details.severity,
      range: details.range,
      effects: details.effects
    });
  } else {
    unapproved.push({
      package: pkgName,
      severity: details.severity,
      range: details.range,
      via: details.via
    });
  }
}

console.log('\n--- Security Audit Summary ---');
console.log(`Total High/Critical Vulnerabilities Detected: ${Object.keys(vulnerabilities).filter(k => ['high', 'critical'].includes(vulnerabilities[k].severity?.toLowerCase())).length}`);

if (approvedMatched.length > 0) {
  console.log('\nApproved Security Exceptions:');
  for (const item of approvedMatched) {
    console.log(`  - [APPROVED] ${item.package} (${item.severity}) [Range: ${item.range}]`);
  }
  for (const exc of APPROVED_EXCEPTIONS) {
    console.log(`    Exception Rationale (${exc.id}): ${exc.reason}`);
  }
}

if (unapproved.length > 0) {
  console.error('\n❌ FAILED: Unapproved High or Critical vulnerabilities detected:');
  for (const item of unapproved) {
    console.error(`  - ${item.package} (${item.severity}) - Details:`, JSON.stringify(item.via));
  }
  console.error('\nRemediation required before merge. Exiting with code 1.');
  process.exit(1);
}

console.log('\n✅ PASSED: No unapproved High or Critical vulnerabilities found.');
process.exit(0);
