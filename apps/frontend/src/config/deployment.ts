export type DeploymentEnvironment = {
  VITE_API_BASE_URL?: string;
  VITE_SOCKET_URL?: string;
};

function canonicalOrigin(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}

export function deploymentEnvironment(source: DeploymentEnvironment = import.meta.env as unknown as DeploymentEnvironment): DeploymentEnvironment {
  return {
    VITE_API_BASE_URL: canonicalOrigin(source.VITE_API_BASE_URL),
    VITE_SOCKET_URL: canonicalOrigin(source.VITE_SOCKET_URL),
  };
}

export function resolveApiUrl(path: string, source: DeploymentEnvironment = import.meta.env as unknown as DeploymentEnvironment): string {
  if (/^https?:\/\//i.test(path)) return path;
  const origin = deploymentEnvironment(source).VITE_API_BASE_URL;
  if (!origin) return path.startsWith('/') ? path : `/${path}`;
  return new URL(path.startsWith('/') ? path : `/${path}`, `${origin}/`).toString();
}

export function resolveSocketUrl(source: DeploymentEnvironment = import.meta.env as unknown as DeploymentEnvironment): string | undefined {
  const environment = deploymentEnvironment(source);
  return environment.VITE_SOCKET_URL ?? environment.VITE_API_BASE_URL;
}
