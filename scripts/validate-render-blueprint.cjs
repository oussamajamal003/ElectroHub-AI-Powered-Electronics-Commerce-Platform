const fs = require('node:fs');
const yaml = require('js-yaml');

const file = 'render.yaml';
const doc = yaml.load(fs.readFileSync(file, 'utf8'));
const services = Array.isArray(doc?.services) ? doc.services : [];
if (services.length < 1) throw new Error('render.yaml must declare at least one service');

const expectedNames = new Set(['electrohub-api', 'electrohub-ai']);
if (services.length !== 2 || services.some((service) => !expectedNames.has(service.name))) {
  throw new Error('render.yaml must declare exactly electrohub-api and electrohub-ai');
}

for (const service of services) {
  if (service.plan !== 'free') throw new Error(`${service.name}: paid or unspecified compute plan`);
  if (service.branch !== 'feature/06.3-production-infrastructure') throw new Error(`${service.name}: branch must remain feature/06.3-production-infrastructure`);
  if (service.region !== 'frankfurt') throw new Error(`${service.name}: region must remain frankfurt`);
  if (service.disk || service.disks) throw new Error(`${service.name}: persistent disk is forbidden`);
  if (!service.healthCheckPath) throw new Error(`${service.name}: healthCheckPath is required`);
  if (service.autoDeploy !== false) throw new Error(`${service.name}: autoDeploy must remain false`);
}

const api = services.find((service) => service.name === 'electrohub-api');
const ai = services.find((service) => service.name === 'electrohub-ai');
if (api.runtime !== 'node' || api.healthCheckPath !== '/health/ready' || api.buildCommand !== 'npm ci && npm run prisma:generate --workspace=@electrohub/backend && npm run build --workspace=@electrohub/frontend && npm run build --workspace=@electrohub/backend' || api.startCommand !== 'npm run start --workspace=@electrohub/backend') {
  throw new Error('electrohub-api: build, start or health configuration is invalid');
}
if (ai.runtime !== 'docker' || ai.dockerfilePath !== './apps/ai-service/Dockerfile' || ai.dockerContext !== './apps/ai-service' || ai.healthCheckPath !== '/health') {
  throw new Error('electrohub-ai: Docker runtime or health configuration is invalid');
}

if ('databases' in doc || 'keyValue' in doc || 'services' in doc && services.some((service) => ['postgres', 'redis', 'keyvalue'].includes(service.type))) {
  throw new Error('Render datastore resources are forbidden by Task 06.3 Free guardrails');
}

console.log(`render.yaml validation passed: ${services.length} Free web service(s), no datastores or disks`);
