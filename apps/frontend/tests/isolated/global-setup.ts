import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const frontendDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultTokenFile = path.resolve(frontendDirectory, '../../../backend/.isolated/runtime-token.txt');
const diagnosticPath = '/api/internal/development-runtime';
const timeoutMs = 5_000;

type RuntimeDiagnostic = {
  data?: {
    mode?: unknown;
    instanceId?: unknown;
    databaseReady?: unknown;
    tlsVerified?: unknown;
  };
};

function isolatedFrontendOrigin(value: string | undefined): string {
  const candidate = value ?? 'http://127.0.0.1:3200';
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error('Isolated runtime preflight failed: ISOLATED_BASE_URL must be the local :3200 frontend.');
  }
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname.toLowerCase()) ||
      url.port !== '3200' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Isolated runtime preflight failed: ISOLATED_BASE_URL must be the local :3200 frontend.');
  }
  return url.origin;
}

async function readRuntime(url: string, token: string, fetcher: typeof fetch): Promise<RuntimeDiagnostic> {
  let response: Response;
  try {
    response = await fetcher(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new Error('Isolated runtime preflight failed: authenticated runtime diagnostic is unreachable.');
  }
  if (!response.ok || !response.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    throw new Error('Isolated runtime preflight failed: authenticated runtime diagnostic was refused.');
  }
  try {
    return await response.json() as RuntimeDiagnostic;
  } catch {
    throw new Error('Isolated runtime preflight failed: authenticated runtime diagnostic was malformed.');
  }
}

function isIsolatedReady(value: RuntimeDiagnostic): value is RuntimeDiagnostic & { data: NonNullable<RuntimeDiagnostic['data']> } {
  const data = value?.data;
  return data?.mode === 'ISOLATED_QA' && typeof data.instanceId === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(data.instanceId) &&
    data.databaseReady === true && data.tlsVerified === true;
}

export async function runIsolatedRuntimePreflight(dependencies: {
  readTokenFile?: (filePath: string) => Promise<string>;
  fetcher?: typeof fetch;
  environment?: NodeJS.ProcessEnv;
} = {}): Promise<void> {
  const environment = dependencies.environment ?? process.env;
  const readTokenFile = dependencies.readTokenFile ?? (async filePath => readFile(filePath, 'utf8'));
  const fetcher = dependencies.fetcher ?? fetch;
  const frontendOrigin = isolatedFrontendOrigin(environment.ISOLATED_BASE_URL);
  let token: string;
  try {
    token = (await readTokenFile(environment.ISOLATED_RUNTIME_TOKEN_FILE ?? defaultTokenFile)).trim();
  } catch {
    throw new Error('Isolated runtime preflight failed: private runtime token file is missing or unreadable.');
  }
  if (!/^[0-9a-f]{64}$/i.test(token)) {
    throw new Error('Isolated runtime preflight failed: private runtime token is invalid.');
  }

  const [direct, proxied] = await Promise.all([
    readRuntime(`http://127.0.0.1:5200${diagnosticPath}`, token, fetcher),
    readRuntime(`${frontendOrigin}${diagnosticPath}`, token, fetcher),
  ]);
  if (!isIsolatedReady(direct) || !isIsolatedReady(proxied) ||
      direct.data.instanceId !== proxied.data.instanceId) {
    // Keep diagnostic bodies and authorization material out of Playwright output.
    throw new Error('Isolated runtime preflight failed: direct API and frontend proxy do not attest the same ready disposable runtime.');
  }
}

export default async function globalSetup(): Promise<void> {
  await runIsolatedRuntimePreflight();
}
