import type { FastifyInstance, FastifyReply } from 'fastify';
import { readActiveWork, resolveActiveWorkPath } from '../lib/active-work';
import { readAgentManifest, resolveAgentManifestPath } from '../lib/agent-manifest';
import { writeCanopy } from '../lib/canopy';
import { mergeFileRecord } from '../lib/merge';
import { countTaskReadiness, resolveProjectTaskReadiness } from '../../shared/project-tasks';
import type {
  Canopy,
  Project,
  ProjectDetail,
  ProjectStatus,
  ProjectSummary,
  WorkClaim,
} from '../../shared/types';

interface ProjectUpdateBody {
  project: string;
  name?: string;
  description?: string;
  status?: ProjectStatus;
  featureIds?: string[];
  files?: string[];
  openQuestions?: string[];
  expectedFiles?: string[];
  expectedFeatureIds?: string[];
}

const PROJECT_STATUS_RANK: Record<ProjectStatus, number> = {
  active: 0,
  paused: 1,
  done: 2,
};

function openTodoCount(project: Project): number {
  return (project.todos ?? []).filter(todo => todo.status === 'open' || todo.status === 'in_progress').length;
}

function findProject(canopy: Canopy, ref: string): [string, Project] | undefined {
  return Object.entries(canopy.projects ?? {}).find(([key, project]) =>
    key === ref || project.id === ref || project.name.toLowerCase() === ref.toLowerCase()
  );
}

function cleanStringList(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new Error(`${field} must be an array of strings.`);
  }
  return [...new Set(value.map(item => item.trim()).filter(Boolean))];
}

function arraysEqual(left: string[] | undefined, right: string[] | undefined): boolean {
  const a = left ?? [];
  const b = right ?? [];
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function sendError(reply: FastifyReply, status: number, error: string) {
  return reply.status(status).send({ error });
}

export function collectProjectSummaries(canopy: Canopy, claims: WorkClaim[] = []): ProjectSummary[] {
  return Object.values(canopy.projects ?? {})
    .map(project => {
      const readiness = countTaskReadiness(resolveProjectTaskReadiness(project, claims));
      return {
        project,
        fileCount: project.files?.length ?? 0,
        todoCount: project.todos?.length ?? 0,
        openTodoCount: openTodoCount(project),
        readyTaskCount: readiness.ready,
        blockedTaskCount: readiness.blocked,
        claimedTaskCount: readiness.claimed,
        milestoneCount: project.milestones?.length ?? 0,
      };
    })
    .sort((a, b) =>
      PROJECT_STATUS_RANK[a.project.status] - PROJECT_STATUS_RANK[b.project.status]
      || a.project.id.localeCompare(b.project.id)
    );
}

export function buildProjectDetail(app: FastifyInstance, projectKey: string, project: Project): ProjectDetail {
  const { canopy, repoIndex, repoRoot } = app.serverState;
  const claims = readActiveWork(resolveActiveWorkPath(repoRoot)).claims;
  const files = (project.files ?? []).map(filePath => ({
    path: filePath,
    annotated: canopy.files[filePath] !== undefined,
    record: mergeFileRecord(filePath, repoIndex.get(filePath), canopy.files[filePath], canopy.projects),
  }));
  const features = (project.featureIds ?? []).map(id => ({ id, feature: canopy.features[id] }));
  const recentActivity = readAgentManifest(resolveAgentManifestPath(repoRoot)).entries
    .filter(entry => entry.projectId === projectKey || entry.projectId === project.id)
    .slice(-5)
    .reverse();

  return {
    project,
    files,
    features,
    recentActivity,
    openTodoCount: openTodoCount(project),
    taskReadiness: resolveProjectTaskReadiness(project, claims),
  };
}

export async function projectsRoutes(app: FastifyInstance) {
  app.get('/api/projects', async () => {
    const { canopy, repoRoot } = app.serverState;
    return collectProjectSummaries(canopy, readActiveWork(resolveActiveWorkPath(repoRoot)).claims);
  });

  app.get<{ Querystring: { project: string } }>('/api/project', async (request, reply) => {
    const ref = request.query.project?.trim();
    if (!ref) return sendError(reply, 400, 'Missing project query parameter.');

    const match = findProject(app.serverState.canopy, ref);
    if (!match) return sendError(reply, 404, `Project not found: ${ref}`);
    return buildProjectDetail(app, match[0], match[1]);
  });

  app.post<{ Body: ProjectUpdateBody }>('/api/project', async (request, reply) => {
    const ref = request.body.project?.trim();
    if (!ref) return sendError(reply, 400, 'Missing required field: project.');

    const { canopy, canopyPath } = app.serverState;
    const match = findProject(canopy, ref);
    if (!match) return sendError(reply, 404, `Project not found: ${ref}`);
    const [projectKey, project] = match;

    if (request.body.files !== undefined && request.body.expectedFiles === undefined) {
      return sendError(reply, 400, 'expectedFiles is required when replacing project files.');
    }
    if (request.body.featureIds !== undefined && request.body.expectedFeatureIds === undefined) {
      return sendError(reply, 400, 'expectedFeatureIds is required when replacing project features.');
    }
    if (request.body.expectedFiles !== undefined
      && !arraysEqual(project.files, request.body.expectedFiles)) {
      return sendError(reply, 409, 'Project files changed since this detail view was loaded. Refresh before saving.');
    }
    if (request.body.expectedFeatureIds !== undefined
      && !arraysEqual(project.featureIds, request.body.expectedFeatureIds)) {
      return sendError(reply, 409, 'Project features changed since this detail view was loaded. Refresh before saving.');
    }

    let changed = false;
    if (request.body.name !== undefined) {
      const name = request.body.name.trim();
      if (!name) return sendError(reply, 400, 'Project name cannot be empty.');
      const duplicate = Object.entries(canopy.projects ?? {}).some(([key, candidate]) =>
        key !== projectKey && candidate.name.toLowerCase() === name.toLowerCase()
      );
      if (duplicate) return sendError(reply, 409, `Project name already exists: ${name}`);
      if (project.name !== name) {
        project.name = name;
        changed = true;
      }
    }

    if (request.body.description !== undefined) {
      const description = request.body.description.trim() || undefined;
      if (project.description !== description) {
        project.description = description;
        changed = true;
      }
    }

    if (request.body.status !== undefined) {
      if (!['active', 'paused', 'done'].includes(request.body.status)) {
        return sendError(reply, 400, 'Project status must be active, paused, or done.');
      }
      if (project.status !== request.body.status) {
        project.status = request.body.status;
        project.completedAt = request.body.status === 'done' ? new Date().toISOString() : undefined;
        changed = true;
      }
    }

    try {
      for (const [bodyField, projectField] of [
        ['featureIds', 'featureIds'],
        ['files', 'files'],
        ['openQuestions', 'openQuestions'],
      ] as const) {
        if (request.body[bodyField] === undefined) continue;
        const values = cleanStringList(request.body[bodyField], bodyField);
        if (!arraysEqual(project[projectField], values)) {
          project[projectField] = values.length > 0 ? values : undefined;
          changed = true;
        }
      }
    } catch (error: any) {
      return sendError(reply, 400, error.message);
    }

    if (changed) writeCanopy(canopyPath, canopy);
    return buildProjectDetail(app, projectKey, project);
  });
}
