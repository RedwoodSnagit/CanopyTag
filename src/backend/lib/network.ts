import { isIP } from 'node:net';

export const DEFAULT_SERVER_HOST = '127.0.0.1';

export interface ServerHostOptions {
  cliHost?: unknown;
  envHost?: unknown;
}

function nonEmptyHost(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Resolve an explicit host while keeping the unauthenticated API loopback-only by default. */
export function resolveServerHost(options: ServerHostOptions = {}): string {
  return nonEmptyHost(options.cliHost)
    ?? nonEmptyHost(options.envHost)
    ?? DEFAULT_SERVER_HOST;
}

export function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/^\[|\]$/g, '');
  return normalized === 'localhost'
    || normalized === '::1'
    || (isIP(normalized) === 4 && normalized.startsWith('127.'));
}

export function networkExposureWarning(host: string): string | undefined {
  if (isLoopbackHost(host)) return undefined;
  return `[canopytag] WARNING: backend bound to ${host}. The web API has no authentication and can read or modify the selected repository; use non-loopback hosts only on a trusted network.`;
}
