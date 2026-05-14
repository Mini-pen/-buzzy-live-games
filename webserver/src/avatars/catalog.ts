/** * Curated mascot keys — each maps to `/avatars/${key}.svg` in the SPA public folder. */
export const AVATAR_CATALOG: ReadonlyArray<{ key: string; label: string }> = [
  { key: "fox", label: "Renard" },
  { key: "owl", label: "Hibou" },
  { key: "frog", label: "Grenouille" },
  { key: "bee", label: "Abeille" },
  { key: "bear", label: "Ours" },
  { key: "cat", label: "Chat" },
  { key: "duck", label: "Canard" },
  { key: "lion", label: "Lion" },
  { key: "panda", label: "Panda" },
  { key: "robot", label: "Robot" },
  { key: "rocket", label: "Fusée" },
  { key: "comet", label: "Comète" },
];

const KEY_SET = new Set(AVATAR_CATALOG.map((a) => a.key));

/** * Fallback when the client sends no avatar or an unknown key during join. */
export const DEFAULT_AVATAR_KEY: string = AVATAR_CATALOG[0]?.key ?? "fox";

/** * Relative URL baked into snapshots (same-origin). */
export function avatarPublicRelativePath(key: string): string {
  return `/avatars/${key}.svg`;
}

/** * Returns a verified key from user input or `null`. */
export function tryParseAvatarKey(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const normalized = raw.trim().toLowerCase().replace(/\.svg$/iu, "").replace(/^\/+/, "");
  if (normalized === "" || normalized.length > 48 || normalized.includes("/") || normalized.includes(".."))
    return null;
  return KEY_SET.has(normalized) ? normalized : null;
}

/** * Join-time default — never rejects. */
export function parseAvatarKeyOrDefault(raw: unknown): string {
  return tryParseAvatarKey(raw) ?? DEFAULT_AVATAR_KEY;
}

/** * PATCH self — rejects unknown ids. */
export function requireParsedAvatarKey(raw: unknown): string {
  const v = tryParseAvatarKey(raw);
  if (v === null) {
    throw Object.assign(new Error("BAD_AVATAR"), { code: "BAD_AVATAR" });
  }
  return v;
}
