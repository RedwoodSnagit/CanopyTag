import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readCanopy, writeCanopy } from '../lib/canopy.js';
import { readAgentManifest, reviewAgentManifestEntry } from '../lib/agent-manifest.js';
import { handleAddComment, handleAddProject, handleAnnotate, handleUpdateProject } from '../../mcp/tools/writes.js';

let tmpDir: string;
let canopyPath: string;
let manifestPath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-activity-'));
  const canopyDir = path.join(tmpDir, 'canopytag');
  fs.mkdirSync(canopyDir, { recursive: true });
  canopyPath = path.join(canopyDir, 'canopy.json');
  manifestPath = path.join(canopyDir, 'agent_manifest.json');

  fs.writeFileSync(canopyPath, JSON.stringify({
    version: 1,
    repo_root: tmpDir,
    last_modified_at: '2026-04-01T00:00:00Z',
    files: {
      'src/auth.ts': {
        summary: 'Original auth module',
        tags: ['auth', 'backend'],
        comments: [],
      },
    },
    features: {},
  }, null, 2));
});

afterEach(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
});

describe('reviewAgentManifestEntry', () => {
  it('reads agent manifests with a UTF-8 BOM', () => {
    fs.writeFileSync(manifestPath, '\uFEFF' + JSON.stringify({
      version: 1,
      entries: [],
    }));

    expect(() => readAgentManifest(manifestPath)).not.toThrow();
    expect(readAgentManifest(manifestPath).version).toBe(1);
  });

  it('rejects an annotate entry by restoring the previous values', () => {
    handleAnnotate(canopyPath, {
      file: 'src/auth.ts',
      summary: 'Updated by agent',
      tags: ['auth', 'security'],
    });

    const manifest = readAgentManifest(manifestPath);
    const entry = manifest.entries[0];
    expect(entry.kind).toBe('annotate');

    reviewAgentManifestEntry(canopyPath, manifestPath, {
      id: entry.id,
      action: 'reject',
    });

    const canopy = readCanopy(canopyPath);
    expect(canopy.files['src/auth.ts'].summary).toBe('Original auth module');
    expect(canopy.files['src/auth.ts'].tags).toEqual(['auth', 'backend']);

    const updatedManifest = readAgentManifest(manifestPath);
    expect(updatedManifest.entries[0].status).toBe('rejected');
  });

  it('marks an entry fixed and leaves a human improvement comment', () => {
    handleAnnotate(canopyPath, {
      file: 'src/auth.ts',
      summary: 'Updated by agent',
    });

    const manifest = readAgentManifest(manifestPath);
    const entry = manifest.entries[0];

    reviewAgentManifestEntry(canopyPath, manifestPath, {
      id: entry.id,
      action: 'fix',
      note: 'Keep the auth summary, but mention session expiry behavior.',
    });

    const canopy = readCanopy(canopyPath);
    const comments = canopy.files['src/auth.ts'].comments ?? [];
    expect(comments).toHaveLength(1);
    expect(comments[0]).toMatchObject({
      text: 'Keep the auth summary, but mention session expiry behavior.',
      type: 'improvement',
    });

    const updatedManifest = readAgentManifest(manifestPath);
    expect(updatedManifest.entries[0]).toMatchObject({
      status: 'fixed',
      reviewNote: 'Keep the auth summary, but mention session expiry behavior.',
    });
  });

  it('marks comment activity agreed without mutating the canopy', () => {
    handleAddComment(canopyPath, {
      file: 'src/auth.ts',
      text: 'Potential logout race here.',
      type: 'finding',
    });

    const manifest = readAgentManifest(manifestPath);
    const entry = manifest.entries[0];

    reviewAgentManifestEntry(canopyPath, manifestPath, {
      id: entry.id,
      action: 'agree',
    });

    const canopy = readCanopy(canopyPath);
    expect(canopy.files['src/auth.ts'].comments).toHaveLength(1);

    const updatedManifest = readAgentManifest(manifestPath);
    expect(updatedManifest.entries[0].status).toBe('agreed');
  });

  it('rejects a project update by restoring only its reviewed fields', () => {
    handleAddProject(canopyPath, { name: 'Context layer', files: ['src/auth.ts'], agent_name: 'ChatGPT 5.6 Sol' });
    let manifest = readAgentManifest(manifestPath);
    reviewAgentManifestEntry(canopyPath, manifestPath, { id: manifest.entries[0].id, action: 'agree' });

    handleUpdateProject(canopyPath, {
      project: 'PRJ-001', status: 'paused', open_questions: ['UI boundary?'], agent_name: 'ChatGPT 5.6 Sol',
    });
    manifest = readAgentManifest(manifestPath);
    reviewAgentManifestEntry(canopyPath, manifestPath, { id: manifest.entries[1].id, action: 'reject' });

    expect(readCanopy(canopyPath).projects?.['PRJ-001']).toMatchObject({ status: 'active' });
    expect(readCanopy(canopyPath).projects?.['PRJ-001'].openQuestions).toBeUndefined();
  });

  it('refuses to reject project creation after the project changed', () => {
    handleAddProject(canopyPath, { name: 'Context layer', agent_name: 'ChatGPT 5.6 Sol' });
    const manifest = readAgentManifest(manifestPath);
    const canopy = readCanopy(canopyPath);
    canopy.projects!['PRJ-001'].description = 'A later human change.';
    writeCanopy(canopyPath, canopy);

    expect(() => reviewAgentManifestEntry(canopyPath, manifestPath, {
      id: manifest.entries[0].id,
      action: 'reject',
    })).toThrow('changed after creation');
    expect(readAgentManifest(manifestPath).entries[0].status).toBe('pending');
  });
});
