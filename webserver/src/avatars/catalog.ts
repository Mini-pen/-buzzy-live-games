import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** * Image files served under `/avatars/…` relative to the avatars root directory. */
const IMAGE_EXTENSIONS = new Set([".svg", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif"]);

export interface AvatarCatalogEntry {
  /** * Relative path under the avatars root (e.g. `base/avatar_1.png`), used as `avatarKey`. */
  key: string;
  label: string;
}

interface CatalogCache {
  root: string;
  entries: ReadonlyArray<AvatarCatalogEntry>;
  /** * Lowercase relative key → canonical stored key. */
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

function candidateAvatarRoots(): string[] {
  const out: string[] = [];
  const fromEnv = process.env.AVATARS_DIR?.trim();
  if (typeof fromEnv === "string" && fromEnv !== "") out.push(path.resolve(fromEnv));
  const pkg = webserverPkgRoot();
  out.push(path.resolve(pkg, "..", "avatars"));
  out.push(path.join(pkg, "client", "public", "avatars"));
  out.push(path.join(pkg, "dist", "client", "avatars"));
  return out;
}

function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function collectImageFilesRecursive(absRoot: string, relPrefix: string, acc: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(absRoot, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const name = e.name;
    if (name === "." || name === "..") continue;
    const rel = relPrefix === "" ? name : `${relPrefix}/${name}`;
    const abs = path.join(absRoot, name);
    if (e.isDirectory()) {
      collectImageFilesRecursive(abs, rel, acc);
    } else if (e.isFile()) {
      const ext = path.extname(name).toLowerCase();
      if (!IMAGE_EXTENSIONS.has(ext)) continue;
      acc.push(rel.replace(/\\/gu, "/"));
    }
  }
}

function buildCatalogForRoot(rootAbs: string): CatalogCache | null {
  const normalizedRoot = path.resolve(rootAbs);
  if (!isDir(normalizedRoot)) return null;
  const relKeys: string[] = [];
  collectImageFilesRecursive(normalizedRoot, "", relKeys);
  relKeys.sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
  const lowerToCanonicalKey = new Map<string, string>();
  const entriesUncached: AvatarCatalogEntry[] = [];
  const seenLower = new Set<string>();
  for (const relKey of relKeys) {
    const lower = relKey.toLowerCase();
    if (seenLower.has(lower)) continue;
    seenLower.add(lower);
    lowerToCanonicalKey.set(lower, relKey);
    const base = path.basename(relKey);
    const stem = path.parse(base).name;
    entriesUncached.push({
      key: relKey,
      label: avatarLabelFromFilenameStem(stem),
    });
  }
  if (entriesUncached.length === 0) return null;
  return { root: normalizedRoot, entries: entriesUncached, lowerToCanonicalKey };
}

/** * First avatars root that contains at least one image (recursive). Exposed for HTTP static registration. */
export function resolveAvatarsServingRoot(): string | null {
  for (const raw of candidateAvatarRoots()) {
    const built = buildCatalogForRoot(raw);
    if (built !== null) return built.root;
  }
  return null;
}

/** * Prefer `AVATARS_DIR`, then repo root `avatars/`, then legacy Vite public folders. */
export function resolveAvatarsDir(): string | null {
  return resolveAvatarsServingRoot();
}

/** * Readable label from optional filename stem. */
export function avatarLabelFromFilenameStem(stem: string): string {
  const withSpaces = stem.replace(/[_-]+/gu, " ").trim();
  if (withSpaces === "") return stem;
  return withSpaces.charAt(0).toUpperCase() + withSpaces.slice(1).toLowerCase();
}

function loadCatalog(): CatalogCache {
  if (cache !== null) return cache;

  for (const raw of candidateAvatarRoots()) {
    const built = buildCatalogForRoot(raw);
    if (built !== null) {
      cache = built;
      return cache;
    }
  }

  console.warn(
    "[avatars] No usable avatars directory (set AVATARS_DIR or add images under buzzy-live-games/avatars/).",
  );
  cache = { root: "", entries: [], lowerToCanonicalKey: new Map() };
  return cache;
}

/** * Fresh list from disk (memoized per process). */
export function getAvatarCatalog(): ReadonlyArray<AvatarCatalogEntry> {
  return loadCatalog().entries;
}

/** * First item after sort; empty string if no assets. */
export function getDefaultAvatarKey(): string {
  const c = getAvatarCatalog();
  return c.length === 0 ? "" : c[0]!.key;
}

/** * Relative URL baked into snapshots (slash-safe). */
export function avatarPublicRelativePath(key: string): string {
  const norm = key.replace(/\\/gu, "/").trim();
  const parts = norm.split("/").filter((p) => p !== "" && p !== "." && p !== "..");
  if (parts.length === 0) return "/avatars/";
  return `/avatars/${parts.map((p) => encodeURIComponent(p)).join("/")}`;
}

function isSafeRelativeAvatarKey(norm: string): boolean {
  if (norm === "" || norm.length > 240) return false;
  const segments = norm.split("/").filter(Boolean);
  if (segments.length === 0) return false;
  for (const seg of segments) {
    if (seg === ".." || seg === ".") return false;
  }
  return true;
}

/** * Returns a verified key from user input or `null`. */
export function tryParseAvatarKey(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  const norm = trimmed.replace(/\\/gu, "/");
  if (!isSafeRelativeAvatarKey(norm)) return null;

  const { entries, lowerToCanonicalKey } = loadCatalog();
  if (entries.length === 0) return null;

  const lowerFull = norm.toLowerCase();
  const exact = lowerToCanonicalKey.get(lowerFull);
  if (exact !== undefined) return exact;

  if (!norm.includes("/")) {
    const lowerStem = trimmed.toLowerCase();
    const stemHits = entries.filter(
      (e) => path.parse(e.key).name.toLowerCase() === lowerStem,
    );
    if (stemHits.length === 1) return stemHits[0]!.key;
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
