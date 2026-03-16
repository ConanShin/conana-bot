#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

LT_PORT=5678
PROXY_PORT=3284

echo "🐳 Starting Docker n8n + OpenCode environment..."
echo ""

# 1. Cleanup
pkill -f "localtunnel\|lt --port" 2>/dev/null || true
pkill -f "opencode-proxy.js" 2>/dev/null || true
pkill -f "cloudflared tunnel" 2>/dev/null || true
sleep 1

# 2. Get Tunnel URL
echo "🌐 Starting Cloudflare tunnel..."
CF_LOG="/tmp/cloudflare.log"
rm -f "$CF_LOG" # Clear old logs
npx -y cloudflared tunnel --url http://localhost:$LT_PORT > "$CF_LOG" 2>&1 &
CF_PID=$!
echo $CF_PID > /tmp/localtunnel.pid

# Wait and verify
VALID_URL=false
for i in $(seq 1 30); do
  # Check for the specific pattern in the log
  TUNNEL_URL=$(grep -a -o "https://[a-zA-Z0-9.-]*\.trycloudflare\.com" "$CF_LOG" | head -1)
  if [[ $TUNNEL_URL == https* ]]; then
    VALID_URL=true
    break
  fi
  # Error check: if cloudflared exited early
  if ! kill -0 $CF_PID 2>/dev/null; then
    echo "  ❌ cloudflared process died unexpectedly. Check $CF_LOG"
    exit 1
  fi
  printf "."
  sleep 1
done
echo ""

if [ "$VALID_URL" = false ]; then
  echo "  ⚠️  Cloudflare tunnel failed. Trying localtunnel fallback..."
  kill $CF_PID 2>/dev/null || true
  
  LT_LOG="/tmp/localtunnel.log"
  rm -f "$LT_LOG"
  npx -y localtunnel --port $LT_PORT > "$LT_LOG" 2>&1 &
  LT_PID=$!
  echo $LT_PID > /tmp/localtunnel.pid
  
  for i in $(seq 1 20); do
    TUNNEL_URL=$(grep -a -o "https://[a-zA-Z0-9.-]*\.loca\.lt" "$LT_LOG" | head -1)
    if [[ $TUNNEL_URL == https* ]]; then
      VALID_URL=true
      break
    fi
    printf "."
    sleep 1
  done
  echo ""
fi

if [ "$VALID_URL" = false ]; then
  echo "  ❌ Failed to obtain any valid tunnel URL (Tried Cloudflare and Localtunnel)."
  echo "     Check your internet connection."
  exit 1
fi

echo "  ✅ Tunnel URL: $TUNNEL_URL"
echo ""

# 3. Load .env
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

TOKEN=$(grep TELEGRAM_TOKEN .env | cut -d'=' -f2)

# 4. Starting Containers
echo "🔨 Building and starting Docker containers..."
WEBHOOK_URL="$TUNNEL_URL" docker compose up -d --build

echo ""
echo "⏳ Waiting for n8n to be fully initialized..."
# Wait for healthz
while ! curl -s http://localhost:5678/healthz > /dev/null 2>&1; do
  sleep 2
done

# Check logs for "n8n ready" to be sure it's not just the port open
for i in $(seq 1 30); do
  if docker logs n8n-opencode 2>&1 | grep -q "n8n ready"; then
    echo "  ✅ n8n is ready!"
    break
  fi
  sleep 2
done
sleep 5

# 5. Workflow Import & Activate
if [ -f "n8n-workflow-docker.json" ]; then
  echo "📤 Importing n8n workflow..."
  
  # Unpublish ALL active workflows first to prevent webhook path conflicts
  # (handles any manually-imported duplicates from the n8n UI)
  echo "  🧹 Clearing any conflicting active workflows..."
  ACTIVE_IDS=$(docker exec n8n-opencode n8n list:workflow 2>/dev/null | awk -F'|' '{print $1}' | tr -d ' ')
  for WF_ID in $ACTIVE_IDS; do
    docker exec n8n-opencode n8n unpublish:workflow --id="$WF_ID" > /dev/null 2>&1 || true
  done

  if [ ! -z "$TOKEN" ]; then
    echo "  🔑 Injecting Secrets into workflow..."
    sed -e "s|%TELEGRAM_TOKEN%|$TOKEN|g" \
        -e "s|%GMAIL_USER%|$GMAIL_USER|g" \
        -e "s|%GMAIL_APP_PASSWORD%|$GMAIL_APP_PASSWORD|g" \
        n8n-workflow-docker.json > /tmp/workflow.json
  else
    cp n8n-workflow-docker.json /tmp/workflow.json
  fi
  
  docker cp /tmp/workflow.json n8n-opencode:/tmp/workflow.json
  
  echo "  📦 Running import command..."
  docker exec n8n-opencode n8n import:workflow --input /tmp/workflow.json
  
  echo "  🚀 Activating workflow..."
  docker exec n8n-opencode n8n publish:workflow --id=tg-opencode-main >/dev/null 2>&1 || true

  echo "🔄 Restarting n8n to ensure webhook registration..."
  docker restart n8n-opencode >/dev/null 2>&1
  
  # Wait for it to come back and ACTIVATE
  echo "  ⌛ Waiting for workflow activation..."
  for i in $(seq 1 30); do
    if docker logs n8n-opencode 2>&1 | grep -q "Activated workflow"; then
      echo "  ✅ Workflow activated and online!"
      break
    fi
    sleep 1
  done
fi

# 6. Manual Telegram Webhook Sync
if [ ! -z "$TOKEN" ] && [[ $TUNNEL_URL == https* ]]; then
  echo "🔗 Syncing Telegram Webhook..."
  HOOK_URL="$TUNNEL_URL/webhook/tg-opencode-hook"
  RESULT=$(curl -s "https://api.telegram.org/bot$TOKEN/setWebhook?url=$HOOK_URL")
  if [[ $RESULT == *"\"ok\":true"* ]]; then
    echo "  ✅ Webhook set to $HOOK_URL"
  else
    echo "  ⚠️  Telegram setWebhook failed: $RESULT"
  fi
fi

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  🎉 Docker environment started!"
echo ""
echo "  n8n UI:           http://localhost:5678"
echo "  Tunnel URL:       $TUNNEL_URL"
echo "  OpenCode Proxy:   http://localhost:$PROXY_PORT"
echo "  Containers:       n8n-opencode, opencode-proxy"
echo "═══════════════════════════════════════════════════════════"
