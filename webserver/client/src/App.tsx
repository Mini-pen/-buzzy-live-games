import type { JSX } from "react";
import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, Route, Routes, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { io, type Socket } from "socket.io-client";

/** * Quiz surface from `PartyPublicSnapshot.gameBoard`. */
interface PartyGameBoardQuiz {
  kind: "quiz";
  packTitle: string;
  roundIndex: number;
  roundTitle: string;
  roundNumberHuman: number;
  questionIndexInRound: number;
  prompt: string;
  choices: string[];
  points: number;
  correctChoiceIndex?: number;
}

/** * Video clip surface; `replaySerial` changes restart playback on clients. */
interface PartyGameBoardVideo {
  kind: "video";
  packTitle: string;
  roundIndex: number;
  roundTitle: string;
  roundNumberHuman: number;
  videoUrl: string;
  replaySerial: number;
}

/** * External page shown inside an iframe manche. */
interface PartyGameBoardIframe {
  kind: "iframe";
  title: string;
  url: string;
  replaySerial: number;
}

/** * YouTube embed manche (`embedUrl` is already normalised server-side). */
interface PartyGameBoardYoutube {
  kind: "youtube";
  title: string;
  embedUrl: string;
  replaySerial: number;
}

type PartyGameBoardSurface =
  | PartyGameBoardQuiz
  | PartyGameBoardVideo
  | PartyGameBoardIframe
  | PartyGameBoardYoutube;

/** * Host-visible manche descriptor (mirror of `PartyPublicSnapshot.mancheScript`). */
interface MancheCatalogItemView {
  id: string;
  kind: "pack_quiz" | "iframe" | "youtube" | "direct_video";
  title: string;
  packBasename: string | null;
  iframeUrl: string | null;
  youtubeEmbedUrl: string | null;
  directVideoUrl: string | null;
  savedRoundIndex: number;
  savedQuestionIndex: number;
}

interface PartySnapshot {
  id: string;
  joinCode: string;
  state: string;
  buzzOrder: string[];
  buzzWindowOpen: boolean;
  allowRename: boolean;
  allowTeamChange: boolean;
  maxTeams: number | null;
  closedAfterStart: boolean;
  hasStartedRound: boolean;
  players: Array<{
    id: string;
    displayName: string;
    avatarUrl: string;
    teamId: number | null;
    score: number;
  }>;
  teamScores: Record<string, number>;
  chatTail: Array<{ id: string; displayName: string; text: string; at: number }>;
  currentRoundIndex?: number | null;
  currentQuestionIndex?: number | null;
  gameBoard?: PartyGameBoardSurface | null;
  mancheScript: MancheCatalogItemView[];
  activeMancheId: string | null;
}

/** * Compact label for animateur lists. */
function mancheKindShort(kind: MancheCatalogItemView["kind"]): string {
  switch (kind) {
    case "pack_quiz":
      return "Quiz";
    case "iframe":
      return "Page";
    case "youtube":
      return "YouTube";
    case "direct_video":
      return "Vidéo";
    default:
      return kind;
  }
}

/** * Decorative round mascot image — surrounding context supplies the audible name. */
function AvatarFigure(props: { src: string; sizePx: number }): JSX.Element {
  return (
    <img
      src={props.src}
      alt=""
      width={props.sizePx}
      height={props.sizePx}
      decoding="async"
      style={{
        flexShrink: 0,
        objectFit: "cover",
        borderRadius: "50%",
        border: "1px solid #ccc",
      }}
    />
  );
}

function playerSessionKey(pid: string): string {
  return `partygames:playerJwt:${pid.trim().toLowerCase()}`;
}

function adminSessionKey(pid: string): string {
  return `partygames:adminToken:${pid.trim().toLowerCase()}`;
}

/** * Case-insensitive lookup for admin token (URL path vs legacy storage key mismatch). */
function findAdminBearerForPartyRouteId(routePartyIdRaw: string): string | null {
  if (routePartyIdRaw.trim() === "" || typeof globalThis.sessionStorage === "undefined")
    return null;
  const needle = routePartyIdRaw.trim().toLowerCase();
  const prefix = "partygames:adminToken:";
  let foundKey: string | null = null;
  let tok: string | null = null;
  for (let i = 0; i < sessionStorage.length; i += 1) {
    const k = sessionStorage.key(i);
    if (k === null || !k.startsWith(prefix)) continue;
    const idPart = k.slice(prefix.length);
    if (idPart.toLowerCase() === needle) {
      const t = sessionStorage.getItem(k);
      if (typeof t === "string" && t.length > 0) {
        foundKey = k;
        tok = t;
        break;
      }
    }
  }
  if (tok !== null && foundKey !== null && foundKey !== adminSessionKey(needle)) {
    sessionStorage.setItem(adminSessionKey(needle), tok);
    sessionStorage.removeItem(foundKey);
  }
  return tok;
}

/** * Case-insensitive lookup for player JWT (same issue as admin keys). */
function findPlayerJwtForPartyRouteId(routePartyIdRaw: string): string | null {
  if (routePartyIdRaw.trim() === "" || typeof globalThis.sessionStorage === "undefined")
    return null;
  const needle = routePartyIdRaw.trim().toLowerCase();
  const prefix = "partygames:playerJwt:";
  let foundKey: string | null = null;
  let tok: string | null = null;
  for (let i = 0; i < sessionStorage.length; i += 1) {
    const k = sessionStorage.key(i);
    if (k === null || !k.startsWith(prefix)) continue;
    const idPart = k.slice(prefix.length);
    if (idPart.toLowerCase() === needle) {
      const t = sessionStorage.getItem(k);
      if (typeof t === "string" && t.length > 0) {
        foundKey = k;
        tok = t;
        break;
      }
    }
  }
  if (tok !== null && foundKey !== null && foundKey !== playerSessionKey(needle)) {
    sessionStorage.setItem(playerSessionKey(needle), tok);
    sessionStorage.removeItem(foundKey);
  }
  return tok;
}

/** * Normalizes party id from the route (store + API use lowercase UUIDs). */
function canonicalPartyIdFromRoute(param: string | undefined): string {
  return (param ?? "").trim().toLowerCase();
}

/** * Browser-only: restores admin Bearer from `#token=` or sessionStorage synchronously on first paint. */
function peekAdminBearer(routePartyIdRaw: string): string | null {
  if (routePartyIdRaw.trim() === "" || typeof globalThis.window === "undefined") return null;
  const pidNorm = canonicalPartyIdFromRoute(routePartyIdRaw);
  const rawHash = window.location.hash;
  const h =
    typeof rawHash === "string" && rawHash.startsWith("#") ? rawHash.slice(1) : "";
  const frag = new URLSearchParams(h).get("token");
  let t = findAdminBearerForPartyRouteId(routePartyIdRaw);
  if (frag !== null && frag.length > 0) {
    sessionStorage.setItem(adminSessionKey(pidNorm), frag);
    window.history.replaceState({}, "", `${window.location.pathname}${window.location.search}`);
    return frag;
  }
  return typeof t === "string" && t.length > 0 ? t : null;
}

/** * Browser-only: player JWT persisted for `/party/:id/play` hydration before first React commit. */
function peekPlayerJwt(routePartyIdRaw: string): string | null {
  if (routePartyIdRaw === "" || typeof globalThis.sessionStorage === "undefined") return null;
  return findPlayerJwtForPartyRouteId(routePartyIdRaw);
}

/** * Last party id hints (tab session). Same browser session scope as a cookie for this SPA. */
const STORAGE_LAST_PLAYER_PARTY = "partygames:lastPlayerPartyId";
const STORAGE_LAST_PLAYER_CODE = "partygames:lastPlayerJoinCode";
const STORAGE_LAST_ADMIN_PARTY = "partygames:lastAdminPartyId";

/** * Drops every stale admin Bearer key tied to `routePartyIdRaw` plus `lastAdminParty` hint when it matches (case-insensitive id suffix). */
function purgeAdminSessionForPartyRouteId(routePartyIdRaw: string): void {
  if (typeof globalThis.sessionStorage === "undefined") return;
  const needle = canonicalPartyIdFromRoute(routePartyIdRaw);
  if (needle === "") return;
  const prefix = "partygames:adminToken:";
  const keysToDrop: string[] = [];
  for (let i = 0; i < sessionStorage.length; i += 1) {
    const k = sessionStorage.key(i);
    if (k === null || !k.startsWith(prefix)) continue;
    const idSuffix = k.slice(prefix.length);
    if (canonicalPartyIdFromRoute(idSuffix) === needle) keysToDrop.push(k);
  }
  for (const k of keysToDrop) sessionStorage.removeItem(k);

  const last = sessionStorage.getItem(STORAGE_LAST_ADMIN_PARTY);
  if (last !== null && canonicalPartyIdFromRoute(last) === needle) {
    sessionStorage.removeItem(STORAGE_LAST_ADMIN_PARTY);
  }

  if (typeof globalThis.window === "undefined") return;
  const rawHash = window.location.hash;
  if (rawHash === "" || rawHash === "#") return;
  const frag = rawHash.startsWith("#") ? rawHash.slice(1) : rawHash;
  try {
    const hp = new URLSearchParams(frag);
    if (hp.has("token")) {
      window.history.replaceState({}, "", `${window.location.pathname}${window.location.search}`);
    }
  } catch {
    /* noop */
  }
}

/** * Records the player party id for the home page resume link; join code is optional display cache. */
function rememberPlayerParty(partyId: string, joinCode?: string): void {
  if (typeof globalThis.sessionStorage === "undefined") return;
  const id = canonicalPartyIdFromRoute(partyId);
  if (id === "") return;
  sessionStorage.setItem(STORAGE_LAST_PLAYER_PARTY, id);
  if (joinCode !== undefined && joinCode !== "")
    sessionStorage.setItem(STORAGE_LAST_PLAYER_CODE, joinCode);
}

/** * Records the admin party id after create or when the host panel is open with a valid token. */
function rememberAdminParty(partyId: string): void {
  if (typeof globalThis.sessionStorage === "undefined") return;
  const id = canonicalPartyIdFromRoute(partyId);
  if (id === "") return;
  sessionStorage.setItem(STORAGE_LAST_ADMIN_PARTY, id);
}

function listPartyIdsWithStoredPlayerJwt(): string[] {
  if (typeof globalThis.sessionStorage === "undefined") return [];
  const prefix = "partygames:playerJwt:";
  const ids: string[] = [];
  for (let i = 0; i < sessionStorage.length; i += 1) {
    const k = sessionStorage.key(i);
    if (k === null || !k.startsWith(prefix)) continue;
    const id = k.slice(prefix.length);
    const tok = sessionStorage.getItem(k);
    if (typeof tok === "string" && tok.length > 0) ids.push(id);
  }
  ids.sort();
  return ids;
}

function listPartyIdsWithStoredAdminToken(): string[] {
  if (typeof globalThis.sessionStorage === "undefined") return [];
  const prefix = "partygames:adminToken:";
  const ids: string[] = [];
  for (let i = 0; i < sessionStorage.length; i += 1) {
    const k = sessionStorage.key(i);
    if (k === null || !k.startsWith(prefix)) continue;
    const id = k.slice(prefix.length);
    const tok = sessionStorage.getItem(k);
    if (typeof tok === "string" && tok.length > 0) ids.push(id);
  }
  ids.sort();
  return ids;
}

/** * Party id if a player JWT is still in session for this tab. */
function resolvePlayerPartyIdToResume(): string | null {
  if (typeof globalThis.sessionStorage === "undefined") return null;
  const last = sessionStorage.getItem(STORAGE_LAST_PLAYER_PARTY);
  if (last !== null && last !== "" && findPlayerJwtForPartyRouteId(last) !== null) {
    const c = canonicalPartyIdFromRoute(last);
    return c === "" ? null : c;
  }
  const all = listPartyIdsWithStoredPlayerJwt();
  if (all.length === 0) return null;
  const c = canonicalPartyIdFromRoute(all[0] ?? "");
  return c === "" ? null : c;
}

/** * Party id if an admin token is still in session for this tab. */
function resolveAdminPartyIdToResume(): string | null {
  if (typeof globalThis.sessionStorage === "undefined") return null;
  const last = sessionStorage.getItem(STORAGE_LAST_ADMIN_PARTY);
  if (last !== null && last !== "" && findAdminBearerForPartyRouteId(last) !== null) {
    const c = canonicalPartyIdFromRoute(last);
    return c === "" ? null : c;
  }
  const all = listPartyIdsWithStoredAdminToken();
  if (all.length === 0) return null;
  const c = canonicalPartyIdFromRoute(all[0] ?? "");
  return c === "" ? null : c;
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const text = await r.text();
  if (!r.ok) throw new Error(text || `${r.status}`);
  return text === "" ? (undefined as T) : (JSON.parse(text) as T);
}

function Shell(props: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="bz-app">
      <div style={{ maxWidth: 880, margin: "0 auto", padding: "0 24px 48px" }}>
        <header className="bz-header">
          <Link to="/" className="bz-logo" style={{ fontSize: 24 }}>
            <span>buzzy</span>
            <span className="bz-logo-dot" />
          </Link>
          <span className="bz-page-title">{props.title}</span>
          <nav>
            <Link to="/">Accueil</Link>
            <Link to="/create">Créer</Link>
            <Link to="/join">Rejoindre</Link>
          </nav>
        </header>
        {props.children}
      </div>
    </div>
  );
}

function Home(): JSX.Element {
  const [playerResume, setPlayerResume] = useState<{
    partyId: string;
    joinCode: string;
  } | null>(null);
  const [adminResume, setAdminResume] = useState<{
    partyId: string;
    joinCode: string;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadResume(): Promise<void> {
      if (typeof globalThis.sessionStorage === "undefined") return;
      const pidP = resolvePlayerPartyIdToResume();
      const pidA = resolveAdminPartyIdToResume();
      let pRes: { partyId: string; joinCode: string } | null = null;
      let aRes: { partyId: string; joinCode: string } | null = null;
      if (pidP !== null) {
        const lastStored = sessionStorage.getItem(STORAGE_LAST_PLAYER_PARTY);
        const cachedCode =
          lastStored === pidP ? sessionStorage.getItem(STORAGE_LAST_PLAYER_CODE) ?? "" : "";
        try {
          const s = await fetchJson<PartySnapshot>(
            `/api/parties/${encodeURIComponent(pidP)}`,
          );
          pRes = { partyId: pidP, joinCode: s.joinCode };
        } catch {
          pRes = {
            partyId: pidP,
            joinCode: cachedCode.length >= 4 ? cachedCode : "",
          };
        }
      }
      if (pidA !== null) {
        try {
          const s = await fetchJson<PartySnapshot>(
            `/api/parties/${encodeURIComponent(pidA)}`,
          );
          aRes = { partyId: pidA, joinCode: s.joinCode };
        } catch {
          aRes = { partyId: pidA, joinCode: "" };
        }
      }
      if (!cancelled) {
        setPlayerResume(pRes);
        setAdminResume(aRes);
      }
    }
    void loadResume();
    function onVis(): void {
      if (document.visibilityState === "visible") void loadResume();
    }
    document.addEventListener("visibilitychange", onVis);
    return (): void => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  return (
    <Shell title="Accueil">
      <section className="bz-hero">
        <span className="bz-eyebrow">Live quiz · soirées en temps réel</span>
        <h1 className="bz-hero-title">
          Le buzzer<br />dans la poche.
        </h1>
        <p className="bz-hero-lead">
          Un code, un QR, et tes joueurs buzzent depuis leur téléphone
          pendant que tu fais défiler les questions ou la vidéo — tout
          est synchronisé.
        </p>
        <div className="bz-cta-row">
          <Link to="/create" className="bz-cta bz-primary">
            Créer une partie
          </Link>
          <Link to="/join" className="bz-cta">
            Rejoindre avec un code
          </Link>
        </div>
      </section>

      {(playerResume !== null || adminResume !== null) ? (
        <section className="bz-resume-grid">
          {playerResume !== null ? (
            <Link
              to={`/party/${encodeURIComponent(playerResume.partyId)}/play`}
              className="bz-card bz-resume-card"
            >
              <span className="bz-pill bz-accent">session joueur</span>
              <h2>Reprendre le lobby</h2>
              <p>
                Une session joueur est enregistrée dans cet onglet —
                tu peux retourner directement dans la partie.
              </p>
              <span className="bz-resume-foot">
                {playerResume.joinCode.length >= 4 ? (
                  <>code <code className="bz-code">{playerResume.joinCode}</code></>
                ) : (
                  <>session active</>
                )}
                <span className="bz-arrow" aria-hidden="true">→</span>
              </span>
            </Link>
          ) : null}

          {adminResume !== null ? (
            <Link
              to={`/party/${encodeURIComponent(adminResume.partyId)}/admin`}
              className="bz-card bz-resume-card"
            >
              <span className="bz-pill bz-info">jeton animateur</span>
              <h2>Reprendre le tableau</h2>
              <p>
                Ton jeton d'animateur est encore actif sur ce navigateur —
                tu peux rouvrir le tableau de cette partie.
              </p>
              <span className="bz-resume-foot">
                {adminResume.joinCode.length >= 4 ? (
                  <>code joueurs <code className="bz-code">{adminResume.joinCode}</code></>
                ) : (
                  <>jeton actif</>
                )}
                <span className="bz-arrow" aria-hidden="true">→</span>
              </span>
            </Link>
          ) : null}
        </section>
      ) : null}
    </Shell>
  );
}

function Join(): JSX.Element {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const [code, setCode] = useState(params.get("code") ?? "");
  const [partyId, setPartyId] = useState(() =>
    canonicalPartyIdFromRoute(params.get("party") ?? ""),
  );
  const [snap, setSnap] = useState<PartySnapshot | null>(null);
  const [name, setName] = useState("");
  const [teamId, setTeamId] = useState<number>(1);
  /** * Slug echoed to `POST /join` — initialised once `/api/avatars` loads. */
  const [avatarKeyChosen, setAvatarKeyChosen] = useState("");
  const [avatarsLib, setAvatarsLib] = useState<{
    defaultKey: string;
    avatars: Array<{ key: string; label: string; url: string }>;
  } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void fetchJson<{
      defaultKey: string;
      avatars: Array<{ key: string; label: string; url: string }>;
    }>(`/api/avatars`).then(setAvatarsLib);
  }, []);

  useEffect(() => {
    const c = params.get("code") ?? "";
    const pRaw = params.get("party");
    setCode(c);
    if (params.has("party")) setPartyId(canonicalPartyIdFromRoute(pRaw ?? ""));
    else if (c.trim() === "") setPartyId("");
  }, [params]);

  useEffect(() => {
    async function sync(): Promise<void> {
      const pidNorm = canonicalPartyIdFromRoute(partyId);
      if (pidNorm.length >= 30) {
        try {
          setSnap(
            await fetchJson<PartySnapshot>(
              `/api/parties/${encodeURIComponent(pidNorm)}`,
            ),
          );
        } catch {
          setSnap(null);
        }
        return;
      }
      const c = code.trim().toUpperCase();
      if (c.length < 4) {
        setSnap(null);
        return;
      }
      try {
        const m = await fetchJson<{ snapshot: PartySnapshot; partyId: string }>(
          `/api/parties/meta-by-code/${encodeURIComponent(c)}`,
        );
        setPartyId(canonicalPartyIdFromRoute(m.partyId));
        setSnap(m.snapshot);
      } catch {
        setSnap(null);
      }
    }
    void sync();
  }, [code, partyId]);

  useEffect(() => {
    if (avatarsLib === null || avatarKeyChosen !== "") return;
    const first = avatarsLib.avatars[0]?.key ?? avatarsLib.defaultKey;
    setAvatarKeyChosen(avatarsLib.defaultKey || first);
  }, [avatarsLib, avatarKeyChosen]);

  const pidNormField = canonicalPartyIdFromRoute(partyId);
  const joinPartyIdResolved: string =
    pidNormField !== "" ? pidNormField : snap !== null ? canonicalPartyIdFromRoute(snap.id) : "";

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const pidCanon = joinPartyIdResolved;
    if (!snap || pidCanon === "") {
      if (snap !== null && pidCanon === "")
        setErr(
          "Impossible de déterminer l’identifiant de la partie. Attendez le chargement ou rafraîchissez la page.",
        );
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      const key =
        avatarKeyChosen !== ""
          ? avatarKeyChosen
          : avatarsLib?.defaultKey ??
            avatarsLib?.avatars[0]?.key ??
            "fox";
      const body: Record<string, unknown> = { displayName: name.trim(), avatarKey: key };
      if (snap.maxTeams != null && snap.maxTeams >= 2) body.teamId = teamId;
      const res = await fetchJson<{ playerToken: string }>(
        `/api/parties/${encodeURIComponent(pidCanon)}/join`,
        { method: "POST", body: JSON.stringify(body) },
      );
      sessionStorage.setItem(playerSessionKey(pidCanon), res.playerToken);
      rememberPlayerParty(pidCanon, snap.joinCode);
      nav(`/party/${encodeURIComponent(pidCanon)}/play`);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Erreur");
    }
    setLoading(false);
  }

  const needsTeam = snap !== null && snap.maxTeams !== null && snap.maxTeams >= 2;

  return (
    <Shell title="Rejoindre une partie">
      {joinPartyIdResolved !== "" && peekPlayerJwt(joinPartyIdResolved) !== null ? (
        <p style={{ marginBottom: 16 }}>
          <button
            type="button"
            onClick={() =>
              nav(`/party/${encodeURIComponent(joinPartyIdResolved)}/play`)
            }
          >
            Reprendre le lobby (vous êtes déjà inscrit sur cet appareil)
          </button>
        </p>
      ) : null}
      <form onSubmit={(e) => void onSubmit(e)} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <label>
          Code
          <input
            style={{ width: "100%", marginTop: 4 }}
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="ABCDEF"
          />
        </label>
        <label>
          Pseudo (2–48 caractères)
          <input
            style={{ width: "100%", marginTop: 4 }}
            value={name}
            minLength={2}
            maxLength={48}
            required
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <section aria-labelledby="join-avatars-heading">
          <h3 id="join-avatars-heading" style={{ fontSize: 16, margin: "14px 0 8px" }}>
            Avatar
          </h3>
          {avatarsLib === null ? (
            <p style={{ margin: 0, opacity: 0.75 }}>Chargement des images…</p>
          ) : (
            <>
              <p style={{ margin: "0 0 10px", fontSize: 14, opacity: 0.85 }}>
                Choisissez une image affichée à côté de votre pseudo.
              </p>
              <div
                role="radiogroup"
                aria-label="Bibliothèque d’avatars"
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(92px, 1fr))",
                  gap: 10,
                  maxHeight: 320,
                  overflowY: "auto",
                  padding: 4,
                }}
              >
                {avatarsLib.avatars.map((a) => (
                  <button
                    key={a.key}
                    type="button"
                    role="radio"
                    aria-checked={avatarKeyChosen === a.key}
                    aria-label={a.label}
                    onClick={() => setAvatarKeyChosen(a.key)}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 6,
                      padding: 10,
                      borderRadius: 10,
                      border:
                        avatarKeyChosen === a.key ? "3px solid #2874a6" : "1px solid #ccc",
                      background: avatarKeyChosen === a.key ? "#f0f7ff" : "#fafafa",
                      cursor: "pointer",
                      fontSize: 12,
                      lineHeight: 1.25,
                      textAlign: "center",
                      boxSizing: "border-box",
                    }}
                  >
                    <AvatarFigure src={a.url} sizePx={56} />
                    <span>{a.label}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </section>
        {needsTeam ? (
          <label>
            Équipe (1–{snap.maxTeams})
            <input
              type="number"
              min={1}
              max={snap.maxTeams ?? 2}
              value={teamId}
              style={{ width: "100%", marginTop: 4 }}
              onChange={(e) => setTeamId(Number.parseInt(e.target.value, 10))}
              required
            />
          </label>
        ) : null}
        {err ? <p style={{ color: "crimson" }}>{err}</p> : null}
        <button type="submit" disabled={snap === null || loading || avatarKeyChosen === ""}>
          Rejoindre le lobby / la partie
        </button>
      </form>
      {snap === null && code.trim().length >= 4 ? <p>Code introuvable…</p> : null}
      {snap ? <PlayersPreview snap={snap} /> : null}
    </Shell>
  );
}

function PlayersPreview(props: { snap: PartySnapshot }): JSX.Element {
  return (
    <section style={{ marginTop: 20 }}>
      <h2>Déjà inscrits</h2>
      <ul style={{ paddingLeft: 0, listStyle: "none" }}>
        {props.snap.players.map((p) => (
          <li
            key={p.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginBottom: 10,
              padding: "6px 0",
            }}
          >
            <AvatarFigure src={p.avatarUrl} sizePx={40} />
            <span>
              {p.displayName} · {p.score} pts · équipe {p.teamId === null ? "—" : p.teamId}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** * Displays quiz prompt or video from `gameBoard`; host may reveal the keyed correct choice on quiz. */
function GameBoardPanel(props: {
  board: PartyGameBoardSurface | null;
  partyState: string;
  revealCorrect: boolean;
}): JSX.Element | null {
  const { board, partyState, revealCorrect } = props;
  if (board !== null && board.kind === "iframe") {
    return (
      <section
        style={{
          marginTop: 14,
          padding: 14,
          border: "1px solid #ccc",
          borderRadius: 8,
          background: "#fafafa",
        }}
      >
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Zone de jeu · page web</h2>
        <p style={{ margin: "0 0 10px", fontSize: 13, opacity: 0.85 }}>{board.title}</p>
        <iframe
          key={board.replaySerial}
          title={board.title}
          src={board.url}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-presentation"
          style={{
            width: "100%",
            minHeight: 420,
            border: "1px solid #ddd",
            borderRadius: 6,
            background: "#fff",
          }}
        />
      </section>
    );
  }

  if (board !== null && board.kind === "youtube") {
    return (
      <section
        style={{
          marginTop: 14,
          padding: 14,
          border: "1px solid #ccc",
          borderRadius: 8,
          background: "#fafafa",
        }}
      >
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Zone de jeu · YouTube</h2>
        <p style={{ margin: "0 0 10px", fontSize: 13, opacity: 0.85 }}>{board.title}</p>
        <div style={{ position: "relative", width: "100%", paddingBottom: "56.25%", height: 0 }}>
          <iframe
            key={board.replaySerial}
            title={board.title}
            src={board.embedUrl}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: "100%",
              border: "none",
              borderRadius: 6,
              background: "#111",
            }}
          />
        </div>
      </section>
    );
  }

  if (board !== null && board.kind === "video") {
    return (
      <section
        style={{
          marginTop: 14,
          padding: 14,
          border: "1px solid #ccc",
          borderRadius: 8,
          background: "#fafafa",
        }}
      >
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Zone de jeu · vidéo</h2>
        <p style={{ margin: "0 0 10px", fontSize: 13, opacity: 0.85 }}>
          {board.packTitle} · Manche {board.roundNumberHuman} — {board.roundTitle}
        </p>
        <video
          key={board.replaySerial}
          controls
          playsInline
          preload="metadata"
          style={{ width: "100%", maxHeight: 420, borderRadius: 6, background: "#111" }}
          src={board.videoUrl}
        >
          Lecture vidéo non supportée par ce navigateur.
        </video>
      </section>
    );
  }
  if (board !== null && board.kind === "quiz") {
    const ci = board.correctChoiceIndex;
    const correctText =
      revealCorrect &&
      typeof ci === "number" &&
      ci >= 0 &&
      ci < board.choices.length
        ? board.choices[ci]
        : null;
    return (
      <section
        style={{
          marginTop: 14,
          padding: 14,
          border: "1px solid #ccc",
          borderRadius: 8,
          background: "#fafafa",
        }}
      >
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Zone de jeu</h2>
        <p style={{ margin: "0 0 8px", fontSize: 13, opacity: 0.85 }}>
          {board.packTitle} · Manche {board.roundNumberHuman} — {board.roundTitle} · Question{" "}
          {board.questionIndexInRound + 1} · {board.points} {board.points === 1 ? "pt" : "pts"}
        </p>
        <p style={{ fontSize: 18, fontWeight: 600, margin: "12px 0" }}>{board.prompt}</p>
        <ol style={{ margin: 0, paddingLeft: 22 }}>
          {board.choices.map((c, i) => (
            <li key={`${board.roundIndex}-${board.questionIndexInRound}-${i}`} style={{ marginBottom: 6 }}>
              <strong>{String.fromCharCode(65 + i)}.</strong> {c}
              {revealCorrect && typeof ci === "number" && ci === i ? (
                <span style={{ marginLeft: 8, color: "seagreen" }}>(attendue)</span>
              ) : null}
            </li>
          ))}
        </ol>
        {correctText !== null ? (
          <p style={{ marginTop: 12, fontSize: 14 }}>
            Réponse attendue : <strong>{correctText}</strong>
          </p>
        ) : null}
      </section>
    );
  }
  if (partyState === "round_active") {
    return (
      <section style={{ marginTop: 14, padding: 12, border: "1px dashed #bbb", borderRadius: 8 }}>
        <h2 style={{ marginTop: 0, fontSize: 16 }}>Zone de jeu</h2>
        <p style={{ margin: 0, opacity: 0.85 }}>
          Aucun contenu affichable pour l’instant (manche inactive ou configuration incomplète côté
          animateur).
        </p>
      </section>
    );
  }
  return null;
}

/** * No player JWT: load public snapshot to redirect to `/join?code=` only (compact invite links / QR). */
function RedirectJoinForReauth(props: { partyId: string }): JSX.Element {
  const nav = useNavigate();
  const pidCanon = canonicalPartyIdFromRoute(props.partyId);
  useEffect(() => {
    let cancelled = false;
    void fetchJson<PartySnapshot>(`/api/parties/${encodeURIComponent(pidCanon)}`)
      .then((s) => {
        if (!cancelled)
          nav(`/join?code=${encodeURIComponent(s.joinCode)}`, { replace: true });
      })
      .catch(() => {
        if (!cancelled) nav("/join", { replace: true });
      });
    return (): void => {
      cancelled = true;
    };
  }, [pidCanon, nav]);
  return (
    <Shell title="Redirection…">
      <p>Ouverture de la page rejoindre…</p>
    </Shell>
  );
}

function Create(): JSX.Element {
  const nav = useNavigate();
  const [playersUnlimited, setPlayersUnlimited] = useState(true);
  const [teamsUnlimited, setTeamsUnlimited] = useState(false);
  const [maxPlayers, setMaxPlayers] = useState(12);
  const [maxTeams, setMaxTeams] = useState(3);
  const [closedAfterStart, setClosedAfterStart] = useState(false);
  const [allowRename, setAllowRename] = useState(true);
  const [allowTeamChange, setAllowTeamChange] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setErr(null);
    try {
      const body = {
        playersUnlimited,
        teamsUnlimited,
        maxPlayers: playersUnlimited ? undefined : maxPlayers,
        maxTeams: teamsUnlimited ? undefined : maxTeams,
        closedAfterStart,
        allowRename,
        allowTeamChange,
      };
      const res = await fetchJson<{
        adminToken: string;
        partyId: string;
      }>(`/api/parties`, { method: "POST", body: JSON.stringify(body) });
      sessionStorage.setItem(adminSessionKey(res.partyId), res.adminToken);
      rememberAdminParty(res.partyId);
      nav(`/party/${res.partyId}/admin#token=${encodeURIComponent(res.adminToken)}`);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Erreur");
    }
  }

  return (
    <Shell title="Nouvelle partie">
      <form onSubmit={(e) => void onSubmit(e)} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <label>
          <input type="checkbox" checked={playersUnlimited} onChange={(e) => setPlayersUnlimited(e.target.checked)} />{" "}
          Joueurs illimités
        </label>
        {!playersUnlimited ? (
          <label>
            Plafond joueurs
            <input
              type="number"
              min={2}
              max={500}
              value={maxPlayers}
              onChange={(e) => setMaxPlayers(Number.parseInt(e.target.value, 10))}
            />
          </label>
        ) : null}

        <label>
          <input type="checkbox" checked={teamsUnlimited} onChange={(e) => setTeamsUnlimited(e.target.checked)} />{" "}
          Pas d’équipes (solo)
        </label>
        {!teamsUnlimited ? (
          <label>
            Nombre d’équipes (≥2)
            <input
              type="number"
              min={2}
              max={40}
              value={maxTeams}
              onChange={(e) => setMaxTeams(Number.parseInt(e.target.value, 10))}
            />
          </label>
        ) : null}

        <label>
          <input type="checkbox" checked={closedAfterStart} onChange={(e) => setClosedAfterStart(e.target.checked)} />{" "}
          Partie fermée après le premier lancement
        </label>
        <label>
          <input type="checkbox" checked={allowRename} onChange={(e) => setAllowRename(e.target.checked)} /> Authoriser le
          changement de pseudo (lobby)
        </label>
        <label>
          <input
            type="checkbox"
            checked={allowTeamChange}
            onChange={(e) => setAllowTeamChange(e.target.checked)}
          />{" "}
          Authoriser le changement d’équipe (lobby)
        </label>
        {err ? <p style={{ color: "crimson" }}>{err}</p> : null}
        <button type="submit">Créer et ouvrir l’administration</button>
      </form>
    </Shell>
  );
}

function Play(): JSX.Element {
  const { partyId } = useParams<{ partyId: string }>();
  const pid = canonicalPartyIdFromRoute(partyId);
  const nav = useNavigate();
  const [jwt, setJwt] = useState<string | null>(() => peekPlayerJwt(pid));

  useEffect(() => {
    setJwt(peekPlayerJwt(pid));
  }, [pid]);

  const [snap, setSnap] = useState<PartySnapshot | null>(null);
  const [chat, setChat] = useState("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!pid || jwt === null || jwt === "") return undefined;

    fetchJson<PartySnapshot>(`/api/parties/${encodeURIComponent(pid)}`)
      .then((s1) => setSnap(s1))
      .catch(() => setSnap(null));

    const s: Socket = io({
      transports: ["websocket", "polling"],
      auth: { partyId: pid, bearer: jwt, role: "player" },
    });

    const onSnap = (p: PartySnapshot) => setSnap(p);
    s.on("party:patch", onSnap);

    return (): void => {
      s.off("party:patch", onSnap);
      s.disconnect();
    };
  }, [pid, jwt]);

  useEffect(() => {
    if (!pid || jwt === null || jwt === "" || snap === null) return;
    rememberPlayerParty(pid, snap.joinCode);
  }, [pid, jwt, snap]);

  async function buzz(): Promise<void> {
    if (!pid || jwt === null || jwt === "") return;
    setErr(null);
    try {
      const snapRes = await fetchJson<PartySnapshot>(`/api/parties/${pid}/me/buzz`, {
        method: "POST",
        headers: { Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({}),
      });
      setSnap(snapRes);
    } catch (e3) {
      setErr(e3 instanceof Error ? e3.message : "Buzz refusé");
    }
  }

  async function sendChat(textOverride?: string): Promise<void> {
    if (!pid || jwt === null || jwt === "") return;
    const payload = (typeof textOverride === "string" ? textOverride : chat).trim();
    if (payload === "") return;
    setErr(null);
    try {
      const snapRes = await fetchJson<PartySnapshot>(`/api/parties/${pid}/me/chat`, {
        method: "POST",
        headers: { Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ text: payload }),
      });
      setChat("");
      setSnap(snapRes);
    } catch (e3) {
      setErr(e3 instanceof Error ? e3.message : "Chat refusé");
    }
  }

  if (!pid) return <Navigate to="/join" replace />;

  if (jwt === null || jwt === "") return <RedirectJoinForReauth partyId={pid} />;

  /** * Spinner before first REST response. */
  if (snap === null) return <Shell title="Chargement…">Connexion lobby…</Shell>;

  function parseSub(tok: string): string | null {
    try {
      const [, body] = tok.split(".");
      if (body === undefined) return null;
      let b64 = body.replace(/-/gu, "+").replace(/_/gu, "/");
      while (b64.length % 4 !== 0) b64 += "=";
      const json = globalThis.atob(b64);
      interface Decoded {
        sub?: string;
      }
      const payload = JSON.parse(json) as Decoded;
      return typeof payload.sub === "string" ? payload.sub : null;
    } catch {
      return null;
    }
  }

  const myId = parseSub(jwt);
  const rowMe = snap.players.find((p) => p.id === myId);
  const canChatRoom = snap.state === "lobby" || snap.state === "between_rounds";
  const canBuzz = snap.state === "round_active" && snap.buzzWindowOpen;

  return (
    <Shell title={`Lobby · ${snap.joinCode}`}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        {rowMe ? <AvatarFigure src={rowMe.avatarUrl} sizePx={48} /> : null}
        <p style={{ margin: 0 }}>
          Pseudo : <strong>{rowMe?.displayName ?? "—"}</strong> · Points :{" "}
          <strong>{rowMe?.score ?? 0}</strong>
          {snap.maxTeams != null && snap.maxTeams >= 2 ? (
            <>
              {" "}
              · Équipe{" "}
              <strong>{rowMe?.teamId === null ? "—" : rowMe.teamId}</strong>
            </>
          ) : null}
        </p>
      </div>
      <p>État : {snap.state}</p>
      {err ? <p style={{ color: "crimson" }}>{err}</p> : null}

      <GameBoardPanel
        board={snap.gameBoard ?? null}
        partyState={snap.state}
        revealCorrect={false}
      />

      <section style={{ marginTop: 14 }}>
        <h2>Manche / lobby</h2>
        {(snap.gameBoard ?? null) === null ? (
          <p>L’animateur diffuse le contenu depuis cette session.</p>
        ) : snap.gameBoard.kind === "video" ? (
          <p style={{ opacity: 0.8 }}>
            Regardez la vidéo ; l’animateur peut la relancer ou avancer depuis son tableau (« Question suivante /
            suivant » lorsque disponible).
          </p>
        ) : snap.gameBoard.kind === "iframe" ? (
          <p style={{ opacity: 0.8 }}>Consultez la page affichée ; le buzzer n’est généralement pas utilisé.</p>
        ) : snap.gameBoard.kind === "youtube" ? (
          <p style={{ opacity: 0.8 }}>Consultez la vidéo ; le buzzer n’est généralement pas utilisé.</p>
        ) : (
          <p style={{ opacity: 0.8 }}>Répondez avec le buzzer lorsque celui‑ci est ouvert.</p>
        )}
        {canBuzz ? (
          <button type="button" onClick={() => void buzz()}>
            BUZZ !
          </button>
        ) : (
          <p>Buzzer fermé pour l’instant.</p>
        )}
        {snap.buzzOrder.length > 0 ? (
          <ol>
            {snap.buzzOrder.map((idBuzz, idx) => {
              const pl = snap.players.find((x) => x.id === idBuzz);
              return (
                <li
                  key={`${idBuzz}-${idx}`}
                  style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}
                >
                  {pl ? <AvatarFigure src={pl.avatarUrl} sizePx={26} /> : null}
                  <span>
                    {idx + 1}. {pl?.displayName ?? idBuzz}
                  </span>
                </li>
              );
            })}
          </ol>
        ) : null}
      </section>

      {canChatRoom ? (
        <section style={{ marginTop: 18 }}>
          <h2>Chat</h2>
          <textarea
            value={chat}
            rows={3}
            style={{ width: "100%" }}
            placeholder="Message…"
            onChange={(e) => setChat(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter" || e.shiftKey) return;
              e.preventDefault();
              void sendChat(e.currentTarget.value);
            }}
          />
          <button type="button" onClick={() => void sendChat()}>
            Envoyer
          </button>
          <ul>
            {snap.chatTail.slice(-15).map((m) => (
              <li key={m.id}>
                <strong>{m.displayName}</strong> : {m.text}
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p style={{ opacity: 0.7 }}>Chat disponible en lobby ou entre deux manches.</p>
      )}

      <p style={{ marginTop: 20 }}>
        <button
          type="button"
          onClick={() => nav(`/join?code=${encodeURIComponent(snap.joinCode)}`)}
        >
          Quitter pour changer pseudo, équipe ou avatar
        </button>
      </p>
    </Shell>
  );
}

function Admin(): JSX.Element {
  const { partyId } = useParams<{ partyId: string }>();
  const pid = canonicalPartyIdFromRoute(partyId);
  const nav = useNavigate();
  const [token, setToken] = useState<string | null>(() => peekAdminBearer(pid));
  const [snap, setSnap] = useState<PartySnapshot | null>(null);
  const [packsList, setPacksList] = useState<
    Array<{ basename: string; id: string; title: string; roundCount?: number }>
  >([]);
  const [err, setErr] = useState<string | null>(null);
  const [hostChat, setHostChat] = useState("");
  const [adminBootstrap, setAdminBootstrap] = useState<"loading" | "ready" | "unavailable">(
    "loading",
  );

  /** * Popup: append a scripted manche (pack, iframe site, or YouTube). */
  const [addMancheOpen, setAddMancheOpen] = useState(false);
  /** * `"pack"` = quiz JSON pack ; `"site"` = iframe or pasted YouTube watch URL. */
  const [addMancheFlavor, setAddMancheFlavor] = useState<"pack" | "site">("pack");
  const [modalPackBasename, setModalPackBasename] = useState("");
  const [modalMancheTitle, setModalMancheTitle] = useState("");
  const [modalSiteKind, setModalSiteKind] = useState<"iframe" | "youtube">("iframe");
  const [modalSiteUrl, setModalSiteUrl] = useState("");

  useEffect(() => {
    void fetchJson<{
      packs: Array<{ basename: string; id: string; title: string; roundCount: number }>;
    }>(`/api/packs`).then((r) => setPacksList(r.packs));
  }, []);

  useEffect(() => {
    if (packsList.length === 0) return;
    setModalPackBasename((prev) => {
      if (prev !== "" && packsList.some((p) => p.basename === prev)) return prev;
      return packsList[0]!.basename;
    });
  }, [packsList]);

  useEffect(() => {
    setToken(peekAdminBearer(pid));
  }, [pid]);

  const bearer = token ?? "";

  useEffect(() => {
    if (!pid || bearer === "") return undefined;

    let cancelled = false;
    setAdminBootstrap("loading");
    setSnap(null);

    void fetchJson<PartySnapshot>(`/api/parties/${encodeURIComponent(pid)}`, {
      headers: { Authorization: `Bearer ${bearer}` },
    })
      .then((s2) => {
        if (!cancelled) {
          setSnap(s2);
          setAdminBootstrap("ready");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSnap(null);
          setAdminBootstrap("unavailable");
        }
      });

    return (): void => {
      cancelled = true;
    };
  }, [pid, bearer]);

  useEffect(() => {
    if (!pid || bearer === "" || adminBootstrap !== "ready") return undefined;

    const s: Socket = io({
      transports: ["websocket", "polling"],
      auth: { partyId: pid, bearer, role: "admin" },
    });
    const onSnap = (p: PartySnapshot) => setSnap(p);
    s.on("party:patch", onSnap);
    return (): void => {
      s.off("party:patch", onSnap);
      s.disconnect();
    };
  }, [pid, bearer, adminBootstrap]);

  useEffect(() => {
    if (adminBootstrap !== "ready" || !pid || bearer === "") return;
    rememberAdminParty(pid);
  }, [adminBootstrap, pid, bearer]);

  const callHostSnapshot = useCallback(
    async (
      path: string,
      method: string,
      body?: Record<string, unknown>,
    ): Promise<PartySnapshot> => {
      if (!pid || bearer === "")
        throw new Error("auth:Session animateur incomplète (recharger la page).");
      const rBody = body === undefined ? undefined : JSON.stringify(body);
      interface ErrBody {
        error?: string;
      }
      const res = await fetch(path, {
        method,
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${bearer}`,
        },
        body: method === "GET" ? undefined : rBody,
      });
      const text = await res.text();
      if (!res.ok) {
        let detail = text.slice(0, 200);
        if (text !== "") {
          try {
            detail = (JSON.parse(text) as ErrBody).error ?? text;
          } catch {
            /* noop */
          }
        }
        throw new Error(`${res.status}:${detail}`);
      }
      try {
        return JSON.parse(text) as PartySnapshot;
      } catch {
        throw new Error(`${res.status}:INVALID_JSON`);
      }
    },
    [pid, bearer],
  );

  const hostBasePath = `/api/parties/${encodeURIComponent(pid)}`;

  const onHostMancheSubmitAdd = useCallback(async (): Promise<void> => {
    setErr(null);
    try {
      if (addMancheFlavor === "pack" && packsList.length === 0) {
        throw new Error("validation:Aucun pack quiz chargé sur le serveur pour l’instant.");
      }
      if (addMancheFlavor === "pack") {
        const pkMeta = packsList.find((x) => x.basename === modalPackBasename);
        const titleDraft = modalMancheTitle.trim();
        const title =
          titleDraft.length > 0
            ? titleDraft
            : (pkMeta?.title ?? "").trim().length > 0
              ? (pkMeta?.title ?? "").trim()
              : modalPackBasename;
        const p = await callHostSnapshot(`${hostBasePath}/host/manche/add`, "POST", {
          kind: "pack_quiz",
          title,
          packBasename: modalPackBasename,
        });
        setSnap(p);
      } else {
        const title = modalMancheTitle.trim();
        if (title === "") {
          throw new Error("validation:Titre obligatoire.");
        }
        const urlRaw = modalSiteUrl.trim();
        if (urlRaw === "") {
          throw new Error("validation:URL obligatoire.");
        }
        const body =
          modalSiteKind === "iframe"
            ? { kind: "iframe", title, url: urlRaw }
            : { kind: "youtube", title, url: urlRaw };
        const p = await callHostSnapshot(`${hostBasePath}/host/manche/add`, "POST", body);
        setSnap(p);
      }
      setAddMancheOpen(false);
      setModalMancheTitle("");
      setModalSiteUrl("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [
    addMancheFlavor,
    callHostSnapshot,
    hostBasePath,
    modalMancheTitle,
    modalPackBasename,
    modalSiteKind,
    modalSiteUrl,
    packsList,
  ]);

  const onHostManchePlay = useCallback(
    async (id: string): Promise<void> => {
      setErr(null);
      try {
        const p = await callHostSnapshot(`${hostBasePath}/host/manche/play`, "POST", { id });
        setSnap(p);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    },
    [callHostSnapshot, hostBasePath],
  );

  const onHostMancheRemove = useCallback(
    async (id: string): Promise<void> => {
      setErr(null);
      try {
        const p = await callHostSnapshot(`${hostBasePath}/host/manche/remove`, "POST", { id });
        setSnap(p);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    },
    [callHostSnapshot, hostBasePath],
  );

  const onHostMancheMove = useCallback(
    async (id: string, direction: "up" | "down"): Promise<void> => {
      setErr(null);
      try {
        const p = await callHostSnapshot(`${hostBasePath}/host/manche/move`, "POST", {
          id,
          direction,
        });
        setSnap(p);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    },
    [callHostSnapshot, hostBasePath],
  );

  const onHostRoundPause = useCallback(async (): Promise<void> => {
    setErr(null);
    try {
      const p = await callHostSnapshot(`${hostBasePath}/host/round/pause`, "POST", {});
      setSnap(p);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [callHostSnapshot, hostBasePath]);

  const onHostBuzzWindow = useCallback(
    async (open: boolean): Promise<void> => {
      setErr(null);
      try {
        const n = await callHostSnapshot(`${hostBasePath}/host/buzz-window`, "POST", { open });
        setSnap(n);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    },
    [callHostSnapshot, hostBasePath],
  );

  const onHostCueNext = useCallback(async (): Promise<void> => {
    setErr(null);
    try {
      const p = await callHostSnapshot(`${hostBasePath}/host/cue/next`, "POST", {});
      setSnap(p);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [callHostSnapshot, hostBasePath]);

  const onHostChatSend = useCallback(async (textOverride?: string): Promise<void> => {
    const payload = (typeof textOverride === "string" ? textOverride : hostChat).trim();
    if (payload === "") return;
    setErr(null);
    try {
      const h = await callHostSnapshot(`${hostBasePath}/host/chat`, "POST", {
        text: payload,
      });
      setHostChat("");
      setSnap(h);
    } catch (e8: unknown) {
      setErr(e8 instanceof Error ? e8.message : String(e8));
    }
  }, [callHostSnapshot, hostBasePath, hostChat]);

  const onPlayerScoreDelta = useCallback(
    async (playerDbId: string, delta: number): Promise<void> => {
      if (delta !== 1 && delta !== -1) return;
      setErr(null);
      try {
        const u = await fetchJson<PartySnapshot>(
          `${hostBasePath}/host/players/${encodeURIComponent(playerDbId)}/score`,
          {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${bearer}`,
            },
            body: JSON.stringify({ delta }),
          },
        );
        setSnap(u);
      } catch (e9) {
        setErr(String(e9));
      }
    },
    [hostBasePath, bearer],
  );

  if (!pid) return <Navigate to="/create" replace />;

  if (bearer === "")
    return (
      <Shell title="Admin">
        <p>Jeton animateur absent ou lien incomplet. Rouvrir le lien après création.</p>
        <button type="button" onClick={() => nav("/create")}>
          Créer une session
        </button>
      </Shell>
    );

  if (adminBootstrap === "loading")
    return <Shell title="Admin">Chargement…</Shell>;

  if (adminBootstrap === "unavailable")
    return (
      <Shell title="Animateur">
        <p>
          Impossible de charger cette partie : elle n’existe plus sur le serveur (après une période
          d’inactivité ou un redémarrage) ou une erreur réseau s’est produite.
        </p>
        <p>
          Le lien « Reprendre » sur l’accueil ne peut pas restaurer une partie effacée ; il faut en
          créer une nouvelle.
        </p>
        <button
          type="button"
          onClick={() => {
            purgeAdminSessionForPartyRouteId(pid);
            setToken(null);
            nav("/", { replace: true });
          }}
        >
          Retour à l’accueil et effacer ce jeton animateur
        </button>
      </Shell>
    );

  if (snap === null)
    return <Shell title="Admin">Synchronisation…</Shell>;

  const joinUrl = `${window.location.origin}/join?code=${encodeURIComponent(snap.joinCode)}`;

  const activeMancheEntry =
    snap.activeMancheId === null
      ? undefined
      : snap.mancheScript.find((m) => m.id === snap.activeMancheId);
  const showQuizCueButtons =
    snap.state === "round_active" && activeMancheEntry?.kind === "pack_quiz";

  return (
    <Shell title={`Animateur · ${snap.joinCode}`}>
      <p>
        État : <strong>{snap.state}</strong>
      </p>
      <p>Code joueurs : <strong>{snap.joinCode}</strong></p>
      <p>Lien rejoindre (partager) :</p>
      <code style={{ wordBreak: "break-all", display: "block", marginBottom: 12 }}>{joinUrl}</code>
      <figure style={{ margin: "16px 0" }}>
        <QRCodeSVG
          value={joinUrl}
          size={220}
          level="M"
          includeMargin
          aria-label="QR code rejoindre la partie"
        />
        <figcaption style={{ fontSize: 13, opacity: 0.85 }}>QR code (même URL que ci‑dessus)</figcaption>
      </figure>
      {err ? <pre style={{ color: "crimson", whiteSpace: "pre-wrap" }}>{err}</pre> : null}

      <GameBoardPanel
        board={snap.gameBoard ?? null}
        partyState={snap.state}
        revealCorrect
      />

      <section style={{ marginTop: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <h2 style={{ margin: 0 }}>Liste des manches</h2>
          <button
            type="button"
            title="Ajouter une manche"
            aria-label="Ajouter une manche"
            onClick={() => {
              setErr(null);
              setAddMancheOpen(true);
              setModalMancheTitle("");
              setModalSiteUrl("");
            }}
          >
            +
          </button>
        </div>
        <p style={{ margin: "8px 0 0", fontSize: 14, opacity: 0.85 }}>
          Réordonnez avec les flèches ; ▶ met la manche en tête et la lance ; la progression d&apos;un pack quiz est
          mémorisée pour la suite.
        </p>
        {snap.mancheScript.length === 0 ? (
          <p style={{ marginTop: 10 }}>
            Aucune manche pour l&apos;instant — utilisez « + » pour ajouter un pack, une page (HTTPS) ou YouTube.
          </p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: "14px 0 0" }}>
            {snap.mancheScript.map((mancheRow, mi) => {
              const playing =
                snap.activeMancheId === mancheRow.id && snap.state === "round_active";
              return (
                <li
                  key={mancheRow.id}
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "center",
                    gap: 8,
                    padding: "10px 12px",
                    marginBottom: 10,
                    borderRadius: 8,
                    border: `1px solid ${playing ? "#6fa8dc" : "#ddd"}`,
                    background: playing ? "#f5faff" : "#fafafa",
                  }}
                >
                  <span style={{ flex: "1 1 200px", minWidth: 0 }}>
                    <strong>{mancheRow.title}</strong>
                    <span style={{ opacity: 0.75, marginLeft: 8 }}>
                      ({mancheKindShort(mancheRow.kind)})
                    </span>
                    {playing ? (
                      <span style={{ marginLeft: 8, color: "#2874a6", fontSize: 13 }}>● en cours</span>
                    ) : null}
                  </span>
                  <button type="button" title="Jouer cette manche" onClick={() => void onHostManchePlay(mancheRow.id)}>
                    ▶
                  </button>
                  <button
                    type="button"
                    disabled={mi === 0}
                    title="Monter dans la liste"
                    aria-label="Monter dans la liste"
                    onClick={() => void onHostMancheMove(mancheRow.id, "up")}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    disabled={mi === snap.mancheScript.length - 1}
                    title="Descendre dans la liste"
                    aria-label="Descendre dans la liste"
                    onClick={() => void onHostMancheMove(mancheRow.id, "down")}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    title="Supprimer cette manche"
                    aria-label="Supprimer cette manche"
                    onClick={() => void onHostMancheRemove(mancheRow.id)}
                  >
                    🗑
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section style={{ marginTop: 14, display: "flex", flexWrap: "wrap", gap: 8 }}>
        <button type="button" onClick={() => void onHostRoundPause()}>
          Mettre en pause (retour joueurs au lobby)
        </button>
        {snap.state === "round_active" ? (
          <button
            type="button"
            aria-pressed={snap.buzzWindowOpen}
            title={
              snap.buzzWindowOpen
                ? "Désactive le buzzer : les joueurs ne peuvent plus buzzer et la file d’ordre est vidée."
                : "Réactive le buzzer pour cette manche ; la liste des buzz démarre vide."
            }
            onClick={() => void onHostBuzzWindow(!snap.buzzWindowOpen)}
          >
            Buzzer&nbsp;: {snap.buzzWindowOpen ? "ON" : "OFF"}
            {snap.buzzWindowOpen ? " (ouvert)" : " (fermé · file purgee)"}
          </button>
        ) : null}
        {showQuizCueButtons ? (
          <button type="button" onClick={() => void onHostCueNext()}>
            Question suivante / rejouer la vidéo du pack
          </button>
        ) : null}
      </section>

      {addMancheOpen ? (
        <div
          role="presentation"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            background: "rgba(0,0,0,0.42)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
          onMouseDown={(evt) => {
            if (evt.target === evt.currentTarget) setAddMancheOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-manche-title"
            style={{
              width: "100%",
              maxWidth: 540,
              maxHeight: "90vh",
              overflowY: "auto",
              padding: "22px 24px",
              borderRadius: 12,
              background: "#fff",
              boxShadow: "0 12px 40px rgba(0,0,0,0.25)",
            }}
            onMouseDown={(evt) => {
              evt.stopPropagation();
            }}
          >
            <h2 id="add-manche-title" style={{ marginTop: 0 }}>
              Ajouter une manche à la liste
            </h2>
            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
              <button
                type="button"
                aria-pressed={addMancheFlavor === "pack"}
                onClick={() => setAddMancheFlavor("pack")}
                style={{
                  fontWeight: addMancheFlavor === "pack" ? 700 : 400,
                  background: addMancheFlavor === "pack" ? "#e8f4fc" : "#f5f5f5",
                  border: "1px solid #ccc",
                  borderRadius: 8,
                  padding: "8px 12px",
                  cursor: "pointer",
                }}
              >
                Pack quiz
              </button>
              <button
                type="button"
                aria-pressed={addMancheFlavor === "site"}
                onClick={() => setAddMancheFlavor("site")}
                style={{
                  fontWeight: addMancheFlavor === "site" ? 700 : 400,
                  background: addMancheFlavor === "site" ? "#e8f4fc" : "#f5f5f5",
                  border: "1px solid #ccc",
                  borderRadius: 8,
                  padding: "8px 12px",
                  cursor: "pointer",
                }}
              >
                Site (iframe) ou YouTube
              </button>
            </div>

            {addMancheFlavor === "pack" ? (
              <>
                <label style={{ display: "block", marginBottom: 10 }}>
                  Pack à ajouter à la liste
                  <select
                    style={{ display: "block", width: "100%", marginTop: 6 }}
                    value={
                      modalPackBasename !== "" && packsList.some((p2) => p2.basename === modalPackBasename)
                        ? modalPackBasename
                        : packsList[0]?.basename ?? ""
                    }
                    onChange={(ev2) => setModalPackBasename(ev2.target.value)}
                  >
                    {packsList.map((pk) => (
                      <option key={pk.basename} value={pk.basename}>
                        {pk.title} ({pk.roundCount ?? 0} manches)
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ display: "block", marginBottom: 8 }}>
                  Titre dans la liste (optionnel ; par défaut le titre du pack)
                  <input
                    type="text"
                    style={{ display: "block", width: "100%", marginTop: 6, boxSizing: "border-box" }}
                    placeholder="Laisser vide pour reprendre le nom du JSON"
                    value={modalMancheTitle}
                    onChange={(ev2) => setModalMancheTitle(ev2.target.value)}
                  />
                </label>
              </>
            ) : (
              <>
                <label style={{ display: "block", marginBottom: 12 }}>
                  Titre dans la liste
                  <input
                    type="text"
                    style={{ display: "block", width: "100%", marginTop: 6, boxSizing: "border-box" }}
                    placeholder="Ex. Présentation du sponsor"
                    value={modalMancheTitle}
                    onChange={(ev2) => setModalMancheTitle(ev2.target.value)}
                  />
                </label>
                <fieldset style={{ border: "1px solid #ddd", borderRadius: 8, margin: "0 0 14px", padding: 12 }}>
                  <legend>Type de lien</legend>
                  <label style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer" }}>
                    <input
                      type="radio"
                      name="modal-site-kind"
                      checked={modalSiteKind === "iframe"}
                      onChange={() => setModalSiteKind("iframe")}
                    />
                    Page web (HTTPS) dans un iframe
                  </label>
                  <label style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer", marginTop: 8 }}>
                    <input
                      type="radio"
                      name="modal-site-kind"
                      checked={modalSiteKind === "youtube"}
                      onChange={() => setModalSiteKind("youtube")}
                    />
                    Vidéo YouTube (lien youtube.com ou youtu.be)
                  </label>
                </fieldset>
                <label style={{ display: "block" }}>
                  URL complète ({modalSiteKind === "iframe" ? "https://… uniquement pour l’iframe" : "coller depuis le navigateur"})
                  <input
                    type="url"
                    autoComplete="url"
                    style={{ display: "block", width: "100%", marginTop: 6, boxSizing: "border-box" }}
                    placeholder={modalSiteKind === "iframe" ? "https://…" : "https://www.youtube.com/watch?v=…"}
                    value={modalSiteUrl}
                    onChange={(ev2) => setModalSiteUrl(ev2.target.value)}
                  />
                </label>
              </>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, marginTop: 22 }}>
              <button
                type="button"
                onClick={() => {
                  setAddMancheOpen(false);
                  setModalMancheTitle("");
                  setModalSiteUrl("");
                }}
              >
                Annuler
              </button>
              <button type="button" onClick={() => void onHostMancheSubmitAdd()}>
                Ajouter cette manche
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <section style={{ marginTop: 18 }}>
        <h2>Buzz ordre courant</h2>
        <ol>
          {snap.buzzOrder.map((idBuzz2, ix) => {
            const pw = snap.players.find((zz) => zz.id === idBuzz2);
            return (
              <li
                key={`${idBuzz2}-${ix}`}
                style={{ display: "flex", alignItems: "center", gap: 8 }}
              >
                {pw ? <AvatarFigure src={pw.avatarUrl} sizePx={28} /> : null}
                <span>{pw?.displayName ?? idBuzz2}</span>
              </li>
            );
          })}
        </ol>
      </section>

      <section style={{ marginTop: 18 }}>
        <h2>Scores joueurs</h2>
        <ul style={{ paddingLeft: 16 }}>
          {snap.players.map((pl2) => (
            <li
              key={pl2.id}
              style={{
                marginBottom: 8,
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: 8,
              }}
            >
              <AvatarFigure src={pl2.avatarUrl} sizePx={36} />
              <span>
                <strong>{pl2.displayName}</strong> ({pl2.score}{" "}
                {pl2.score === 1 ? "pt" : "pts"})
              </span>
              <button
                type="button"
                aria-label={`Ajouter un point à ${pl2.displayName}`}
                onClick={() => void onPlayerScoreDelta(pl2.id, 1)}
              >
                +1
              </button>
              <button
                type="button"
                aria-label={`Retirer un point à ${pl2.displayName}`}
                onClick={() => void onPlayerScoreDelta(pl2.id, -1)}
              >
                −1
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section style={{ marginTop: 18 }}>
        <h2>Fil de chat (joueurs + animateur)</h2>
        {snap.chatTail.length === 0 ? (
          <p style={{ margin: 0, opacity: 0.75 }}>Aucun message pour l’instant.</p>
        ) : (
          <ul
            style={{
              margin: "8px 0 0",
              paddingLeft: 18,
              maxHeight: 240,
              overflowY: "auto",
            }}
          >
            {snap.chatTail.slice(-80).map((m) => (
              <li key={m.id} style={{ marginBottom: 8 }}>
                <strong>{m.displayName}</strong> : {m.text}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section style={{ marginTop: 18 }}>
        <h2>Messages animateur vers le chat</h2>
        <textarea
          rows={2}
          style={{ width: "100%" }}
          value={hostChat}
          onChange={(evh) => setHostChat(evh.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || e.shiftKey) return;
            e.preventDefault();
            void onHostChatSend(e.currentTarget.value);
          }}
        />
        <button type="button" onClick={() => void onHostChatSend()}>
          Publier
        </button>
      </section>
    </Shell>
  );
}

export default function App(): JSX.Element {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/join" element={<Join />} />
      <Route path="/create" element={<Create />} />
      <Route path="/party/:partyId/play" element={<Play />} />
      <Route path="/party/:partyId/admin" element={<Admin />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

