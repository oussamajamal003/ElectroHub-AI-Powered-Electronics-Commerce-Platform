/** Explicit QA-only entrypoint: real app and socket gateway, without maintenance or financial workers. */
import './config/env.js';
import { activateDeliveryQaRuntime } from './delivery-qa-runtime.config.js';
import app, { corsOrigin } from './app.js';
import { env } from './config/env.js';
import { prisma } from './lib/prisma.js';
import { attachDeliveryGateway } from './sockets/delivery.gateway.js';
import { DeliveryPublisher } from './sockets/delivery.publisher.js';
import { deliveryOrigin } from './config/delivery-map.config.js';
import { sharedDevSimulationScope } from './services/delivery-simulation/simulation.config.js';

activateDeliveryQaRuntime();

async function main() {
  deliveryOrigin();
  await prisma.$queryRaw`SELECT 1`;
  console.log(`Delivery QA simulation scope: ${sharedDevSimulationScope() ? 'enabled' : 'disabled'}`);
  const server = app.listen(env.PORT, '127.0.0.1', () => console.log(`Delivery QA API listening on 127.0.0.1:${env.PORT}`));
  const gateway = attachDeliveryGateway(server, { corsOrigin });
  DeliveryPublisher.attach(gateway);
  const stop = async () => { await gateway.close(); server.close(); await prisma.$disconnect(); };
  process.once('SIGINT', () => void stop());
  process.once('SIGTERM', () => void stop());
}
void main().catch((error: unknown) => {
  const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : 'UNKNOWN';
  console.error(`Delivery QA API failed to start (${code}).`);
  process.exitCode = 1;
});
