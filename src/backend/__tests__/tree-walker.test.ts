import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { walkTree } from '../lib/tree-walker';

const TEST_DIR = path.join(import.meta.dirname, '__test_repo__');

beforeEach(() => {
  fs.mkdirSync(path.join(TEST_DIR, 'src'), { recursive: true });
  fs.mkdirSync(path.join(TEST_DIR, 'node_modules', 'pkg'), { recursive: true });
  fs.mkdirSync(path.join(TEST_DIR, 'canopytag'), { recursive: true });
  fs.writeFileSync(path.join(TEST_DIR, 'README.md'), '# test');
  fs.writeFileSync(path.join(TEST_DIR, 'src', 'main.py'), 'print("hi")');
  fs.writeFileSync(path.join(TEST_DIR, 'node_modules', 'pkg', 'index.js'), '');
  fs.writeFileSync(path.join(TEST_DIR, 'canopytag', 'canopy.json'), '{}');
  fs.writeFileSync(path.join(TEST_DIR, '.gitignore'), 'node_modules/\n');
});

afterEach(() => {
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('walkTree', () => {
  it('returns tree nodes', () => {
    const tree = walkTree(TEST_DIR);
    expect(tree.length).toBeGreaterThan(0);
    const names = tree.map(n => n.name);
    expect(names).toContain('src');
    expect(names).toContain('README.md');
  });

  it('excludes node_modules', () => {
    const tree = walkTree(TEST_DIR);
    const allNames = flatNames(tree);
    expect(allNames).not.toContain('node_modules');
  });

  it('excludes canopytag metadata directory', () => {
    const tree = walkTree(TEST_DIR);
    const allNames = flatNames(tree);
    expect(allNames).not.toContain('canopytag');
    expect(allNames).not.toContain('canopy.json');
  });
});

function flatNames(nodes: { name: string; children?: any[] }[]): string[] {
  const result: string[] = [];
  for (const n of nodes) {
    result.push(n.name);
    if (n.children) result.push(...flatNames(n.children));
  }
  return result;
}
