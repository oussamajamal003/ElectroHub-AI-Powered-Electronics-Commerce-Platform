import { performance } from 'node:perf_hooks';
import { Prisma } from '@prisma/client';
import { env } from '../src/config/env.js';
import { prisma } from '../src/lib/prisma.js';
import { searchSchema } from '../src/validators/search.validator.js';
import { searchFrom, searchOrder, searchWhere } from '../src/services/search.sql.js';
import { productSummarySelect, publicProductWhere } from '../src/services/product.service.js';

const devRef = 'pzxekjybdiulzmssalfo';
const configuredTargetsAreDev = [env.DATABASE_URL, env.DIRECT_URL].every(value => {
  const target = new URL(value);
  const identity = `${target.hostname} ${target.username}`;
  return identity.includes(devRef) && !identity.includes('yepfgjehdstlxbpespun');
});
if (env.NODE_ENV !== 'development' || !configuredTargetsAreDev) {
  throw new Error('DEV-only Search plan check refused the configured database target.');
}

type PlanNode = { 'Node Type': string; 'Relation Name'?: string; Plans?: PlanNode[] };
type ExplainRow = { 'QUERY PLAN': [{ Plan: PlanNode; 'Planning Time': number; 'Execution Time': number }] };
const cases = [
  { q: 'macbook' },
  { q: 'sony', brand: 'sony' },
  { q: 'apple', category: 'laptops', availability: 'available' },
  { q: 'sony', minPrice: '50', maxPrice: '1000', sort: 'price-asc' },
] as const;

function shape(node: PlanNode): string[] {
  return [`${node['Node Type']}${node['Relation Name'] ? `(${node['Relation Name']})` : ''}`,
    ...(node.Plans ?? []).flatMap(shape)];
}

async function main() {
  const connectedAt = performance.now();
  await prisma.$connect();
  process.stdout.write(`DEV cold connection: ${Math.round(performance.now() - connectedAt)} ms\n`);
  for (const [index, raw] of cases.entries()) {
    const input = searchSchema.parse(raw);
    const query = Prisma.sql`SELECT p."id" ${searchFrom} ${searchWhere(input)}
      ORDER BY ${searchOrder(input)} LIMIT ${input.pageSize} OFFSET 0`;
    const explained = await prisma.$queryRaw<ExplainRow[]>(Prisma.sql`EXPLAIN (ANALYZE, FORMAT JSON, BUFFERS) ${query}`);
    const plan = explained[0]?.['QUERY PLAN'][0];
    if (!plan) throw new Error('DEV Search plan was unavailable.');
    const queryAt = performance.now();
    const ids = await prisma.$queryRaw<{ id: string }[]>(query);
    const queryRoundTrip = Math.round(performance.now() - queryAt);
    const hydratedAt = performance.now();
    if (ids.length) await prisma.product.findMany({ where: { ...publicProductWhere, id: { in: ids.map(value => value.id) } }, select: productSummarySelect });
    const hydrationRoundTrip = Math.round(performance.now() - hydratedAt);
    process.stdout.write(`Case ${index + 1}: SQL ${plan['Execution Time'].toFixed(2)} ms; plan ${plan['Planning Time'].toFixed(2)} ms; ` +
      `query round-trip ${queryRoundTrip} ms; hydration round-trip ${hydrationRoundTrip} ms; ` +
      `IDs ${ids.length}; shape ${shape(plan.Plan).join(' > ')}\n`);
  }
}

main().catch(() => { process.stderr.write('DEV Search plan check failed; no target details printed.\n'); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
