import path from "node:path";

import { describe, expect, test } from "vitest";

import {
  avatarLabelFromFilenameStem,
  avatarPublicRelativePath,
  getAvatarCatalog,
  inferAvatarKeyFromDisplayName,
  refreshAvatarCatalog,
  resolveJoinAvatarKey,
  tryParseAvatarKey,
} from "./catalog.js";

describe("avatarLabelFromFilenameStem", () => {
  test("humanizes stems", () => {
    expect(avatarLabelFromFilenameStem("red-fox")).toBe("Red fox");
    expect(avatarLabelFromFilenameStem("BEE")).toBe("Bee");
  });
});

describe("avatarPublicRelativePath", () => {
  test("encodes basename", () => {
    expect(avatarPublicRelativePath("a b.png")).toBe("/avatars/a%20b.png");
  });

  test("encodes each path segment for nested keys", () => {
    expect(avatarPublicRelativePath("base/fox.png")).toBe("/avatars/base/fox.png");
  });
});

describe("disk-backed catalog (repo avatars folder)", () => {
  test("has at least one image and stable keys", () => {
    refreshAvatarCatalog();
    const c = getAvatarCatalog();
    expect(c.length).toBeGreaterThan(0);
    const first = c[0]!;
    expect(first.key.length).toBeGreaterThan(0);
    expect(first.label.length).toBeGreaterThan(0);
  });

  test("matches exact nested key path", () => {
    refreshAvatarCatalog();
    const c = getAvatarCatalog();
    const hit = c.find((e) => e.key.startsWith("base/"));
    if (!hit) {
      throw new Error("Expected at least one file under avatars/base/ for this test");
    }
    expect(tryParseAvatarKey(hit.key)).toBe(hit.key);
  });

  test("infer resolves pseudo from image stem under base/", () => {
    refreshAvatarCatalog();
    const c = getAvatarCatalog();
    const hit = c.find((e) => e.key.startsWith("base/"));
    if (!hit) {
      throw new Error("Expected at least one file under avatars/base/ for this test");
    }
    const stem = path.parse(path.basename(hit.key.replace(/\\/gu, "/"))).name;
    const spaced = stem.replace(/_/gu, " ");
    expect(inferAvatarKeyFromDisplayName(spaced)).toBe(hit.key);
    expect(resolveJoinAvatarKey(spaced, undefined)).toBe(hit.key);
  });
});
