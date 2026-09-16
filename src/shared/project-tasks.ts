import type {
  Project,
  Task,
  TaskReadiness,
  TaskReadinessBlocker,
  TaskReadinessState,
  WorkClaim,
} from './types.js';

const DEPENDENCY_TYPES = new Set(['blocks', 'depends_on', 'parent_child', 'related']);

function normalizedPath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
}

function taskPathOverlapsClaim(taskPath: string, claim: WorkClaim['paths'][number]): boolean {
  const task = normalizedPath(taskPath);
  const claimed = normalizedPath(claim.path);
  if (task === claimed) return true;
  if (claim.kind === 'directory' && task.startsWith(`${claimed}/`)) return true;
  if (/[\\/]$/.test(taskPath) && claimed.startsWith(`${task}/`)) return true;
  return false;
}

function addBlocker(blockers: Map<string, TaskReadinessBlocker[]>, taskId: string, blocker: TaskReadinessBlocker): void {
  const current = blockers.get(taskId) ?? [];
  if (!current.some(candidate => (
    candidate.kind === blocker.kind
    && candidate.ref === blocker.ref
    && candidate.message === blocker.message
  ))) {
    current.push(blocker);
    blockers.set(taskId, current);
  }
}

function dependencyPrerequisites(tasks: Task[]): Map<string, string[]> {
  const taskIds = new Set(tasks.map(task => task.id));
  const prerequisites = new Map(tasks.map(task => [task.id, [] as string[]]));

  for (const task of tasks) {
    for (const dependency of task.dependencies ?? []) {
      if (!taskIds.has(dependency.taskId)) continue;
      if (dependency.type === 'depends_on') {
        prerequisites.get(task.id)?.push(dependency.taskId);
      } else if (dependency.type === 'blocks') {
        prerequisites.get(dependency.taskId)?.push(task.id);
      }
    }
  }
  return prerequisites;
}

function canonicalCycle(cycle: string[]): string[] {
  if (cycle.length < 2) return cycle;
  const rotations = cycle.map((_, index) => [...cycle.slice(index), ...cycle.slice(0, index)]);
  return rotations.sort((left, right) => left.join('\u0000').localeCompare(right.join('\u0000')))[0];
}

/** Return each blocking dependency cycle once, without adding the repeated closing node. */
export function findProjectTaskDependencyCycles(tasks: Task[]): string[][] {
  const prerequisites = dependencyPrerequisites(tasks);
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];
  const cycles = new Map<string, string[]>();

  const visit = (taskId: string) => {
    if (visited.has(taskId)) return;
    visiting.add(taskId);
    stack.push(taskId);

    for (const prerequisite of prerequisites.get(taskId) ?? []) {
      if (visiting.has(prerequisite)) {
        const start = stack.indexOf(prerequisite);
        const cycle = canonicalCycle(stack.slice(start));
        cycles.set(cycle.join('\u0000'), cycle);
      } else if (!visited.has(prerequisite)) {
        visit(prerequisite);
      }
    }

    stack.pop();
    visiting.delete(taskId);
    visited.add(taskId);
  };

  for (const taskId of prerequisites.keys()) visit(taskId);
  return [...cycles.values()].sort((left, right) => left.join('\u0000').localeCompare(right.join('\u0000')));
}

/**
 * Compute project-task availability from authored status/edges/decisions and
 * optional local active-work claims. No readiness state is persisted.
 */
export function resolveProjectTaskReadiness(
  project: Project,
  claims: WorkClaim[] = [],
  now = new Date(),
): TaskReadiness[] {
  const tasks = project.todos ?? [];
  const byId = new Map(tasks.map(task => [task.id, task]));
  const blockers = new Map<string, TaskReadinessBlocker[]>();

  for (const task of tasks) {
    for (const dependency of task.dependencies ?? []) {
      if (!DEPENDENCY_TYPES.has(dependency.type)) {
        addBlocker(blockers, task.id, {
          kind: 'invalid',
          ref: dependency.taskId,
          message: `Unknown dependency type ${String(dependency.type)}.`,
        });
        continue;
      }
      const related = byId.get(dependency.taskId);
      if (!related) {
        addBlocker(blockers, task.id, {
          kind: 'invalid',
          ref: dependency.taskId,
          message: `Dependency ${dependency.taskId} does not exist in project ${project.id}.`,
        });
        continue;
      }
      if (dependency.taskId === task.id) {
        addBlocker(blockers, task.id, {
          kind: 'invalid',
          ref: dependency.taskId,
          message: 'Task cannot depend on or block itself.',
        });
        continue;
      }

      if (dependency.type === 'depends_on' && related.status !== 'done') {
        addBlocker(blockers, task.id, {
          kind: 'dependency',
          ref: related.id,
          message: `Depends on ${related.id}, which is ${related.status}.`,
        });
      } else if (dependency.type === 'blocks' && task.status !== 'done') {
        addBlocker(blockers, related.id, {
          kind: 'dependency',
          ref: task.id,
          message: `Blocked by ${task.id}, which is ${task.status}.`,
        });
      }
    }

    for (const question of task.openQuestions ?? []) {
      addBlocker(blockers, task.id, {
        kind: 'decision',
        message: question,
      });
    }
  }

  for (const cycle of findProjectTaskDependencyCycles(tasks)) {
    const message = `Blocking dependency cycle: ${[...cycle, cycle[0]].join(' -> ')}.`;
    for (const taskId of cycle) addBlocker(blockers, taskId, { kind: 'invalid', message });
  }

  const activeClaims = claims.filter(claim => (
    claim.state === 'active' && new Date(claim.expiresAt).getTime() > now.getTime()
  ));

  return tasks.map(task => {
    const taskClaims = activeClaims.filter(claim => (
      (task.ownedPaths ?? []).some(taskPath => claim.paths.some(claimPath => taskPathOverlapsClaim(taskPath, claimPath)))
    ));
    for (const claim of taskClaims) {
      addBlocker(blockers, task.id, {
        kind: 'claim',
        ref: claim.id,
        message: `Claimed by ${claim.owner} until ${claim.expiresAt}.`,
      });
    }

    const taskBlockers = blockers.get(task.id) ?? [];
    let state: TaskReadinessState;
    if (task.status === 'done' || task.status === 'deferred' || task.status === 'in_progress') {
      state = task.status;
    } else if (taskBlockers.some(blocker => blocker.kind !== 'claim')) {
      state = 'blocked';
    } else if (taskClaims.length > 0) {
      state = 'claimed';
    } else {
      state = 'ready';
    }

    return {
      taskId: task.id,
      state,
      blockers: taskBlockers,
      claims: taskClaims.map(claim => ({
        id: claim.id,
        owner: claim.owner,
        ...(claim.session ? { session: claim.session } : {}),
        summary: claim.summary,
        expiresAt: claim.expiresAt,
      })),
    };
  });
}

export function countTaskReadiness(readiness: TaskReadiness[]): {
  ready: number;
  blocked: number;
  claimed: number;
} {
  return {
    ready: readiness.filter(item => item.state === 'ready').length,
    blocked: readiness.filter(item => item.state === 'blocked').length,
    claimed: readiness.filter(item => item.state === 'claimed').length,
  };
}
