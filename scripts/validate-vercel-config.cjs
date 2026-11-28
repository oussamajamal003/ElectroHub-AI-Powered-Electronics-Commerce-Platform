const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const configPath = path.join(root, 'vercel.json');
const packagePath = path.join(root, 'package.json');

if (!fs.existsSync(configPath)) throw new Error('Missing vercel.json');
if (!fs.existsSync(packagePath)) throw new Error('Missing root package.json');

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

const checks = [
  [config.framework === 'vite', 'framework must be vite'],
  [config.installCommand === 'npm ci', 'installCommand must be npm ci'],
  [config.buildCommand === 'npm run build --workspace=@electrohub/frontend', 'frontend workspace build command mismatch'],
  [config.outputDirectory === 'apps/frontend/dist', 'outputDirectory must be apps/frontend/dist'],
  [config.devCommand === 'npm run dev --workspace=@electrohub/frontend', 'frontend workspace dev command mismatch'],
  [packageJson.workspaces?.includes('apps/frontend'), 'root workspace must include apps/frontend'],
  [Array.isArray(config.rewrites) && config.rewrites.some((rewrite) => rewrite.source === '/(.*)' && rewrite.destination === '/index.html'), 'SPA fallback rewrite required'],
];

const failures = checks.filter(([passed]) => !passed).map(([, message]) => message);
if (failures.length) throw new Error(`Vercel validation failed:\n- ${failures.join('\n- ')}`);

console.log('vercel.json validation passed: root workspace, Vite build, SPA fallback');
