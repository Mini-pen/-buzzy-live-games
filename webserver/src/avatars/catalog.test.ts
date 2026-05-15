import { describe, expect, test } from "vitest";

import {
  avatarLabelFromFilenameStem,
  avatarPublicRelativePath,
  getAvatarCatalog,
  refreshAvatarCatalog,
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

  test("matches exact relative key when unique stem", () => {
    refreshAvatarCatalog();
    const c = getAvatarCatalog();
    const hit = c.find((e) => e.key.includes("avatar_base"));
    if (!hit) {
      throw new Error("Expected nested avatar_base*.png under avatars/ for this test");
    }
    expect(tryParseAvatarKey(hit.key)).toBe(hit.key);
  });
});
