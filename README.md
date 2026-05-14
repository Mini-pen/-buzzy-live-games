# buzzy-live-games

Application de quiz / soirées en temps réel (API **Fastify**, SPA **React** + **Vite**, **Socket.IO**), déployable derrière **Traefik**.

- Plan produit et état du code : [DEV_PLAN.md](./DEV_PLAN.md)
- Manuel build & déploiement : [manuel.md](./manuel.md)
- Labels Traefik / HTTPS : [TRAEFIK.md](./TRAEFIK.md)
- Journal de bord Cursor (reprise session) : [cursor_log_latest.txt](./cursor_log_latest.txt), archive [cursor_log_archive.txt](./cursor_log_archive.txt)

## Démarrage rapide (développement)

```bash
cp .env.example .env
# Renseigner JWT_SECRET dans .env

cd webserver
npm install
npm test
npm run dev
```

Production (Docker) : voir la section correspondante dans `manuel.md`.
