import { describe, expect, it } from 'vitest';
import type { Canopy } from '../../shared/types.js';
import { inspectCanopyDoctor, renderDoctorText, selectRepresentativeIssues } from '../doctor.js';

function makeCanopy(overrides: Partial<Canopy> = {}): Canopy {
  return {
    version: 1,
    repoRoot: '',
    lastModifiedAt: '2026-08-01T00:00:00Z',
    files: {},
    features: {},
    ...overrides,
  };
}

describe('inspectCanopyDoctor', () => {
  it('returns a clean report when deterministic evidence agrees', () => {
    const canopy = makeCanopy({
      files: {
        'src/app.ts': {
          lastReviewed: '2026-08-01',
          relatedFiles: ['docs/app.md'],
          todos: [{
            id: 'RT-001',
            text: 'Example',
            priority: 3,
            status: 'open',
            createdAt: '2026-08-01T00:00:00Z',
            createdBy: 'human',
          }],
        },
      },
      features: {
        app: { name: 'App', canonicalFile: 'src/app.ts' },
      },
    });
    const report = inspectCanopyDoctor(canopy, {
      repoFiles: new Set(['src/app.ts', 'docs/app.md']),
      gitDates: new Map([
        ['src/app.ts', '2026-08-01T00:00:00Z'],
        ['docs/app.md', '2026-08-01T00:00:00Z'],
      ]),
    });

    expect(report.ok).toBe(true);
    expect(report.strictOk).toBe(true);
    expect(report.counts).toEqual({ errors: 0, warnings: 0, info: 0 });
    expect(renderDoctorText(report)).toContain('No deterministic maintenance findings');
  });

  it('finds unsafe paths, missing targets, duplicate IDs, drift, and pending review', () => {
    const sharedTodo = {
      id: 'RT-007',
      text: 'Collision',
      priority: 2 as const,
      status: 'open' as const,
      createdAt: '2026-07-01T00:00:00Z',
      createdBy: 'agent' as const,
    };
    const canopy = makeCanopy({
      repoRoot: 'C:\\private\\repo',
      files: {
        'src/app.ts': {
          lastReviewed: '2026-07-01',
          relatedFiles: ['docs/missing.md', '../secret.txt'],
          todos: [sharedTodo],
          comments: [{ id: 'RC-002', text: 'One', author: 'agent', createdAt: '2026-07-01T00:00:00Z' }],
        },
        'gone.ts': {
          todos: [sharedTodo],
          comments: [{ id: 'RC-002', text: 'Two', author: 'human', createdAt: '2026-07-01T00:00:00Z' }],
        },
        'C:\\outside.ts': {},
      },
      features: {
        missing: { name: 'Missing', canonicalFile: 'docs/nope.md' },
      },
    });
    const report = inspectCanopyDoctor(canopy, {
      repoFiles: new Set(['src/app.ts']),
      gitDates: new Map([['src/app.ts', '2026-07-02T00:00:00Z']]),
      pendingAgentReviews: 2,
    });
    const codes = report.issues.map(issue => issue.code);

    expect(report.ok).toBe(false);
    expect(report.strictOk).toBe(false);
    expect(codes).toContain('unsafe-annotation-path');
    expect(codes).toContain('unsafe-related-path');
    expect(codes).toContain('missing-related-file');
    expect(codes).toContain('orphaned-annotation');
    expect(codes).toContain('missing-canonical-file');
    expect(codes).toContain('duplicate-todo-id');
    expect(codes).toContain('duplicate-comment-id');
    expect(codes).toContain('review-drift');
    expect(codes).toContain('pending-agent-review');
    expect(codes).toContain('persisted-repo-root');
  });

  it('bounds returned findings while preserving complete counts', () => {
    const files = Object.fromEntries(
      Array.from({ length: 8 }, (_, index) => [`gone-${index}.ts`, {}]),
    );
    const report = inspectCanopyDoctor(makeCanopy({ files }), {
      repoFiles: new Set(),
      issueLimit: 3,
    });

    expect(report.issues).toHaveLength(3);
    expect(report.counts.warnings).toBe(8);
    expect(report.omittedIssues).toBe(5);
    expect(renderDoctorText(report)).toContain('5 of 8 findings not shown');
    expect(report.countsByCode['orphaned-annotation']).toBe(8);
  });

  it('distinguishes directories, untracked files, and deleted orphans', () => {
    const report = inspectCanopyDoctor(makeCanopy({
      files: { 'src/feature': {}, 'draft.md': {}, 'deleted.md': {} },
    }), {
      repoFiles: new Set(),
      pathKind: filePath => filePath === 'src/feature'
        ? 'directory'
        : filePath === 'draft.md' ? 'file' : undefined,
      pathExists: filePath => filePath === 'src/feature' || filePath === 'draft.md',
    });

    expect(report.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'directory-annotation', path: 'src/feature' }),
      expect.objectContaining({ code: 'untracked-annotation', path: 'draft.md' }),
      expect.objectContaining({ code: 'orphaned-annotation', path: 'deleted.md' }),
    ]));
  });

  it('keeps portable legacy repo_root metadata informational', () => {
    const report = inspectCanopyDoctor(makeCanopy({ repoRoot: '.' }), {
      repoFiles: new Set(),
    });

    expect(report.ok).toBe(true);
    expect(report.strictOk).toBe(true);
    expect(report.counts.info).toBe(1);
  });

  it('reports malformed nested metadata instead of crashing', () => {
    const canopy = makeCanopy({
      repoRoot: 17 as any,
      files: {
        'bad-card.ts': null as any,
        'src/app.ts': {
          relatedFiles: [17 as any, { path: 'docs/app.md' }],
          lastReviewed: 42 as any,
          todos: {} as any,
          comments: 'nope' as any,
        },
      },
      features: {
        broken: 42 as any,
        typedWrong: { name: 'Wrong', canonicalFile: 17 as any },
      },
    });

    const report = inspectCanopyDoctor(canopy, {
      repoFiles: new Set(['bad-card.ts', 'src/app.ts', 'docs/app.md']),
      manifestError: 'entries must be an array',
    });
    const codes = report.issues.map(issue => issue.code);

    expect(report.ok).toBe(false);
    expect(codes).toEqual(expect.arrayContaining([
      'invalid-repo-root',
      'invalid-file-card',
      'invalid-related-entry',
      'invalid-last-reviewed',
      'invalid-todos',
      'invalid-comments',
      'invalid-feature-card',
      'invalid-canonical-file',
      'invalid-agent-manifest',
    ]));
  });
});

describe('inspectCanopyDoctor — agent attribution', () => {
  it('flags agent records that carry no model identity', () => {
    const canopy = makeCanopy({
      files: {
        'src/app.ts': {
          todos: [{
            id: 'RT-001',
            text: 'Example',
            priority: 3,
            status: 'open',
            createdAt: '2026-08-01T00:00:00Z',
            createdBy: { role: 'agent', name: 'agent' },
          }],
          comments: [{
            text: 'Observation',
            author: { role: 'agent', name: 'unattributed' },
            createdAt: '2026-08-01T00:00:00Z',
          }],
        },
      },
    });

    const report = inspectCanopyDoctor(canopy, { repoFiles: new Set(['src/app.ts']) });
    const issue = report.issues.find(i => i.code === 'unattributed-agent');

    expect(issue).toBeDefined();
    expect(issue!.severity).toBe('warning');
    expect(issue!.message).toContain('2 agent-authored record(s)');
    expect(issue!.message).toContain('src/app.ts');
    expect(issue!.suggestion).toContain('agent_name');
  });

  it('stays silent when agents record a real model identity', () => {
    const canopy = makeCanopy({
      files: {
        'src/app.ts': {
          todos: [{
            id: 'RT-001',
            text: 'Example',
            priority: 3,
            status: 'open',
            createdAt: '2026-08-01T00:00:00Z',
            createdBy: { role: 'agent', name: 'Claude Opus 5' },
          }],
        },
      },
    });

    const report = inspectCanopyDoctor(canopy, { repoFiles: new Set(['src/app.ts']) });
    expect(report.issues.find(i => i.code === 'unattributed-agent')).toBeUndefined();
  });

  it('does not flag human authors, who are attributed via the profile', () => {
    const canopy = makeCanopy({
      files: {
        'src/app.ts': {
          todos: [{
            id: 'RT-001',
            text: 'Example',
            priority: 3,
            status: 'open',
            createdAt: '2026-08-01T00:00:00Z',
            createdBy: 'human',
          }],
        },
      },
    });

    const report = inspectCanopyDoctor(canopy, { repoFiles: new Set(['src/app.ts']) });
    expect(report.issues.find(i => i.code === 'unattributed-agent')).toBeUndefined();
  });

  it('aggregates rather than emitting one finding per record', () => {
    const files: Record<string, any> = {};
    for (let i = 0; i < 40; i += 1) {
      files[`src/f${i}.ts`] = {
        todos: [{
          id: `RT-${i}`,
          text: 'Example',
          priority: 3,
          status: 'open',
          createdAt: '2026-08-01T00:00:00Z',
          createdBy: { role: 'agent', name: 'agent' },
        }],
      };
    }

    const report = inspectCanopyDoctor(makeCanopy({ files }), {
      repoFiles: new Set(Object.keys(files)),
    });
    const matching = report.issues.filter(i => i.code === 'unattributed-agent');

    expect(matching).toHaveLength(1);
    expect(matching[0].message).toContain('40 agent-authored record(s)');
    expect(matching[0].message).toContain('+37 more');
  });
});

describe('selectRepresentativeIssues', () => {
  const issue = (code: string, path: string) => ({
    severity: 'warning' as const, code, path, message: `${code} ${path}`,
  });

  it('returns everything when under the limit', () => {
    const issues = [issue('a', '1'), issue('b', '2')];
    expect(selectRepresentativeIssues(issues, 50)).toHaveLength(2);
  });

  it('keeps at least one example of every code when truncating', () => {
    // 40 of one code sorted ahead of a single instance of another: a flat
    // slice at limit 5 would drop the rare code entirely.
    const issues = [
      ...Array.from({ length: 40 }, (_, i) => issue('review-drift', `f${i}.ts`)),
      issue('unattributed-agent', 'repo'),
    ];

    const selected = selectRepresentativeIssues(issues, 5);

    expect(selected).toHaveLength(5);
    expect(selected.map(i => i.code)).toContain('unattributed-agent');
  });

  it('spends leftover budget in sort order', () => {
    const issues = [
      issue('a', '1'), issue('a', '2'), issue('a', '3'), issue('b', '9'),
    ];
    const selected = selectRepresentativeIssues(issues, 3);

    expect(selected.map(i => i.path)).toEqual(['1', '2', '9']);
  });

  it('degrades predictably when codes outnumber the limit', () => {
    const issues = ['a', 'b', 'c', 'd'].map(code => issue(code, code));
    const selected = selectRepresentativeIssues(issues, 2);

    expect(selected.map(i => i.code)).toEqual(['a', 'b']);
  });
});

describe('doctor limit reporting', () => {
  function noisyCanopy(driftCount: number) {
    const files: Record<string, any> = {};
    for (let i = 0; i < driftCount; i += 1) {
      files[`src/f${i}.ts`] = {
        todos: [{
          id: `RT-${i}`,
          text: 'Example',
          priority: 3,
          status: 'open',
          createdAt: '2026-08-01T00:00:00Z',
          createdBy: { role: 'agent', name: 'agent' },
        }],
      };
    }
    return makeCanopy({ files });
  }

  it('reports full per-code counts even when truncating', () => {
    const canopy = noisyCanopy(60);
    const report = inspectCanopyDoctor(canopy, {
      repoFiles: new Set(),
      issueLimit: 5,
    });

    expect(report.totalIssues).toBeGreaterThan(5);
    expect(report.issues).toHaveLength(5);
    expect(report.countsByCode['unattributed-agent']).toBe(1);
    // Counts are pre-truncation, so they exceed what was rendered.
    const summed = Object.values(report.countsByCode).reduce((a, b) => a + b, 0);
    expect(summed).toBe(report.totalIssues);
  });

  it('names the exact limit that would show everything', () => {
    const report = inspectCanopyDoctor(noisyCanopy(60), {
      repoFiles: new Set(),
      issueLimit: 5,
    });
    const text = renderDoctorText(report);

    expect(text).toContain(`Use --limit ${report.totalIssues}`);
    expect(text).toContain('At least one of every type appears above.');
    expect(text).toContain('All types:');
  });

  it('keeps the rare finding visible in rendered output', () => {
    const report = inspectCanopyDoctor(noisyCanopy(60), {
      repoFiles: new Set(),
      issueLimit: 5,
    });

    expect(renderDoctorText(report)).toContain('unattributed-agent');
  });
});
