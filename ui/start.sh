#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

# Kill any existing backend
pkill -f "node server.js" 2>/dev/null || true

echo "Starting API server..."
node server.js > /tmp/mariadb-ui-server.log 2>&1 &
SERVER_PID=$!
echo "  API server PID: $SERVER_PID (logs: /tmp/mariadb-ui-server.log)"

sleep 1

# Verify backend started
if ! curl -sf http://localhost:3001/api/instances > /dev/null 2>&1; then
  echo "  WARNING: API server may not be ready yet, check /tmp/mariadb-ui-server.log"
fi

echo "Starting Vite dev server..."
echo "  UI: http://localhost:5173"
npm run dev
