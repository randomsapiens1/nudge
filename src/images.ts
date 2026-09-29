export interface FoundImage {
  data: string; // base64
  mime: string;
}

/**
 * Walk an MCP tool response looking for image content. Handles both MCP shape
 * ({type:"image", data, mimeType}) and Anthropic shape ({type:"image", source:{data, media_type}}).
 */
export function findImage(value: unknown, depth = 0): FoundImage | null {
  if (depth > 8 || value === null || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findImage(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  const obj = value as Record<string, unknown>;
  if (obj.type === "image") {
    if (typeof obj.data === "string" && obj.data.length > 100) {
      return { data: obj.data, mime: typeof obj.mimeType === "string" ? obj.mimeType : "image/png" };
    }
    const source = obj.source as Record<string, unknown> | undefined;
    if (source && typeof source.data === "string" && source.data.length > 100) {
      return {
        data: source.data,
        mime: typeof source.media_type === "string" ? source.media_type : "image/png",
      };
    }
  }
  for (const key of Object.keys(obj)) {
    const found = findImage(obj[key], depth + 1);
    if (found) return found;
  }
  return null;
}

/** Turn "3000", "localhost:3000/x" or a full URL into a navigable URL. */
export function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (/^\d+$/.test(trimmed)) return `http://localhost:${trimmed}`;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed;
  return `http://${trimmed}`;
}
