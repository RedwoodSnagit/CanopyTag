import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { resolveCanopyPath } from '../../cli/shared.js';
import { resolveAgentManifestPath } from '../../backend/lib/agent-manifest.js';
import {
  handleAddComment,
  handleAddProject,
  handleAnnotate,
  handleAddTodo,
  handleRenameTag,
  handleStageSuggestion,
  handleUpdateProject,
} from './writes.js';

const RELATION_TYPES = ['doc-for', 'test-of', 'implements', 'procedure-for', 'audit-of', 'update-on', 'fed-by'] as const;

const attributionFields = {
  // Required, because the calling model is the only party that reliably knows
  // which model it is. An env var can go stale when a config is reused, and an
  // optional field is simply never sent — every agent write in a long-running
  // repo then reads "agent", which cannot answer "which model produced the work
  // I later had to fix".
  agent_name: z.string().min(1)
    .describe('Your model identity, e.g. "Claude Opus 5", "ChatGPT 5.6 Sol", "Gemini 3 Pro". Use the specific model and version, never a role word such as "agent", "assistant", or "ai".'),
  agent_session: z.string().optional()
    .describe('Optional session/run identifier for attribution. Falls back to CANOPYTAG_AGENT_SESSION.'),
};

const relatedFileSchema = z.union([
  z.string(),
  z.object({
    path: z.string().describe('Related file path'),
    closeness: z.number().min(1).max(5).optional().describe('Closeness 1-5'),
    relation: z.enum(RELATION_TYPES).optional().describe('Typed file relationship'),
  }),
]);

const ownerSchema = z.union([
  z.enum(['human', 'agent']),
  z.object({
    role: z.enum(['human', 'agent']),
    name: z.string().min(1).optional(),
    session: z.string().optional(),
  }),
]);

export function registerWriteTools(server: McpServer): void {
  server.tool(
    'canopytag_add_comment',
    'Add a comment to a file. Use type "finding" for surprises. Always allowed, even on locked files.',
    {
      file: z.string().describe('File path relative to repo root'),
      text: z.string().describe('Comment text'),
      type: z.enum(['finding', 'bug', 'improvement', 'note']).optional().describe('Comment type (default: note)'),
      confidence: z.number().min(1).max(5).optional().describe('Confidence level 1-5'),
      ...attributionFields,
    },
    async (params) => {
      try {
        const canopyPath = resolveCanopyPath();
        return { content: [{ type: 'text' as const, text: handleAddComment(canopyPath, params) }] };
      } catch (e: any) {
        return { content: [{ type: 'text' as const, text: e.message }], isError: true };
      }
    }
  );

  server.tool(
    'canopytag_annotate',
    'Update file metadata. Respects locked files. Use sparingly -- prefer add_comment for observations.',
    {
      file: z.string().describe('File path relative to repo root'),
      summary: z.string().optional(),
      tags: z.array(z.string()).optional(),
      authority_level: z.enum(['idea', 'blueprint', 'guideline', 'specification', 'standard']).optional(),
      status: z.enum(['active', 'draft', 'experimental', 'deprecated', 'archived']).optional(),
      feature_id: z.string().optional(),
      validity: z.number().min(1).max(5).optional(),
      clarity: z.number().min(1).max(5).optional(),
      completeness: z.number().min(1).max(5).optional(),
      stability: z.number().min(1).max(5).optional(),
      ...attributionFields,
    },
    async (params) => {
      try {
        const canopyPath = resolveCanopyPath();
        return { content: [{ type: 'text' as const, text: handleAnnotate(canopyPath, params) }] };
      } catch (e: any) {
        return { content: [{ type: 'text' as const, text: e.message }], isError: true };
      }
    }
  );

  server.tool(
    'canopytag_add_todo',
    "Log Canopy-native work on exactly one file or project. Don't create TODOs for work you're about to do yourself. File TODOs are blocked on locked files.",
    {
      file: z.string().optional().describe('File path relative to repo root. Mutually exclusive with project.'),
      project: z.string().optional().describe('Project ID or exact name. Mutually exclusive with file.'),
      text: z.string().describe('TODO description'),
      priority: z.number().min(1).max(5).describe('Priority 1-5 (P1=critical)'),
      difficulty: z.number().min(1).max(5).optional().describe('Difficulty 1-5'),
      tags: z.array(z.string()).optional(),
      ...attributionFields,
    },
    async (params) => {
      try {
        const canopyPath = resolveCanopyPath();
        return { content: [{ type: 'text' as const, text: handleAddTodo(canopyPath, params) }] };
      } catch (e: any) {
        return { content: [{ type: 'text' as const, text: e.message }], isError: true };
      }
    }
  );

  server.tool(
    'canopytag_add_project',
    'Create a thin multi-file work/context umbrella. This is not a board, sprint, or nested project tree.',
    {
      id: z.string().regex(/^PRJ-\d+$/).optional().describe('Optional explicit ID such as PRJ-001; generated when omitted'),
      name: z.string().min(1),
      description: z.string().optional().describe('Why this work exists and what outcome it advances'),
      status: z.enum(['active', 'paused', 'done']).optional(),
      owners: z.array(ownerSchema).optional(),
      feature_ids: z.array(z.string()).optional(),
      files: z.array(z.string()).optional().describe('Repo-relative file paths implicated by the project'),
      open_questions: z.array(z.string()).optional(),
      ...attributionFields,
    },
    async (params) => {
      try {
        const canopyPath = resolveCanopyPath();
        return { content: [{ type: 'text' as const, text: handleAddProject(canopyPath, params) }] };
      } catch (e: any) {
        return { content: [{ type: 'text' as const, text: e.message }], isError: true };
      }
    }
  );

  server.tool(
    'canopytag_update_project',
    'Update one project. Array fields replace their current values; send [] to clear them. Add TODOs separately with canopytag_add_todo.',
    {
      project: z.string().describe('Project ID or exact name'),
      name: z.string().min(1).optional(),
      description: z.string().optional(),
      status: z.enum(['active', 'paused', 'done']).optional(),
      owners: z.array(ownerSchema).optional().describe('Replacement owner list'),
      feature_ids: z.array(z.string()).optional().describe('Replacement feature ID list'),
      files: z.array(z.string()).optional().describe('Replacement repo-relative file list'),
      open_questions: z.array(z.string()).optional().describe('Replacement open-question list'),
      ...attributionFields,
    },
    async (params) => {
      try {
        const canopyPath = resolveCanopyPath();
        return { content: [{ type: 'text' as const, text: handleUpdateProject(canopyPath, params) }] };
      } catch (e: any) {
        return { content: [{ type: 'text' as const, text: e.message }], isError: true };
      }
    }
  );

  server.tool(
    'canopytag_rename_tag',
    'Rename a tag across all files. Use to consolidate duplicates. Check canopytag_tags first.',
    {
      old_tag: z.string().describe('Tag to rename'),
      new_tag: z.string().describe('Replacement tag'),
      ...attributionFields,
    },
    async (params) => {
      try {
        const canopyPath = resolveCanopyPath();
        return { content: [{ type: 'text' as const, text: handleRenameTag(canopyPath, params) }] };
      } catch (e: any) {
        return { content: [{ type: 'text' as const, text: e.message }], isError: true };
      }
    }
  );

  server.tool(
    'canopytag_stage_suggestion',
    'Stage a non-canonical suggestion in canopytag/agent_manifest.json without editing canopy.json. Good for tentative metadata, manual stale recommendations, and follow-up notes.',
    {
      file: z.string().describe('File path relative to repo root'),
      title: z.string().optional(),
      summary: z.string().optional(),
      tags: z.array(z.string()).optional(),
      authority_level: z.enum(['idea', 'blueprint', 'guideline', 'specification', 'standard']).optional(),
      file_status: z.enum(['active', 'draft', 'experimental', 'deprecated', 'superseded', 'archived']).optional(),
      feature_id: z.string().optional(),
      validity: z.number().min(1).max(5).optional(),
      clarity: z.number().min(1).max(5).optional(),
      completeness: z.number().min(1).max(5).optional(),
      stability: z.number().min(1).max(5).optional(),
      related_files: z.array(relatedFileSchema).optional().describe('Suggested related files'),
      suggested_freshness: z.enum(['fresh', 'review-drift', 'unknown', 'stale']).optional()
        .describe('Optional manual freshness recommendation. `stale` is sidecar-only today.'),
      comment: z.string().optional().describe('Suggested comment or review note'),
      todo_text: z.string().optional().describe('Suggested TODO text'),
      todo_priority: z.number().min(1).max(5).optional().describe('Suggested TODO priority 1-5'),
      todo_difficulty: z.number().min(1).max(5).optional().describe('Suggested TODO difficulty 1-5'),
      todo_tags: z.array(z.string()).optional().describe('Suggested TODO tags'),
      follow_ups: z.array(z.string()).optional().describe('Related files or follow-up checks to review next'),
      rationale: z.string().optional().describe('Why this suggestion was staged instead of applied'),
      ...attributionFields,
    },
    async (params) => {
      try {
        const canopyPath = resolveCanopyPath();
        const manifestPath = resolveAgentManifestPath();
        return { content: [{ type: 'text' as const, text: handleStageSuggestion(canopyPath, manifestPath, params) }] };
      } catch (e: any) {
        return { content: [{ type: 'text' as const, text: e.message }], isError: true };
      }
    }
  );
}
