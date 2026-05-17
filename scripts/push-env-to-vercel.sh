#!/usr/bin/env bash
# Push Renatus's env vars from local .env to Vercel (production target).
# Run from repo root. Reads .env, never echoes secrets, idempotent (replaces existing).
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ ! -f .env ]]; then
  echo "ERROR: .env not found in repo root ($(pwd))" >&2
  exit 1
fi

VERCEL_BIN="${VERCEL_BIN:-vercel}"
if ! command -v "$VERCEL_BIN" >/dev/null 2>&1; then
  VERCEL_BIN="/Users/thisisaman408/.nvm/versions/node/v20.19.5/bin/vercel"
fi
if ! "$VERCEL_BIN" --version >/dev/null 2>&1; then
  echo "ERROR: vercel CLI not found. set VERCEL_BIN or install it." >&2
  exit 1
fi

# Pull value for KEY out of .env. Supports KEY=val, KEY="val", KEY='val'.
get_env() {
  local key="$1"
  grep -E "^${key}=" .env 2>/dev/null | head -1 \
    | sed -E "s/^${key}=//; s/^\"(.*)\"$/\1/; s/^'(.*)'$/\1/"
}

KEYS=(
  DATABASE_URL
  WATSONX_API_KEY
  WATSONX_PROJECT_ID
  WATSONX_REGION
  GROQ_API_KEY
  GEMINI_API_KEY
  VERCEL_AI_GATEWAY_URL
  VERCEL_AI_GATEWAY_API_KEY
  RENATUS_KEK
  INNGEST_EVENT_KEY
  INNGEST_SIGNING_KEY
)

pushed=0
skipped=0
for key in "${KEYS[@]}"; do
  val="$(get_env "$key" || true)"
  if [[ -z "$val" ]]; then
    echo "  skip   $key (not in .env)"
    ((skipped++)) || true
    continue
  fi
  # Replace existing if present
  "$VERCEL_BIN" env rm "$key" production --yes >/dev/null 2>&1 || true
  printf '%s' "$val" | "$VERCEL_BIN" env add "$key" production >/dev/null 2>&1
  echo "  pushed $key"
  ((pushed++)) || true
done

echo ""
echo "Done. Pushed $pushed, skipped $skipped."
echo "Next: run \`vercel --prod\` from repo root to deploy."
