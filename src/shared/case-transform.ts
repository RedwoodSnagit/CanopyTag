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

type AnyObject = Record<string, unknown>;

export function snakeToCamel<T>(obj: T): T {
  if (Array.isArray(obj)) {
    return obj.map(snakeToCamel) as T;
  }
  if (obj !== null && typeof obj === 'object' && !(obj instanceof Date)) {
    const result: AnyObject = {};
    for (const [key, value] of Object.entries(obj as AnyObject)) {
      const newKey = isOpaqueMapKey(key) ? key : toCamelCase(key);
      result[newKey] = snakeToCamel(value);
    }
    return result as T;
  }
  return obj;
}

export function camelToSnake<T>(obj: T): T {
  if (Array.isArray(obj)) {
    return obj.map(camelToSnake) as T;
  }
  if (obj !== null && typeof obj === 'object' && !(obj instanceof Date)) {
    const result: AnyObject = {};
    for (const [key, value] of Object.entries(obj as AnyObject)) {
      const newKey = isOpaqueMapKey(key) ? key : toSnakeCase(key);
      result[newKey] = camelToSnake(value);
    }
    return result as T;
  }
  return obj;
}
