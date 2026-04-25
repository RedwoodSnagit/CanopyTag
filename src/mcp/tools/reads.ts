import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { readAgentManifest, resolveAgentManifestPath } from '../../backend/lib/agent-manifest.js';
import { readCanopy } from '../../backend/lib/canopy.js';
import {
  resolveCanopyPath, resolveRepoRoot,
  parseBaseFilters,
  type FileFilters, type SortKey,
} from '../../cli/shared.js';
import { buildStats } from '../../cli/stats.js';
import { buildLs } from '../../cli/ls.js';
import { buildQuery } from '../../cli/query.js';
import { buildContext } from '../../cli/context.js';
import { buildCompare } from '../../cli/compare.js';
import { buildHealth } from '../../cli/health.js';
import { buildTodos } from '../../cli/todos.js';
import { buildAgentManifestReport } from './agent-manifest.js';
import { buildTags } from './tags.js';
import { walkGraph, renderGraphTree } from '../../cli/graph.js';
import { readAnalytics, writeAnalytics, incrementFile, resolveAnalyticsPath } from '../../backend/lib/analytics.js';
import path from 'node:path';
import { discoverRepoFiles, buildCoverage } from '../../cli/coverage.js';

const DETAIL_ALIASES: Record<string, number> = {
  low: 1, medium: 2, 'medium-high': 3, high: 4, full: 5,
};

// Common filter params (reused across tools)
const filterParams = {
  feature: z.string().optional().describe('Filter by feature ID'),
  tag: z.string().optional().describe('Filter by tag'),
  kind: z.string().optional().describe('Filter by file kind: doc, code, test, config, asset, data'),
  unreviewed: z.boolean().optional().describe('Only files with unreviewed scores'),
  surprising: z.boolean().optional().describe('Only files tagged surprising or with finding comments'),
};

/** Map MCP params to the format parseBaseFilters expects */
function buildFilters(params: Record<string, any>): FileFilters {
  const values: Record<string, unknown> = {};
  if (params.feature) values.feature = params.feature;
  if (params.tag) values.tag = params.tag;
  if (params.kind) values.kind = params.kind;
  if (params.unreviewed) values.unreviewed = true;
  if (params.surprising) values.surprising = true;
  if (params.tagged_after) values['tagged-after'] = params.tagged_after;
  if (params.tagged_before) values['tagged-before'] = params.tagged_before;
  if (params.git_after) values['git-after'] = params.git_after;
  if (params.git_before) values['git-before'] = params.git_before;
  return parseBaseFilters(values);
}

export function registerReadTools(server: McpServer): void {
  function trackFiles(paths: (string | undefined)[]): void {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const analyticsPath = resolveAnalyticsPath();
      const analytics = readAnalytics(analyticsPath);
      for (const p of paths) {
        if (p) incrementFile(analytics, p, 'canopyQueryCount', today);
      }
      writeAnalytics(analyticsPath, analytics);
    } catch { /* analytics must never break tool responses */ }
  }

  // 1. canopytag_stats
  server.tool(
    'canopytag_stats',
    'Start here. Shows file counts by kind, authority distribution, and open TODOs.',
    { ...filterParams },
    async (params) => {
      try {
        const repoRoot = resolveRepoRoot();
        const canopyPath = resolveCanopyPath();
        const canopy = readCanopy(canopyPath);
        const filters = buildFilters(params);
        return { content: [{ type: 'text' as const, text: buildStats(canopy, filters, repoRoot) }] };
      } catch (e: any) {
        return { content: [{ type: 'text' as const, text: e.message }], isError: true };
      }
    }
  );

  // 2. canopytag_ls
  server.tool(
    'canopytag_ls',
    'List annotated files, sorted and filtered. Good for finding high-authority or attention-needing files.',
    {
      ...filterParams,
      sort: z.enum(['authority', 'scores', 'stability', 'attention', 'modified', 'recent', 'name', 'todos', 'priority']).optional()
        .describe('Sort key (default: authority)'),
      limit: z.number().optional().describe('Max results (default: 10)'),
      tagged_after: z.string().optional().describe('Only files tagged after this date (YYYY-MM-DD)'),
      tagged_before: z.string().optional().describe('Only files tagged before this date (YYYY-MM-DD)'),
      git_after: z.string().optional().describe('Only files modified in git after this date'),
      git_before: z.string().optional().describe('Only files modified in git before this date'),
    },
    async (params) => {
      try {
        const repoRoot = resolveRepoRoot();
        const canopyPath = resolveCanopyPath();
        const canopy = readCanopy(canopyPath);
        const filters = buildFilters(params);
        const sort = (params.sort ?? 'authority') as SortKey;
        const limit = params.limit ?? 10;
        return { content: [{ type: 'text' as const, text: buildLs(canopy, filters, sort, limit, repoRoot) }] };
      } catch (e: any) {
        return { content: [{ type: 'text' as const, text: e.message }], isError: true };
      }
    }
  );

  // 3. canopytag_query
  server.tool(
    'canopytag_query',
    'Progressive-depth exploration by feature, tag, or filter. Returns summaries, scores, TODOs, and relationships.',
    {
      ...filterParams,
      detail: z.union([z.number().min(1).max(5), z.enum(['low', 'medium', 'medium-high', 'high', 'full'])]).optional()
        .describe('Detail level 1-5 or low/medium/medium-high/high/full (default: medium)'),
      relation: z.string().optional().describe('Filter connections by relation type'),
      sort: z.enum(['authority', 'scores', 'stability', 'attention', 'modified', 'recent', 'name', 'todos', 'priority']).optional(),
      limit: z.number().optional().describe('Max results (default: 10)'),
      all: z.boolean().optional().describe('Show all results'),
    },
    async (params) => {
      try {
        const repoRoot = resolveRepoRoot();
        const canopyPath = resolveCanopyPath();
        const canopy = readCanopy(canopyPath);
        const filters = buildFilters(params);
        const rawDetail = params.detail;
        const detail = typeof rawDetail === 'string' ? (DETAIL_ALIASES[rawDetail] ?? 2) : (rawDetail ?? 2);
        const { text, matchedPaths } = buildQuery(canopy, filters, {
          detail,
          relation: params.relation as any,
          sortKey: (params.sort ?? 'authority') as SortKey,
          limit: params.limit ?? 10,
          showAll: params.all,
          repoRoot,
        });
        // Track only targeted queries (not full-repo unfiltered)
        if ((params.feature || params.tag) && matchedPaths.length > 0) {
          trackFiles(matchedPaths);
        }
        return { content: [{ type: 'text' as const, text }] };
      } catch (e: any) {
        return { content: [{ type: 'text' as const, text: e.message }], isError: true };
      }
    }
  );

  // 4. canopytag_context
  server.tool(
    'canopytag_context',
    'Compact context block for a file or feature. Inject into prompts.',
    {
      file: z.string().optional().describe('Single file path'),
      files: z.array(z.string()).optional().describe('Multiple file paths'),
      feature: z.string().optional().describe('Feature ID'),
      surprising: z.boolean().optional().describe('Only surprising files'),
      depth: z.number().min(1).max(5).optional().describe('Detail depth (default: 4)'),
    },
    async (params) => {
      try {
        const repoRoot = resolveRepoRoot();
        const canopyPath = resolveCanopyPath();
        const canopy = readCanopy(canopyPath);
        const text = buildContext(canopy, {
          file: params.file,
          files: params.files,
          feature: params.feature,
          surprising: params.surprising,
          depth: params.depth,
          repoRoot,
        });
        // Track explicit file queries (feature-scoped calls are out of scope for tracking)
        const trackedPaths = [
          ...(params.file ? [params.file] : []),
          ...(params.files ?? []),
        ];
        if (trackedPaths.length > 0) trackFiles(trackedPaths);
        return { content: [{ type: 'text' as const, text }] };
      } catch (e: any) {
        return { content: [{ type: 'text' as const, text: e.message }], isError: true };
      }
    }
  );

  // 5. canopytag_compare
  server.tool(
    'canopytag_compare',
    'Compare exact files by authority, quality composite, freshness, warnings, TODO pressure, and trust order. Use when deciding which source to trust between documents.',
    {
      files: z.array(z.string()).min(1).describe('File paths to compare'),
    },
    async (params) => {
      try {
        const repoRoot = resolveRepoRoot();
        const canopyPath = resolveCanopyPath();
        const canopy = readCanopy(canopyPath);
        const { text, matchedPaths } = buildCompare(canopy, params.files, repoRoot);
        if (matchedPaths.length > 0) trackFiles(matchedPaths);
        return { content: [{ type: 'text' as const, text }] };
      } catch (e: any) {
        return { content: [{ type: 'text' as const, text: e.message }], isError: true };
      }
    }
  );

  // 6. canopytag_todos
  server.tool(
    'canopytag_todos',
    'List open TODOs across all annotated files.',
    {
      ...filterParams,
      priority: z.number().min(1).max(5).optional().describe('Max priority level (e.g. 2 = P1+P2)'),
      limit: z.number().optional().describe('Max results'),
      all: z.boolean().optional().describe('Include done/deferred'),
    },
    async (params) => {
      try {
        const repoRoot = resolveRepoRoot();
        const canopyPath = resolveCanopyPath();
        const canopy = readCanopy(canopyPath);
        const filters = buildFilters(params);
        return { content: [{ type: 'text' as const, text: buildTodos(canopy, filters, {
          priority: params.priority,
          limit: params.limit,
          all: params.all,
          repoRoot,
        }) }] };
      } catch (e: any) {
        return { content: [{ type: 'text' as const, text: e.message }], isError: true };
      }
    }
  );

  // 7. canopytag_health
  server.tool(
    'canopytag_health',
    'Find authority/quality mismatches -- high-authority files with low scores.',
    {
      ...filterParams,
      all: z.boolean().optional().describe('Show all files including healthy ones'),
    },
    async (params) => {
      try {
        const repoRoot = resolveRepoRoot();
        const canopyPath = resolveCanopyPath();
        const canopy = readCanopy(canopyPath);
        const filters = buildFilters(params);
        return { content: [{ type: 'text' as const, text: buildHealth(canopy, filters, !!params.all, repoRoot) }] };
      } catch (e: any) {
        return { content: [{ type: 'text' as const, text: e.message }], isError: true };
      }
    }
  );

  // 8. canopytag_tags
  server.tool(
    'canopytag_tags',
    'Browse the tag vocabulary. Top tags by usage, search by substring, warns about duplicates.',
    {
      search: z.string().optional().describe('Substring filter'),
      limit: z.number().optional().describe('Max results (default: 20)'),
      all: z.boolean().optional().describe('Show all tags'),
    },
    async (params) => {
      try {
        const canopyPath = resolveCanopyPath();
        const canopy = readCanopy(canopyPath);
        return { content: [{ type: 'text' as const, text: buildTags(canopy, params.search, params.limit, params.all) }] };
      } catch (e: any) {
        return { content: [{ type: 'text' as const, text: e.message }], isError: true };
      }
    }
  );

  // 9. canopytag_manifest
  server.tool(
    'canopytag_manifest',
    'Inspect recent agent activity in canopytag/agent_manifest.json. Shows direct agent writes plus any staged suggestions, and helps review them after the fact.',
    {
      file: z.string().optional().describe('Filter to a single file path'),
      status: z.enum(['pending', 'agreed', 'fixed', 'rejected']).optional().describe('Filter by review status'),
      limit: z.number().optional().describe('Max results (default: pending entries up to 20)'),
      all: z.boolean().optional().describe('Include already-reviewed entries when status is not set'),
    },
    async (params) => {
      try {
        const manifestPath = resolveAgentManifestPath();
        const manifest = readAgentManifest(manifestPath);
        return {
          content: [{
            type: 'text' as const,
            text: buildAgentManifestReport(manifest, {
              file: params.file,
              status: params.status,
              limit: params.limit,
              all: params.all,
            }),
          }],
        };
      } catch (e: any) {
        return { content: [{ type: 'text' as const, text: e.message }], isError: true };
      }
    }
  );

  // 10. canopytag_fan_in
  server.tool(
    'canopytag_fan_in',
    'Who depends on this file? Reverse-walks the relation graph to find files whose relatedFiles point at the target. Use after changing a file to understand blast radius. Note: hops is hop count, not the same as canopytag_query depth levels.',
    {
      file: z.string().describe('File path to check'),
      hops: z.number().min(1).max(10).optional().describe('Hops to traverse (default: 1)'),
      min_closeness: z.number().min(1).max(5).optional().describe('Min closeness filter (default: 1)'),
      relation: z.string().optional().describe('Filter by relation type (e.g. implements, test-of)'),
    },
    async (params) => {
      try {
        const canopyPath = resolveCanopyPath();
        const canopy = readCanopy(canopyPath);
        const tree = walkGraph(canopy, params.file, 'in', params.hops ?? 1, {
          minCloseness: params.min_closeness,
          relation: params.relation as any,
        });
        if (tree.children.length === 0) {
          return { content: [{ type: 'text' as const, text: `No fan-in found for ${params.file} (no files in the canopy declare it as a related file)` }] };
        }
        trackFiles([params.file]);
        return { content: [{ type: 'text' as const, text: renderGraphTree(tree, 'in') }] };
      } catch (e: any) {
        return { content: [{ type: 'text' as const, text: e.message }], isError: true };
      }
    }
  );

  // 11. canopytag_fan_out
  server.tool(
    'canopytag_fan_out',
    'What does this file depend on? Walks the forward relation graph through relatedFiles. Use to understand dependencies and what shaped this file. Note: hops is hop count, not the same as canopytag_query depth levels.',
    {
      file: z.string().describe('File path to check'),
      hops: z.number().min(1).max(10).optional().describe('Hops to traverse (default: 2)'),
      min_closeness: z.number().min(1).max(5).optional().describe('Min closeness filter (default: 1)'),
      relation: z.string().optional().describe('Filter by relation type'),
    },
    async (params) => {
      try {
        const canopyPath = resolveCanopyPath();
        const canopy = readCanopy(canopyPath);
        const fc = canopy.files[params.file];
        if (!fc) {
          return { content: [{ type: 'text' as const, text: `${params.file} is not in the canopy. Add it with canopytag_annotate first.` }] };
        }
        const tree = walkGraph(canopy, params.file, 'out', params.hops ?? 2, {
          minCloseness: params.min_closeness,
          relation: params.relation as any,
        });
        if (tree.children.length === 0) {
          return { content: [{ type: 'text' as const, text: `No fan-out found for ${params.file} (file has no relatedFiles entries)` }] };
        }
        trackFiles([params.file]);
        return { content: [{ type: 'text' as const, text: renderGraphTree(tree, 'out') }] };
      } catch (e: any) {
        return { content: [{ type: 'text' as const, text: e.message }], isError: true };
      }
    }
  );

  // 12. canopytag_coverage
  server.tool(
    'canopytag_coverage',
    'Annotation coverage report: what is annotated, what is not, and what is orphaned.',
    {
      kind: z.string().optional().describe('Filter by file kind: module, doc, test, config, asset, data'),
      detail: z.boolean().optional().describe('Show per-file field completeness'),
    },
    async (params) => {
      try {
        const repoRoot = resolveRepoRoot();
        const canopyPath = resolveCanopyPath();
        const canopyDir = path.dirname(canopyPath);
        const canopy = readCanopy(canopyPath);
        const repoFiles = discoverRepoFiles(repoRoot, canopyDir);
        const { text } = buildCoverage(canopy, repoFiles, params.kind, params.detail);
        return { content: [{ type: 'text' as const, text }] };
      } catch (e: any) {
        return { content: [{ type: 'text' as const, text: e.message }], isError: true };
      }
    }
  );
}
