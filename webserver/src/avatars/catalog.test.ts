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

  test("matches exact basename and legacy stem", () => {
    refreshAvatarCatalog();
    const fox = getAvatarCatalog().find((e) => /^fox\./iu.test(e.key));
    if (!fox) {
      throw new Error("Expected fox.* in avatars/ for this test");
    }
    expect(tryParseAvatarKey(fox.key)).toBe(fox.key);
    expect(tryParseAvatarKey("fox")).toBe(fox.key);
  });
});
