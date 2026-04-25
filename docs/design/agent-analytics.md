# Agent Analytics Design

**Date:** 2026-04-04
**Status:** approved

## Summary

Passive behavioral telemetry for CanopyTag repos. A Claude Code `PostToolUse` hook and MCP-side increments record which files agents read, edit, write, and query — silently, with no agent awareness, no token cost, and no impact on existing workflows. Data is stored locally in `<canopyDir>/.analytics.json` (gitignored, dot-hidden, not MCP-exposed) and surfaced as a heatmap in a new Analytics view mode in the UI.

The secondary value is a navigation benchmark: tracking aggregate Grep/Glob/rg counts per day gives a proxy metric for CanopyTag effectiveness. If annotation coverage grows and blind-search counts trend down, agents are navigating via CanopyTag instead of searching blind. When hook output includes result paths, those files also receive lightweight search-hit heat.

## What Is Not Being Built

- `enter()` / `exit()` agent API calls
- Up/down vote mechanism
- Query string capture (privacy risk; `captureQueryStrings` settings slot reserved for future opt-in)
- Visit counts as a search ranking signal (correlation with quality is weak)
- Any auto-purge of analytics data

---

## Directory Resolution

CanopyTag supports two directory names for backward compatibility: `canopytag/` (preferred, unhidden) and `.canopytag/` (legacy, hidden). The resolution logic from `resolveCanopyPath()` in `src/cli/shared.ts` is the canonical pattern for CLI and hook:

1. Check `<repoRoot>/canopytag/` first
2. Fall back to `<repoRoot>/.canopytag/`
3. Default to `canopytag/` for new files if neither exists

The backend server resolves the same directory at startup and derives
`analyticsPath` from that resolved `canopyDir` as
`path.join(canopyDir, '.analytics.json')`. The CLI and hook use
`resolveCanopyPath()`-style resolution independently.

The analytics file always lives at `<canopyDir>/.analytics.json`.

---

## Schema — `<canopyDir>/.analytics.json`

Gitignored. Not committed. Not exposed via MCP tools or API routes. The dot-prefix hides it from casual agent reads; the MCP boundary prevents intentional reads.

```json
{
  "version": 1,
  "clearedBefore": "2026-03-01",
  "files": {
    "src/auth/middleware.ts": {
      "total": {
        "readCount": 45,
        "editCount": 8,
        "writeCount": 2,
        "canopyQueryCount": 12,
        "grepHitCount": 6,
        "globHitCount": 1,
        "ripgrepHitCount": 4
      },
      "days": {
        "2026-04-04": { "readCount": 3, "editCount": 1, "grepHitCount": 2 },
        "2026-04-03": { "readCount": 5, "canopyQueryCount": 2, "ripgrepHitCount": 1 }
      },
      "firstAccessedAt": "2026-04-01T09:00:00Z",
      "lastAccessedAt": "2026-04-04T10:30:00Z"
    }
  },
  "daily": {
    "2026-04-04": {
      "grepCount": 15,
      "globCount": 8,
      "ripgrepCount": 4,
      "uniqueFilesAccessed": 23
    }
  }
}
```

**Per-file fields:**
- `total` — cumulative counters since `clearedBefore` (or since first use if never cleared)
- `days` — day-keyed buckets (YYYY-MM-DD) kept for the full lifetime of the analytics file; never auto-pruned. Only removed by an explicit `analytics clear` command. Keeping all day entries ensures `total` can always be correctly recalculated from `days` after a `--before` clear.
- `firstAccessedAt` / `lastAccessedAt` — ISO-8601 datetime strings

**`total` counter initialization:** When a file is first touched, all four counters are initialized to `0` before the first increment. This prevents `undefined` in partial-increment scenarios (e.g., a file first seen via `editCount` must still have `readCount: 0`).

**Top-level `clearedBefore`:** A `YYYY-MM-DD` date string (not a datetime). Set when `analytics clear --before DATE` is run. Absent if the data has never been cleared. The CLI and UI display "since YYYY-MM-DD" instead of "all-time" when this field is present, so users understand that `total` reflects data from that date forward. Comparing `clearedBefore` to other dates uses string comparison on `YYYY-MM-DD` format, which is safe.

**Per-file counters:**
- `readCount` — agent opened the file (Claude Code `Read` tool)
- `editCount` — agent modified the file (`Edit` tool)
- `writeCount` — agent overwrote the file (`Write` tool)
- `canopyQueryCount` — agent explicitly queried CanopyTag about this file (MCP tools)

Search-hit fields are also recorded per file when hook output includes result paths: `grepHitCount`, `globHitCount`, and `ripgrepHitCount`. These add heat but do not count as opened files, and query strings are not stored.

**Daily aggregates:**
Daily aggregates include Claude `Grep`, Claude `Glob`, Bash `rg`/`ripgrep`, and unique direct file touches.
- `grepCount` — total `Grep` invocations that day (global searches, not file-specific)
- `globCount` — total `Glob` invocations that day
- `uniqueFilesAccessed` — distinct file paths touched that day; owned by `incrementFile` (see Component 1)

**Concurrent writes:** If two agents run in the same repo simultaneously (e.g., parallel sub-agents), both hook instances may read the same stale `.analytics.json` and the second atomic write overwrites the first. Last-write-wins. Undercounting by a small margin on concurrent sessions is acceptable; analytics are a behavioral signal, not an audit log. No locking is implemented.

---

## Settings

One new field in `canopyDir/settings.json`:

```json
{
  "archiveRetention": "7d",
  "analyticsEnabled": true
}
```

Default: `true`. When `false`:
- Hook checks the setting on startup and exits silently without writing
- MCP tools skip all analytics increments
- Analytics UI view shows an "analytics paused" notice

`CanopySettings` in `src/shared/types.ts` must be updated to add `analyticsEnabled?: boolean`. The existing `readSettings()` and `writeSettings()` functions in `src/backend/lib/canopy.ts` perform explicit field validation — `writeSettings` rebuilds a validated object from a whitelist. Both functions must be updated to handle `analyticsEnabled`. If `writeSettings` is not updated, the field will be silently stripped on every settings save.

`analyticsEnabled` is exposed as a checkbox in the Settings panel in the UI.

---

## Component 1: Analytics Library — `src/backend/lib/analytics.ts`

Mirrors the structure of `canopy.ts`. Uses the same directory resolution as `resolveCanopyPath()` for CLI callers. Responsibilities:

- `resolveAnalyticsPath(repoRoot?): string` — calls `path.dirname(resolveCanopyPath(repoRoot))` to obtain `canopyDir` (note: `resolveCanopyPath()` returns the full path to `canopy.json`, not the directory), then appends `.analytics.json`
- `readAnalytics(path): CanopyAnalytics` — reads and parses `.analytics.json`; returns empty structure if file does not exist
- `writeAnalytics(path, data): void` — atomic write (tmp + rename), same pattern as `canopy.ts`
- `incrementFile(analytics, filePath, field, today: string)` — bumps a per-file counter in both `total` and the given day's bucket; sets `firstAccessedAt` on first touch; updates `lastAccessedAt`; increments `daily[today].uniqueFilesAccessed` if this is the first event for this file on this day
- `incrementDaily(analytics, field, today: string)` — bumps today's `grepCount` or `globCount` only; does NOT touch `uniqueFilesAccessed` (Grep/Glob have no file path to track)

TypeScript interfaces to add to `src/shared/types.ts`:

```typescript
export interface FileAnalyticsTotal {
  readCount: number;
  editCount: number;
  writeCount: number;
  canopyQueryCount: number;
  grepHitCount?: number;
  globHitCount?: number;
  ripgrepHitCount?: number;
}

export interface FileAnalyticsDayBucket {
  readCount?: number;
  editCount?: number;
  writeCount?: number;
  canopyQueryCount?: number;
  grepHitCount?: number;
  globHitCount?: number;
  ripgrepHitCount?: number;
}

export interface FileAnalytics {
  total: FileAnalyticsTotal;
  days: Record<string, FileAnalyticsDayBucket>;  // keyed YYYY-MM-DD
  firstAccessedAt: string;   // ISO-8601 datetime
  lastAccessedAt: string;    // ISO-8601 datetime
}

export interface DailyAnalytics {
  grepCount: number;
  globCount: number;
  ripgrepCount?: number;
  uniqueFilesAccessed: number;
}

export interface CanopyAnalytics {
  version: 1;
  clearedBefore?: string;           // YYYY-MM-DD date string; present if data has been pruned
  files: Record<string, FileAnalytics>;
  daily: Record<string, DailyAnalytics>;  // keyed YYYY-MM-DD
}
```

`ViewMode` in `src/shared/types.ts` (line 275) must also be updated:

```typescript
export type ViewMode = 'explorer' | 'table' | 'analytics';
```

---

## Component 2: PostToolUse Hook — `hooks/canopytag-analytics.mjs`

A standalone Node.js ESM script. Claude Code calls it after every matching tool invocation. Receives tool payload on stdin. No stdout expected. Target completion: < 50ms on a local filesystem. Performance on network-mounted or WSL2 filesystems is not guaranteed — known tradeoff, two synchronous file reads (canopy.json + settings.json) occur per invocation.

The hook is a `.mjs` file and cannot import TypeScript source directly. The increment logic from `analytics.ts` is **inlined** into the hook script. This avoids any build-time dependency (`tsx`, compiled output, etc.) and keeps the hook self-contained and fast. The inline logic is small: read JSON, increment a counter, write JSON atomically.

**Tool → counter mapping:**

| Tool  | Path source              | Counter           |
|-------|--------------------------|-------------------|
| Read  | `tool_input.file_path`   | `readCount`       |
| Edit  | `tool_input.file_path`   | `editCount`       |
| Write | `tool_input.file_path`   | `writeCount`      |
| Grep  | result paths when present | daily `grepCount` + per-file `grepHitCount` |
| Glob  | result paths when present | daily `globCount` + per-file `globHitCount` |
| Bash `rg`/`ripgrep` | result paths when present | daily `ripgrepCount` + per-file `ripgrepHitCount` |

**Startup sequence:**
1. Parse stdin JSON — exit 0 if malformed (hook must never error visibly)
2. Locate `canopy.json` in cwd using the `canopytag/` → `.canopytag/` resolution order — if neither exists, exit 0 (not a CanopyTag repo)
3. Read `<canopyDir>/settings.json` — if `analyticsEnabled: false`, exit 0
4. **Branch on tool type:**
   - For `Read`, `Edit`, `Write`: extract `tool_input.file_path`; if the path does not start with `repoRoot`, exit 0; proceed to `incrementFile`
   - For `Grep`, `Glob`, and Bash `rg`/`ripgrep`: increment the daily search counter; if the hook payload includes result paths, add per-file search-hit heat after normalizing paths under the repo root
5. Read `.analytics.json` (or empty structure if absent)
6. Call `incrementFile(analytics, filePath, field, today)` or `incrementDaily(analytics, field, today)`
7. Atomic write `.analytics.json`

**Hook configuration** (written by `canopytag-hook install`):

```json
{
  "hooks": {
    "PostToolUse": [{
      "matcher": "Read|Edit|Write|Grep|Glob|Bash",
      "hooks": [{ "type": "command", "command": "node hooks/canopytag-analytics.mjs" }]
    }]
  }
}
```

The path is relative to the repo root. Claude Code runs hooks from the repo root, so this resolves correctly without hardcoding machine-specific paths.

---

## Component 3: Hook Installer — `canopytag-hook install`

The current CLI uses a script-per-command pattern with one `bin` entry per command. `canopytag hook` as a subcommand of the existing `canopytag` bin would require introducing a dispatcher — a larger refactor than this feature warrants. Instead, a separate bin entry is added:

```json
"bin": {
  "canopytag": "./src/cli/ls.ts",
  "canopytag-hook": "./src/cli/hook.ts"
}
```

Invocation: `canopytag-hook install`

`src/cli/hook.ts` handles the install subcommand. It merges the hook config into `.claude/settings.json`:

- Reads existing `.claude/settings.json` (or starts with `{}` if absent)
- Checks if the analytics hook entry is already present — prints "already installed" and exits if so (idempotent)
- Merges the `PostToolUse` hook entry without clobbering existing hooks at that key
- Writes the updated settings atomically
- Prints confirmation with the hook path

---

## Component 4: MCP Passive Tracking

In `src/mcp/tools/reads.ts`, after a successful response in four tools, increment `canopyQueryCount` for each file path that was the subject of the query:

- `canopytag_context` — increment for each path in `params.file` / `params.files` only. When `params.feature` is passed, the files are resolved inside `buildContext()` and not visible at the tool layer — feature-scoped context calls are explicitly out of scope for tracking.
- `canopytag_fan_in` — increment for `params.file`
- `canopytag_fan_out` — increment for `params.file`
- `canopytag_query` — increment for all files in the result set **when at least one of `feature`, `tag`, or `file` filters is active**. Full-repo unfiltered queries are not tracked. Because `buildQuery()` currently returns a formatted string, it needs a parallel return path. Refactor to return `{ text: string; matchedPaths: string[] }` — the tool layer uses `text` for the MCP response and `matchedPaths` for the analytics increment. This is cleaner than extracting paths after formatting.

`canopytag_stats`, `canopytag_ls`, `canopytag_todos`, `canopytag_health`, `canopytag_tags` are not tracked — orientation tools, not file-specific queries.

Analytics increments are wrapped in try/catch at the call site. Failures (including `canopyDir` not existing) are silently swallowed — analytics must never break a tool response.

---

## Component 5: API Route — `src/backend/routes/analytics.ts`

`GET /api/analytics` — returns the parsed `CanopyAnalytics` object. Returns an empty structure if `.analytics.json` does not exist.

`analyticsPath` is added to `ServerState` in `server.ts` (alongside `settingsPath` and `archivePath`) and derived from the existing `canopyDir` variable:

```typescript
const analyticsPath = path.join(canopyDir, '.analytics.json');
```

The route receives `analyticsPath` via `request.server.serverState.analyticsPath`, consistent with how all other paths are passed to routes.

The route is **setting-agnostic** — it returns whatever is on disk regardless of `analyticsEnabled`. The UI receives `analyticsEnabled` via the existing settings route and renders the "analytics paused" notice based on that, independently.

The raw `.analytics.json` file is never returned directly. No write endpoint — analytics are write-only via the hook and MCP side.

---

## Component 6: CLI — `src/cli/analytics.ts`

New `canopytag analytics` command:

```
canopytag analytics [--days N] [--limit N]
```

Default: `--days 7`, `--limit 10`.

**Output format:**

```
agent activity: last 7 days  (since 2026-03-01)

  hot files (by engagement)
    src/auth/middleware.ts       ████████  28  (12r 3e 1w 12q)
    src/mcp/server.ts            █████     18  (14r 4e)
    docs/architecture.md         ████      14  (9r  5q)

  navigation trend
    Mon  grep ████████ 18  glob ████ 8
    Tue  grep ██████   12  glob ███  6
    Wed  grep ████      9  glob ██   4

  today
    grep: 9   glob: 4   rg: 3   files touched: 23
```

`r/e/w/q/grep/glob/rg` = read / edit / write / canopyQuery / search-result hits. The "since YYYY-MM-DD" line appears only when `clearedBefore` is set.

`canopytag stats` gains a "hot files" footer (top 3 by engagement over last 7 days).

**Engagement score** for sorting:

```
score = readCount + (editCount × 2) + (writeCount × 2) + canopyQueryCount + search result hits
```

**Clear command:**

```
canopytag analytics clear [--before YYYY-MM-DD]
```

Without `--before`: wipes all analytics data after a confirmation prompt.

With `--before`: prunes `days` entries older than the given date from all files; drops `daily` entries older than that date; recalculates `total` counters by summing the remaining `days` entries (safe because `days` entries are kept for the full lifetime of the file — never auto-pruned); sets `clearedBefore` to the given date.

---

## Component 7: UI

### Heat dots — `src/frontend/components/FileTree.tsx`

A small colored dot to the right of filenames in the tree. Visible in both explorer and analytics mode. Computed from the file's engagement score over the last 7 days (windowed so stale files naturally cool off).

Five tiers:

| Score (7-day) | Visual        |
|---------------|---------------|
| 0 / no data   | none          |
| 1–5           | dim warm dot  |
| 6–14          | orange dot    |
| 15–29         | bright orange |
| 30+           | red dot       |

Analytics data is fetched once on load from `GET /api/analytics` and held in the workspace store. **No live refresh while the UI is open** — heat dots update on the next page load. This is a known limitation; polling is not implemented.

### Analytics view mode — `src/frontend/components/AnalyticsView.tsx`

Third mode alongside `explorer` and `table`. Layout mirrors explorer: file tree with heat dots on the left, analytics panel on the right.

**Analytics panel sections:**
- **Hot files** — ranked list with engagement bars and `r/e/w/q/grep/glob/rg` breakdown; clicking a file switches to explorer mode and selects it
- **Navigation trend** — 7-day bar chart of Grep/Glob/rg counts (CSS bars or inline SVG, no charting library)
- **Today at a glance** — Grep count, Glob count, rg count, unique files touched
- **"Analytics paused" notice** — shown when `analyticsEnabled: false`

**Wiring changes:**
- `src/frontend/stores/workspace.ts` — add `analytics: CanopyAnalytics | null`, fetched on connect via `fetchAnalytics()`
- `src/frontend/components/ViewToggle.tsx` — add `analytics` as third mode
- `src/frontend/App.tsx` — render `<AnalyticsView />` when `viewMode === 'analytics'`
- `src/frontend/components/Settings.tsx` — add `analyticsEnabled` checkbox

---

## File Inventory

| File | Change |
|------|--------|
| `src/shared/types.ts` | Add `CanopyAnalytics`, `FileAnalytics`, `FileAnalyticsTotal`, `FileAnalyticsDayBucket`, `DailyAnalytics` interfaces; update `ViewMode` to add `'analytics'`; add `analyticsEnabled?: boolean` to `CanopySettings` |
| `src/backend/lib/analytics.ts` | New — analytics read/write library |
| `src/backend/lib/canopy.ts` | Update `readSettings` and `writeSettings` to handle `analyticsEnabled` field |
| `src/backend/routes/analytics.ts` | New — `GET /api/analytics` |
| `src/backend/server.ts` | Resolve `canopyDir` with `canopytag/` before `.canopytag/`; add `analyticsPath` to `ServerState`; compute from resolved `canopyDir`; pass to analytics route; register analytics route |
| `src/mcp/tools/reads.ts` | Passive `canopyQueryCount` increments on 4 tools; refactor `buildQuery` to return `{ text, matchedPaths }` |
| `src/cli/analytics.ts` | New — `canopytag analytics` command |
| `src/cli/hook.ts` | New — `canopytag-hook install` subcommand |
| `src/cli/stats.ts` | Add hot files footer |
| `hooks/canopytag-analytics.mjs` | New — PostToolUse hook script |
| `package.json` | Add `"canopytag-hook": "./src/cli/hook.ts"` bin entry |
| `src/frontend/lib/api.ts` | Add `fetchAnalytics()` method for `GET /api/analytics` |
| `src/frontend/stores/workspace.ts` | Add `analytics` state, fetch on connect |
| `src/frontend/components/FileTree.tsx` | Heat dot overlay |
| `src/frontend/components/AnalyticsView.tsx` | New — analytics view panel |
| `src/frontend/components/ViewToggle.tsx` | Add analytics mode |
| `src/frontend/App.tsx` | Render analytics mode |
| `src/frontend/components/Settings.tsx` | `analyticsEnabled` toggle |
| `.gitignore` | Add `canopytag/.analytics.json` and `.canopytag/.analytics.json` |

---

## Out of Scope

- Query string capture — privacy risk; `captureQueryStrings` settings slot reserved for future explicit opt-in
- Event log / per-event timestamps — daily buckets provide sufficient resolution for heatmap and trend use cases
- Using visit counts as a search ranking signal — behavioral frequency and semantic quality are weakly correlated; decoupled by design
- Structural graph integration — visit frequency overlaid on dependency graphs is a natural future extension if CanopyTag later ingests dependency data
- Heat dot live refresh — dots update on next page load only; polling not implemented
- Feature-scoped `canopytag_context` tracking — file paths are resolved inside `buildContext()` and not visible at the tool layer
