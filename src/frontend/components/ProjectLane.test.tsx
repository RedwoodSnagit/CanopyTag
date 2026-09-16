import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ProjectSummary, Task } from '../../shared/types';
import { filterProjectSummaries, ProjectLane, projectTaskCompletionLabel, ProjectTaskList, removedValues } from './ProjectLane';

function summary(id: string, status: ProjectSummary['project']['status']): ProjectSummary {
  return {
    project: {
      id,
      name: `${status} project`,
      description: `Description for ${status}`,
      status,
      files: [`src/${status}.ts`],
      todos: [{
        id: `RT-${id.slice(-3)}`,
        text: `${status} task`,
        priority: 1,
        status: 'open',
        createdAt: '2026-08-20T00:00:00Z',
        createdBy: { role: 'human', name: 'Owner' },
      }],
      createdAt: '2026-08-20T00:00:00Z',
      createdBy: { role: 'human', name: 'Owner' },
    },
    fileCount: 1,
    todoCount: 1,
    openTodoCount: 1,
    readyTaskCount: status === 'done' ? 0 : 1,
    blockedTaskCount: 0,
    claimedTaskCount: 0,
    milestoneCount: 0,
  };
}

describe('ProjectLane helpers', () => {
  const projects = [summary('PRJ-001', 'active'), summary('PRJ-002', 'paused'), summary('PRJ-003', 'done')];

  it('matches CLI current-project semantics while retaining completed history as a filter', () => {
    expect(filterProjectSummaries(projects, 'current', '')).toHaveLength(2);
    expect(filterProjectSummaries(projects, 'done', '')[0].project.id).toBe('PRJ-003');
    expect(filterProjectSummaries(projects, 'all', 'src/paused')).toEqual([projects[1]]);
  });

  it('detects only removed relationships for the confirmation gate', () => {
    expect(removedValues(['a', 'b', 'c'], ['b', 'c', 'd'])).toEqual(['a']);
    expect(removedValues(undefined, ['a'])).toEqual([]);
  });

  it('renders current counts and a visible Projects lane list', () => {
    const html = renderToStaticMarkup(
      <ProjectLane
        projects={projects}
        activeProjectId={null}
        onSelectProject={() => {}}
        onOpenGraph={() => {}}
        onOpenFile={() => {}}
        onProjectsChanged={async () => {}}
      />,
    );

    expect(html).toContain('Current 2');
    expect(html).toContain('Active 1');
    expect(html).toContain('Paused 1');
    expect(html).toContain('active project');
    expect(html).toContain('paused project');
    expect(html).not.toContain('done project');
  });

  it('makes an active project with no open recorded work visibly await a human decision', () => {
    const project = summary('PRJ-004', 'active').project;
    expect(projectTaskCompletionLabel(project, 0)).toBe('All recorded tasks complete · awaiting next decision');
    expect(projectTaskCompletionLabel(project, 1)).toBeNull();
    expect(projectTaskCompletionLabel({ ...project, status: 'done' }, 1)).toBe('Project complete');
  });

  it('renders compact rich task packets with readiness, resources, and receipts', () => {
    const task: Task = {
      id: 'RT-015',
      text: 'Freeze the project task contract.',
      priority: 2,
      status: 'done',
      whyNow: 'Fresh agents need an accountable handoff.',
      milestoneId: 'MS-001',
      dependencies: [{ type: 'depends_on', taskId: 'RT-014' }],
      ownedPaths: ['src/shared/types.ts'],
      excludedPaths: ['src/frontend/components/GraphView.tsx'],
      resources: [{ kind: 'documentation', role: 'governs', ref: 'docs/design/project-layer.md' }],
      acceptance: ['Readiness is computed rather than persisted.'],
      receipts: [{
        id: 'AR-001', kind: 'validation', outcome: 'passed', summary: 'Full suite passed.',
        actor: { role: 'agent', name: 'Test Agent' }, recordedAt: '2026-08-21T00:00:00Z',
      }],
      createdAt: '2026-08-21T00:00:00Z',
      completedAt: '2026-08-21T01:00:00Z',
      createdBy: { role: 'human', name: 'Owner' },
    };
    const html = renderToStaticMarkup(<ProjectTaskList
      tasks={[task]}
      readiness={[{ taskId: task.id, state: 'done', blockers: [], claims: [] }]}
    />);

    expect(html).toContain('Execution packet');
    expect(html).toContain('Fresh agents need an accountable handoff.');
    expect(html).toContain('docs/design/project-layer.md');
    expect(html).toContain('AR-001');
    expect(html).toContain('GraphView.tsx');
  });
});
