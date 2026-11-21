'use strict';

const fs = require('node:fs');

const PROTECTED_SERVICES = ['api', 'ai-service'];

function validateComposePortExposure(compose, protectedServices = PROTECTED_SERVICES) {
  if (!compose || typeof compose !== 'object' || Array.isArray(compose)) {
    throw new Error('Rendered Compose JSON must be an object');
  }

  if (!compose.services || typeof compose.services !== 'object' || Array.isArray(compose.services)) {
    throw new Error('Rendered Compose JSON is missing its services object');
  }

  for (const serviceName of protectedServices) {
    if (!Object.prototype.hasOwnProperty.call(compose.services, serviceName)) {
      throw new Error(`Rendered Compose JSON is missing required service: ${serviceName}`);
    }

    const service = compose.services[serviceName];
    if (!service || typeof service !== 'object' || Array.isArray(service)) {
      throw new Error(`Rendered Compose JSON has invalid service: ${serviceName}`);
    }

    if (Object.prototype.hasOwnProperty.call(service, 'ports')) {
      if (!Array.isArray(service.ports)) {
        throw new Error(`Rendered Compose service ${serviceName} has invalid ports data`);
      }
      if (service.ports.length > 0) {
        throw new Error(`Service ${serviceName} publishes host ports: ${JSON.stringify(service.ports)}`);
      }
    }
  }

  return true;
}

function validateComposeFile(filePath) {
  let compose;
  try {
    compose = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Unable to parse rendered Compose JSON from ${filePath}: ${error.message}`);
  }

  return validateComposePortExposure(compose);
}

module.exports = {
  PROTECTED_SERVICES,
  validateComposePortExposure,
  validateComposeFile,
};

if (require.main === module) {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: node scripts/validate-compose-port-exposure.cjs <rendered-compose.json>');
    process.exit(2);
  }

  try {
    validateComposeFile(filePath);
  } catch (error) {
    console.error(error.message);
    process.exit(4);
  }
}
