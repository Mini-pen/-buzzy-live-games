import { randomUUID, timingSafeEqual } from "node:crypto";

import { nanoid } from "nanoid";

import type { QuizPack } from "../games/pack.js";
import { isVideoRound } from "../games/pack.js";
import { parseAvatarKeyOrDefault, requireParsedAvatarKey } from "../avatars/catalog.js";
import { randomJoinCode, randomSecretHex } from "./codes.js";
import { evaluateJoin, normalizeTeamChoice, publicSnapshotForParty } from "./partyLogic.js";
import type { ChatEntry, MancheCatalogItem, Party, PartyPublicSnapshot, Player } from "./types.js";

export interface CreatePartyOpts {
  maxPlayers: number | null;
  maxTeams: number | null;
  closedAfterStart: boolean;
  allowRename: boolean;
  allowTeamChange: boolean;
}

export type PartyNotifier = (partyId: string, party: Party) => void;

function inferChatAllows(party: Party): boolean {
  return party.state === "lobby" || party.state === "between_rounds";
}

export class PartyStore {
  private readonly parties = new Map<string, Party>();

  private readonly indexByJoinCode = new Map<string, string>();

  constructor(private readonly notify: PartyNotifier) {}

  sweep(maxAgeMs: number, now = Date.now()): number {
    let removed = 0;
    for (const id of [...this.parties.keys()]) {
      const p = this.parties.get(id)!;
      if (now - p.updatedAt > maxAgeMs) {
        this.erase(id);
        removed += 1;
      }
    }
    return removed;
  }

  private erase(id: string): void {
    const party = this.parties.get(id);
    if (!party) return;
    this.indexByJoinCode.delete(party.joinCode.toUpperCase());
    this.parties.delete(id);
  }

  broadcast(party: Party): void {
    this.notify(party.id, party);
  }

  private touch(party: Party): void {
    party.updatedAt = Date.now();
  }

  get(partyId: string): Party | undefined {
    return this.parties.get(partyId);
  }

  getByJoinCode(code: string): Party | undefined {
    const normalized = code.trim().toUpperCase();
    const id = this.indexByJoinCode.get(normalized);
    if (id === undefined) return undefined;
    return this.parties.get(id);
  }

  /** * Base snapshot shape used by presenters; realtime uses `partySnapshotWithGame`. */
  snapshot(party: Party): PartyPublicSnapshot {
    return publicSnapshotForParty(party);
  }

  createParty(opts: CreatePartyOpts): Party {
    let joinCode = "";
    for (let i = 0; i < 40; i += 1) {
      joinCode = randomJoinCode().toUpperCase();
      if (!this.indexByJoinCode.has(joinCode)) break;
    }
    if (this.indexByJoinCode.has(joinCode)) {
      throw new Error("JOIN_CODE_EXHAUSTED");
    }
    const party: Party = {
      id: randomUUID(),
      joinCode,
      adminToken: randomSecretHex(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      state: "lobby",
      hasStartedRound: false,
      maxPlayers: opts.maxPlayers,
      maxTeams: opts.maxTeams,
      closedAfterStart: opts.closedAfterStart,
      allowRename: opts.allowRename,
      allowTeamChange: opts.allowTeamChange,
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
    this.parties.set(party.id, party);
    this.indexByJoinCode.set(joinCode, party.id);
    this.broadcast(party);
    return party;
  }

  joinParty(
    joinCodeRaw: string,
    displayNameRaw: string,
    teamIdRaw: unknown,
    avatarKeyRaw?: unknown,
  ): { party: Party; player: Player } {
    const party =
      this.getByJoinCode(joinCodeRaw.trim()) ??
      null;
    if (!party) {
      throw Object.assign(new Error("NOT_FOUND"), { code: "NOT_FOUND" });
    }
    const player = this.joinPlayer(party, displayNameRaw, teamIdRaw, avatarKeyRaw);
    return { party, player };
  }

  /** * Adds a participant to an already-resolved party row (used by HTTP join by party id). */
  joinPlayer(
    party: Party,
    displayNameRaw: string,
    teamIdRaw: unknown,
    avatarKeyRaw: unknown | undefined,
  ): Player {
    const canonical = this.parties.get(party.id);
    if (!canonical) {
      throw Object.assign(new Error("NOT_FOUND"), { code: "NOT_FOUND" });
    }
    const displayName = displayNameRaw.trim().slice(0, 48);
    if (displayName.length < 2) {
      throw Object.assign(new Error("INVALID_NAME"), { code: "INVALID_NAME" });
    }
    const teamRes = normalizeTeamChoice(teamIdRaw, canonical.maxTeams);
    if (!teamRes.ok) {
      throw Object.assign(new Error(teamRes.code), { code: teamRes.code });
    }
    const joinRes = evaluateJoin({
      closedAfterStart: canonical.closedAfterStart,
      hasStartedRound: canonical.hasStartedRound,
      maxPlayers: canonical.maxPlayers,
      playerCount: canonical.players.size,
    });
    if (!joinRes.ok) {
      throw Object.assign(new Error(joinRes.code), { code: joinRes.code });
    }
    const player: Player = {
      id: randomUUID(),
      displayName,
      avatarKey: parseAvatarKeyOrDefault(avatarKeyRaw),
      teamId: teamRes.teamId,
      score: 0,
      joinedAt: Date.now(),
    };
    canonical.players.set(player.id, player);
    this.touch(canonical);
    this.broadcast(canonical);
    return player;
  }

  verifyAdminToken(
    party: Party | undefined,
    candidate: string | null | undefined,
  ): boolean {
    if (!party || candidate === undefined || candidate === null || candidate === "") return false;
    const a = Buffer.from(candidate.trim(), "utf8");
    const b = Buffer.from(party.adminToken, "utf8");
    if (a.length !== b.length) return false;
    try {
      return timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }

  patchPlayerSelf(
    party: Party,
    playerId: string,
    body: {
      displayName?: string | undefined;
      teamId?: number | null | undefined;
      avatarKey?: string | undefined;
    },
  ): Player {
    const player = party.players.get(playerId);
    if (!player)
      throw Object.assign(new Error("PLAYER_GONE"), { code: "PLAYER_GONE" });

    if (typeof body.displayName === "string") {
      const nextName = body.displayName.trim().slice(0, 48);
      if (nextName.length < 2)
        throw Object.assign(new Error("INVALID_NAME"), { code: "INVALID_NAME" });
      if (nextName !== player.displayName) {
        if (!party.allowRename)
          throw Object.assign(new Error("FORBIDDEN"), { code: "FORBIDDEN" });
        player.displayName = nextName;
      }
    }

    if (body.teamId !== undefined) {
      if (body.teamId !== player.teamId && !party.allowTeamChange) {
        throw Object.assign(new Error("FORBIDDEN"), { code: "FORBIDDEN" });
      }
      const teamChoice = normalizeTeamChoice(body.teamId, party.maxTeams);
      if (!teamChoice.ok)
        throw Object.assign(new Error(teamChoice.code), { code: teamChoice.code });
      player.teamId = teamChoice.teamId;
    }

    if (typeof body.avatarKey === "string") {
      const nextKey = requireParsedAvatarKey(body.avatarKey);
      if (nextKey !== player.avatarKey) {
        if (!party.allowRename)
          throw Object.assign(new Error("FORBIDDEN"), { code: "FORBIDDEN" });
        player.avatarKey = nextKey;
      }
    }

    this.touch(party);
    this.broadcast(party);
    return player;
  }

  setLoadedPack(party: Party, packId: string | null): void {
    party.loadedPackId = packId;
    this.touch(party);
    this.broadcast(party);
  }

  /** * Host-visible chat bubble (pseudo player id "__host__"); allowed in any phase. */
  appendHostChat(party: Party, textRaw: string): void {
    const text = textRaw.trim().slice(0, 480);
    if (text.length === 0) {
      throw Object.assign(new Error("BAD_MESSAGE"), { code: "BAD_MESSAGE" });
    }
    const entry: ChatEntry = {
      id: nanoid(12),
      playerId: "__host__",
      displayName: "Animateur",
      text,
      at: Date.now(),
    };
    party.chat.push(entry);
    this.touch(party);
    this.broadcast(party);
  }

  appendChat(party: Party, playerId: string, senderName: string, textRaw: string): void {
    if (!inferChatAllows(party)) {
      throw Object.assign(new Error("BAD_PHASE"), { code: "BAD_PHASE" });
    }
    const text = textRaw.trim().slice(0, 480);
    if (text.length === 0) {
      throw Object.assign(new Error("BAD_MESSAGE"), { code: "BAD_MESSAGE" });
    }
    const entry: ChatEntry = {
      id: nanoid(12),
      playerId,
      displayName: senderName.slice(0, 48),
      text,
      at: Date.now(),
    };
    party.chat.push(entry);
    this.touch(party);
    this.broadcast(party);
  }

  buzz(party: Party, playerId: string): void {
    if (!(party.state === "round_active" && party.buzzWindowOpen)) {
      throw Object.assign(new Error("NO_BUZZ"), { code: "NO_BUZZ" });
    }
    const player = party.players.get(playerId);
    if (!player)
      throw Object.assign(new Error("PLAYER_GONE"), { code: "PLAYER_GONE" });
    const alreadyBuzzedFirst = party.buzzOrder.some((pid) => pid === playerId);
    if (!alreadyBuzzedFirst) {
      party.buzzOrder.push(playerId);
      this.touch(party);
      this.broadcast(party);
    }
  }

  resetBuzzBoard(party: Party): void {
    party.buzzOrder = [];
    this.touch(party);
    this.broadcast(party);
  }

  adminSetBuzzOpen(party: Party, open: boolean): void {
    if (party.state !== "round_active") {
      throw Object.assign(new Error("BAD_PHASE"), { code: "BAD_PHASE" });
    }
    party.buzzWindowOpen = open;
    if (!open) {
      party.buzzOrder = [];
    }
    this.touch(party);
    this.broadcast(party);
  }

  private syncActiveQuizProgressIntoScriptItem(party: Party): void {
    if (party.activeMancheId === null || party.state !== "round_active") return;
    const item = party.mancheScript.find((m) => m.id === party.activeMancheId);
    if (item === undefined || item.kind !== "pack_quiz") return;
    if (party.currentRoundIndex !== null) item.savedRoundIndex = party.currentRoundIndex;
    if (party.currentQuestionIndex !== null) item.savedQuestionIndex = party.currentQuestionIndex;
  }

  private hydrateRuntimeFromMancheItem(
    party: Party,
    item: MancheCatalogItem,
    packs: Map<string, QuizPack>,
  ): void {
    party.videoReplaySerial += 1;
    if (item.kind === "pack_quiz") {
      const basename = (item.packBasename ?? "").replace(/\.json$/u, "").trim();
      const pack = packs.get(basename);
      if (!pack)
        throw Object.assign(new Error("PACK_NOT_FOUND"), {
          code: "PACK_NOT_FOUND",
        });
      party.loadedPackId = pack.id;
      const ri = Math.min(
        Math.max(item.savedRoundIndex, 0),
        Math.max(pack.rounds.length - 1, 0),
      );
      party.currentRoundIndex = ri;
      const round = pack.rounds[ri];
      if (round === undefined)
        throw Object.assign(new Error("BAD_ROUND"), { code: "BAD_ROUND" });
      if (isVideoRound(round)) {
        party.currentQuestionIndex = 0;
      } else {
        party.currentQuestionIndex = Math.min(
          Math.max(item.savedQuestionIndex, 0),
          Math.max(round.questions.length - 1, 0),
        );
      }
      return;
    }
    party.loadedPackId = null;
    party.currentRoundIndex = null;
    party.currentQuestionIndex = null;
  }

  hostAppendManche(party: Party, draft: Omit<MancheCatalogItem, "id">): void {
    const item: MancheCatalogItem = { ...draft, id: nanoid(12) };
    party.mancheScript.push(item);
    this.touch(party);
    this.broadcast(party);
  }

  hostRemoveManche(party: Party, mancheId: string): void {
    const idx = party.mancheScript.findIndex((m) => m.id === mancheId);
    if (idx < 0)
      throw Object.assign(new Error("NOT_FOUND"), { code: "NOT_FOUND" });
    const removing = party.mancheScript[idx];
    const activePlaying =
      removing.id === party.activeMancheId && party.state === "round_active";
    if (activePlaying) this.syncActiveQuizProgressIntoScriptItem(party);
    party.mancheScript.splice(idx, 1);
    if (removing.id === party.activeMancheId) {
      party.activeMancheId = null;
      party.loadedPackId = null;
      party.currentRoundIndex = null;
      party.currentQuestionIndex = null;
      if (party.state === "round_active") party.state = "lobby";
      party.buzzWindowOpen = false;
      party.buzzOrder = [];
    }
    this.touch(party);
    this.broadcast(party);
  }

  hostMoveManche(party: Party, mancheId: string, delta: number): void {
    const i = party.mancheScript.findIndex((m) => m.id === mancheId);
    if (i < 0)
      throw Object.assign(new Error("NOT_FOUND"), { code: "NOT_FOUND" });
    const j = i + delta;
    if (j < 0 || j >= party.mancheScript.length)
      throw Object.assign(new Error("BAD_MOVE"), { code: "BAD_MOVE" });
    const arr = party.mancheScript;
    const tmp = arr[i];
    arr[i] = arr[j]!;
    arr[j] = tmp!;
    this.touch(party);
    this.broadcast(party);
  }

  hostPlayMancheById(
    party: Party,
    mancheId: string,
    packs: Map<string, QuizPack>,
  ): void {
    if (party.mancheScript.length === 0)
      throw Object.assign(new Error("BAD_PHASE"), { code: "BAD_PHASE" });
    const i = party.mancheScript.findIndex((m) => m.id === mancheId);
    if (i < 0)
      throw Object.assign(new Error("NOT_FOUND"), { code: "NOT_FOUND" });
    this.syncActiveQuizProgressIntoScriptItem(party);

    const before = [...party.mancheScript];
    const [picked] = party.mancheScript.splice(i, 1);
    if (picked === undefined)
      throw Object.assign(new Error("NOT_FOUND"), { code: "NOT_FOUND" });
    party.mancheScript.unshift(picked);
    try {
      party.activeMancheId = picked.id;
      this.hydrateRuntimeFromMancheItem(party, picked, packs);
    } catch (err) {
      party.mancheScript = before;
      throw err;
    }
    party.state = "round_active";
    party.hasStartedRound = true;
    party.buzzWindowOpen = false;
    party.buzzOrder = [];
    this.touch(party);
    this.broadcast(party);
  }

  adminPauseToLobby(party: Party): void {
    this.syncActiveQuizProgressIntoScriptItem(party);
    party.state = "lobby";
    party.buzzWindowOpen = false;
    party.buzzOrder = [];
    this.touch(party);
    this.broadcast(party);
  }

  /** * Host “next cue”: next quiz question in the round, or replay current video round. */
  adminAdvanceCue(party: Party, pack: QuizPack): void {
    if (party.state !== "round_active") {
      throw Object.assign(new Error("BAD_PHASE"), { code: "BAD_PHASE" });
    }
    const ri = party.currentRoundIndex;
    if (ri === null || ri < 0 || ri >= pack.rounds.length) {
      throw Object.assign(new Error("BAD_ROUND"), { code: "BAD_ROUND" });
    }
    const round = pack.rounds[ri];
    if (isVideoRound(round)) {
      party.videoReplaySerial += 1;
      party.buzzWindowOpen = false;
      party.buzzOrder = [];
      this.syncActiveQuizProgressIntoScriptItem(party);
      this.touch(party);
      this.broadcast(party);
      return;
    }
    const qi = party.currentQuestionIndex;
    if (qi === null || qi < 0) {
      throw Object.assign(new Error("BAD_QUESTION"), { code: "BAD_QUESTION" });
    }
    const nextQ = qi + 1;
    if (nextQ < round.questions.length) {
      party.currentQuestionIndex = nextQ;
      party.buzzWindowOpen = false;
      party.buzzOrder = [];
      this.syncActiveQuizProgressIntoScriptItem(party);
      this.touch(party);
      this.broadcast(party);
      return;
    }
    throw Object.assign(
      new Error("Fin des questions de cette manche — passez à la suivante ou mettez en pause."),
      { code: "ROUND_EXHAUSTED" },
    );
  }

  adminAwardPoints(party: Party, playerId: string, delta: number): void {
    if (!Number.isInteger(delta))
      throw Object.assign(new Error("BAD_POINTS"), { code: "BAD_POINTS" });
    const player = party.players.get(playerId);
    if (!player)
      throw Object.assign(new Error("PLAYER_GONE"), { code: "PLAYER_GONE" });
    player.score = Math.max(0, player.score + delta);
    this.touch(party);
    this.broadcast(party);
  }
}
