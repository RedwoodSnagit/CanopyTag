import { describe, it, expect } from 'vitest';
import { mergeFileRecord } from '../lib/merge';

describe('mergeFileRecord', () => {
  it('returns repo_index fields when no canopy', () => {
    const result = mergeFileRecord('test.py', {
      path: 'test.py', title: 'Test', kind: 'module', subsystem: 'core',
      summary: 'A test', status: 'active', tags: ['testing'],
      validity: 4, clarity: 5,
    }, undefined);
    expect(result.summary).toBe('A test');
    expect(result.validity).toBe(4);
    expect(result.todos).toEqual([]);
  });

  it('returns canopy fields when no repo_index', () => {
    const result = mergeFileRecord('new.py', undefined, {
      summary: 'Canopy summary', validity: 3, tags: ['tools'],
      todos: [{ id: 'RT-001', text: 'Do it', priority: 1, status: 'open', createdAt: '2026-01-01', createdBy: 'human' }],
    });
    expect(result.summary).toBe('Canopy summary');
    expect(result.validity).toBe(3);
    expect(result.openTodoCount).toBe(1);
  });

  it('canopy wins on shared fields, repo_index provides quality scores', () => {
    const result = mergeFileRecord('both.py', {
      path: 'both.py', title: 'Both', kind: 'module', subsystem: 'core',
      summary: 'Index summary', status: 'active', tags: ['testing'],
      validity: 4, clarity: 3,
    }, {
      summary: 'Canopy summary', tags: ['tools', 'testing'],
      status: 'draft',
    });
    expect(result.summary).toBe('Canopy summary');
    expect(result.status).toBe('draft');
    expect(result.tags).toEqual(['tools', 'testing']);
    expect(result.validity).toBe(4);
    expect(result.kind).toBe('module');
  });

  it('computes openTodoCount and highestPriority', () => {
    const result = mergeFileRecord('x.py', undefined, {
      todos: [
        { id: 'RT-001', text: 'A', priority: 3, status: 'open', createdAt: '', createdBy: 'human' },
        { id: 'RT-002', text: 'B', priority: 1, status: 'done', createdAt: '', createdBy: 'human' },
        { id: 'RT-003', text: 'C', priority: 2, status: 'open', createdAt: '', createdBy: 'agent' },
      ],
    });
    expect(result.openTodoCount).toBe(2);
    expect(result.highestPriority).toBe(2);
  });
});
