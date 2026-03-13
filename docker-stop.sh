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
  kill $(cat /tmp/localtunnel.pid) 2>/dev/null || true
  rm -f /tmp/localtunnel.pid
fi
pkill -f "lt --port" 2>/dev/null || true
pkill -f "cloudflared tunnel" 2>/dev/null || true

# OpenCode proxy
if [ -f /tmp/opencode-proxy.pid ]; then
  kill $(cat /tmp/opencode-proxy.pid) 2>/dev/null || true
  rm -f /tmp/opencode-proxy.pid
fi
pkill -f "opencode-proxy.js" 2>/dev/null || true

echo "✅ All services stopped."
echo ""
echo "💡 To also remove n8n persistent data: docker compose down -v"
