import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preHandlerHookHandler,
} from "fastify";

import { z } from "zod";

import type { AppConfig } from "../config.js";
import type { PartyStore } from "../domain/store.js";
import type { Party } from "../domain/types.js";
import { partySnapshotWithGame, quizPackFromLoadedId } from "../domain/partySnapshotPresenter.js";
import type { QuizPack } from "../games/pack.js";
import { readBearer } from "./bearer.js";
import { replyDomain } from "./replyDomain.js";
import {
  avatarPublicRelativePath,
  AVATAR_CATALOG,
  DEFAULT_AVATAR_KEY,
} from "../avatars/catalog.js";
import { youtubeWatchUrlToEmbedUrl } from "../domain/youtubeEmbed.js";

export interface PartyRouteDeps {
  store: PartyStore;
  packs: Map<string, QuizPack>;
  config: AppConfig;
}

const createPartySchema = z
  .object({
    playersUnlimited: z.boolean(),
    teamsUnlimited: z.boolean(),
    maxPlayers: z.number().int().min(2).max(500).optional(),
    maxTeams: z.number().int().min(2).max(40).optional(),
    closedAfterStart: z.boolean(),
    allowRename: z.boolean(),
    allowTeamChange: z.boolean(),
  })
  .superRefine((d, ctx) => {
    if (!d.playersUnlimited && d.maxPlayers === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "maxPlayers is required unless playersUnlimited=true",
        path: ["maxPlayers"],
      });
    }
    if (!d.teamsUnlimited && d.maxTeams === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "maxTeams is required unless teamsUnlimited=true",
        path: ["maxTeams"],
      });
    }
  });

const joinBodySchema = z.object({
  displayName: z.string().min(2).max(48),
  teamId: z.number().int().min(1).max(500).nullable().optional(),
  avatarKey: z.string().min(1).max(48).optional(),
});

const patchSelfSchema = z.object({
  displayName: z.string().min(2).max(48).optional(),
  teamId: z.number().int().min(1).max(500).nullable().optional(),
  avatarKey: z.string().min(1).max(48).optional(),
});

const chatSchema = z.object({
  text: z.string().min(1).max(480),
});

const awardSchema = z.object({
  delta: z.number().int().min(-999).max(999),
});

const buzzWindowSchema = z.object({
  open: z.boolean(),
});

const mancheIdSchema = z.object({
  id: z.string().min(1).max(40),
});

const mancheMoveSchema = z.object({
  id: z.string().min(1).max(40),
  direction: z.enum(["up", "down"]),
});

const addManchePackBody = z.object({
  kind: z.literal("pack_quiz"),
  title: z.string().min(1).max(160),
  packBasename: z.string().min(1).max(180),
});

const addMancheIframeBody = z
  .object({
    kind: z.literal("iframe"),
    title: z.string().min(1).max(160),
    url: z.string().url().max(2048),
  })
  .refine((b) => b.url.startsWith("https:"), {
    message: "HTTPS_REQUIRED",
    path: ["url"],
  });

const addMancheYoutubeBody = z.object({
  kind: z.literal("youtube"),
  title: z.string().min(1).max(160),
  url: z.string().min(1).max(500),
});

const addMancheDirectVideoBody = z
  .object({
    kind: z.literal("direct_video"),
    title: z.string().min(1).max(160),
    url: z.string().url().max(2048),
  })
  .refine((b) => b.url.startsWith("https:"), {
    message: "HTTPS_REQUIRED",
    path: ["url"],
  });

const addMancheBody = z.union([
  addManchePackBody,
  addMancheIframeBody,
  addMancheYoutubeBody,
  addMancheDirectVideoBody,
]);

function requireParty(store: PartyStore, id: string) {
  const normalized = id.trim().toLowerCase();
  const party = store.get(normalized);
  if (!party) {
    const err = Object.assign(new Error("NOT_FOUND"), { code: "NOT_FOUND" });
    throw err;
  }
  return party;
}

export async function registerPartyRoutes(
  app: FastifyInstance,
  deps: PartyRouteDeps,
): Promise<void> {
  const { store, packs, config } = deps;

  const snapPlayer = (party: Party): ReturnType<typeof partySnapshotWithGame> =>
    partySnapshotWithGame(party, packs, "player");

  const snapHost = (party: Party): ReturnType<typeof partySnapshotWithGame> =>
    partySnapshotWithGame(party, packs, "host");

  const gatePlayerJwt: preHandlerHookHandler = async (
    req: FastifyRequest,
    reply: FastifyReply,
  ) => {
    try {
      await req.jwtVerify();
    } catch {
      return reply.status(401).send({ error: "UNAUTHORIZED" });
    }
  };

  app.get("/api/health", async () => ({
    ok: true,
    ts: Date.now(),
  }));

  app.get("/api/packs", async () => ({
    packs: [...packs.entries()].map(([basename, p]) => ({
      basename,
      id: p.id,
      title: p.title,
      version: p.version,
      roundCount: p.rounds.length,
    })),
  }));

  app.get("/api/avatars", async () => ({
    defaultKey: DEFAULT_AVATAR_KEY,
    avatars: AVATAR_CATALOG.map((entry) => ({
      key: entry.key,
      label: entry.label,
      url: avatarPublicRelativePath(entry.key),
    })),
  }));

  app.get<{ Params: { joinCode: string } }>(
    "/api/parties/meta-by-code/:joinCode",
    async (req, reply) => {
      try {
        const party = store.getByJoinCode(req.params.joinCode);
        if (!party) throw Object.assign(new Error("NOT_FOUND"), { code: "NOT_FOUND" });
        return { partyId: party.id, snapshot: snapPlayer(party) };
      } catch (err) {
        return replyDomain(reply, err);
      }
    },
  );

  app.post("/api/parties", async (req, reply) => {
    try {
      const body = createPartySchema.parse(req.body ?? {});
      const maxPlayers = body.playersUnlimited ? null : body.maxPlayers ?? null;
      const maxTeams = body.teamsUnlimited ? null : body.maxTeams ?? null;
      if (body.playersUnlimited !== true && maxPlayers === null) {
        return reply.status(400).send({ error: "INVALID_PAYLOAD" });
      }
      if (body.teamsUnlimited !== true && (maxTeams === null || maxTeams < 2)) {
        return reply.status(400).send({ error: "INVALID_PAYLOAD" });
      }

      const party = store.createParty({
        maxPlayers,
        maxTeams,
        closedAfterStart: body.closedAfterStart,
        allowRename: body.allowRename,
        allowTeamChange: body.allowTeamChange,
      });

      const joinRelative = `/join?code=${encodeURIComponent(party.joinCode)}`;

      const joinUrl = `${config.publicUrl}${joinRelative}`;
      const adminUrl = `${config.publicUrl}/party/${party.id}/admin#token=${encodeURIComponent(party.adminToken)}`;

      return reply.status(201).send({
        partyId: party.id,
        joinCode: party.joinCode,
        adminToken: party.adminToken,
        joinUrl,
        adminUrl,
        joinRelative,
        snapshot: snapPlayer(party),
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return reply.status(400).send({ error: "VALIDATION", issues: err.issues });
      }
      return replyDomain(reply, err);
    }
  });

  app.get<{ Params: { partyId: string } }>(
    "/api/parties/:partyId",
    async (req, reply) => {
      try {
        const party = requireParty(store, req.params.partyId);
        const token = readBearer(req.headers.authorization);
        if (typeof token === "string" && token.trim() !== "") {
          if (store.verifyAdminToken(party, token)) return snapHost(party);
          return reply.status(401).send({ error: "UNAUTHORIZED" });
        }
        return snapPlayer(party);
      } catch (err) {
        return replyDomain(reply, err);
      }
    },
  );

  app.post<{ Params: { partyId: string } }>(
    "/api/parties/:partyId/join",
    async (req, reply) => {
      try {
        const body = joinBodySchema.parse(req.body ?? {});
        const party = requireParty(store, req.params.partyId);
        const player = store.joinPlayer(party, body.displayName, body.teamId, body.avatarKey);
        const token = await app.jwt.sign({ pid: party.id, sub: player.id });
        return reply.status(201).send({
          playerId: player.id,
          playerToken: token,
          snapshot: snapPlayer(party),
        });
      } catch (err) {
        if (err instanceof z.ZodError) {
          return reply.status(400).send({ error: "VALIDATION", issues: err.issues });
        }
        return replyDomain(reply, err);
      }
    },
  );

  app.patch<{ Params: { partyId: string } }>(
    "/api/parties/:partyId/me",
    {
      preHandler: [gatePlayerJwt],
    },
    async (req, reply) => {
      try {
        const parsed = patchSelfSchema.parse(req.body ?? {});
        const principal = req.user instanceof Object ? req.user : null;
        interface U {
          pid?: string;
          sub?: string;
        }
        const u = principal as U;
        const partyId = u.pid;
        const playerId = u.sub;
        if (typeof partyId !== "string" || typeof playerId !== "string") {
          return reply.status(401).send({ error: "UNAUTHORIZED" });
        }
        if (partyId !== req.params.partyId) {
          return reply.status(403).send({ error: "FORBIDDEN" });
        }
        const party = requireParty(store, partyId);
        store.patchPlayerSelf(party, playerId, parsed);
        return snapPlayer(party);
      } catch (err) {
        if (err instanceof z.ZodError) {
          return reply.status(400).send({ error: "VALIDATION", issues: err.issues });
        }
        return replyDomain(reply, err);
      }
    },
  );

  app.post<{ Params: { partyId: string } }>(
    "/api/parties/:partyId/me/chat",
    {
      preHandler: [gatePlayerJwt],
    },
    async (req, reply) => {
      try {
        const body = chatSchema.parse(req.body ?? {});
        const principal = req.user instanceof Object ? req.user : null;
        const u = principal as { pid?: string; sub?: string };
        const partyId = u.pid;
        const playerId = u.sub;
        if (typeof partyId !== "string" || typeof playerId !== "string") {
          return reply.status(401).send({ error: "UNAUTHORIZED" });
        }
        if (partyId !== req.params.partyId)
          return reply.status(403).send({ error: "FORBIDDEN" });
        const party = requireParty(store, partyId);
        const player = party.players.get(playerId);
        if (!player) return reply.status(410).send({ error: "PLAYER_GONE" });
        store.appendChat(party, playerId, player.displayName, body.text);
        return snapPlayer(party);
      } catch (err) {
        if (err instanceof z.ZodError) {
          return reply.status(400).send({ error: "VALIDATION", issues: err.issues });
        }
        return replyDomain(reply, err);
      }
    },
  );

  app.post<{ Params: { partyId: string } }>(
    "/api/parties/:partyId/me/buzz",
    {
      preHandler: [gatePlayerJwt],
    },
    async (req, reply) => {
      try {
        const principal = req.user instanceof Object ? req.user : null;
        const u = principal as { pid?: string; sub?: string };
        const partyId = u.pid;
        const playerId = u.sub;
        if (typeof partyId !== "string" || typeof playerId !== "string") {
          return reply.status(401).send({ error: "UNAUTHORIZED" });
        }
        if (partyId !== req.params.partyId)
          return reply.status(403).send({ error: "FORBIDDEN" });
        const party = requireParty(store, partyId);
        store.buzz(party, playerId);
        return snapPlayer(party);
      } catch (err) {
        return replyDomain(reply, err);
      }
    },
  );

  /* ----- Host (admin token) ----- */

  app.post<{ Params: { partyId: string } }>(
    "/api/parties/:partyId/host/cue/next",
    async (req, reply) => {
      try {
        const party = requireParty(store, req.params.partyId);
        const token = readBearer(req.headers.authorization);
        if (!store.verifyAdminToken(party, token))
          return reply.status(401).send({ error: "UNAUTHORIZED" });
        const loaded = quizPackFromLoadedId(packs, party.loadedPackId);
        if (!loaded)
          throw Object.assign(new Error("PACK_NOT_FOUND"), { code: "PACK_NOT_FOUND" });
        store.adminAdvanceCue(party, loaded);
        return snapHost(party);
      } catch (err) {
        return replyDomain(reply, err);
      }
    },
  );

  app.post<{ Params: { partyId: string } }>(
    "/api/parties/:partyId/host/round/pause",
    async (req, reply) => {
      try {
        const party = requireParty(store, req.params.partyId);
        const token = readBearer(req.headers.authorization);
        if (!store.verifyAdminToken(party, token))
          return reply.status(401).send({ error: "UNAUTHORIZED" });
        store.adminPauseToLobby(party);
        return snapHost(party);
      } catch (err) {
        return replyDomain(reply, err);
      }
    },
  );

  app.post<{ Params: { partyId: string } }>(
    "/api/parties/:partyId/host/buzz-window",
    async (req, reply) => {
      try {
        const body = buzzWindowSchema.parse(req.body ?? {});
        const party = requireParty(store, req.params.partyId);
        const token = readBearer(req.headers.authorization);
        if (!store.verifyAdminToken(party, token))
          return reply.status(401).send({ error: "UNAUTHORIZED" });
        store.adminSetBuzzOpen(party, body.open);
        return snapHost(party);
      } catch (err) {
        if (err instanceof z.ZodError) {
          return reply.status(400).send({ error: "VALIDATION", issues: err.issues });
        }
        return replyDomain(reply, err);
      }
    },
  );

  app.patch<{ Params: { partyId: string; playerId: string } }>(
    "/api/parties/:partyId/host/players/:playerId/score",
    async (req, reply) => {
      try {
        const deltaBody = awardSchema.parse(req.body ?? {});
        const party = requireParty(store, req.params.partyId);
        const token = readBearer(req.headers.authorization);
        if (!store.verifyAdminToken(party, token))
          return reply.status(401).send({ error: "UNAUTHORIZED" });
        store.adminAwardPoints(party, req.params.playerId, deltaBody.delta);
        return snapHost(party);
      } catch (err) {
        if (err instanceof z.ZodError) {
          return reply.status(400).send({ error: "VALIDATION", issues: err.issues });
        }
        return replyDomain(reply, err);
      }
    },
  );

  app.post<{ Params: { partyId: string } }>(
    "/api/parties/:partyId/host/manche/add",
    async (req, reply) => {
      try {
        const party = requireParty(store, req.params.partyId);
        const token = readBearer(req.headers.authorization);
        if (!store.verifyAdminToken(party, token))
          return reply.status(401).send({ error: "UNAUTHORIZED" });
        const body = addMancheBody.parse(req.body ?? {});

        if (body.kind === "pack_quiz") {
          const basename = body.packBasename.replace(/\.json$/u, "");
          if (!packs.get(basename)) {
            throw Object.assign(new Error("PACK_NOT_FOUND"), {
              code: "PACK_NOT_FOUND",
            });
          }
          store.hostAppendManche(party, {
            kind: "pack_quiz",
            title: body.title.trim(),
            packBasename: basename,
            iframeUrl: null,
            youtubeEmbedUrl: null,
            directVideoUrl: null,
            savedRoundIndex: 0,
            savedQuestionIndex: 0,
          });
        } else if (body.kind === "iframe") {
          store.hostAppendManche(party, {
            kind: "iframe",
            title: body.title.trim(),
            packBasename: null,
            iframeUrl: body.url,
            youtubeEmbedUrl: null,
            directVideoUrl: null,
            savedRoundIndex: 0,
            savedQuestionIndex: 0,
          });
        } else if (body.kind === "youtube") {
          const embed = youtubeWatchUrlToEmbedUrl(body.url);
          if (embed === null) {
            throw Object.assign(new Error("BAD_YOUTUBE_URL"), {
              code: "BAD_YOUTUBE_URL",
            });
          }
          store.hostAppendManche(party, {
            kind: "youtube",
            title: body.title.trim(),
            packBasename: null,
            iframeUrl: null,
            youtubeEmbedUrl: embed,
            directVideoUrl: null,
            savedRoundIndex: 0,
            savedQuestionIndex: 0,
          });
        } else {
          store.hostAppendManche(party, {
            kind: "direct_video",
            title: body.title.trim(),
            packBasename: null,
            iframeUrl: null,
            youtubeEmbedUrl: null,
            directVideoUrl: body.url,
            savedRoundIndex: 0,
            savedQuestionIndex: 0,
          });
        }

        return snapHost(party);
      } catch (err) {
        if (err instanceof z.ZodError) {
          return reply.status(400).send({ error: "VALIDATION", issues: err.issues });
        }
        return replyDomain(reply, err);
      }
    },
  );

  app.post<{ Params: { partyId: string } }>(
    "/api/parties/:partyId/host/manche/remove",
    async (req, reply) => {
      try {
        const party = requireParty(store, req.params.partyId);
        const token = readBearer(req.headers.authorization);
        if (!store.verifyAdminToken(party, token))
          return reply.status(401).send({ error: "UNAUTHORIZED" });
        store.hostRemoveManche(party, mancheIdSchema.parse(req.body ?? {}).id);
        return snapHost(party);
      } catch (err) {
        if (err instanceof z.ZodError) {
          return reply.status(400).send({ error: "VALIDATION", issues: err.issues });
        }
        return replyDomain(reply, err);
      }
    },
  );

  app.post<{ Params: { partyId: string } }>(
    "/api/parties/:partyId/host/manche/move",
    async (req, reply) => {
      try {
        const party = requireParty(store, req.params.partyId);
        const token = readBearer(req.headers.authorization);
        if (!store.verifyAdminToken(party, token))
          return reply.status(401).send({ error: "UNAUTHORIZED" });
        const b = mancheMoveSchema.parse(req.body ?? {});
        store.hostMoveManche(party, b.id, b.direction === "up" ? -1 : 1);
        return snapHost(party);
      } catch (err) {
        if (err instanceof z.ZodError) {
          return reply.status(400).send({ error: "VALIDATION", issues: err.issues });
        }
        return replyDomain(reply, err);
      }
    },
  );

  app.post<{ Params: { partyId: string } }>(
    "/api/parties/:partyId/host/manche/play",
    async (req, reply) => {
      try {
        const party = requireParty(store, req.params.partyId);
        const token = readBearer(req.headers.authorization);
        if (!store.verifyAdminToken(party, token))
          return reply.status(401).send({ error: "UNAUTHORIZED" });
        store.hostPlayMancheById(party, mancheIdSchema.parse(req.body ?? {}).id, packs);
        return snapHost(party);
      } catch (err) {
        if (err instanceof z.ZodError) {
          return reply.status(400).send({ error: "VALIDATION", issues: err.issues });
        }
        return replyDomain(reply, err);
      }
    },
  );

  app.post<{ Params: { partyId: string } }>(
    "/api/parties/:partyId/host/chat",
    async (req, reply) => {
      try {
        const body = chatSchema.parse(req.body ?? {});
        const party = requireParty(store, req.params.partyId);
        const token = readBearer(req.headers.authorization);
        if (!store.verifyAdminToken(party, token))
          return reply.status(401).send({ error: "UNAUTHORIZED" });
        store.appendHostChat(party, body.text);
        return snapHost(party);
      } catch (err) {
        if (err instanceof z.ZodError) {
          return reply.status(400).send({ error: "VALIDATION", issues: err.issues });
        }
        return replyDomain(reply, err);
      }
    },
  );
}
