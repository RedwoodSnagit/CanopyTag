import fs from 'node:fs';
import path from 'node:path';
import { snakeToCamel } from '../../shared/case-transform.js';
import type {
  ScopeMemberRole,
  ScopeMembershipProposalArtifact,
  ScopeSubjectKind,
} from '../../shared/types.js';
import { parseJsonFile } from './canopy.js';

const SUBJECT_KINDS = new Set<ScopeSubjectKind>(['file', 'directory']);
const MEMBER_ROLES = new Set<ScopeMemberRole>([
  'component',
  'entrypoint',
  'canonical_document',
  'test',
  'resource',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireNonEmptyString(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Invalid scope membership proposals: '${field}' must be a non-empty string`);
  }
}

function requireIsoDate(value: unknown, field: string): asserts value is string {
  requireNonEmptyString(value, field);
  if (!Number.isFinite(Date.parse(value))) {
    throw new Error(`Invalid scope membership proposals: '${field}' must be an ISO date string`);
  }
}

function isSafeRepoPath(value: string): boolean {
  const normalized = value.replace(/\\/g, '/');
  return normalized.length > 0
    && normalized !== '.'
    && !path.posix.isAbsolute(normalized)
    && !path.win32.isAbsolute(value)
    && !normalized.split('/').includes('..');
}

export function resolveScopeMembershipProposalPath(canopyPath: string): string {
  return path.join(path.dirname(canopyPath), 'generated', 'scope-membership.json');
}

export function validateScopeMembershipProposalArtifact(value: unknown): ScopeMembershipProposalArtifact {
  if (!isRecord(value)) {
    throw new Error('Invalid scope membership proposals: expected a JSON object');
  }
  if (value.version !== 1) {
    throw new Error("Invalid scope membership proposals: 'version' must be 1");
  }
  requireNonEmptyString(value.provider, 'provider');
  requireNonEmptyString(value.artifactFingerprint, 'artifact_fingerprint');
  requireIsoDate(value.generatedAt, 'generated_at');
  requireIsoDate(value.freshUntil, 'fresh_until');
  if (Date.parse(value.generatedAt) > Date.parse(value.freshUntil)) {
    throw new Error("Invalid scope membership proposals: 'fresh_until' must not precede 'generated_at'");
  }
  if (!Array.isArray(value.proposals)) {
    throw new Error("Invalid scope membership proposals: 'proposals' must be an array");
  }

  for (const [index, proposal] of value.proposals.entries()) {
    const prefix = `proposals[${index}]`;
    if (!isRecord(proposal)) {
      throw new Error(`Invalid scope membership proposals: '${prefix}' must be an object`);
    }
    requireNonEmptyString(proposal.scopeSetId, `${prefix}.scope_set_id`);
    requireNonEmptyString(proposal.path, `${prefix}.path`);
    if (!isSafeRepoPath(proposal.path)) {
      throw new Error(`Invalid scope membership proposals: '${prefix}.path' must be repository-relative and safe`);
    }
    if (typeof proposal.kind !== 'string' || !SUBJECT_KINDS.has(proposal.kind as ScopeSubjectKind)) {
      throw new Error(`Invalid scope membership proposals: '${prefix}.kind' must be file or directory`);
    }
    if (proposal.role !== undefined &&
        (typeof proposal.role !== 'string' || !MEMBER_ROLES.has(proposal.role as ScopeMemberRole))) {
      throw new Error(`Invalid scope membership proposals: '${prefix}.role' is not supported`);
    }
    if (proposal.rationale !== undefined && typeof proposal.rationale !== 'string') {
      throw new Error(`Invalid scope membership proposals: '${prefix}.rationale' must be a string`);
    }
    if (proposal.evidence !== undefined &&
        (!Array.isArray(proposal.evidence) || proposal.evidence.some(item => typeof item !== 'string'))) {
      throw new Error(`Invalid scope membership proposals: '${prefix}.evidence' must be an array of strings`);
    }
  }

  return value as unknown as ScopeMembershipProposalArtifact;
}

export function readScopeMembershipProposalArtifact(
  filePath: string,
): ScopeMembershipProposalArtifact | undefined {
  if (!fs.existsSync(filePath)) return undefined;
  return validateScopeMembershipProposalArtifact(snakeToCamel(parseJsonFile(filePath)));
}

export function scopeProposalFreshness(
  artifact: ScopeMembershipProposalArtifact,
  asOf: Date = new Date(),
): 'fresh' | 'stale' {
  return asOf.getTime() <= Date.parse(artifact.freshUntil) ? 'fresh' : 'stale';
}
