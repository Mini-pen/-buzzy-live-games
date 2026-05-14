# Buzzy redesign · phase 3 (Play — joueur)

Prérequis : **phases 1 & 2 mergées**.

Refonte de l'écran joueur (`/party/:id/play`) :
- Identity strip en haut (avatar, pseudo, équipe, état, **score XXL**).
- Game board carte (énoncé géant, choix en grille, vidéo en 16/9).
- **Buzz hero** : disque jaune néon qui pulse quand le buzzer est ouvert,
  message d'attente clair quand il est fermé.
- File de buzz en cards, **mise en évidence de ta position** (ligne jaune).
- Chat redesigné (auteur en jaune, input compact, scroll list 280 px).

Aucune logique métier touchée : socket, fetch, JWT, buzz endpoint, chat
endpoint, state machine — tout reste à l'identique.

## Branche suggérée

```bash
git checkout -b redesign/buzzy-play
```

## Fichiers

- **Remplace** `webserver/client/src/styles/buzzy.css`
  *(ajoute la section "Phase 3 — Play" à la fin)*
- **Modifie** `webserver/client/src/App.tsx` :
  - la fonction `GameBoardPanel` (≈ lignes 580-670)
  - le `return` final de la fonction `Play` (≈ lignes 894-987)

Le state et les effets de `Play` **ne changent pas**.

---

## 1. Remplace la fonction `GameBoardPanel`

```tsx
function GameBoardPanel(props: {
  board: PartyGameBoardSurface | null;
  partyState: string;
  revealCorrect: boolean;
}): JSX.Element | null {
  const { board, partyState, revealCorrect } = props;

  if (board !== null && board.kind === "video") {
    return (
      <section className="bz-board">
        <div className="bz-board-meta">
          <span className="bz-pill bz-info"><span className="bz-dot" />vidéo</span>
          <span>
            {board.packTitle} · Manche {board.roundNumberHuman} — {board.roundTitle}
          </span>
        </div>
        <video
          key={board.replaySerial}
          controls
          playsInline
          preload="metadata"
          className="bz-board-video"
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
      <section className="bz-board">
        <div className="bz-board-meta">
          <span className="bz-pill bz-accent">
            +{board.points} {board.points === 1 ? "pt" : "pts"}
          </span>
          <span>
            {board.packTitle} · Manche {board.roundNumberHuman} — {board.roundTitle}
            {" · Question "}
            {board.questionIndexInRound + 1}
          </span>
        </div>
        <h2 className="bz-board-prompt">{board.prompt}</h2>
        <ol className="bz-board-choices">
          {board.choices.map((c, i) => {
            const isCorrect =
              revealCorrect && typeof ci === "number" && ci === i;
            return (
              <li
                key={`${board.roundIndex}-${board.questionIndexInRound}-${i}`}
                className={`bz-choice ${isCorrect ? "bz-choice--correct" : ""}`}
              >
                <span className="bz-choice-letter">
                  {String.fromCharCode(65 + i)}
                </span>
                <span className="bz-choice-text">{c}</span>
                {isCorrect ? (
                  <span className="bz-pill bz-good">
                    <span className="bz-dot" />
                    bonne réponse
                  </span>
                ) : null}
              </li>
            );
          })}
        </ol>
        {correctText !== null ? (
          <p className="bz-board-answer">
            Réponse attendue : <strong>{correctText}</strong>
          </p>
        ) : null}
      </section>
    );
  }

  if (partyState === "round_active") {
    return (
      <section className="bz-board bz-board--empty">
        <h2>Zone de jeu</h2>
        <p>
          Aucun énoncé disponible : l'animateur doit charger un pack quiz
          côté tableau avant de lancer la manche.
        </p>
      </section>
    );
  }
  return null;
}
```

---

## 2. Remplace **uniquement** le `return (...)` de `Play`

State et effects (`useState`, `useEffect`, `buzz`, `sendChat`, les
gardes `Navigate`/`RedirectJoinForReauth`/`Shell title="Chargement…"`,
`parseSub`, le calcul de `myId`, `rowMe`, `canChatRoom`, `canBuzz`) restent
à l'identique. Repère la ligne `return (` après la définition de
`canBuzz` et remplace tout jusqu'à la `}` de fermeture de fonction (juste
avant `function Admin()`).

```tsx
  return (
    <Shell title={`Partie · ${snap.joinCode}`}>
      <section className="bz-identity-strip">
        <span className="bz-avatar">
          {(rowMe?.displayName ?? "?").slice(0, 2).toUpperCase()}
        </span>
        <div className="bz-identity-info">
          <div className="bz-identity-name">{rowMe?.displayName ?? "—"}</div>
          <div className="bz-identity-meta">
            {snap.maxTeams != null && snap.maxTeams >= 2 ? (
              <span>
                Équipe&nbsp;
                <strong>
                  {rowMe?.teamId === null || rowMe?.teamId === undefined
                    ? "—"
                    : rowMe.teamId}
                </strong>
              </span>
            ) : null}
            <span
              className={`bz-pill ${
                snap.state === "round_active" ? "bz-live" : ""
              }`}
            >
              {snap.state === "round_active" ? (
                <span className="bz-dot" />
              ) : null}
              {snap.state}
            </span>
          </div>
        </div>
        <div className="bz-identity-score">
          <span className="bz-score-label">points</span>
          <span className="bz-score-value">{rowMe?.score ?? 0}</span>
        </div>
      </section>

      {err ? <p style={{ color: "crimson" }}>{err}</p> : null}

      <GameBoardPanel
        board={snap.gameBoard ?? null}
        partyState={snap.state}
        revealCorrect={false}
      />

      <section className="bz-buzz-hero">
        {canBuzz ? (
          <button
            type="button"
            onClick={() => void buzz()}
            className="bz-buzz-btn bz-buzz-armed"
            aria-label="Buzz"
          >
            BUZZ
          </button>
        ) : (
          <div className="bz-buzz-closed">
            <span className="bz-pill">buzzer fermé</span>
            <p>
              {snap.gameBoard !== null && snap.gameBoard.kind === "video"
                ? "Regarde la vidéo — l'animateur peut la relancer pour tout le monde."
                : snap.state === "lobby"
                ? "En attente du démarrage de la manche par l'animateur."
                : snap.state === "between_rounds"
                ? "Pause entre les manches. Le buzzer rouvrira à la prochaine manche."
                : snap.state === "ended"
                ? "Partie terminée. Merci d'avoir joué !"
                : "L'animateur n'a pas encore ouvert le buzzer pour cette question."}
            </p>
          </div>
        )}
      </section>

      {snap.buzzOrder.length > 0 ? (
        <section className="bz-queue">
          <h2>File de buzz</h2>
          <ol>
            {snap.buzzOrder.map((idBuzz, idx) => {
              const pl = snap.players.find((x) => x.id === idBuzz);
              const isMe = idBuzz === myId;
              return (
                <li
                  key={`${idBuzz}-${idx}`}
                  className={`bz-queue-row ${isMe ? "bz-queue-me" : ""}`}
                >
                  <span className="bz-queue-rank">{idx + 1}</span>
                  <span className="bz-queue-name">
                    {pl?.displayName ?? idBuzz}
                    {isMe ? " · toi" : ""}
                  </span>
                </li>
              );
            })}
          </ol>
        </section>
      ) : null}

      {canChatRoom ? (
        <section className="bz-chat">
          <h2>Chat</h2>
          <div className="bz-chat-input">
            <textarea
              value={chat}
              rows={2}
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
          </div>
          <ul className="bz-chat-list">
            {snap.chatTail.slice(-15).map((m) => (
              <li key={m.id} className="bz-chat-row">
                <strong>{m.displayName}</strong>
                <span>{m.text}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="bz-muted">
          Chat disponible en lobby ou entre deux manches.
        </p>
      )}

      <p className="bz-leave">
        <button
          type="button"
          onClick={() =>
            nav(`/join?code=${encodeURIComponent(snap.joinCode)}`)
          }
        >
          Quitter pour changer pseudo / équipe
        </button>
      </p>
    </Shell>
  );
}
```

⚠️ N'oublie pas la `}` finale qui ferme la fonction `Play`.

---

## Vérifier en local

```bash
cd webserver
npm run dev
```

Scénario rapide à tester :

1. Crée une partie (sur un onglet) → rejoins-la (sur un autre onglet en navigation privée).
2. **En lobby** : tu vois le buzz "fermé" avec message "En attente du démarrage de la manche".
3. **Charge un pack** côté animateur, **lance la manche**, **ouvre le buzzer** : sur l'écran joueur le disque jaune apparaît et pulse.
4. **Clique sur BUZZ** : ta ligne dans la file s'affiche en jaune (highlight `bz-queue-me`).
5. **Charge un pack vidéo**, lance : le player vidéo s'affiche dans une card sombre, le buzzer reste fermé avec le message "Regarde la vidéo".
6. **Pause** côté animateur : retour en `between_rounds`, le chat redevient dispo.

## Commit & push

```bash
git add webserver/client/src/styles/buzzy.css \
        webserver/client/src/App.tsx
git commit -m "feat(ui): redesign Play — full-screen buzzer, board cards, queue & chat"
git push -u origin redesign/buzzy-play
```
