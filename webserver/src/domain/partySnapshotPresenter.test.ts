import { describe, expect, test } from "vitest";

import type { QuizPack } from "../games/pack.js";
import type { MancheCatalogItem, Party } from "./types.js";
import { partySnapshotWithGame } from "./partySnapshotPresenter.js";

const demoPack: QuizPack = {
  id: "demo-quiz-v1",
  title: "Demo",
  version: 1,
  rounds: [
    {
      id: "r1",
      title: "R",
      questions: [
        {
          id: "q1",
          prompt: "?",
          choices: ["a", "b"],
          correctIndex: 1,
          points: 2,
        },
      ],
    },
  ],
};

const videoRoundPack: QuizPack = {
  id: "demo-video-v1",
  title: "Vidéo",
  version: 1,
  rounds: [
    {
      id: "v1",
      title: "Clip",
      videoUrl: "https://example.com/x.webm",
    },
  ],
};

const freeBuzzPack: QuizPack = {
  id: "fb-v1",
  title: "Free",
  version: 1,
  rounds: [
    {
      kind: "free_buzz",
      id: "fr",
      title: "Oral",
      playerPrompt: "Buzz",
      plannedQuestionCount: 3,
    },
  ],
};

const audioBlindPack: QuizPack = {
  id: "ab-v1",
  title: "Blind",
  version: 1,
  rounds: [
    {
      kind: "audio_blind",
      id: "ar",
      title: "Son",
      tracks: [
        { id: "t1", audioUrl: "/games/a.mp3", revealTitle: "Titre A" },
        { id: "t2", audioUrl: "/games/b.mp3", revealTitle: "Titre B", revealArtist: "Art B" },
      ],
    },
  ],
};

function partyStub(over: Partial<Party>): Party {
  const base: Party = {
    id: "party-uuid",
    joinCode: "ABCD",
    adminToken: "sec",
    createdAt: 0,
    updatedAt: 1,
    state: "lobby",
    hasStartedRound: false,
    maxPlayers: null,
    maxTeams: null,
    closedAfterStart: false,
    allowRename: true,
    allowTeamChange: true,
    players: new Map(),
    buzzOrder: [],
    buzzWindowOpen: false,
    chat: [],
    currentRoundIndex: null,
    currentQuestionIndex: null,
    loadedPackId: null,
    videoReplaySerial: 0,
    mancheScript: [],
    activeMancheId: null,
  };
  return { ...base, ...over };
}

function quizMancheOverPack(basenameKey: string, idForItem = "mid-quiz"): MancheCatalogItem {
  return {
    id: idForItem,
    kind: "pack_quiz",
    title: basenameKey,
    packBasename: basenameKey,
    iframeUrl: null,
    youtubeEmbedUrl: null,
    directVideoUrl: null,
    savedRoundIndex: 0,
    savedQuestionIndex: 0,
  };
}

describe("partySnapshotWithGame", () => {
  const packs = new Map<string, QuizPack>([
    ["example", demoPack],
    ["vid", videoRoundPack],
    ["free", freeBuzzPack],
    ["aud", audioBlindPack],
  ]);

  test("quiz host snapshot includes correct index", () => {
    const party = partyStub({
      state: "round_active",
      currentRoundIndex: 0,
      currentQuestionIndex: 0,
      loadedPackId: "demo-quiz-v1",
      hasStartedRound: true,
      mancheScript: [quizMancheOverPack("example")],
      activeMancheId: "mid-quiz",
    });
    const hostSnap = partySnapshotWithGame(party, packs, "host");
    expect(hostSnap.gameBoard).not.toBeNull();
    expect(hostSnap.gameBoard?.kind).toBe("quiz");
    if (hostSnap.gameBoard?.kind !== "quiz") throw new Error("expected quiz");
    expect(hostSnap.gameBoard.correctChoiceIndex).toBe(1);
    const playSnap = partySnapshotWithGame(party, packs, "player");
    expect(playSnap.gameBoard?.kind).toBe("quiz");
    if (playSnap.gameBoard?.kind !== "quiz") throw new Error("expected quiz");
    expect(playSnap.gameBoard.correctChoiceIndex).toBeUndefined();
  });

  test("video round exposes replay serial", () => {
    const party = partyStub({
      state: "round_active",
      currentRoundIndex: 0,
      currentQuestionIndex: 0,
      loadedPackId: "demo-video-v1",
      hasStartedRound: true,
      videoReplaySerial: 3,
      mancheScript: [quizMancheOverPack("vid")],
      activeMancheId: "mid-quiz",
    });
    const s = partySnapshotWithGame(party, packs, "player");
    expect(s.gameBoard?.kind).toBe("video");
    if (s.gameBoard?.kind !== "video") throw new Error("expected video");
    expect(s.gameBoard.replaySerial).toBe(3);
    expect(s.gameBoard.videoUrl).toContain("example.com");
  });

  test("audio blind hides reveal from players", () => {
    const party = partyStub({
      state: "round_active",
      currentRoundIndex: 0,
      currentQuestionIndex: 1,
      loadedPackId: "ab-v1",
      hasStartedRound: true,
      mancheScript: [quizMancheOverPack("aud", "mid-a")],
      activeMancheId: "mid-a",
    });
    const play = partySnapshotWithGame(party, packs, "player");
    expect(play.gameBoard?.kind).toBe("audio_blind");
    if (play.gameBoard?.kind !== "audio_blind") throw new Error("audio");
    expect(play.gameBoard.revealTitle).toBeUndefined();
    const host = partySnapshotWithGame(party, packs, "host");
    if (host.gameBoard?.kind !== "audio_blind") throw new Error("audio host");
    expect(host.gameBoard.revealTitle).toBe("Titre B");
    expect(host.gameBoard.revealArtist).toBe("Art B");
  });

  test("omits gameBoard when no round manche is targeted", () => {
    const party = partyStub({
      state: "round_active",
      currentRoundIndex: 0,
      currentQuestionIndex: 0,
      loadedPackId: null,
      activeMancheId: null,
    });
    expect(partySnapshotWithGame(party, packs, "host").gameBoard).toBeNull();
  });
});
