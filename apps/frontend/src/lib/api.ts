export class ApiError extends Error {
  public status: number;
  public data: unknown;

  constructor(status: number, message: string, data?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

interface FetchOptions extends RequestInit {
  data?: unknown;
}

let accessToken: string | null = null;
let isRefreshing = false;
let refreshSubscribers: Array<(token: string | null) => void> = [];

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function getAccessToken() {
  return accessToken;
}

function onRefreshed(token: string | null) {
  refreshSubscribers.forEach((cb) => cb(token));
  refreshSubscribers = [];
}

function addRefreshSubscriber(cb: (token: string | null) => void) {
  refreshSubscribers.push(cb);
}

export async function apiClient<T = unknown>(endpoint: string, options: FetchOptions = {}): Promise<T> {
  const url = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;

  const config: RequestInit = {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  };

  if (options.data) {
    config.body = JSON.stringify(options.data);
  }

  // Include credentials for endpoints that need cookies
  config.credentials = 'include';

  if (accessToken) {
    config.headers = {
      ...config.headers,
      Authorization: `Bearer ${accessToken}`,
    };
  }

  const response = await fetch(url, config);

  if (!response.ok) {
    // Handle 401 Unauthorized
    if (
      response.status === 401 &&
      !url.includes('/api/auth/refresh') &&
      !url.includes('/api/auth/login') &&
      !url.includes('/api/auth/logout')
    ) {
      if (!isRefreshing) {
        isRefreshing = true;

        try {
          // Attempt silent refresh
          const refreshRes = await fetch('/api/auth/refresh', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
          });

          if (!refreshRes.ok) {
            throw new Error('Refresh failed');
          }

          const refreshData = await refreshRes.json();
          setAccessToken(refreshData.accessToken);
          onRefreshed(refreshData.accessToken);
        } catch {
          setAccessToken(null);
          onRefreshed(null);
        } finally {
          isRefreshing = false;
        }
      }

      // Wait for the refresh to complete
      return new Promise((resolve, reject) => {
        addRefreshSubscriber(async (newToken) => {
          if (newToken) {
            // Update Authorization header and retry
            const retryConfig = { ...config };
            retryConfig.headers = {
              ...retryConfig.headers,
              Authorization: `Bearer ${newToken}`,
            };
            try {
              const retryResponse = await fetch(url, retryConfig);
              if (!retryResponse.ok) {
                const errorData = await retryResponse.json().catch(() => ({}));
                return reject(new ApiError(retryResponse.status, errorData.error || 'Request failed', errorData));
              }
              const data = await retryResponse.json().catch(() => ({}));
              resolve(data);
            } catch (err) {
              reject(err);
            }
          } else {
            reject(new ApiError(401, 'Session expired'));
          }
        });
      });
    }

    // Normal error parsing
    const errorData = await response.json().catch(() => ({}));
    let errorMessage = errorData.error || errorData.message;
    if (!errorMessage && Array.isArray(errorData.errors) && errorData.errors.length > 0) {
      const firstErr = errorData.errors[0];
      errorMessage = typeof firstErr === 'string' ? firstErr : (firstErr?.message || JSON.stringify(firstErr));
    }
    if (typeof errorMessage === 'object' && errorMessage !== null) {
      errorMessage = (errorMessage as { message?: string }).message || JSON.stringify(errorMessage);
    }
    if (!errorMessage || typeof errorMessage !== 'string') {
      errorMessage = response.statusText || 'Request failed';
    }
    throw new ApiError(response.status, errorMessage, errorData);
  }

  // Success
  return response.json().catch(() => ({}));
}
