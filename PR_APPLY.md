# Buzzy redesign · patch · correctifs thème sombre

Trois points où le thème clair fuit encore. Patch minimal et sûr :

| Bug | Fix |
|-----|-----|
| Tuiles avatars en bleu pâle / blanc cassé avec label invisible | Nouvelle classe `.bz-avatar-pick` + retrait des inline-styles dans `App.tsx` |
| Bordure `#ccc` autour des images d'avatars | Variable CSS `--bz-line-strong` à la place |
| `<option>` natives en blanc dans certains navigateurs | `color-scheme: dark` au niveau racine + style explicite des `<option>` |
| (Bonus) Iframes externes (YouTube, sites) qui flashent en blanc à l'ouverture | Cadre + fond sombre derrière les `iframe` en attendant le chargement |

## Branche suggérée

```bash
git checkout -b fix/dark-leftovers
```

## 1. Append en bas de `webserver/client/src/styles/buzzy.css`

```css
/* ── Patch · résidus de thème clair ────────────────────────────── */

/* Indique au navigateur que tout est en sombre → scrollbars,
   options de <select>, date pickers, autofill, etc., s'adaptent. */
:root { color-scheme: dark; }
[data-theme="light"] { color-scheme: light; }

/* Filet de sécurité sur les options de select (Firefox + Safari) */
.bz-app select option,
.bz-app select optgroup {
  background-color: var(--bz-surface-2);
  color: var(--bz-text);
}

/* Avatar — cercle autour de l'image */
.bz-app .bz-avatar-img {
  flex-shrink: 0;
  object-fit: cover;
  border-radius: 50%;
  border: 1px solid var(--bz-line-strong);
}

/* Avatar picker — tuiles sélectionnables (étape pseudo) */
.bz-app .bz-avatar-pick {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 10px;
  border-radius: 12px;
  border: 1px solid var(--bz-line);
  background: var(--bz-surface);
  color: var(--bz-text);
  cursor: pointer;
  font-size: 12px;
  line-height: 1.25;
  text-align: center;
  box-sizing: border-box;
  font-family: var(--bz-f-body);
  font-weight: 500;
  transition: border-color 120ms ease, background 120ms ease, transform 80ms ease;
  height: auto;
}
.bz-app .bz-avatar-pick:hover {
  background: var(--bz-surface-2);
  border-color: var(--bz-line-strong);
}
.bz-app .bz-avatar-pick[aria-checked="true"] {
  background: var(--bz-accent-soft);
  border-color: var(--bz-accent);
  color: var(--bz-text-strong);
  box-shadow: 0 0 0 1px var(--bz-accent) inset;
}
.bz-app .bz-avatar-pick[aria-checked="true"] .bz-avatar-img {
  border-color: var(--bz-accent);
}
.bz-app .bz-avatar-pick:focus-visible {
  outline: 2px solid var(--bz-accent);
  outline-offset: 2px;
}

/* Iframes externes — cadre sombre derrière (sans toucher au contenu cross-origin) */
.bz-app .bz-board-embed-wrap {
  background: var(--bz-bg-2);
}
.bz-app .bz-board-embed-wrap iframe {
  background: var(--bz-bg-2);
}
```

## 2. Modifs ciblées dans `webserver/client/src/App.tsx`

### a. `AvatarFigure` — remplace l'inline-style par la classe

**Ligne ~111-126.** Cherche :

```tsx
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
```

Remplace par :

```tsx
function AvatarFigure(props: { src: string; sizePx: number }): JSX.Element {
  return (
    <img
      className="bz-avatar-img"
      src={props.src}
      alt=""
      width={props.sizePx}
      height={props.sizePx}
      decoding="async"
    />
  );
}
```

### b. Tuile dans la grille de choix d'avatar

**Ligne ~750-777.** Cherche le `<button>` à l'intérieur de
`avatarsLib.avatars.map((a) => (`. Remplace **tout le `<button>`** par :

```tsx
                  <button
                    key={a.key}
                    type="button"
                    role="radio"
                    aria-checked={avatarKeyChosen === a.key}
                    aria-label={a.label}
                    className="bz-avatar-pick"
                    onClick={() => setAvatarKeyChosen(a.key)}
                  >
                    <AvatarFigure src={a.url} sizePx={56} />
                    <span>{a.label}</span>
                  </button>
```

C'est-à-dire : supprime entièrement le bloc
`style={{ display: "flex", flexDirection: "column", ... }}` (≈ 17 lignes
d'inline-style). La classe `bz-avatar-pick` gère tout, et l'état
sélectionné est piloté par `aria-checked` que tu avais déjà.

## Vérifier en local

```bash
cd webserver
npm run dev
```

1. Va sur `/join`, saisis un code valide, passe à l'étape pseudo/avatar.
   - Les tuiles d'avatars doivent maintenant être en **fond sombre**
     avec label crème lisible. La tuile sélectionnée est entourée de
     jaune Buzzy.
   - L'image d'avatar a un cercle gris foncé (pas blanc).
2. Ouvre n'importe quel `<select>` (pack quiz côté Admin, modal "Ajouter
   manche"). Les options doivent être sur **fond sombre** (et plus en
   blanc dans Firefox/Safari).
3. Sur l'Admin, ajoute une manche YouTube ou iframe et lance-la : pendant
   le chargement, **le cadre derrière l'iframe est sombre** (avant ça
   flashait en blanc).

## Commit

```bash
git add webserver/client/src/styles/buzzy.css webserver/client/src/App.tsx
git commit -m "fix(ui): dark-theme leftovers — avatar picker, select options, iframe backdrop"
git push -u origin fix/dark-leftovers
```

## Note

- L'**intérieur** des iframes (page YouTube, site externe…) reste sous le
  contrôle du site distant — c'est cross-origin, on ne peut pas le
  thématiser. Le patch ci-dessus s'occupe du cadre **autour** pour éviter
  le flash blanc à l'ouverture.
- Si tu vois d'autres zones spécifiques en clair, envoie-moi une capture
  ou pointe-moi la route + le nom du composant et je fais un nouveau
  patch ciblé.
