#!/usr/bin/env bash
# * Rebuild image, redeploy stack, refresh Traefik discovery.
# * Usage: ./scripts/deploy-docker-stack.sh (from repo root or any cwd)
# * Env (optional):
# *   REMOVE_LEGACY_PARTYGAMES=0  Skip removal of old `partygames` compose project containers (same Traefik Host).
# *   TRAEFIK_COMPOSE_DIR=/path    If set and docker-compose.yml exists, `docker compose restart traefik` there.
# *   TRAEFIK_SERVICE_NAME=traefik Compose service name inside that file (default traefik).
# *   TRAEFIK_CONTAINER_NAME=traefik Used when TRAEFIK_COMPOSE_DIR unset: `docker restart` this container.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

IMAGE_NAME="${IMAGE_NAME:-buzzy-live-games:local}"
REMOVE_LEGACY="${REMOVE_LEGACY_PARTYGAMES:-1}"
TRAEFIK_COMPOSE_DIR="${TRAEFIK_COMPOSE_DIR:-}"
TRAEFIK_SERVICE_NAME="${TRAEFIK_SERVICE_NAME:-traefik}"
TRAEFIK_CONTAINER_NAME="${TRAEFIK_CONTAINER_NAME:-traefik}"

if [[ -z "${TRAEFIK_COMPOSE_DIR}" ]] && [[ -f "${HOME}/dev/traefik/docker-compose.yml" ]]; then
  TRAEFIK_COMPOSE_DIR="${HOME}/dev/traefik"
fi

if [[ ! -f "${ROOT}/.env" ]]; then
  echo >&2 "Missing ${ROOT}/.env — copier depuis .env.example et renseigner JWT_SECRET."
  exit 1
fi

if [[ "${REMOVE_LEGACY}" == "1" ]]; then
  while read -r cid; do
    [[ -z "${cid}" ]] && continue
    echo "Suppression conteneur ancien projet compose partygames: ${cid}"
    docker rm -f "${cid}" || true
  done < <(docker ps -aq --filter "label=com.docker.compose.project=partygames" 2>/dev/null || true)
fi

docker compose down --remove-orphans || true

echo "Suppression image locale ${IMAGE_NAME}…"
docker rmi -f "${IMAGE_NAME}" 2>/dev/null || true

echo "Build (--no-cache)…"
docker compose build --no-cache

echo "Démarrage…"
docker compose up -d

if [[ -n "${TRAEFIK_COMPOSE_DIR}" ]] && [[ -f "${TRAEFIK_COMPOSE_DIR}/docker-compose.yml" ]]; then
  echo "Restart Traefik (compose) ${TRAEFIK_COMPOSE_DIR}…"
  (cd "${TRAEFIK_COMPOSE_DIR}" && docker compose restart "${TRAEFIK_SERVICE_NAME}")
elif docker inspect "${TRAEFIK_CONTAINER_NAME}" >/dev/null 2>&1; then
  echo "Restart Traefik (${TRAEFIK_CONTAINER_NAME})…"
  docker restart "${TRAEFIK_CONTAINER_NAME}"
else
  echo "Avertissement: Traefik introuvable (pas de dossier compose ni conteneur ${TRAEFIK_CONTAINER_NAME}). Ajustez TRAEFIK_COMPOSE_DIR." >&2
fi

echo ""
if docker compose ps --status running --quiet | grep -q .; then
  echo "Conteneurs actifs:"
  docker compose ps
fi

echo "Terminé. Test rapide depuis l’hôte (si le port 3000 est publié ailleurs, adapter):"
curl -fsS "http://127.0.0.1:3000/api/health" && echo "" || echo "(curl localhost:3000 ignoré si le stack n’expose pas 3000 sur l’hôte — normal avec Traefik seul)"
