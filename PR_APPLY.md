# Buzzy redesign · phase 4 (Admin — tableau animateur)

Prérequis : **phases 1, 2 & 3 mergées**.

Refonte de `/party/:id/admin` :
- **Layout 2 colonnes** sur desktop : stage à gauche, sidebar live à droite (file, scores, chat).
- **Hero card** : code joueurs en 88 px jaune, lien de partage en mono,
  QR sur fond blanc à droite.
- **Pack picker** dans une card propre.
- **Barre de contrôles sticky** en bas du stage (toujours visible quand
  tu scrolles dans la sidebar).
- **Scoreboard** trié par score décroissant, avec rang, équipe, input de
  delta + bouton compact dans une seule ligne.
- **File de buzz** en aside (rang #1 mis en avant en jaune).
- **Chat aside** : lecture + envoi en tant qu'animateur, format compact.

Aucune logique modifiée — état, sockets, callbacks REST, bootstrap, JWT,
purge des jetons, tout est strictement préservé.

## Branche suggérée

```bash
git checkout -b redesign/buzzy-admin
```

## Fichiers

- **Remplace** `webserver/client/src/styles/buzzy.css` *(ajoute la
  section "Phase 4 — Admin (host)" à la fin)*
- **Modifie** `webserver/client/src/App.tsx` :
  1. la fonction `Shell` (1 ligne d'inline-style → className + nouveau
     prop `wide` optionnel)
  2. le `return` final de la fonction `Admin` (≈ lignes 1257-1393)

Le state, les `useEffect`, les `useCallback` et toutes les fonctions
`onHost*` de `Admin` **ne changent pas**.

---

## 1. Mets à jour `Shell` (1 inline-style remplacé + prop `wide`)

Repère la fonction `Shell`. Le wrapper interne avec inline-style doit
devenir une `className`, et `Shell` accepte un prop `wide` optionnel :

```tsx
function Shell(props: {
  title: string;
  children: React.ReactNode;
  wide?: boolean;
}): JSX.Element {
  return (
    <div className="bz-app">
      <div
        className={`bz-shell-container${props.wide ? " bz-shell--wide" : ""}`}
      >
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
```

C'est tout : la valeur par défaut (`undefined` / `false`) garde l'ancien
max-width 880 px. Sur Admin on passera `wide`.

---

## 2. Remplace le `return (...)` final de `Admin`

Repère, à la toute fin de la fonction `Admin`, le `return (` qui suit la
ligne `const joinUrl = ...`. Tout le bloc jusqu'à `</Shell>);` se
remplace par celui-ci. Garde la `}` de fin de fonction.

```tsx
  const joinUrl = `${window.location.origin}/join?code=${encodeURIComponent(snap.joinCode)}`;

  const sortedPlayers = [...snap.players].sort((a, b) => b.score - a.score);

  return (
    <Shell title={`Animateur · ${snap.joinCode}`} wide>
      <div className="bz-host-layout">
        <main className="bz-host-stage">
          {/* Hero — code, share, QR */}
          <section className="bz-host-hero">
            <div className="bz-host-hero-info">
              <span className="bz-eyebrow">code joueurs</span>
              <div className="bz-host-code">{snap.joinCode}</div>
              <div className="bz-host-join">
                {window.location.host}/join?code=<strong>{snap.joinCode}</strong>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
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
                <span className="bz-pill">
                  {snap.players.length} joueur
                  {snap.players.length === 1 ? "" : "s"}
                </span>
                {snap.buzzWindowOpen ? (
                  <span className="bz-pill bz-good">
                    <span className="bz-dot" />
                    buzzer ouvert
                  </span>
                ) : null}
              </div>
            </div>
            <div className="bz-host-hero-qr">
              <QRCodeSVG
                value={joinUrl}
                size={160}
                level="M"
                includeMargin
                aria-label="QR code rejoindre la partie"
              />
              <span className="bz-host-qr-cap">scanne pour rejoindre</span>
            </div>
          </section>

          {err ? <pre className="bz-err">{err}</pre> : null}

          {/* Game board — same component, with revealCorrect for host */}
          <GameBoardPanel
            board={snap.gameBoard ?? null}
            partyState={snap.state}
            revealCorrect
          />

          {/* Pack picker */}
          <section className="bz-host-pack">
            <h2>Pack quiz</h2>
            <div className="bz-host-pack-row">
              <select
                value={basename}
                onChange={(e2) => setBasename(e2.target.value)}
              >
                {packsList.map((pk) => (
                  <option key={pk.basename} value={pk.basename}>
                    {pk.title} ({pk.roundCount ?? 0} manches)
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => void applyPackMutation()}
              >
                Charger
              </button>
            </div>
          </section>

          {/* Sticky controls */}
          <div className="bz-host-controls">
            <button
              type="button"
              className="bz-primary"
              onClick={() => void onHostRoundStart()}
            >
              ▶ Lancer la manche
            </button>
            <button type="button" onClick={() => void onHostRoundPause()}>
              ⏸ Pause (lobby)
            </button>
            <button
              type="button"
              onClick={() => void onHostBuzzWindow(true)}
            >
              🔔 Ouvrir buzzer
            </button>
            <button
              type="button"
              onClick={() => void onHostBuzzWindow(false)}
            >
              ⏹ Fermer & purger
            </button>
            <button type="button" onClick={() => void onHostCueNext()}>
              Question suivante →
            </button>
          </div>
        </main>

        <aside className="bz-host-aside">
          {/* Buzz queue */}
          <section className="bz-host-section">
            <h2>
              File de buzz
              {snap.buzzOrder.length > 0 ? (
                <span className="bz-pill bz-live">
                  <span className="bz-dot" />
                  live
                </span>
              ) : null}
            </h2>
            {snap.buzzOrder.length === 0 ? (
              <p className="bz-muted" style={{ margin: 0, fontSize: 12 }}>
                Vide.
              </p>
            ) : (
              <ol className="bz-host-queue-list">
                {snap.buzzOrder.map((idBuzz2, ix) => {
                  const pw = snap.players.find((zz) => zz.id === idBuzz2);
                  return (
                    <li key={`${idBuzz2}-${ix}`}>
                      <span className="bz-rank">{ix + 1}</span>
                      <span className="bz-name">
                        {pw?.displayName ?? idBuzz2}
                      </span>
                      {pw?.teamId != null ? (
                        <span className="bz-host-team">éq. {pw.teamId}</span>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            )}
          </section>

          {/* Scoreboard */}
          <section className="bz-host-section">
            <h2>Scores</h2>
            <ul className="bz-host-scores">
              {sortedPlayers.map((pl2, idx) => (
                <li key={pl2.id} className="bz-host-score-row">
                  <span className="bz-host-rank">{idx + 1}</span>
                  <span className="bz-host-name">
                    {pl2.displayName}
                    {pl2.teamId != null ? (
                      <span className="bz-host-team">éq. {pl2.teamId}</span>
                    ) : null}
                  </span>
                  <span className="bz-host-score-value">{pl2.score}</span>
                  <span className="bz-host-delta">
                    <input
                      value={deltaById[pl2.id] ?? ""}
                      placeholder="±"
                      onChange={(ev) =>
                        setDeltaById((m) => ({
                          ...m,
                          [pl2.id]: ev.target.value,
                        }))
                      }
                    />
                    <button
                      type="button"
                      onClick={() => void onDeltaScoreApply(pl2.id)}
                    >
                      OK
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </section>

          {/* Chat */}
          <section className="bz-host-section bz-chat">
            <h2>Chat</h2>
            <ul className="bz-chat-list">
              {snap.chatTail.length === 0 ? (
                <li
                  className="bz-chat-row bz-muted"
                  style={{ fontSize: 12 }}
                >
                  Aucun message pour l'instant.
                </li>
              ) : (
                snap.chatTail.slice(-80).map((m) => (
                  <li key={m.id} className="bz-chat-row">
                    <strong>{m.displayName}</strong>
                    <span>{m.text}</span>
                  </li>
                ))
              )}
            </ul>
            <div className="bz-chat-input">
              <textarea
                rows={2}
                value={hostChat}
                placeholder="Message animateur…"
                onChange={(evh) => setHostChat(evh.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter" || e.shiftKey) return;
                  e.preventDefault();
                  void onHostChatSend(e.currentTarget.value);
                }}
              />
              <button
                type="button"
                onClick={() => void onHostChatSend()}
              >
                Publier
              </button>
            </div>
          </section>
        </aside>
      </div>
    </Shell>
  );
}
```

⚠️ La `}` fermante existe déjà après `</Shell>);` — vérifie qu'elle est
bien préservée pour clore la fonction `Admin`.

---

## Petits raffinements optionnels sur les early returns

Tu peux aussi améliorer les écrans d'attente d'`Admin` (loading,
unavailable, missing token). Purement cosmétique :

```tsx
  if (bearer === "")
    return (
      <Shell title="Animateur">
        <div className="bz-card" style={{ marginTop: 24 }}>
          <p style={{ marginTop: 0 }}>
            Jeton animateur absent ou lien incomplet. Rouvrir le lien
            après création.
          </p>
          <button type="button" className="bz-primary" onClick={() => nav("/create")}>
            Créer une nouvelle partie
          </button>
        </div>
      </Shell>
    );

  if (adminBootstrap === "loading")
    return (
      <Shell title="Animateur">
        <p className="bz-muted">Chargement…</p>
      </Shell>
    );

  if (adminBootstrap === "unavailable")
    return (
      <Shell title="Animateur">
        <div className="bz-card" style={{ marginTop: 24 }}>
          <h2 style={{ marginTop: 0, fontSize: 22 }}>Partie indisponible</h2>
          <p>
            Cette partie n'existe plus côté serveur (inactivité ou
            redémarrage). Le lien "Reprendre" sur l'accueil ne peut pas
            restaurer une partie effacée.
          </p>
          <button
            type="button"
            onClick={() => {
              purgeAdminSessionForPartyRouteId(pid);
              setToken(null);
              nav("/", { replace: true });
            }}
          >
            Retour à l'accueil
          </button>
        </div>
      </Shell>
    );

  if (snap === null)
    return (
      <Shell title="Animateur">
        <p className="bz-muted">Synchronisation…</p>
      </Shell>
    );
```

---

## Vérifier en local

```bash
cd webserver
npm run dev
```

1. Va sur `/create`, crée une partie → tu arrives sur `/party/:id/admin`.
2. **Hero** : code en jaune géant, QR à droite sur fond blanc, pills d'état.
3. Ouvre un 2e onglet, scanne ou tape le code → rejoins comme joueur.
4. Le **scoreboard** dans la sidebar affiche maintenant le joueur (équipe en éq. X mono).
5. Lance la manche, **charge un pack**, ouvre le buzzer.
6. Le joueur clique BUZZ → sa ligne apparaît dans la **file de buzz aside** (rang #1 en jaune).
7. Saisis `+2` dans la case delta → clique OK → score mis à jour.
8. Écris un message dans le **chat** → il apparaît côté joueur.
9. Scrolle dans la page : la barre de contrôles reste **collée en bas**.

## Commit & push

```bash
git add webserver/client/src/styles/buzzy.css \
        webserver/client/src/App.tsx
git commit -m "feat(ui): redesign Admin — 2-col layout, hero QR, sticky controls, live aside"
git push -u origin redesign/buzzy-admin
```
