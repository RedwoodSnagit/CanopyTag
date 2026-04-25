import type {
  AgentManifestEntry,
  AgentReviewAction,
  Author,
  CanopyProfile,
  CanopyAnalytics,
  Comment,
  Feature,
  MergedFileRecord,
  Todo,
  TreeNode,
} from '../../shared/types';

const BASE = '/api';

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
  return res.json();
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
  return res.json();
}

async function del<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
  return res.json();
}

export const api = {
  fetchTree: () => get<TreeNode[]>('/tree'),
  fetchFile: (path: string) => get<MergedFileRecord>(`/file?path=${encodeURIComponent(path)}`),
  fetchIndex: () => get<MergedFileRecord[]>('/index'),
  fetchTags: () => get<string[]>('/tags'),
  fetchFeatures: () => get<Record<string, Feature>>('/features'),

  updateFileMeta: (path: string, data: Partial<{
    title: string;
    summary: string;
    validity: number;
    clarity: number;
    completeness: number;
    stability: number;
    scoresReviewed: boolean;
    tags: string[];
    featureId: string;
    authorityLevel: string;
    status: string;
    ioMetadata: import('../../shared/types').IoMetadata | undefined;
    relatedFiles: (string | import('../../shared/types').FileRelation)[];
  }>) => post<MergedFileRecord>('/file/meta', { path, ...data }),

  addTodo: (path: string, todo: { text: string; priority: number; tags?: string[]; createdBy?: Author; difficulty?: number }) =>
    post<Todo>('/todo', { path, ...todo }),

  updateTodo: (path: string, todoId: string, updates: { status?: string; text?: string; priority?: number; tags?: string[]; difficulty?: number }) =>
    post<Todo>('/todo', { path, id: todoId, ...updates }),

  deleteTodo: (path: string, todoId: string) =>
    del<{ success: boolean }>('/todo', { path, todoId }),

  addComment: (path: string, comment: { text: string; author?: Author; type?: string; confidence?: number }) =>
    post<Comment>('/comment', { path, ...comment }),

  deleteComment: (path: string, commentId: string) =>
    del<{ ok: boolean }>('/comment', { path, commentId }),

  createFeature: (id: string, feature: { name: string; description?: string; tags?: string[]; status?: string }) =>
    post<Feature>('/features', { id, ...feature }),

  deleteFeature: (id: string) =>
    del<{ success: boolean }>('/features', { id }),

  fetchAgentNotes: () => get<import('../../shared/types').AgentNote[]>('/agent-notes'),

  acknowledgeAgentNote: (index: number) =>
    post<{ success: boolean }>('/agent-notes/acknowledge', { index }),

  fetchDirectory: (path: string) =>
    get<{ path: string; summary?: string; fileCount: number; openTodoCount: number }>(`/directory?path=${encodeURIComponent(path)}`),

  updateDirectorySummary: (path: string, summary: string) =>
    post<{ summary?: string }>('/directory/meta', { path, summary }),

  triggerRescan: () => post<{ success: boolean; output: string }>('/rescan', {}),

  archiveItem: (path: string, kind: 'todo' | 'comment', itemId: string) =>
    post<{ ok: boolean }>('/archive', { path, kind, itemId }),

  getSettings: () => get<Record<string, unknown>>('/settings'),

  updateSettings: (settings: Record<string, unknown>) =>
    post<{ ok: boolean }>('/settings', settings),

  fetchProfile: () => get<CanopyProfile>('/profile'),

  updateProfile: (profile: Partial<CanopyProfile> & { name?: string }) =>
    post<CanopyProfile>('/profile', profile),

  getConfig: () => get<{ repoRoot: string; repoName: string; isDemo: boolean }>('/config'),

  setRepoRoot: (path: string) =>
    post<{ repoRoot: string; repoName: string; isDemo: boolean }>('/config/repo', { path }),

  fetchAnalytics: () => get<CanopyAnalytics>('/analytics'),

  fetchManifest: () => get<AgentManifestEntry[]>('/manifest'),
  fetchActivity: () => get<AgentManifestEntry[]>('/activity'),
  reviewActivity: (id: string, action: AgentReviewAction, note?: string) =>
    post<AgentManifestEntry>('/activity/review', { id, action, note }),

  browse: (path?: string) =>
    get<{ path: string; parent: string; dirs: string[]; isGitRepo: boolean; hasCanopytag: boolean }>(
      `/config/browse${path ? `?path=${encodeURIComponent(path)}` : ''}`
    ),
};
