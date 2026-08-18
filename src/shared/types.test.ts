import { describe, expect, it } from 'vitest';
import {
  UNATTRIBUTED_AGENT_NAME,
  checkFreshness,
  isUnattributedAgent,
  isUnattributedAgentName,
} from './types';

describe('checkFreshness', () => {
  it('returns null when no freshness signals exist', () => {
    expect(checkFreshness({})).toBeNull();
  });

  it('returns unknown when a file has not been reviewed yet', () => {
    expect(checkFreshness({ lastModified: '2026-04-20' })).toBe('unknown');
  });

  it('returns unknown when a review exists without modification evidence', () => {
    expect(checkFreshness({ lastReviewed: '2026-04-20' })).toBe('unknown');
  });

  it('returns fresh when review is at least as recent as the file change', () => {
    expect(checkFreshness({
      lastModified: '2026-04-20',
      lastReviewed: '2026-04-20',
    })).toBe('fresh');
  });

  it('returns review-drift when the file changed after the last review', () => {
    expect(checkFreshness({
      lastModified: '2026-04-20',
      lastReviewed: '2026-04-19',
    })).toBe('review-drift');
  });

  it('returns review-drift when a close related file changed after the last review', () => {
    expect(checkFreshness({
      lastReviewed: '2026-04-19',
      relatedModifiedDates: ['2026-04-18', '2026-04-20'],
    })).toBe('review-drift');
  });

  it('stays fresh when related-file changes are older than the last review', () => {
    expect(checkFreshness({
      lastReviewed: '2026-04-20',
      relatedModifiedDates: ['2026-04-18', '2026-04-19'],
    })).toBe('fresh');
  });
});

describe('isUnattributedAgentName', () => {
  it('treats absent or blank names as unattributed', () => {
    expect(isUnattributedAgentName(undefined)).toBe(true);
    expect(isUnattributedAgentName(null)).toBe(true);
    expect(isUnattributedAgentName('')).toBe(true);
    expect(isUnattributedAgentName('   ')).toBe(true);
  });

  it('treats role words as unattributed regardless of case or padding', () => {
    for (const word of ['agent', 'Agent', ' AGENT ', 'assistant', 'ai', 'bot', 'llm', 'unknown']) {
      expect(isUnattributedAgentName(word)).toBe(true);
    }
  });

  it('treats the explicit fallback marker as unattributed', () => {
    expect(isUnattributedAgentName(UNATTRIBUTED_AGENT_NAME)).toBe(true);
  });

  it('accepts real model identities', () => {
    for (const name of ['Claude Opus 5', 'ChatGPT 5.6 Sol', 'claude-opus', 'codex']) {
      expect(isUnattributedAgentName(name)).toBe(false);
    }
  });
});

describe('isUnattributedAgent', () => {
  it('ignores humans, whose attribution comes from the profile', () => {
    expect(isUnattributedAgent('human')).toBe(false);
    expect(isUnattributedAgent({ role: 'human' })).toBe(false);
    expect(isUnattributedAgent({ role: 'human', name: 'Jeff Ballard' })).toBe(false);
  });

  it('flags a legacy bare "agent" string author', () => {
    expect(isUnattributedAgent('agent')).toBe(true);
  });

  it('flags an agent signature whose name is a role word', () => {
    expect(isUnattributedAgent({ role: 'agent', name: 'agent' })).toBe(true);
  });

  it('accepts an agent signature carrying a model identity', () => {
    expect(isUnattributedAgent({ role: 'agent', name: 'Claude Opus 5' })).toBe(false);
  });

  it('treats an absent author as nothing to report', () => {
    expect(isUnattributedAgent(undefined)).toBe(false);
  });
});
