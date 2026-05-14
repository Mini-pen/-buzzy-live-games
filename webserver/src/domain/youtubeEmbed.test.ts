import { describe, expect, test } from "vitest";
import {
  canonicalYoutubeEmbedIframeSrc,
  youtubeWatchUrlToEmbedUrl,
} from "./youtubeEmbed.js";

describe("youtubeWatchUrlToEmbedUrl", () => {
  test("watch URL → nocookie embed with params", () => {
    expect(youtubeWatchUrlToEmbedUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?modestbranding=1&rel=0&playsinline=1",
    );
  });

  test("short youtu.be", () => {
    expect(youtubeWatchUrlToEmbedUrl("https://youtu.be/dQw4w9WgXcQ")).toBe(
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?modestbranding=1&rel=0&playsinline=1",
    );
  });

  test("legacy embed host is accepted as input", () => {
    expect(youtubeWatchUrlToEmbedUrl("https://www.youtube.com/embed/dQw4w9WgXcQ")).toBe(
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?modestbranding=1&rel=0&playsinline=1",
    );
  });

  test("youtube-nocookie embed URL pasted as-is", () => {
    expect(
      youtubeWatchUrlToEmbedUrl(
        "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=1",
      ),
    ).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?modestbranding=1&rel=0&playsinline=1");
  });

  test("invalid rejects", () => {
    expect(youtubeWatchUrlToEmbedUrl("https://example.com")).toBeNull();
    expect(youtubeWatchUrlToEmbedUrl("")).toBeNull();
  });
});

describe("canonicalYoutubeEmbedIframeSrc", () => {
  test("legacy stored youtube.com/embed → nocookie canonical", () => {
    expect(canonicalYoutubeEmbedIframeSrc("https://www.youtube.com/embed/abcdEF12345")).toBe(
      "https://www.youtube-nocookie.com/embed/abcdEF12345?modestbranding=1&rel=0&playsinline=1",
    );
  });

  test("preserves start/end from legacy URL", () => {
    expect(
      canonicalYoutubeEmbedIframeSrc(
        "https://www.youtube.com/embed/abcdEF12345?start=12&end=99",
      ),
    ).toBe(
      "https://www.youtube-nocookie.com/embed/abcdEF12345?modestbranding=1&rel=0&playsinline=1&start=12&end=99",
    );
  });
});
