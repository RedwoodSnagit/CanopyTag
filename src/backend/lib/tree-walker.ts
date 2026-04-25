import fs from 'fs';
import path from 'path';
import ignore from 'ignore';
import type { TreeNode } from '../../shared/types';

// Skip version control, IDE, tool caches, and build directories.
// These are never useful to annotate. The .gitignore filter handles project-specific exclusions.
const ALWAYS_SKIP = new Set([
  // Version control & CI
  '.git', '.github', '.gitlab',
  // Dependency & virtual-env directories
  'node_modules', '.venv', 'venv', '.tox',
  // Build output
  'dist', 'build', '__pycache__',
  // IDE & editor
  '.idea', '.vscode', '.storybook',
  // Tool caches & temp
  '.pytest_tmp', '.test_tmp', '.pytest_cache', '.mypy_cache', '.ruff_cache',
  // Agent / tool workspace directories
  '.superpowers', '.claude', '.canopytag', 'canopytag',
  // Common root-level config dotfiles (not useful to annotate)
  '.ctagignore', '.gitignore', '.flake8', '.nvmrc', '.rgignore',
  '.pre-commit-config.yaml', '.stylelintignore', '.eslintrc', '.eslintrc.js',
  '.prettierrc', '.prettierignore', '.editorconfig', '.dockerignore',
  '.env', '.env.local', '.env.development', '.env.production',
  '.DS_Store', 'Thumbs.db',
  // Lock files (machine-generated, never useful to annotate)
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'poetry.lock',
  'Pipfile.lock', 'composer.lock', 'Gemfile.lock',
]);

export function walkTree(rootDir: string): TreeNode[] {
  const ig = ignore();

  // Load .gitignore patterns
  const gitignorePath = path.join(rootDir, '.gitignore');
  if (fs.existsSync(gitignorePath)) {
    const content = fs.readFileSync(gitignorePath, 'utf-8');
    ig.add(content);
  }

  // Load .ctagignore for project-specific CanopyTag exclusions.
  // Check unhidden canopytag/ first (current convention), then legacy .canopytag/,
  // then the repo root as a final fallback.
  const ctagignoreCandidates = [
    path.join(rootDir, 'canopytag', '.ctagignore'),
    path.join(rootDir, '.canopytag', '.ctagignore'),
    path.join(rootDir, '.ctagignore'),
  ];
  for (const ctagignorePath of ctagignoreCandidates) {
    if (fs.existsSync(ctagignorePath)) {
      const content = fs.readFileSync(ctagignorePath, 'utf-8');
      ig.add(content);
      break;
    }
  }

  return walkDir(rootDir, rootDir, ig);
}

function walkDir(dir: string, rootDir: string, ig: ReturnType<typeof ignore>): TreeNode[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    // Permission denied or other OS-level error — skip this directory
    return [];
  }
  const nodes: TreeNode[] = [];

  // Sort: folders first, then alphabetically
  entries.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  for (const entry of entries) {
    if (ALWAYS_SKIP.has(entry.name)) continue;

    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(rootDir, fullPath).replace(/\\/g, '/');

    if (ig.ignores(relativePath)) continue;

    if (entry.isDirectory()) {
      const children = walkDir(fullPath, rootDir, ig);
      nodes.push({
        id: relativePath,
        name: entry.name,
        path: relativePath,
        isFolder: true,
        children,
      });
    } else {
      nodes.push({
        id: relativePath,
        name: entry.name,
        path: relativePath,
        isFolder: false,
      });
    }
  }

  return nodes;
}
