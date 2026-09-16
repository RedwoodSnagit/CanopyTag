import { describe, expect, it } from 'vitest';
import type { Project, Task, WorkClaim } from './types.js';
import {
  countTaskReadiness,
  findProjectTaskDependencyCycles,
  resolveProjectTaskReadiness,
} from './project-tasks.js';

const baseTask = (id: string, status: Task['status'] = 'open'): Task => ({
  id,
  text: `Task ${id}`,
  priority: 2,
  status,
  createdAt: '2026-08-21T00:00:00Z',
  createdBy: { role: 'human', name: 'Owner' },
});

const project = (todos: Task[]): Project => ({
  id: 'PRJ-001',
  name: 'Execution packet',
  status: 'active',
  todos,
  createdAt: '2026-08-21T00:00:00Z',
  createdBy: { role: 'human', name: 'Owner' },
});

describe('project task readiness', () => {
  it('computes required dependency order while leaving relational edges non-blocking', () => {
    const tasks = [
      baseTask('RT-001', 'done'),
      {
        ...baseTask('RT-002'),
        dependencies: [
          { type: 'depends_on' as const, taskId: 'RT-001' },
          { type: 'related' as const, taskId: 'RT-003' },
        ],
      },
      {
        ...baseTask('RT-003'),
        dependencies: [{ type: 'depends_on' as const, taskId: 'RT-002' }],
      },
    ];

    const readiness = resolveProjectTaskReadiness(project(tasks));

    expect(readiness).toEqual(expect.arrayContaining([
      expect.objectContaining({ taskId: 'RT-001', state: 'done' }),
      expect.objectContaining({ taskId: 'RT-002', state: 'ready' }),
      expect.objectContaining({ taskId: 'RT-003', state: 'blocked' }),
    ]));
    expect(countTaskReadiness(readiness)).toEqual({ ready: 1, blocked: 1, claimed: 0 });
  });

  it('interprets blocks in the declared direction and surfaces missing decisions', () => {
    const tasks = [
      { ...baseTask('RT-001'), dependencies: [{ type: 'blocks' as const, taskId: 'RT-002' }] },
      { ...baseTask('RT-002'), openQuestions: ['Which contract is authoritative?'] },
    ];

    const readiness = resolveProjectTaskReadiness(project(tasks));
    const target = readiness.find(item => item.taskId === 'RT-002');

    expect(target).toMatchObject({ state: 'blocked' });
    expect(target?.blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'dependency', ref: 'RT-001' }),
      expect.objectContaining({ kind: 'decision', message: 'Which contract is authoritative?' }),
    ]));
  });

  it('derives claimed state from live path overlap without persisting it', () => {
    const task = { ...baseTask('RT-001'), ownedPaths: ['src/shared/types.ts'] };
    const claim: WorkClaim = {
      id: 'AW-001',
      paths: [{ path: 'src/shared', kind: 'directory' }],
      owner: 'Other Agent',
      summary: 'Schema work',
      exclusive: true,
      state: 'active',
      createdAt: '2026-08-21T00:00:00Z',
      updatedAt: '2026-08-21T00:00:00Z',
      expiresAt: '2026-08-22T00:00:00Z',
    };

    const [readiness] = resolveProjectTaskReadiness(
      project([task]),
      [claim],
      new Date('2026-08-21T12:00:00Z'),
    );

    expect(readiness).toMatchObject({
      state: 'claimed',
      claims: [expect.objectContaining({ id: 'AW-001', owner: 'Other Agent' })],
    });
    expect(task).not.toHaveProperty('readiness');
  });

  it('blocks malformed references and every member of a blocking cycle', () => {
    const tasks = [
      { ...baseTask('RT-001'), dependencies: [{ type: 'depends_on' as const, taskId: 'RT-002' }] },
      { ...baseTask('RT-002'), dependencies: [{ type: 'depends_on' as const, taskId: 'RT-001' }] },
      { ...baseTask('RT-003'), dependencies: [{ type: 'depends_on' as const, taskId: 'RT-999' }] },
    ];

    expect(findProjectTaskDependencyCycles(tasks)).toEqual([['RT-001', 'RT-002']]);
    const readiness = resolveProjectTaskReadiness(project(tasks));
    expect(readiness.every(item => item.state === 'blocked')).toBe(true);
    expect(readiness.find(item => item.taskId === 'RT-003')?.blockers[0]).toMatchObject({
      kind: 'invalid',
      ref: 'RT-999',
    });
  });
});
