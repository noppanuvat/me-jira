#!/bin/sh
set -e

# Start Node.js backend on internal port 3000
PORT=3000 node /app/jira-proxy-server.js &

# Start Nginx in foreground on port 8787
nginx -g "daemon off;"
