function toSnakeCase(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function toCamelCase(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

// Keys that look like file paths (contain / or .) should not be transformed.
// These appear as object keys in the canopy `files` and `features` maps.
function isPathLikeKey(key: string): boolean {
  return key.includes('/') || key.includes('.');
}

type AnyObject = Record<string, unknown>;

export function snakeToCamel<T>(obj: T): T {
  if (Array.isArray(obj)) {
    return obj.map(snakeToCamel) as T;
  }
  if (obj !== null && typeof obj === 'object' && !(obj instanceof Date)) {
    const result: AnyObject = {};
    for (const [key, value] of Object.entries(obj as AnyObject)) {
      const newKey = isPathLikeKey(key) ? key : toCamelCase(key);
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
      const newKey = isPathLikeKey(key) ? key : toSnakeCase(key);
      result[newKey] = camelToSnake(value);
    }
    return result as T;
  }
  return obj;
}
