#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"
SERVER_FILE="$SCRIPT_DIR/jira-proxy-server.js"
HTML_FILE="$SCRIPT_DIR/jira_ai_requirement_analyzer_dev_qa.html"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing .env file: $ENV_FILE" >&2
  exit 1
fi

if [[ ! -f "$SERVER_FILE" || ! -f "$HTML_FILE" ]]; then
  echo "Could not find the proxy server or HTML app next to this script." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1 || ! command -v open >/dev/null 2>&1; then
  echo "This script requires Node.js and macOS 'open'." >&2
  exit 1
fi

set -a
. "$ENV_FILE"
set +a

if [[ -z "${JIRA_BASE_URL:-}" || -z "${JIRA_EMAIL:-}" || -z "${JIRA_API_TOKEN:-}" ]]; then
  echo "Set JIRA_BASE_URL, JIRA_EMAIL, and JIRA_API_TOKEN in .env." >&2
  exit 1
fi

PORT="${PORT:-8787}"
node "$SERVER_FILE" &
PROXY_PID=$!

cleanup() {
  if kill -0 "$PROXY_PID" 2>/dev/null; then
    kill "$PROXY_PID" 2>/dev/null || true
    wait "$PROXY_PID" 2>/dev/null || true
  fi
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

for _ in {1..20}; do
  if ! kill -0 "$PROXY_PID" 2>/dev/null; then
    wait "$PROXY_PID" || true
    echo "Proxy failed to start. Check whether port $PORT is already in use." >&2
    exit 1
  fi
  if curl --silent --fail "http://127.0.0.1:$PORT/health" >/dev/null; then
    break
  fi
  sleep 0.5
done

if ! curl --silent --fail "http://127.0.0.1:$PORT/health" >/dev/null; then
  echo "Proxy did not become ready at http://localhost:$PORT." >&2
  exit 1
fi

open "$HTML_FILE"
echo "Opened the app in your browser. Press Ctrl-C to stop the proxy."
wait "$PROXY_PID"
