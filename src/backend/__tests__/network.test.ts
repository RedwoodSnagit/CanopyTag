import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SERVER_HOST,
  isLoopbackHost,
  networkExposureWarning,
  resolveServerHost,
} from '../lib/network.js';

describe('server network defaults', () => {
  it('binds to IPv4 loopback when no host is configured', () => {
    expect(resolveServerHost()).toBe(DEFAULT_SERVER_HOST);
  });

  it('accepts an explicit environment host for automated startup', () => {
    expect(resolveServerHost({ envHost: '0.0.0.0' })).toBe('0.0.0.0');
  });

  it('lets the CLI host override the environment', () => {
    expect(resolveServerHost({ cliHost: '192.168.1.12', envHost: '0.0.0.0' }))
      .toBe('192.168.1.12');
  });

  it('ignores blank host values', () => {
    expect(resolveServerHost({ cliHost: '  ', envHost: '' })).toBe(DEFAULT_SERVER_HOST);
  });

  it.each(['localhost', '127.0.0.1', '127.1.2.3', '::1', '[::1]'])(
    'recognizes %s as loopback',
    host => expect(isLoopbackHost(host)).toBe(true),
  );

  it('does not mistake an invalid 127-looking hostname for loopback', () => {
    expect(isLoopbackHost('127.999.1.1')).toBe(false);
  });

  it('warns clearly when an explicit host exposes the unauthenticated API', () => {
    expect(networkExposureWarning('0.0.0.0')).toContain('no authentication');
    expect(networkExposureWarning('0.0.0.0')).toContain('read or modify');
    expect(networkExposureWarning(DEFAULT_SERVER_HOST)).toBeUndefined();
  });
});
