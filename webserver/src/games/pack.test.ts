import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

import {
  isAudioBlindRound,
  isFreeBuzzRound,
  isVideoRound,
  quizPackSchema,
  scanQuizPacks,
} from "./pack.js";

describe("round discriminators", () => {
  test("legacy video round has videoUrl without kind", () => {
    const r = {
      id: "v",
      title: "V",
      videoUrl: "/games/demo/clip.mp4",
    };
    expect(isVideoRound(r)).toBe(true);
    expect(isFreeBuzzRound(r)).toBe(false);
    expect(isAudioBlindRound(r)).toBe(false);
  });

  test("free_buzz schema", () => {
    const p = quizPackSchema.parse({
      id: "f",
      title: "F",
      version: 1,
      rounds: [
        {
          kind: "free_buzz",
          id: "r1",
          title: "Libre",
          playerPrompt: "Buzz",
          plannedQuestionCount: 5,
        },
      ],
    });
    expect(isFreeBuzzRound(p.rounds[0])).toBe(true);
  });

  test("audio_blind schema", () => {
    const p = quizPackSchema.parse({
      id: "a",
      title: "A",
      version: 1,
      rounds: [
        {
          kind: "audio_blind",
          id: "r1",
          title: "Son",
          tracks: [{ id: "x", audioUrl: "/games/x.wav", revealTitle: "T", revealArtist: "Arti" }],
        },
      ],
    });
    expect(isAudioBlindRound(p.rounds[0])).toBe(true);
  });

  test("audio_blind rejects URL without recognizable audio extension", () => {
    expect(() =>
      quizPackSchema.parse({
        id: "a",
        title: "A",
        version: 1,
        rounds: [
          {
            kind: "audio_blind",
            id: "r1",
            title: "Son",
            tracks: [
              {
                id: "x",
                audioUrl: "https://streams.example.net/live",
                revealTitle: "T",
              },
            ],
          },
        ],
      }),
    ).toThrow();
  });

  test("audio_blind accepts uppercase extension and query string", () => {
    const parsed = quizPackSchema.parse({
      id: "a",
      title: "A",
      version: 1,
      rounds: [
        {
          kind: "audio_blind",
          id: "r1",
          title: "Son",
          tracks: [
            {
              id: "x",
              audioUrl: "https://files.example/audio/TRACK.MP3?sig=abc",
              revealTitle: "T",
            },
          ],
        },
      ],
    });
    expect(isAudioBlindRound(parsed.rounds[0])).toBe(true);
  });
});

describe("scanQuizPacks", () => {
  test("indexes nested pack under guess_by_color/", async () => {
    const gamesDir = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "..",
      "games",
    );
    const map = await scanQuizPacks(gamesDir);
    expect(map.has("guess_by_color/quiz_with_images")).toBe(true);
  });
});


describe("quizPackSchema · question.imageUrl", () => {
  const minimalRound = {
    id: "r",
    title: "T",
    questions: [
      {
        id: "q1",
        prompt: "Hello?",
        choices: ["A", "B"],
        correctIndex: 0,
        points: 1,
      },
    ],
  };

  test("accepts HTTPS and root-relative URLs", () => {
    const parsed = quizPackSchema.parse({
      id: "p",
      title: "Pack",
      version: 1,
      rounds: [
        {
          ...minimalRound,
          questions: [
            {
              ...minimalRound.questions[0],
              imageUrl: "/games/foo/bar.png",
            },
          ],
        },
      ],
    });
    expect(parsed.rounds[0]).toMatchObject({ id: "r" });
    const r0 = parsed.rounds[0];
    if (!("questions" in r0)) throw new Error("expected quiz round");
    expect(r0.questions[0]?.imageUrl).toBe("/games/foo/bar.png");
  });

  test("rejects traversal in imageUrl", () => {
    expect(() =>
      quizPackSchema.parse({
        id: "p",
        title: "Pack",
        version: 1,
        rounds: [
          {
            ...minimalRound,
            questions: [
              {
                ...minimalRound.questions[0],
                imageUrl: "/games/../secret",
              },
            ],
          },
        ],
      }),
    ).toThrow();
  });
});
