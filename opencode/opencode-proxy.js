const http = require("http");
const { readBody, respond, formatReply, escapeHTML } = require("../shared");
const sessionManager = require("./session-manager");
const { runOpencode, runWithFallback } = require("./opencode-runner");

const PORT = process.env.OPENCODE_PROXY_PORT || 3284;
const DEFAULT_MODEL = process.env.PRIMARY_MODEL || "google/antigravity-gemini-3.1-pro";

const MODULE_NAME = "General";

// ─── Helpers ──────────────────────────────────────────────────────────

/** Resolve session: body > memory > null */
function resolveSession(bodySessionId, chatIdStr) {
  const sid = bodySessionId || (chatIdStr ? sessionManager.get(chatIdStr) : null);
  return (!sid || sid === "none") ? null : sid;
}

/** Detect if text looks like raw JSON trace rather than a real answer */
function isRawJson(text) {
  const t = (text || "").trim();
  return t.startsWith("{") && (t.includes('"type"') || t.includes('"sessionID"'));
}

/** Clean raw response text before formatting */
function sanitizeResponseText(text, isSystem) {
  if (isSystem) return text;
  if (!isRawJson(text)) return escapeHTML(text || "");

  console.warn("[General] Detected raw JSON in response, stripping.");
  try {
    const parsed = JSON.parse(text);
    if (parsed.text) return escapeHTML(parsed.text);
  } catch { /* ignore */ }
  return escapeHTML("(AI 응답을 처리하지 못했습니다. 다시 시도해주세요.)");
}

// ─── Server ───────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {

  // ─── Health ─────────────────────────────────────────────────────
  if (req.method === "GET" && req.url === "/health") {
    return respond(res, 200, { status: "ok", model: DEFAULT_MODEL });
  }

  // ═══════════════════════════════════════════════════════════════
  //  SESSION ENDPOINTS
  // ═══════════════════════════════════════════════════════════════

  if (req.method === "GET" && req.url.startsWith("/session")) {
    const chatId = new URL(req.url, "http://localhost").searchParams.get("chatId");
    if (!chatId) return respond(res, 400, { error: "chatId is required" });

    let sessionId = sessionManager.get(chatId);

    if (sessionId === "none") {
      console.log(`[Session] Initializing first session for chatId: ${chatId}`);
      try {
        const result = await runOpencode("New session initialized.", DEFAULT_MODEL, null, chatId);
        sessionId = result.sessionId || "none";
      } catch (err) {
        console.error("[Session] Init failed:", err.message);
      }
    }

    return respond(res, 200, { sessionId });
  }

  if (req.method === "POST" && req.url === "/session/clear") {
    try {
      const { chatId } = await readBody(req);
      const chatIdStr = chatId ? String(chatId) : null;
      sessionManager.clear(chatIdStr);
      console.log(`[Session] Cleared for chatId: ${chatIdStr}`);

      const result = await runOpencode("New session initialized.", DEFAULT_MODEL, null, chatIdStr);
      return respond(res, 200, {
        ok: true,
        sessionId: result.sessionId || "none",
        message: "✨ 새로운 세션이 발급되었습니다!"
      });
    } catch (err) {
      console.error("[Session] Clear error:", err.message);
      return respond(res, 500, { error: "Failed to initialize new session" });
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  MEDIA GROUP ENDPOINTS
  // ═══════════════════════════════════════════════════════════════

  if (req.method === "POST" && req.url === "/media-group/add") {
    try {
      const { mediaGroupId, fileId } = await readBody(req);
      if (!mediaGroupId || !fileId) return respond(res, 400, { error: "Missing parameters" });
      return respond(res, 200, { ok: true, count: sessionManager.bufferMedia(mediaGroupId, fileId) });
    } catch (e) {
      return respond(res, 500, { error: e.message });
    }
  }

  if (req.method === "GET" && req.url.startsWith("/media-group/collect")) {
    const params = new URL(req.url, "http://localhost").searchParams;
    const mediaGroupId = params.get("id");
    const waitMs = parseInt(params.get("waitMs")) || 2000;
    if (!mediaGroupId) return respond(res, 400, { error: "id parameter is required" });

    setTimeout(() => {
      const fileIds = sessionManager.collectMedia(mediaGroupId);
      console.log(`[MediaGroup] Collected ${mediaGroupId}: ${fileIds.length} photos`);
      respond(res, 200, { fileIds });
    }, waitMs);
    return;
  }

  // ═══════════════════════════════════════════════════════════════
  //  GENERAL RUN ENDPOINT
  // ═══════════════════════════════════════════════════════════════

  if (req.method === "POST" && req.url === "/run") {
    try {
      const { prompt, model, intent, chatId, sessionId: bodySessionId } = await readBody(req);
      const chatIdStr = chatId ? String(chatId) : null;
      if (!prompt) return respond(res, 400, { error: "prompt is required" });

      const sessionId = resolveSession(bodySessionId, chatIdStr);
      let finalPrompt = prompt;
      let finalModel = model;

      // Wrap general/search/qa questions with a general-purpose prompt and use Flash model.
      // Any intent that reaches this endpoint is NOT blog/stock/email (those have their own proxies),
      // so all of them should be treated as general-purpose questions.
      const GENERAL_INTENTS = new Set(["general", "search", "qa"]);
      const isGeneralQuestion = intent && GENERAL_INTENTS.has(intent) && prompt !== "New session initialized.";

      if (isGeneralQuestion) {
        finalPrompt = `You are a helpful and general-purpose AI assistant. Answer the user's question naturally and comprehensively in the same language the user used. You can answer about anything: weather, news, general knowledge, coding, science, history, etc.\n\nUser Question: ${prompt}`;
        finalModel = finalModel || process.env.FALLBACK_MODEL || "google/antigravity-gemini-3-flash";
      }

      console.log(`[General] Run: chat=${chatIdStr}, session=${sessionId || "none"}, intent=${intent || "N/A"}`);

      const result = finalModel
        ? await runOpencode(finalPrompt, finalModel, sessionId, chatIdStr)
        : await runWithFallback(finalPrompt, sessionId, chatIdStr);

      const isSystem = prompt === "New session initialized.";
      const cleanContent = sanitizeResponseText(result.text, isSystem);

      const formattedText = formatReply(cleanContent.slice(0, 3900), {
        model: result.model || DEFAULT_MODEL,
        sessionId: result.sessionId,
        moduleName: MODULE_NAME,
        isSystem
      });

      return respond(res, 200, {
        text: result.text,
        model: result.model,
        formattedText,
        sessionId: result.sessionId || "none"
      });
    } catch (err) {
      console.error("[General] Run error:", err.message);
      return respond(res, 500, { error: err.message });
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  IMAGE ANALYSIS ENDPOINT
  // ═══════════════════════════════════════════════════════════════

  if (req.method === "POST" && req.url === "/analyze-image") {
    try {
      const { prompt, imageUrls, chatId, sessionId: bodySessionId } = await readBody(req);
      const chatIdStr = chatId ? String(chatId) : null;
      if (!prompt || !imageUrls) return respond(res, 400, { error: "prompt and imageUrls are required" });

      const sessionId = resolveSession(bodySessionId, chatIdStr);
      console.log(`[General] Vision: chat=${chatIdStr}, session=${sessionId || "none"}`);

      const result = await runOpencode(prompt, DEFAULT_MODEL, sessionId, chatIdStr, imageUrls);

      return respond(res, 200, {
        text: result.text,
        model: result.model,
        sessionId: result.sessionId || "none"
      });
    } catch (err) {
      console.error("[General] Vision error:", err.message);
      return respond(res, 500, { error: err.message });
    }
  }

  respond(res, 404, { error: "Not found" });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`General proxy (OpenCode) running on port ${PORT}`);
  console.log(`Default Model: ${DEFAULT_MODEL}`);
});
