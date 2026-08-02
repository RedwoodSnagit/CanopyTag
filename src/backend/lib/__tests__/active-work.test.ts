import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Canopy } from '../../../shared/types.js';
import {
  claimWork,
  derivedClaimState,
  listWorkClaims,
  parseTtl,
  readActiveWork,
  releaseWorkClaim,
  renewWorkClaim,
  resolveTodoLink,
} from '../active-work.js';

let repoRoot: string;
let activeWorkPath: string;

beforeEach(() => {
  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'canopytag-active-work-'));
  fs.mkdirSync(path.join(repoRoot, 'canopytag'), { recursive: true });
  fs.mkdirSync(path.join(repoRoot, 'src', 'feature'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, 'src', 'feature', 'one.ts'), 'export const one = 1;\n');
  fs.writeFileSync(path.join(repoRoot, 'src', 'two.ts'), 'export const two = 2;\n');
  activeWorkPath = path.join(repoRoot, 'canopytag', '.active_work.json');
});

afterEach(() => {
  fs.rmSync(repoRoot, { recursive: true, force: true });
});

describe('active work claims', () => {
  it('writes local snake_case state and reads it back', () => {
    const result = claimWork(repoRoot, activeWorkPath, {
      paths: ['src\\two.ts'],
      owner: 'agent-a',
      session: 'session-1',
      summary: 'Repair route parsing',
      ttlSeconds: 3600,
      now: new Date('2026-08-02T12:00:00Z'),
    });

    expect(result.conflicts).toEqual([]);
    expect(result.claim?.paths).toEqual([{ path: 'src/two.ts', kind: 'file' }]);
    const disk = fs.readFileSync(activeWorkPath, 'utf-8');
    expect(disk).toContain('"expires_at"');
    expect(disk).not.toContain('"expiresAt"');
    expect(readActiveWork(activeWorkPath).claims[0].owner).toBe('agent-a');
  });

  it('rejects overlapping exclusive file and directory claims', () => {
    const first = claimWork(repoRoot, activeWorkPath, {
      paths: ['src/feature'], owner: 'agent-a', summary: 'Feature work', ttlSeconds: 3600,
    });
    const second = claimWork(repoRoot, activeWorkPath, {
      paths: ['src/feature/one.ts'], owner: 'agent-b', summary: 'Same feature', ttlSeconds: 3600,
    });

    expect(first.claim).toBeDefined();
    expect(second.claim).toBeUndefined();
    expect(second.conflicts).toHaveLength(1);
    expect(readActiveWork(activeWorkPath).claims).toHaveLength(1);
  });

  it('treats a trailing slash as planned directory scope', () => {
    const directory = claimWork(repoRoot, activeWorkPath, {
      paths: ['src/planned/'], owner: 'agent-a', summary: 'Build planned directory',
    });
    const child = claimWork(repoRoot, activeWorkPath, {
      paths: ['src/planned/new.ts'], owner: 'agent-b', summary: 'Build child',
    });

    expect(directory.claim?.paths[0].kind).toBe('directory');
    expect(child.conflicts).toHaveLength(1);
  });

  it.runIf(['win32', 'darwin'].includes(process.platform))('compares default case-insensitive platform paths safely', () => {
    claimWork(repoRoot, activeWorkPath, {
      paths: ['src/two.ts'], owner: 'agent-a', summary: 'Edit file',
    });
    const alias = claimWork(repoRoot, activeWorkPath, {
      paths: ['SRC/TWO.TS'], owner: 'agent-b', summary: 'Edit alias',
    });

    expect(alias.conflicts).toHaveLength(1);
  });

  it('allows overlapping shared claims and ignores expired claims', () => {
    const now = new Date('2026-08-02T12:00:00Z');
    const sharedA = claimWork(repoRoot, activeWorkPath, {
      paths: ['src/two.ts'], owner: 'agent-a', summary: 'Review', exclusive: false,
      ttlSeconds: 60, now,
    });
    const sharedB = claimWork(repoRoot, activeWorkPath, {
      paths: ['src/two.ts'], owner: 'agent-b', summary: 'Second review', exclusive: false,
      ttlSeconds: 60, now,
    });
    const afterExpiry = claimWork(repoRoot, activeWorkPath, {
      paths: ['src/two.ts'], owner: 'agent-c', summary: 'Implementation', exclusive: true,
      ttlSeconds: 3600, now: new Date('2026-08-02T12:02:00Z'),
    });

    expect(sharedA.claim).toBeDefined();
    expect(sharedB.claim).toBeDefined();
    expect(afterExpiry.claim).toBeDefined();
    expect(afterExpiry.conflicts).toEqual([]);
  });

  it('lists active claims by path while retaining released and expired history', () => {
    const now = new Date('2026-08-02T12:00:00Z');
    const active = claimWork(repoRoot, activeWorkPath, {
      paths: ['src/feature'], owner: 'agent-a', summary: 'Feature', ttlSeconds: 3600, now,
    }).claim!;
    const released = claimWork(repoRoot, activeWorkPath, {
      paths: ['src/two.ts'], owner: 'agent-b', summary: 'Other', ttlSeconds: 3600, now,
    }).claim!;
    releaseWorkClaim(activeWorkPath, released.id, {
      owner: 'agent-b', note: 'Handoff complete', now: new Date('2026-08-02T12:05:00Z'),
    });
    const state = readActiveWork(activeWorkPath);

    expect(listWorkClaims(state, {
      paths: ['src/feature/one.ts'], now: new Date('2026-08-02T12:10:00Z'),
    }).map(claim => claim.id)).toEqual([active.id]);
    const history = listWorkClaims(state, {
      includeHistory: true, now: new Date('2026-08-02T13:10:00Z'),
    });
    expect(history.map(claim => claim.derivedState).sort()).toEqual(['expired', 'released']);
  });

  it('requires the matching actor to renew or release unless forced', () => {
    const claim = claimWork(repoRoot, activeWorkPath, {
      paths: ['src/two.ts'], owner: 'agent-a', session: 'one', summary: 'Work', ttlSeconds: 3600,
      now: new Date('2026-08-02T12:00:00Z'),
    }).claim!;

    expect(() => renewWorkClaim(activeWorkPath, claim.id, {
      owner: 'agent-b', session: 'two', ttlSeconds: 7200,
    })).toThrow('belongs to agent-a');
    const renewed = renewWorkClaim(activeWorkPath, claim.id, {
      owner: 'agent-a', session: 'one', ttlSeconds: 7200, now: new Date('2026-08-02T12:30:00Z'),
    });
    expect(renewed.expiresAt).toBe('2026-08-02T14:30:00.000Z');
    const released = releaseWorkClaim(activeWorkPath, claim.id, {
      owner: 'human-reviewer', force: true, note: 'Agent stopped', now: new Date('2026-08-02T14:01:00Z'),
    });
    expect(released.state).toBe('released');
    expect(released.releaseNote).toBe('Agent stopped');
  });

  it('requires the matching session when a session was recorded', () => {
    const claim = claimWork(repoRoot, activeWorkPath, {
      paths: ['src/two.ts'], owner: 'agent-a', session: 'thread-1', summary: 'Work',
    }).claim!;

    expect(() => renewWorkClaim(activeWorkPath, claim.id, {
      owner: 'agent-a', session: 'thread-2',
    })).toThrow(/owner\/session/);
    expect(() => releaseWorkClaim(activeWorkPath, claim.id, {
      owner: 'agent-a',
    })).toThrow(/owner\/session/);
  });

  it('rejects renewal after expiry so a successor claim cannot be overlapped', () => {
    const original = claimWork(repoRoot, activeWorkPath, {
      paths: ['src/two.ts'], owner: 'agent-a', session: 'thread-1', summary: 'First',
      ttlSeconds: 60, now: new Date('2026-08-02T12:00:00Z'),
    }).claim!;
    const successor = claimWork(repoRoot, activeWorkPath, {
      paths: ['src/two.ts'], owner: 'agent-b', session: 'thread-2', summary: 'Second',
      ttlSeconds: 3600, now: new Date('2026-08-02T12:02:00Z'),
    }).claim!;

    expect(successor).toBeDefined();
    expect(() => renewWorkClaim(activeWorkPath, original.id, {
      owner: 'agent-a', session: 'thread-1', now: new Date('2026-08-02T12:03:00Z'),
    })).toThrow(/expired.*new claim/i);
    expect(listWorkClaims(readActiveWork(activeWorkPath), {
      now: new Date('2026-08-02T12:03:00Z'),
    }).map(claim => claim.id)).toEqual([successor.id]);
  });

  it('links only an unambiguous CanopyTag TODO', () => {
    const canopy: Canopy = {
      version: 1, repoRoot: '', lastModifiedAt: '', features: {},
      files: {
        'src/two.ts': {
          todos: [{
            id: 'RT-001', text: 'Finish parser', priority: 2, status: 'in_progress',
            createdAt: '2026-08-02T12:00:00Z', createdBy: 'human',
          }],
        },
      },
    };
    expect(resolveTodoLink(canopy, 'RT-001')).toEqual({ file: 'src/two.ts', id: 'RT-001' });
    expect(resolveTodoLink(canopy, 'RT-001', 'src\\two.ts')).toEqual({ file: 'src/two.ts', id: 'RT-001' });
    expect(() => resolveTodoLink(canopy, 'RT-404')).toThrow('was not found');
  });

  it('validates durations and derives expiry without mutating state', () => {
    expect(parseTtl('30m')).toBe(1800);
    expect(parseTtl('2d')).toBe(172800);
    expect(() => parseTtl('30')).toThrow('whole-number duration');
    const claim = claimWork(repoRoot, activeWorkPath, {
      paths: ['src/two.ts'], owner: 'agent-a', summary: 'Work', ttlSeconds: 60,
      now: new Date('2026-08-02T12:00:00Z'),
    }).claim!;
    expect(derivedClaimState(claim, new Date('2026-08-02T12:01:00Z'))).toBe('expired');
  });

  it('rejects malformed local state instead of trusting partial claims', () => {
    fs.writeFileSync(activeWorkPath, JSON.stringify({
      version: 1,
      claims: [{ id: 'AW-broken', paths: [], owner: 'agent-a' }],
    }));
    expect(() => readActiveWork(activeWorkPath)).toThrow(/paths must be a non-empty array/);
  });

  it('prunes released and expired local history after seven days', () => {
    const old = claimWork(repoRoot, activeWorkPath, {
      paths: ['src/two.ts'], owner: 'agent-a', summary: 'Old work', ttlSeconds: 3600,
      now: new Date('2026-07-01T12:00:00Z'),
    }).claim!;
    releaseWorkClaim(activeWorkPath, old.id, {
      owner: 'agent-a', now: new Date('2026-07-01T12:01:00Z'),
    });
    claimWork(repoRoot, activeWorkPath, {
      paths: ['src/feature/one.ts'], owner: 'agent-b', summary: 'Current work',
      now: new Date('2026-08-02T12:00:00Z'),
    });

    expect(readActiveWork(activeWorkPath).claims.some(claim => claim.id === old.id)).toBe(false);
  });

  it('ages expired history from expiry rather than its earlier update', () => {
    const recentlyExpired = claimWork(repoRoot, activeWorkPath, {
      paths: ['src/two.ts'], owner: 'agent-a', summary: 'Long lease', ttlSeconds: 86400,
      now: new Date('2026-07-25T12:00:00Z'),
    }).claim!;
    claimWork(repoRoot, activeWorkPath, {
      paths: ['src/feature/one.ts'], owner: 'agent-b', summary: 'Current work',
      now: new Date('2026-08-02T12:00:00Z'),
    });

    expect(readActiveWork(activeWorkPath).claims.some(claim => claim.id === recentlyExpired.id)).toBe(true);
  });

  it('does not steal an old lock while its owning process is alive', () => {
    const lockPath = `${activeWorkPath}.lock`;
    fs.writeFileSync(lockPath, `${process.pid} live-owner 2026-01-01T00:00:00Z\n`);
    fs.utimesSync(lockPath, new Date('2026-01-01T00:00:00Z'), new Date('2026-01-01T00:00:00Z'));

    expect(() => claimWork(repoRoot, activeWorkPath, {
      paths: ['src/two.ts'], owner: 'agent-a', summary: 'Blocked work',
    })).toThrow(/state is busy/);
    expect(fs.readFileSync(lockPath, 'utf-8')).toContain('live-owner');
  });

  it('recovers an old malformed orphan lock', () => {
    const lockPath = `${activeWorkPath}.lock`;
    fs.writeFileSync(lockPath, 'unparseable orphan\n');
    fs.utimesSync(lockPath, new Date('2026-01-01T00:00:00Z'), new Date('2026-01-01T00:00:00Z'));

    const result = claimWork(repoRoot, activeWorkPath, {
      paths: ['src/two.ts'], owner: 'agent-a', summary: 'Recovered work',
    });
    expect(result.claim).toBeDefined();
    expect(fs.existsSync(lockPath)).toBe(false);
  });
});
