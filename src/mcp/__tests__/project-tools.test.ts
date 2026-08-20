import { describe, expect, it } from 'vitest';
import { registerReadTools } from '../tools/reads.js';
import { registerWriteTools } from '../tools/writes-registration.js';

function registeredNames(register: (server: any) => void): string[] {
  const names: string[] = [];
  register({ tool: (name: string) => names.push(name) });
  return names;
}

describe('project MCP surface', () => {
  it('keeps project reads discoverable', () => {
    const names = registeredNames(registerReadTools);
    expect(names).toEqual(expect.arrayContaining([
      'canopytag_projects',
      'canopytag_project',
      'canopytag_query',
      'canopytag_context',
      'canopytag_todos',
    ]));
  });

  it('keeps project writes discoverable', () => {
    const names = registeredNames(registerWriteTools);
    expect(names).toEqual(expect.arrayContaining([
      'canopytag_add_project',
      'canopytag_update_project',
      'canopytag_add_todo',
    ]));
  });
});
