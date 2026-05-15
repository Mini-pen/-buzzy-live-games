import type { Server } from "socket.io";

import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { partySnapshotWithGame } from "./domain/partySnapshotPresenter.js";
import { PartyStore } from "./domain/store.js";
import { loadBuzzSoundCatalog, resolveBuzzSoundPublicUrl } from "./games/buzzSoundCatalog.js";
import type { QuizPack } from "./games/pack.js";
import { getAvatarCatalog } from "./avatars/catalog.js";
import { scanQuizPacks } from "./games/pack.js";
import { attachSocketIO } from "./realtime/socket.js";

let socketRef: Server | undefined;
let quizPacksByRun: Map<string, QuizPack> | undefined;

async function main(): Promise<void> {
  const config = loadConfig();
  const packs = await scanQuizPacks(config.gamesDir);
  quizPacksByRun = packs;
  console.info(`Indexed ${packs.size} quiz pack(s) under ${config.gamesDir}`);

  const buzzCatalog = await loadBuzzSoundCatalog(config.gamesDir);
  console.info(`Buzz SFX catalogue: ${buzzCatalog.sounds.length} clip(s)`);

  const store = new PartyStore((partyId, party, meta) => {
    if (socketRef === undefined || quizPacksByRun === undefined) return;
    const packsSnap = quizPacksByRun;
    socketRef
      .to(`party:${partyId}:player`)
      .emit("party:patch", partySnapshotWithGame(party, packsSnap, "player"));
    socketRef
      .to(`party:${partyId}:admin`)
      .emit("party:patch", partySnapshotWithGame(party, packsSnap, "host"));
    socketRef
      .to(`party:${partyId}:broadcast`)
      .emit("party:patch", partySnapshotWithGame(party, packsSnap, "player"));
    if (meta?.kind === "buzz_fx") {
      if (!party.buzzSound.echoPlayerBuzzOnHost) return;
      const pl = party.players.get(meta.playerId);
      if (!pl) return;
      const sfx = buzzCatalog.byKey.get(pl.buzzSoundKey);
      if (!sfx) return;
      const url = resolveBuzzSoundPublicUrl(sfx);
      if (url === "") return;
      socketRef
        .to(`party:${partyId}:admin`)
        .emit("party:buzz_fx", { playerId: meta.playerId, url });
      return;
    }
    if (meta?.kind === "answer_fx") {
      const u = typeof meta.url === "string" ? meta.url.trim() : "";
      if (u === "") return;
      socketRef.to(`party:${partyId}:admin`).emit("party:answer_fx", { url: u });
      socketRef.to(`party:${partyId}:broadcast`).emit("party:answer_fx", { url: u });
    }
  }, buzzCatalog);

  const avatarN = getAvatarCatalog().length;
  console.info(avatarN > 0 ? `Avatar library: ${avatarN} file(s)` : "Avatar library: empty");

  const app = await buildApp({ config, packs, store, buzzCatalog });
  await app.ready();

  socketRef = attachSocketIO(app.server, { store, config });

  const sweep = (): void => {
    const removed = store.sweep(config.partySweepMaxAgeMs);
    if (removed > 0) {
      app.log.info({ removed }, "inactive parties swept");
    }
  };
  setInterval(sweep, config.partySweepIntervalMs).unref?.();

  await app.listen({
    host: config.host,
    port: config.port,
  });

  app.log.info(`Listening on ${config.host}:${config.port}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
