#!/usr/bin/env bash
set -u
DIR=/home/meturr/agent_1_workspaces/jira-ai
DOC=/home/meturr/agent_1_workspaces/jira-doc-creator
AUTH=/home/meturr/agent_1_workspaces/meturr-auth
NODE=/home/meturr/.hermes/tools/node-26.12.1-linux-x64/bin/node
CADDY=/home/meturr/.local/bin/caddy

# Node proxy (jira-ai)
if ! curl -s --max-time 3 http://127.0.0.1:8787/health >/dev/null 2>&1; then
  if [[ -f "$DIR/.env" ]]; then
    ( cd "$DIR" && set -a && . "$DIR/.env" && set +a && nohup "$NODE" "$DIR/jira-proxy-server.js" >> "$DIR/proxy.log" 2>&1 & )
  fi
fi

# Node backend (jira-doc-creator)
if ! curl -s --max-time 3 http://127.0.0.1:3001/health >/dev/null 2>&1; then
  if [[ -f "$DOC/.env" ]]; then
    ( cd "$DOC" && set -a && . "$DOC/.env" && set +a && PORT=3001 nohup "$NODE" "$DOC/backend/src/index.js" >> "$DOC/backend.log" 2>&1 & )
  fi
fi

# Auth service
if ! curl -s --max-time 3 http://127.0.0.1:3002/health >/dev/null 2>&1; then
  ( cd "$AUTH" && PORT=3002 nohup "$NODE" "$AUTH/src/index.js" >> "$AUTH/auth.log" 2>&1 & )
fi

# Caddy
if ! curl -s --max-time 3 https://meturr.online >/dev/null 2>&1; then
  ( cd "$DIR" && nohup "$CADDY" run --config "$DIR/Caddyfile" >> "$DIR/caddy.log" 2>&1 & )
fi
