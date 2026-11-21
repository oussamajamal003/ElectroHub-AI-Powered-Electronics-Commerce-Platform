import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

const EXPECTED_PROD_PROJECT_REF = 'yepfgjehdstlxbpespun';

function projectRefFromDatabaseUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const direct = /^db\.([a-z0-9-]{8,64})\.supabase\.co$/i.exec(url.hostname)?.[1];
    if (direct) return direct.toLowerCase();
    const projectHost = /^([a-z0-9-]{8,64})\.supabase\.co$/i.exec(url.hostname)?.[1];
    if (projectHost) return projectHost.toLowerCase();
    if (url.hostname.endsWith('.pooler.supabase.com')) {
      const username = decodeURIComponent(url.username);
      const ref = /(?:^|\.)([a-z0-9-]{8,64})$/i.exec(username)?.[1];
      return ref?.toLowerCase() ?? null;
    }
  } catch {
    return null;
  }
  return null;
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV !== 'production') throw new Error('This operator command only runs with NODE_ENV=production.');
  if (process.env.ADMIN_BOOTSTRAP_ENABLED !== 'true') throw new Error('Set ADMIN_BOOTSTRAP_ENABLED=true only for this approved one-time operation.');
  if (!stdin.isTTY || !stdout.isTTY) throw new Error('An interactive operator terminal is required.');
  // Production secrets are supplied by the operator environment; never inherit a checkout-local env file.
  process.env.ELECTROHUB_ENV_FILES = 'none';

  const targetRefs = [projectRefFromDatabaseUrl(process.env.DATABASE_URL), projectRefFromDatabaseUrl(process.env.DIRECT_URL)];
  if (targetRefs.some(ref => ref !== EXPECTED_PROD_PROJECT_REF) || process.env.SUPABASE_PROJECT_REF !== EXPECTED_PROD_PROJECT_REF ||
      process.env.SUPABASE_URL !== `https://${EXPECTED_PROD_PROJECT_REF}.supabase.co`) {
    throw new Error('Configured database and Storage identifiers do not match the pinned PROD project.');
  }

  const prompts = createInterface({ input: stdin, output: stdout });
  let email: string;
  let authorizationReference: string;
  try {
    email = (await prompts.question('Initial administrator email: ')).trim().toLowerCase();
    authorizationReference = (await prompts.question('Operator approval reference: ')).trim();
    if (authorizationReference.length < 4 || authorizationReference.length > 200 || /[\r\n\0]/.test(authorizationReference)) {
      throw new Error('A valid operator approval reference is required.');
    }
    const confirmation = await prompts.question(`Type BOOTSTRAP ${EXPECTED_PROD_PROJECT_REF} ${email} to send the one-time invitation: `);
    if (confirmation !== `BOOTSTRAP ${EXPECTED_PROD_PROJECT_REF} ${email}`) throw new Error('Typed confirmation did not match.');
  } finally {
    prompts.close();
  }

  const { AdminTeamService } = await import('./services/admin-team.service.js');
  const { prisma } = await import('./lib/prisma.js');
  try {
    const result = await new AdminTeamService().createBootstrapInvitation({ email, authorizationReference });
    console.log(JSON.stringify({ result: 'invitation-created', invitationId: result.id, deliveryStatus: result.deliveryStatus,
      expiresAt: result.expiresAt, projectRef: EXPECTED_PROD_PROJECT_REF }));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(() => {
  // Do not print database URLs, provider errors, email addresses, invitation tokens, or raw error objects.
  console.error('Administrator bootstrap did not complete. Review sanitized server logs and preserve the approval reference.');
  process.exitCode = 1;
});
