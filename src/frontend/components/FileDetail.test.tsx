import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { MergedFileRecord } from '../../shared/types';
import { ProjectBacklinks } from './FileDetail';

describe('ProjectBacklinks', () => {
  it('shows linked project context and inherited tasks as read-only', () => {
    const file: MergedFileRecord = {
      path: 'src/unannotated.ts',
      extension: '.ts',
      tags: [],
      todos: [],
      comments: [],
      relatedFiles: [],
      openTodoCount: 0,
      projects: [{
        id: 'PRJ-001',
        name: 'Project context',
        description: 'Why this file is implicated.',
        status: 'active',
        todos: [{
          id: 'RT-013',
          text: 'Expose the inherited project task.',
          priority: 1,
          status: 'open',
          createdAt: '2026-08-20T00:00:00Z',
          createdBy: { role: 'human', name: 'Owner' },
        }],
      }],
    };

    const html = renderToStaticMarkup(<ProjectBacklinks file={file} />);

    expect(html).toContain('Implicated in');
    expect(html).toContain('PRJ-001');
    expect(html).toContain('Why this file is implicated.');
    expect(html).toContain('Inherited project TODOs · read-only');
    expect(html).toContain('Expose the inherited project task.');
  });
});
