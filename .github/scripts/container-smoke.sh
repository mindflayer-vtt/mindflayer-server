#!/usr/bin/env bash
set -euo pipefail

container=mindflayer-server-ci-smoke
cleanup() { docker rm -f "$container" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker run --rm --detach --name "$container" \
  --env MINDFLAYER_FIRMWARE_AUTO_UPDATE=false \
  --publish 127.0.0.1:18080:8080 \
  --publish 127.0.0.1:18443:10443 \
  mindflayer-server:test >/dev/null

for attempt in {1..30}; do
  if docker exec "$container" node scripts/healthcheck.js; then
    break
  fi
  if [[ "$attempt" == 30 ]]; then
    docker logs "$container"
    exit 1
  fi
  sleep 1
done

test "$(docker inspect --format '{{.Config.User}}' "$container")" = node
test "$(docker inspect --format '{{index .Config.Labels "org.opencontainers.image.licenses"}}' "$container")" = GPL-3.0-only
docker exec "$container" test -s /app/LICENSE
docker exec "$container" test -s /app/CREDITS.md
docker exec "$container" node -e 'require("node:assert/strict").equal(require("./package.json").license, "GPL-3.0-only")'
curl --fail --silent --show-error http://127.0.0.1:18080/healthz >/dev/null
curl --fail --insecure --silent --show-error https://127.0.0.1:18443/healthz >/dev/null
docker logs "$container"
