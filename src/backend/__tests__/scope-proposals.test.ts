import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { camelToSnake } from '../../shared/case-transform.js';
import {
  readScopeMembershipProposalArtifact,
  resolveScopeMembershipProposalPath,
  scopeProposalFreshness,
  validateScopeMembershipProposalArtifact,
} from '../lib/scope-proposals.js';

let testDir: string;

beforeEach(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctag-scope-proposals-'));
});

afterEach(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
});

function artifact(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    provider: 'cartographer-test',
    artifactFingerprint: 'sha256:abc123',
    generatedAt: '2026-08-20T00:00:00Z',
    freshUntil: '2026-08-22T00:00:00Z',
    proposals: [{
      scopeSetId: 'production_candidate',
      path: 'src/new-route.ts',
      kind: 'file',
      role: 'component',
      rationale: 'Reachable from the API entrypoint',
      evidence: ['src/server.ts -> src/new-route.ts'],
    }],
    ...overrides,
  };
}

describe('scope membership proposal artifacts', () => {
  it('loads snake_case provider provenance without promoting proposals', () => {
    const canopyPath = path.join(testDir, 'canopytag', 'canopy.json');
    const proposalPath = resolveScopeMembershipProposalPath(canopyPath);
    fs.mkdirSync(path.dirname(proposalPath), { recursive: true });
    fs.writeFileSync(proposalPath, JSON.stringify(camelToSnake(artifact())));

    const result = readScopeMembershipProposalArtifact(proposalPath)!;
    expect(result.provider).toBe('cartographer-test');
    expect(result.artifactFingerprint).toBe('sha256:abc123');
    expect(result.proposals[0]).toMatchObject({
      scopeSetId: 'production_candidate',
      path: 'src/new-route.ts',
      kind: 'file',
    });
  });

  it('returns undefined when the optional generated sidecar is absent', () => {
    expect(readScopeMembershipProposalArtifact(path.join(testDir, 'missing.json')))
      .toBeUndefined();
  });

  it('requires provenance, bounded freshness, safe paths, and known kinds', () => {
    expect(() => validateScopeMembershipProposalArtifact(artifact({ provider: '' })))
      .toThrow(/provider/);
    expect(() => validateScopeMembershipProposalArtifact(artifact({ freshUntil: '2026-08-19' })))
      .toThrow(/fresh_until/);
    expect(() => validateScopeMembershipProposalArtifact(artifact({
      proposals: [{ scopeSetId: 'production_candidate', path: '../outside.ts', kind: 'file' }],
    }))).toThrow(/repository-relative and safe/);
    expect(() => validateScopeMembershipProposalArtifact(artifact({
      proposals: [{ scopeSetId: 'production_candidate', path: 'src/app.ts', kind: 'symbol' }],
    }))).toThrow(/file or directory/);
  });

  it('labels freshness from the declared deadline rather than provider popularity', () => {
    const parsed = validateScopeMembershipProposalArtifact(artifact());
    expect(scopeProposalFreshness(parsed, new Date('2026-08-21T00:00:00Z'))).toBe('fresh');
    expect(scopeProposalFreshness(parsed, new Date('2026-08-23T00:00:00Z'))).toBe('stale');
  });
});
