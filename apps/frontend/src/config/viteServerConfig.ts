export type FrontendServerEnvironment = {
  E2E_FRONTEND_PORT?: string;
  E2E_API_PROXY_TARGET?: string;
};

function readCliPort(arguments_: string[]): number | undefined {
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === undefined) continue;
    if (argument === '--port') {
      const value = arguments_[index + 1];
      if (!value || value.startsWith('-')) throw new Error('--port requires a valid TCP port.');
      const port = Number(value);
      if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('--port must be a valid TCP port.');
      return port;
    }
    if (argument.startsWith('--port=')) {
      const port = Number(argument.slice('--port='.length));
      if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('--port must be a valid TCP port.');
      return port;
    }
  }
  return undefined;
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export function getFrontendServerConfig(environment: FrontendServerEnvironment, arguments_: string[] = []) {
  const configuredPort = environment.E2E_FRONTEND_PORT === undefined ? undefined : Number(environment.E2E_FRONTEND_PORT);
  const cliPort = readCliPort(arguments_);
  if (environment.E2E_FRONTEND_PORT !== undefined && (!Number.isInteger(configuredPort) || configuredPort! < 1 || configuredPort! > 65_535)) {
    throw new Error('E2E_FRONTEND_PORT must be a valid TCP port.');
  }
  if (configuredPort !== undefined && cliPort !== undefined && configuredPort !== cliPort) {
    throw new Error('E2E_FRONTEND_PORT and Vite --port must agree when both are set.');
  }
  const port = cliPort ?? configuredPort ?? 3000;
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('E2E_FRONTEND_PORT must be a valid TCP port.');
  }

  const defaultTargetPort = port === 3200 ? 5200 : 5000;
  const target = environment.E2E_API_PROXY_TARGET ?? `http://localhost:${defaultTargetPort}`;
  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    throw new Error('E2E_API_PROXY_TARGET must be a loopback HTTP URL.');
  }
  if (parsed.protocol !== 'http:' || !LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase()) ||
      parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error('E2E_API_PROXY_TARGET must be a loopback HTTP URL without credentials, path, query, or hash.');
  }
  const targetPort = Number(parsed.port || 80);
  if (!Number.isInteger(targetPort) || targetPort < 1 || targetPort > 65_535) {
    throw new Error('E2E_API_PROXY_TARGET must include a valid TCP port.');
  }
  if ((port === 3000 && targetPort !== 5000) || (port === 3200 && targetPort !== 5200)) {
    throw new Error(`Frontend :${port} must proxy to its reserved backend port.`);
  }

  return {
    port,
    strictPort: true as const,
    proxy: { '/api': { target: parsed.origin, changeOrigin: true as const } },
  };
}

export function getViteServerConfig(command: 'serve' | 'build', environment: FrontendServerEnvironment, arguments_: string[] = []) {
  return command === 'serve' ? getFrontendServerConfig(environment, arguments_) : undefined;
}
