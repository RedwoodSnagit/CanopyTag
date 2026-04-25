import { create } from 'zustand';
import type { TreeNode, MergedFileRecord, Feature, ViewMode, AgentNote, CanopyAnalytics, CanopyProfile } from '../../shared/types';
import { api } from '../lib/api';

interface RepoConfig {
  repoRoot: string;
  repoName: string;
  isDemo: boolean;
}

interface WorkspaceState {
  // Repo connection
  connected: boolean;
  repoConfig: RepoConfig | null;

  // Data
  tree: TreeNode[];
  selectedPath: string | null;
  selectedFile: MergedFileRecord | null;
  selectedDirectory: { path: string; summary?: string; fileCount: number; openTodoCount: number } | null;
  index: MergedFileRecord[];
  tags: string[];
  features: Record<string, Feature>;
  agentNotes: AgentNote[];
  analytics: CanopyAnalytics | null;
  profile: CanopyProfile | null;
  viewMode: ViewMode;
  searchQuery: string;
  loading: boolean;
  error: string | null;
  saveNotice: string | null;

  // Actions
  setRepoConfig: (config: RepoConfig) => void;
  disconnect: () => void;
  loadTree: () => Promise<void>;
  loadIndex: () => Promise<void>;
  loadTags: () => Promise<void>;
  loadFeatures: () => Promise<void>;
  selectFile: (path: string) => Promise<void>;
  selectDirectory: (path: string) => Promise<void>;
  setViewMode: (mode: ViewMode) => void;
  setSearchQuery: (query: string) => void;
  refreshSelectedFile: () => Promise<void>;
  flashSave: (path: string) => void;
  initialize: () => Promise<void>;
  loadAnalytics: () => Promise<void>;
  loadProfile: () => Promise<void>;
  updateProfile: (name: string) => Promise<void>;
}

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  connected: false,
  repoConfig: null,
  tree: [],
  selectedPath: null,
  selectedFile: null,
  selectedDirectory: null,
  index: [],
  tags: [],
  features: {},
  agentNotes: [],
  analytics: null,
  profile: null,
  viewMode: 'explorer',
  searchQuery: '',
  loading: false,
  error: null,
  saveNotice: null,

  setRepoConfig: (config) => set({ repoConfig: config }),

  disconnect: () => set({
    connected: false,
    repoConfig: null,
    tree: [],
    selectedPath: null,
    selectedFile: null,
    selectedDirectory: null,
    index: [],
    tags: [],
    features: {},
    agentNotes: [],
    analytics: null,
    profile: null,
  }),

  initialize: async () => {
    set({ loading: true, error: null });
    try {
      const [tree, tags, features, index, agentNotes, profile, analytics] = await Promise.all([
        api.fetchTree(),
        api.fetchTags(),
        api.fetchFeatures(),
        api.fetchIndex(),
        api.fetchAgentNotes(),
        api.fetchProfile(),
        api.fetchAnalytics().catch(() => null),  // optional — don't fail init
      ]);
      set({ tree, tags, features, index, agentNotes, analytics, profile, loading: false, connected: true });
    } catch (err: any) {
      set({ error: err.message, loading: false });
    }
  },

  loadTree: async () => {
    try {
      const tree = await api.fetchTree();
      set({ tree });
    } catch (err: any) {
      set({ error: err.message });
    }
  },

  loadIndex: async () => {
    try {
      const index = await api.fetchIndex();
      set({ index });
    } catch (err: any) {
      set({ error: err.message });
    }
  },

  loadTags: async () => {
    try {
      const tags = await api.fetchTags();
      set({ tags });
    } catch (err: any) {
      set({ error: err.message });
    }
  },

  loadFeatures: async () => {
    try {
      const features = await api.fetchFeatures();
      set({ features });
    } catch (err: any) {
      set({ error: err.message });
    }
  },

  loadAnalytics: async () => {
    try {
      const analytics = await api.fetchAnalytics();
      set({ analytics });
    } catch { /* analytics optional — silent failure */ }
  },

  loadProfile: async () => {
    try {
      const profile = await api.fetchProfile();
      set({ profile });
    } catch (err: any) {
      set({ error: err.message });
    }
  },

  updateProfile: async (name: string) => {
    try {
      const profile = await api.updateProfile({ name });
      set({ profile });
    } catch (err: any) {
      set({ error: err.message });
      throw err;
    }
  },

  selectFile: async (path: string) => {
    set({ selectedPath: path, selectedDirectory: null, loading: true, error: null });
    try {
      const file = await api.fetchFile(path);
      set({ selectedFile: file, loading: false });
    } catch (err: any) {
      set({ selectedFile: null, error: err.message, loading: false });
    }
  },

  selectDirectory: async (path: string) => {
    set({ selectedPath: path, selectedFile: null, loading: true, error: null });
    try {
      const dir = await api.fetchDirectory(path);
      set({ selectedDirectory: dir, loading: false });
    } catch (err: any) {
      set({ selectedDirectory: null, error: err.message, loading: false });
    }
  },

  setViewMode: (mode) => set({ viewMode: mode }),
  setSearchQuery: (query) => set({ searchQuery: query }),

  flashSave: (filePath: string) => {
    set({ saveNotice: `Saved → canopy.json (${filePath})` });
    setTimeout(() => set({ saveNotice: null }), 2500);
  },

  refreshSelectedFile: async () => {
    const { selectedPath, flashSave } = get();
    if (selectedPath) {
      try {
        const file = await api.fetchFile(selectedPath);
        const index = await api.fetchIndex();
        set({ selectedFile: file, index });
        flashSave(selectedPath);
      } catch (err: any) {
        set({ error: err.message });
      }
    }
  },
}));
