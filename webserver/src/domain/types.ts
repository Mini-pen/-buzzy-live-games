/** * Lifecycle of a party from the server's perspective. */
export type PartyState = "lobby" | "round_active" | "between_rounds" | "ended";

export interface ChatEntry {
  id: string;
  playerId: string;
  /** * Display snapshot at send time — avoids lookups if player leaves. */
  displayName: string;
  text: string;
  at: number;
}

export interface Player {
  id: string;
  displayName: string;
  /** * 1-based team index when teams are enabled; otherwise null. */
  teamId: number | null;
  score: number;
  joinedAt: number;
}

export interface Party {
  id: string;
  joinCode: string;
  /** * Opaque Bearer token for the host UI (never share in QR/player links). */
  adminToken: string;
  createdAt: number;
  updatedAt: number;
  state: PartyState;
  /** * Once true, joins are forbidden if `closedAfterStart` holds. */
  hasStartedRound: boolean;
  maxPlayers: number | null;
  maxTeams: number | null;
  closedAfterStart: boolean;
  allowRename: boolean;
  allowTeamChange: boolean;
  players: Map<string, Player>;
  /** * Player IDs in buzz order during an active buzz window. */
  buzzOrder: string[];
  buzzWindowOpen: boolean;
  chat: ChatEntry[];
  currentRoundIndex: number | null;
  currentQuestionIndex: number | null;
  loadedPackId: string | null;
  /** * Increments when the host replays a video round (“next” on `kind: video`). */
  videoReplaySerial: number;
}

/** * Buzzer-visible quiz surface (`kind: quiz`). */
export interface PartyGameBoardQuiz {
  kind: "quiz";
  packTitle: string;
  roundIndex: number;
  roundTitle: string;
  roundNumberHuman: number;
  questionIndexInRound: number;
  prompt: string;
  choices: string[];
  points: number;
  /** * Present only when the snapshot is assembled for an authenticated host. */
  correctChoiceIndex?: number;
}

/** * Video segment surface; `replaySerial` forces clients to remount the `<video>` element. */
export interface PartyGameBoardVideo {
  kind: "video";
  packTitle: string;
  roundIndex: number;
  roundTitle: string;
  roundNumberHuman: number;
  videoUrl: string;
  replaySerial: number;
}

export type PartyGameBoardSurface = PartyGameBoardQuiz | PartyGameBoardVideo;

export interface PartyPublicSnapshot {
  id: string;
  joinCode: string;
  createdAt: number;
  updatedAt: number;
  state: PartyState;
  hasStartedRound: boolean;
  maxPlayers: number | null;
  maxTeams: number | null;
  closedAfterStart: boolean;
  allowRename: boolean;
  allowTeamChange: boolean;
  playerCount: number;
  buzzOrder: string[];
  buzzWindowOpen: boolean;
  players: Array<{
    id: string;
    displayName: string;
    teamId: number | null;
    score: number;
  }>;
  teamScores: Record<string, number>;
  chatTail: ChatEntry[];
  /** * Indices into `loadedPackId` quiz JSON; surfaced for sync; see `gameBoard` for wording. */
  currentRoundIndex: number | null;
  currentQuestionIndex: number | null;
  /** * Non-null during `round_active` when the loaded pack resolves the indices. */
  gameBoard: PartyGameBoardSurface | null;
}

/** * Stored inside the player JWT (`pid` mandatory; Fastify validates `sub` as player id). */
export interface JwtPlayerPayload {
  pid: string;
  sub?: string;
}
