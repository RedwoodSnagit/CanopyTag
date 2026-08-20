import { describe, it, expect } from 'vitest';
import { snakeToCamel, camelToSnake } from '../../shared/case-transform';

describe('snakeToCamel', () => {
  it('converts flat object keys', () => {
    expect(snakeToCamel({ authority_level: 'spec', created_at: '2026-01-01' }))
      .toEqual({ authorityLevel: 'spec', createdAt: '2026-01-01' });
  });

  it('converts nested objects', () => {
    expect(snakeToCamel({ file_meta: { feature_id: 'abc' } }))
      .toEqual({ fileMeta: { featureId: 'abc' } });
  });

  it('converts arrays of objects', () => {
    expect(snakeToCamel({ items: [{ created_by: 'human' }] }))
      .toEqual({ items: [{ createdBy: 'human' }] });
  });

  it('leaves non-object values unchanged', () => {
    expect(snakeToCamel({ count: 5, name: 'test' }))
      .toEqual({ count: 5, name: 'test' });
  });

  it('preserves file path keys (keys containing / or .)', () => {
    const input = {
      files: {
        'src/examples/calculators/pressure_converter.py': {
          feature_id: 'tire-pressure',
          created_at: '2026-01-01'
        }
      }
    };
    const result = snakeToCamel(input) as any;
    expect(result.files['src/examples/calculators/pressure_converter.py']).toBeDefined();
    expect(result.files['src/examples/calculators/pressure_converter.py'].featureId).toBe('tire-pressure');
  });

  it('preserves project IDs while converting fields inside project cards', () => {
    const result = snakeToCamel({
      projects: { 'PRJ-001': { feature_ids: ['core'], created_at: '2026-08-20' } },
    }) as any;
    expect(result.projects['PRJ-001']).toEqual({ featureIds: ['core'], createdAt: '2026-08-20' });
  });

  it('preserves authored feature IDs with underscores while converting cards', () => {
    const result = snakeToCamel({
      features: { ride_analysis: { canonical_file: 'docs/ride.md', open_questions: ['Ready?'] } },
    }) as any;
    expect(result.features.ride_analysis).toEqual({
      canonicalFile: 'docs/ride.md',
      openQuestions: ['Ready?'],
    });
    expect(result.features.rideAnalysis).toBeUndefined();
  });
});

describe('camelToSnake', () => {
  it('converts flat object keys', () => {
    expect(camelToSnake({ authorityLevel: 'spec', createdAt: '2026-01-01' }))
      .toEqual({ authority_level: 'spec', created_at: '2026-01-01' });
  });

  it('converts nested objects', () => {
    expect(camelToSnake({ fileMeta: { featureId: 'abc' } }))
      .toEqual({ file_meta: { feature_id: 'abc' } });
  });

  it('preserves file path keys', () => {
    const input = {
      files: {
        'src/examples/calculators/pressure_converter.py': {
          featureId: 'tire-pressure'
        }
      }
    };
    const result = camelToSnake(input) as any;
    expect(result.files['src/examples/calculators/pressure_converter.py']).toBeDefined();
    expect(result.files['src/examples/calculators/pressure_converter.py'].feature_id).toBe('tire-pressure');
  });

  it('preserves project IDs while converting fields inside project cards', () => {
    const result = camelToSnake({
      projects: { 'PRJ-001': { featureIds: ['core'], createdAt: '2026-08-20' } },
    }) as any;
    expect(result.projects['PRJ-001']).toEqual({ feature_ids: ['core'], created_at: '2026-08-20' });
  });

  it('preserves authored feature IDs with underscores while converting cards', () => {
    const result = camelToSnake({
      features: { ride_analysis: { canonicalFile: 'docs/ride.md', openQuestions: ['Ready?'] } },
    }) as any;
    expect(result.features.ride_analysis).toEqual({
      canonical_file: 'docs/ride.md',
      open_questions: ['Ready?'],
    });
    expect(result.features.rideAnalysis).toBeUndefined();
  });
});
