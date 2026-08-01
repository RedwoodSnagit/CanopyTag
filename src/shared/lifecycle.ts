import type { Author, LifecycleMark } from './types.js';

export type LifecycleDerivedState = 'open' | 'due' | 'expired' | 'resolved' | 'invalid';

export interface LifecycleAssessment {
  raw: unknown;
  mark?: LifecycleMark;
  state: LifecycleDerivedState;
  issues: string[];
}

const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_UTC_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?Z$/;
const MARK_TYPES = new Set([
  'temporary_contract',
  'condensation_artifact',
  'provisional',
  'superseded',
  'review_needed',
]);
const MARK_STATES = new Set(['open', 'resolved']);
const TEMPORAL_DEPENDENCIES = new Set([
  'none',
  'date_bound',
  'event_bound',
  'release_bound',
  'version_bound',
]);
const RETRIEVAL_TREATMENTS = new Set([
  'normal',
  'include_with_warning',
  'deprioritize',
  'exclude_by_default',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function valueKind(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function normalizeIsoDay(value: unknown): string | undefined {
  if (typeof value !== 'string' || !ISO_DAY_RE.test(value)) return undefined;

  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value
    ? undefined
    : value;
}

function isIsoUtcDateTime(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_UTC_DATETIME_RE.test(value)) return false;
  if (!normalizeIsoDay(value.slice(0, 10))) return false;
  return !Number.isNaN(Date.parse(value));
}

function isAuthor(value: unknown): value is Author {
  if (value === 'human' || value === 'agent') return true;
  if (!isRecord(value) || (value.role !== 'human' && value.role !== 'agent')) return false;
  if (value.name !== undefined && typeof value.name !== 'string') return false;
  if (value.session !== undefined && typeof value.session !== 'string') return false;
  return true;
}

function validateOptionalString(record: Record<string, unknown>, key: string, issues: string[]): void {
  if (record[key] !== undefined && typeof record[key] !== 'string') {
    issues.push(`${key} must be a string`);
  }
}

function validateOptionalStringArray(record: Record<string, unknown>, key: string, issues: string[]): void {
  const value = record[key];
  if (value === undefined) return;
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || item.length === 0)) {
    issues.push(`${key} must be an array of non-empty strings`);
  }
}

function validateLifecycleMark(raw: unknown, index: number): string[] {
  if (!isRecord(raw)) {
    return [`lifecycle_marks[${index}] must be an object; received ${valueKind(raw)}`];
  }

  const issues: string[] = [];
  if (typeof raw.id !== 'string' || raw.id.length === 0) issues.push('id must be a non-empty string');
  if (typeof raw.type !== 'string' || !MARK_TYPES.has(raw.type)) issues.push('type is not recognized');
  if (typeof raw.reason !== 'string' || raw.reason.length === 0) issues.push('reason must be a non-empty string');
  if (!isIsoUtcDateTime(raw.createdAt)) issues.push('created_at must be an ISO-8601 UTC datetime');
  if (!isAuthor(raw.createdBy)) issues.push('created_by must identify a human or agent');

  if (raw.state !== undefined && (typeof raw.state !== 'string' || !MARK_STATES.has(raw.state))) {
    issues.push('state must be open or resolved');
  }
  if (raw.reviewAfter !== undefined && !normalizeIsoDay(raw.reviewAfter)) {
    issues.push('review_after must be a valid YYYY-MM-DD calendar date');
  }
  if (raw.expiresAt !== undefined && !normalizeIsoDay(raw.expiresAt)) {
    issues.push('expires_at must be a valid YYYY-MM-DD calendar date');
  }
  if (raw.temporalDependence !== undefined
      && (typeof raw.temporalDependence !== 'string' || !TEMPORAL_DEPENDENCIES.has(raw.temporalDependence))) {
    issues.push('temporal_dependence is not recognized');
  }
  if (raw.retrievalTreatment !== undefined
      && (typeof raw.retrievalTreatment !== 'string' || !RETRIEVAL_TREATMENTS.has(raw.retrievalTreatment))) {
    issues.push('retrieval_treatment is not recognized');
  }

  validateOptionalString(raw, 'temporalNote', issues);
  if (raw.resolvedAt !== undefined && !isIsoUtcDateTime(raw.resolvedAt)) {
    issues.push('resolved_at must be an ISO-8601 UTC datetime');
  }
  validateOptionalStringArray(raw, 'supersededBy', issues);
  validateOptionalStringArray(raw, 'sourceFiles', issues);
  return issues;
}

/** Local calendar day used by interactive CLI/MCP reads. */
export function currentLocalIsoDay(now: Date = new Date()): string {
  const year = String(now.getFullYear()).padStart(4, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Derive a lifecycle state without reading the clock or external state.
 *
 * Date semantics follow the design contract:
 * - dates must be exact YYYY-MM-DD calendar dates;
 * - reviewAfter is due on that date;
 * - expiresAt is expired after that date, not during it;
 * - an explicit resolved mark wins over stored dates.
 *
 * Event-, release-, and version-bound marks remain open until explicitly
 * resolved because CanopyTag has no external-state authority.
 */
export function deriveLifecycleState(
  mark: LifecycleMark,
  asOfDate: string,
): Exclude<LifecycleDerivedState, 'invalid'> {
  const asOf = normalizeIsoDay(asOfDate);
  if (!asOf) {
    throw new Error(`Invalid lifecycle as-of date: ${asOfDate}. Use YYYY-MM-DD.`);
  }

  if (mark.state === 'resolved') return 'resolved';

  if (mark.expiresAt !== undefined && !normalizeIsoDay(mark.expiresAt)) {
    throw new Error(`Invalid lifecycle expires_at: ${String(mark.expiresAt)}. Use YYYY-MM-DD.`);
  }
  if (mark.reviewAfter !== undefined && !normalizeIsoDay(mark.reviewAfter)) {
    throw new Error(`Invalid lifecycle review_after: ${String(mark.reviewAfter)}. Use YYYY-MM-DD.`);
  }

  if (mark.expiresAt && asOf > mark.expiresAt) return 'expired';
  if (mark.reviewAfter && asOf >= mark.reviewAfter) return 'due';
  return 'open';
}

/**
 * Tolerantly assess untrusted repo JSON. Invalid values remain untouched in
 * canopy.json and become visible findings instead of throwing from readers.
 */
export function assessLifecycleMarks(
  marks: unknown,
  asOfDate: string,
): LifecycleAssessment[] {
  if (marks === undefined) return [];
  if (!Array.isArray(marks)) {
    return [{
      raw: marks,
      state: 'invalid',
      issues: [`lifecycle_marks must be an array; received ${valueKind(marks)}`],
    }];
  }

  return marks.map((raw, index) => {
    const issues = validateLifecycleMark(raw, index);
    if (issues.length > 0) return { raw, state: 'invalid' as const, issues };

    const mark = raw as LifecycleMark;
    return {
      raw,
      mark,
      state: deriveLifecycleState(mark, asOfDate),
      issues: [],
    };
  });
}

export function lifecycleTypeLabel(type: LifecycleMark['type']): string {
  return type.replaceAll('_', ' ');
}

export function lifecycleStateLabel(state: LifecycleDerivedState): string {
  switch (state) {
    case 'due': return 'REVIEW DUE';
    case 'expired': return 'EXPIRED';
    case 'resolved': return 'RESOLVED';
    case 'invalid': return 'INVALID';
    default: return 'OPEN';
  }
}

export function describeLifecycleAssessment(assessment: LifecycleAssessment): string {
  const { mark, state } = assessment;
  if (state === 'invalid' || !mark) {
    const raw = isRecord(assessment.raw) ? assessment.raw : undefined;
    const id = typeof raw?.id === 'string' && raw.id.length > 0 ? ` [${raw.id}]` : '';
    return `INVALID lifecycle mark${id} - ${assessment.issues.join('; ')}`;
  }

  const details: string[] = [mark.reason];
  if (state === 'expired' && mark.expiresAt) {
    details.push(`expired after ${mark.expiresAt}`);
  } else if (state === 'due' && mark.reviewAfter) {
    details.push(`review due since ${mark.reviewAfter}`);
  } else if (state === 'open') {
    if (mark.reviewAfter) details.push(`review after ${mark.reviewAfter}`);
    if (mark.expiresAt) details.push(`expires after ${mark.expiresAt}`);
  }

  if (mark.temporalNote) details.push(mark.temporalNote);
  if (mark.supersededBy?.length) {
    details.push(`successor${mark.supersededBy.length === 1 ? '' : 's'}: ${mark.supersededBy.join(', ')}`);
  }

  return `${lifecycleStateLabel(state)} ${lifecycleTypeLabel(mark.type)} [${mark.id}] - ${details.join('; ')}`;
}
