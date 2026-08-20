function toSnakeCase(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function toCamelCase(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

// Opaque map keys are identifiers, not schema field names. File paths and
// project IDs must survive the recursive key transform byte-for-byte.
function isOpaqueMapKey(key: string): boolean {
  return key.includes('/') || key.includes('.') || /^PRJ-\d+$/i.test(key);
}

// Values of these schema fields are authored identifier maps. Their child
// keys are data (`ride_analysis`, `PRJ-001`, a path), while the fields inside
// each child card are schema and still need conversion.
const IDENTIFIER_MAP_FIELDS = new Set(['files', 'features', 'directories', 'projects']);

type AnyObject = Record<string, unknown>;

function snakeToCamelValue<T>(obj: T, preserveOwnKeys = false): T {
  if (Array.isArray(obj)) {
    return obj.map(value => snakeToCamelValue(value)) as T;
  }
  if (obj !== null && typeof obj === 'object' && !(obj instanceof Date)) {
    const result: AnyObject = {};
    for (const [key, value] of Object.entries(obj as AnyObject)) {
      const newKey = preserveOwnKeys || isOpaqueMapKey(key) ? key : toCamelCase(key);
      result[newKey] = snakeToCamelValue(value, IDENTIFIER_MAP_FIELDS.has(newKey));
    }
    return result as T;
  }
  return obj;
}

export function snakeToCamel<T>(obj: T): T {
  return snakeToCamelValue(obj);
}

function camelToSnakeValue<T>(obj: T, preserveOwnKeys = false): T {
  if (Array.isArray(obj)) {
    return obj.map(value => camelToSnakeValue(value)) as T;
  }
  if (obj !== null && typeof obj === 'object' && !(obj instanceof Date)) {
    const result: AnyObject = {};
    for (const [key, value] of Object.entries(obj as AnyObject)) {
      const newKey = preserveOwnKeys || isOpaqueMapKey(key) ? key : toSnakeCase(key);
      result[newKey] = camelToSnakeValue(value, IDENTIFIER_MAP_FIELDS.has(newKey));
    }
    return result as T;
  }
  return obj;
}

export function camelToSnake<T>(obj: T): T {
  return camelToSnakeValue(obj);
}
