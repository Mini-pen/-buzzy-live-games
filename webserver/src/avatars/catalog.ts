import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** * Image files served under `/avatars/*` relative to the Vite-spa bundle. */
const IMAGE_EXTENSIONS = new Set([".svg", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif"]);

export interface AvatarCatalogEntry {
  /** * Basename as stored with the player (`avatarKey`). */
  key: string;
  label: string;
}

interface CatalogCache {
  dir: string;
  entries: ReadonlyArray<AvatarCatalogEntry>;
  /** * Lowercase basename → canonical on-disk basename. */
  lowerToCanonicalKey: Map<string, string>;
}

let cache: CatalogCache | null = null;

/** * Clears memoized scan (tests). */
export function refreshAvatarCatalog(): void {
  cache = null;
}

function webserverPkgRoot(): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
}

/** * Prefer source `client/public/avatars` in a dev tree; fall back to Vite-built `dist/client/avatars`. */
export function resolveAvatarsDir(): string | null {
  const root = webserverPkgRoot();
  const ordered = [
    path.join(root, "client", "public", "avatars"),
    path.join(root, "dist", "client", "avatars"),
  ];
  for (const dir of ordered) {
    try {
      if (fs.statSync(dir).isDirectory()) return dir;
    } catch {
      continue;
    }
  }
  return null;
}

/** * Readable label from optional filename stem. */
export function avatarLabelFromFilenameStem(stem: string): string {
  const withSpaces = stem.replace(/[_-]+/gu, " ").trim();
  if (withSpaces === "") return stem;
  return withSpaces.charAt(0).toUpperCase() + withSpaces.slice(1).toLowerCase();
}

function normalizeCatalog(dir: string, names: string[]): CatalogCache | null {
  const entriesUncached: AvatarCatalogEntry[] = [];
  const lowerToCanonicalKey = new Map<string, string>();
  const seenLower = new Set<string>();

  for (const name of names) {
    const ext = path.extname(name).toLowerCase();
    if (!IMAGE_EXTENSIONS.has(ext)) continue;
    const abs = path.join(dir, name);
    try {
      if (!fs.statSync(abs).isFile()) continue;
    } catch {
      continue;
    }
    const lower = name.toLowerCase();
    if (seenLower.has(lower)) continue;
    seenLower.add(lower);
    const stem = path.parse(name).name;
    entriesUncached.push({
      key: name,
      label: avatarLabelFromFilenameStem(stem),
    });
    lowerToCanonicalKey.set(lower, name);
  }

  entriesUncached.sort((a, b) => a.key.localeCompare(b.key, "en", { sensitivity: "base" }));

  if (entriesUncached.length === 0) return null;
  return {
    dir,
    entries: entriesUncached,
    lowerToCanonicalKey,
  };
}

function loadCatalog(): CatalogCache {
  if (cache !== null) return cache;

  const dir = resolveAvatarsDir();
  if (dir === null) {
    console.warn("[avatars] No avatars directory found (client/public/avatars or dist/client/avatars).");
    cache = { dir: "", entries: [], lowerToCanonicalKey: new Map() };
    return cache;
  }

  let names: string[] = [];
  try {
    names = fs.readdirSync(dir);
  } catch (e) {
    console.warn("[avatars] Failed to read directory:", dir, e);
    cache = { dir, entries: [], lowerToCanonicalKey: new Map() };
    return cache;
  }

  const built = normalizeCatalog(dir, names);
  if (built === null) {
    console.warn(`[avatars] No image files in ${dir}.`);
    cache = { dir, entries: [], lowerToCanonicalKey: new Map() };
    return cache;
  }

  cache = built;
  return cache;
}

/** * Fresh list from disk (memoized per process). */
export function getAvatarCatalog(): ReadonlyArray<AvatarCatalogEntry> {
  return loadCatalog().entries;
}

/** * First item after sort; empty string if no assets. */
export function getDefaultAvatarKey(): string {
  const c = getAvatarCatalog();
  return c.length === 0 ? "" : c[0].key;
}

/** * Relative URL baked into snapshots (same-origin). */
export function avatarPublicRelativePath(key: string): string {
  return `/avatars/${encodeURIComponent(key)}`;
}

/** * Returns a verified key from user input or `null`. */
export function tryParseAvatarKey(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed.length > 120) return null;
  if (trimmed.includes("..") || trimmed.includes("/") || trimmed.includes("\\")) return null;

  const { entries, lowerToCanonicalKey } = loadCatalog();
  if (entries.length === 0) return null;

  const lower = trimmed.toLowerCase();
  const exact = lowerToCanonicalKey.get(lower);
  if (exact !== undefined) return exact;

  // * Legacy: join sent only the stem (e.g. "fox") when every asset was `fox.svg`.
  if (!trimmed.includes(".")) {
    for (const ext of IMAGE_EXTENSIONS) {
      const candidate = `${trimmed}${ext}`;
      const c = lowerToCanonicalKey.get(candidate.toLowerCase());
      if (c !== undefined) return c;
    }
  }

  return null;
}

/** * Join-time default — never rejects when the catalog is non-empty. */
export function parseAvatarKeyOrDefault(raw: unknown): string {
  const d = getDefaultAvatarKey();
  if (d === "") return "";
  return tryParseAvatarKey(raw) ?? d;
}

/** * PATCH self — rejects unknown ids. */
export function requireParsedAvatarKey(raw: unknown): string {
  const v = tryParseAvatarKey(raw);
  if (v === null) {
    throw Object.assign(new Error("BAD_AVATAR"), { code: "BAD_AVATAR" });
  }
  return v;
}
