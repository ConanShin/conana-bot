#!/bin/bash
# ─── Stop Docker n8n + all services ─────────────────────────────────────────
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "🛑 Stopping all services..."

# Docker
docker compose down 2>/dev/null || true

# Localtunnel / Cloudflared
if [ -f /tmp/localtunnel.pid ]; then
  LT_PID=$(cat /tmp/localtunnel.pid)
  kill "$LT_PID" 2>/dev/null || true
  rm -f /tmp/localtunnel.pid
fi
pkill -9 -f "cloudflared tunnel" 2>/dev/null || true
rm -f /tmp/cloudflare.log

# OpenCode proxy
if [ -f /tmp/opencode-proxy.pid ]; then
  PROXY_PID=$(cat /tmp/opencode-proxy.pid)
  kill "$PROXY_PID" 2>/dev/null || true
  rm -f /tmp/opencode-proxy.pid
fi
pkill -9 -f "opencode-proxy.js" 2>/dev/null || true

echo "✅ All services stopped."
echo ""
echo "💡 To also remove n8n persistent data: docker compose down -v"
