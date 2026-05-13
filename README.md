# buzzy-live-games

Application de quiz / soirées en temps réel (API **Fastify**, SPA **React** + **Vite**, **Socket.IO**), déployable derrière **Traefik**.

- Manuel détaillé : [manuel.md](./manuel.md)
- Labels Traefik / HTTPS : [TRAEFIK.md](./TRAEFIK.md)

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
