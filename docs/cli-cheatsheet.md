# CanopyTag CLI Cheatsheet

Use CanopyTag after normal repo search. `rg` finds candidate files; CanopyTag
adds authority, freshness, quality, TODOs, and relationship context.

## Start Here

```bash
canopytag stats --repo /path/to/repo
canopytag ls --sort attention --repo /path/to/repo
canopytag coverage --repo /path/to/repo
```

## Search Then Enrich

```bash
rg -l "validateToken" src tests
canopytag context src/auth/middleware.ts src/auth/tokens.ts
```

Use `context` when you already have paths and want compact agent-ready context:
summary, authority, review status, warnings, TODOs, relations, and tags.

## Compare Trust Between Files

```bash
canopytag compare docs/auth-spec.md src/auth/middleware.ts docs/auth-idea.md
```

Use `compare` when multiple files appear relevant and you need to decide which
one should win a conflict. It returns:

- Authority rank: conflict precedence from `1-Idea` to `5-Standard`
- Quality: validity + clarity + completeness + stability, out of 20
- Review freshness: `Fresh`, `Review Drift`, or `Unknown`
- Warning count and TODO pressure
- Trust order across the requested files

MCP equivalent:

```ts
canopytag_compare({ files: ["docs/auth-spec.md", "src/auth/middleware.ts"] })
```

## Explore A Feature

```bash
canopytag query --feature auth --detail 4
canopytag query --feature auth --relation implements
canopytag context --feature auth
```

Use `query` when you need the broader neighborhood around a feature, tag, or
relation. Use `context --feature` when you want a compact prompt block.

## Review Work

```bash
canopytag todos --priority 2
canopytag health
canopytag analytics --days 7
```

## Install Agent Hooks

```bash
canopytag mcp --repo /path/to/repo
canopytag hook install
```

`mcp` writes project-local MCP config. `hook install` is Claude Code-specific
and records recent read/edit/search heat in `canopytag/.analytics.json`.

For public repos, review or keep local the generated `.mcp.json` and
`.claude/settings.json`; both may contain absolute paths from your machine. See
[repo-local data hygiene](./repo-local-data.md) for the shared vs local file
boundary.
