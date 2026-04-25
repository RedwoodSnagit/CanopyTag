import { describe, it, expect } from 'vitest';
import { collectTodos } from '../todos';
import { filterFiles } from '../shared';
import type { Canopy } from '../../shared/types';

const TEST_CANOPY: Canopy = {
  version: 1,
  repoRoot: '.',
  lastModifiedAt: '2026-03-27T12:00:00Z',
  files: {
    'src/main.ts': {
      featureId: 'core',
      authorityLevel: 'specification',
      tags: ['core'],
      todos: [
        {
          id: 'RT-001',
          text: 'Add error handling',
          priority: 1,
          difficulty: 3,
          status: 'open',
          tags: ['reliability'],
          createdAt: '2026-03-20T10:00:00Z',
          createdBy: { role: 'human', name: 'jeff' },
        },
        {
          id: 'RT-002',
          text: 'Done task',
          priority: 3,
          status: 'done',
          tags: [],
          createdAt: '2026-03-19T10:00:00Z',
          completedAt: '2026-03-21T10:00:00Z',
          createdBy: { role: 'agent', name: 'claude' },
        },
      ],
    },
    'src/utils.ts': {
      featureId: 'core',
      tags: ['utilities'],
      todos: [
        {
          id: 'RT-003',
          text: 'Refactor validation',
          priority: 3,
          difficulty: 2,
          status: 'open',
          tags: ['refactor'],
          createdAt: '2026-03-21T10:00:00Z',
          createdBy: { role: 'agent', name: 'claude' },
        },
      ],
    },
    'docs/readme.md': {
      featureId: 'docs',
      tags: ['docs'],
      todos: [
        {
          id: 'RT-004',
          text: 'Update install instructions',
          priority: 2,
          difficulty: 1,
          status: 'in_progress',
          tags: ['docs', 'release-blocker'],
          createdAt: '2026-03-22T10:00:00Z',
          createdBy: { role: 'human', name: 'jeff' },
        },
      ],
    },
    'src/config.ts': {
      tags: ['config'],
    },
  },
  features: {
    core: { name: 'Core Engine' },
    docs: { name: 'Documentation' },
  },
};

describe('collectTodos', () => {
  it('collects all open/in_progress TODOs by default', () => {
    const rows = collectTodos(TEST_CANOPY);
    expect(rows).toHaveLength(3);
    expect(rows.map(r => r.id).sort()).toEqual(['RT-001', 'RT-003', 'RT-004']);
  });

  it('sorts by priority ascending (P1 first)', () => {
    const rows = collectTodos(TEST_CANOPY);
    expect(rows[0].id).toBe('RT-001');  // P1
    expect(rows[1].id).toBe('RT-004');  // P2
    expect(rows[2].id).toBe('RT-003');  // P3
  });

  it('filters by --tag (matches TODO tags)', () => {
    const rows = collectTodos(TEST_CANOPY, { tag: 'reliability' });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('RT-001');
  });

  it('filters by --tag (matches file tags too)', () => {
    const rows = collectTodos(TEST_CANOPY, { tag: 'docs' });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('RT-004');
  });

  it('filters by --feature (via filterFiles upstream)', () => {
    const fileEntries = filterFiles(Object.entries(TEST_CANOPY.files), { feature: 'docs' });
    const rows = collectTodos(TEST_CANOPY, {}, fileEntries);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('RT-004');
  });

  it('filters by --priority (max priority)', () => {
    const rows = collectTodos(TEST_CANOPY, { maxPriority: 2 });
    expect(rows).toHaveLength(2);
    expect(rows.map(r => r.id)).toEqual(['RT-001', 'RT-004']);
  });

  it('--all includes done/deferred TODOs', () => {
    const rows = collectTodos(TEST_CANOPY, { all: true });
    expect(rows).toHaveLength(4);
    expect(rows.map(r => r.id)).toContain('RT-002');
  });

  it('includes file path and feature in each row', () => {
    const rows = collectTodos(TEST_CANOPY);
    const r1 = rows.find(r => r.id === 'RT-001')!;
    expect(r1.file).toBe('src/main.ts');
    expect(r1.feature).toBe('core');
  });

  it('formats createdBy for structured authors', () => {
    const rows = collectTodos(TEST_CANOPY);
    const r1 = rows.find(r => r.id === 'RT-001')!;
    expect(r1.createdBy).toBe('human:jeff');
    const r3 = rows.find(r => r.id === 'RT-003')!;
    expect(r3.createdBy).toBe('agent:claude');
  });
});
