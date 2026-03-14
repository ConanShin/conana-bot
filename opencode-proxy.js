const http = require("http");
const https = require("https");
const { exec } = require("child_process");
const { promisify } = require("util");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const execAsync = promisify(exec);

const PORT = process.env.OPENCODE_PROXY_PORT || 3284;
const OPENCODE_PATH = process.env.OPENCODE_PATH || "/usr/local/bin/opencode";
const DEFAULT_MODEL = process.env.PRIMARY_MODEL || "google/antigravity-gemini-3.1-pro";
const STOCK_MODEL = process.env.STOCK_MODEL || "google/antigravity-claude-opus-4-6-thinking";
const FALLBACK_MODEL = process.env.FALLBACK_MODEL || "google/antigravity-gemini-3-flash";
const TIMEOUT_MS = parseInt(process.env.OPENCODE_TIMEOUT_MS) || 300000;

function stripAnsi(str) {
  return str.replace(
    /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><~]/g,
    ""
  );
}

function extractAnswer(stdout) {
  const lines = stdout.split("\n").filter(Boolean);
  const parts = [];
  const errors = [];
  let sessionId = null;
  for (const line of lines) {
    try {
      const ev = JSON.parse(line);
      if (ev.sessionID && !sessionId) {
        sessionId = ev.sessionID;
      }
      if (ev.type === "text" && ev.part && ev.part.text) {
        parts.push(ev.part.text);
      } else if (ev.type === "assistant" && ev.properties && Array.isArray(ev.properties.content)) {
        for (const block of ev.properties.content) {
          if (block.type === "text" && block.text) parts.push(block.text);
        }
      } else if (ev.type === "error" && ev.error) {
        // Capture error events (e.g. quota exceeded)
        const errMsg = ev.error.data?.message || ev.error.message || ev.error.name || JSON.stringify(ev.error);
        errors.push(errMsg);
      }
    } catch { /* skip */ }
  }
  const text = parts.length > 0 ? parts.join("").trim() : (stripAnsi(stdout).trim() || "(no output)");
  return { text, sessionId, errors };
}

// Download a file from a URL and return the local filepath
function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(destPath);
    proto.get(url, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        // Follow redirect
        downloadFile(response.headers.location, destPath).then(resolve).catch(reject);
        return;
      }
      response.pipe(file);
      file.on('finish', () => { file.close(); resolve(destPath); });
    }).on('error', (err) => {
      fs.unlink(destPath, () => { }); // Clean up
      reject(err);
    });
  });
}

async function runOpencode(prompt, model, sessionId, chatId, files = []) {
  // Shell-safe encoding: escape single quotes inside a single-quoted bash string
  const safePrompt = prompt.replace(/'/g, "'\\''");
  let cmd = `"${OPENCODE_PATH}" run --model "${model}"`;
  if (sessionId && sessionId !== 'none') {
    cmd += ` --session "${sessionId}" --continue`;
  }
  // Attach files if provided
  for (const filePath of files) {
    cmd += ` --file "${filePath}"`;
  }
  cmd += ` --format json '${safePrompt}' < /dev/null`;

  try {
    const { stdout, stderr } = await execAsync(cmd, {
      timeout: TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024,
      cwd: "/tmp",
      env: { ...process.env, PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin" },
    });
    if (stderr) console.warn("stderr:", stderr.slice(0, 500));

    const extracted = extractAnswer(stdout);
    const finalSessionId = extracted.sessionId || sessionId;

    // Check for quota/rate-limit errors in stdout JSON events
    if (extracted.errors && extracted.errors.length > 0) {
      const errMsg = extracted.errors.join('; ');
      console.warn(`OpenCode returned error event: ${errMsg}`);
      const isQuota = /quota|rate.limit|429|overload|limit|unavailable/i.test(errMsg);
      if (isQuota) {
        const quotaErr = new Error(errMsg);
        quotaErr.stderr = errMsg; // So fallback logic can detect it
        throw quotaErr;
      }
    }

    if (chatId && finalSessionId && finalSessionId !== 'none') {
      userSessions.set(String(chatId), finalSessionId);
    }

    return { text: extracted.text, model, sessionId: finalSessionId };
  } catch (err) {
    console.error("Exec Exception:", err.message);
    if (err.stdout) console.log("stdout:", err.stdout.slice(0, 500));
    if (err.stderr) console.error("stderr:", err.stderr.slice(0, 500));
    throw err;
  }
}



async function runWithFallback(prompt, sessionId, chatId) {
  try {
    return await runOpencode(prompt, DEFAULT_MODEL, sessionId, chatId);
  } catch (err) {
    const msg = (err.stderr || err.message || "").toLowerCase();
    const isQuota = /quota|rate|429|overload|limit|unavailable/.test(msg);
    if (isQuota) {
      console.warn(`Primary model quota hit, falling back to ${FALLBACK_MODEL}`);
      return await runOpencode(prompt, FALLBACK_MODEL, sessionId, chatId);
    }
    throw err;
  }
}

// In-memory session tracking mapping chatId to sessionId
const userSessions = new Map();

// ─── Media Group Buffer (for Telegram albums) ────────────────────────────────
// When users send multiple photos as an album, Telegram sends each photo as
// a separate webhook call with the same media_group_id.
// We buffer them here and return all at once after a short wait.
const mediaGroupBuffer = new Map(); // mediaGroupId -> { fileIds: [], timestamp }

// Auto-cleanup stale buffers (older than 60 seconds)
setInterval(() => {
  const now = Date.now();
  for (const [id, data] of mediaGroupBuffer) {
    if (now - data.timestamp > 60000) {
      mediaGroupBuffer.delete(id);
    }
  }
}, 30000);

const server = http.createServer(async (req, res) => {
  // Health check
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", model: DEFAULT_MODEL }));
    return;
  }

  // Session info
  if (req.method === "GET" && req.url.startsWith("/session")) {
    const parsedUrl = new URL(req.url, 'http://localhost');
    const chatId = parsedUrl.searchParams.get("chatId");
    const chatIdStr = chatId ? String(chatId) : null;
    const sessionId = (chatIdStr && userSessions.get(chatIdStr)) || "none";
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ sessionId }));
    return;
  }

  // ─── Media Group: buffer a photo ─────────────────────────────────
  if (req.method === "POST" && req.url === "/media-group/add") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const { mediaGroupId, fileId } = JSON.parse(body);
        if (!mediaGroupId || !fileId) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "mediaGroupId and fileId are required" }));
          return;
        }
        if (!mediaGroupBuffer.has(mediaGroupId)) {
          mediaGroupBuffer.set(mediaGroupId, { fileIds: [], timestamp: Date.now() });
        }
        const group = mediaGroupBuffer.get(mediaGroupId);
        if (!group.fileIds.includes(fileId)) {
          group.fileIds.push(fileId);
        }
        group.timestamp = Date.now();
        console.log(`[MediaGroup] Buffered photo for ${mediaGroupId}, total: ${group.fileIds.length}`);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, count: group.fileIds.length }));
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // ─── Media Group: collect all buffered photos (with delay) ───────
  if (req.method === "GET" && req.url.startsWith("/media-group/collect")) {
    const parsedUrl = new URL(req.url, 'http://localhost');
    const mediaGroupId = parsedUrl.searchParams.get("id");
    const waitMs = parseInt(parsedUrl.searchParams.get("waitMs")) || 2000;

    if (!mediaGroupId) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "id parameter is required" }));
      return;
    }

    // Wait for more photos to arrive
    setTimeout(() => {
      const group = mediaGroupBuffer.get(mediaGroupId);
      const fileIds = group ? group.fileIds : [];
      console.log(`[MediaGroup] Collecting ${mediaGroupId}: ${fileIds.length} photos`);
      // Clean up after collection
      mediaGroupBuffer.delete(mediaGroupId);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ fileIds }));
    }, waitMs);
    return;
  }

  // Analyze images with vision
  if (req.method === "POST" && req.url === "/analyze-image") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      const tempFiles = [];
      try {
        const { prompt, imageUrls, chatId } = JSON.parse(body);
        const chatIdStr = chatId ? String(chatId) : null;
        if (!prompt || !imageUrls || !imageUrls.length) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "prompt and imageUrls are required" }));
          return;
        }

        // Download all images to temp files
        const tmpDir = '/tmp/stock-images';
        if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

        for (let i = 0; i < imageUrls.length; i++) {
          const ext = '.jpg';
          const tmpPath = path.join(tmpDir, `${crypto.randomUUID()}${ext}`);
          await downloadFile(imageUrls[i], tmpPath);
          tempFiles.push(tmpPath);
          console.log(`Downloaded image ${i + 1}/${imageUrls.length} to ${tmpPath}`);
        }

        let sessionId = null;
        if (chatIdStr && userSessions.has(chatIdStr)) {
          sessionId = userSessions.get(chatIdStr);
        }

        console.log(`[${new Date().toISOString()}] Analyzing ${tempFiles.length} images with ${STOCK_MODEL} (session: ${sessionId || 'none'})`);

        let result;
        try {
          result = await runOpencode(prompt, STOCK_MODEL, sessionId, chatIdStr, tempFiles);
        } catch (err) {
          const msg = (err.stderr || err.message || "").toLowerCase();
          const isQuota = /quota|rate|429|overload|limit|unavailable/.test(msg);
          if (isQuota) {
            console.warn(`Stock model (${STOCK_MODEL}) quota hit, falling back to ${FALLBACK_MODEL}`);
            result = await runOpencode(prompt, FALLBACK_MODEL, sessionId, chatIdStr, tempFiles);
          } else {
            throw err;
          }
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      } catch (err) {
        console.error("Image analysis error:", err.message);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          error: true,
          text: "❌ 이미지 분석 오류: " + (err.message || "").slice(0, 500),
          model: "Error"
        }));
      } finally {
        // Cleanup temp files
        for (const f of tempFiles) {
          try { fs.unlinkSync(f); } catch { }
        }
      }
    });
    return;
  }

  // Run opencode
  if (req.method === "POST" && req.url === "/run") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      try {
        const { prompt, model, chatId } = JSON.parse(body);
        const chatIdStr = chatId ? String(chatId) : null;
        if (!prompt) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "prompt is required" }));
          return;
        }

        let sessionId = null;
        if (chatIdStr) {
          if (prompt.trim() === '/new') {
            userSessions.delete(chatIdStr);
            console.log(`[${new Date().toISOString()}] Resetting session for chatId: ${chatIdStr}`);
            try {
              // Run a dummy prompt to trigger a new session and get a real ID
              const result = await runOpencode("New session initialized.", DEFAULT_MODEL, null, chatIdStr);
              const newSessionId = result.sessionId || 'none';
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify({
                text: "✨ 새로운 세션이 발급되었습니다! (New session ID has been issued)",
                model: "System",
                sessionId: newSessionId
              }));
            } catch (err) {
              console.error("Failed to reset session:", err);
              res.writeHead(500, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "Failed to initialize new session" }));
            }
            return;
          }
          if (userSessions.has(chatIdStr)) {
            sessionId = userSessions.get(chatIdStr);
          }
        }

        console.log(`[${new Date().toISOString()}] Processing: "${prompt.slice(0, 50)}..." (model: ${model || DEFAULT_MODEL}, session: ${sessionId || "none"})`);

        let result;
        if (model) {
          result = await runOpencode(prompt, model, sessionId, chatIdStr);
        } else {
          result = await runWithFallback(prompt, sessionId, chatIdStr);
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      } catch (err) {
        console.error("Error:", err.message);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          error: true,
          text: "❌ 오류 발생: " + (err.message || "").slice(0, 500),
          model: "Error"
        }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`OpenCode proxy server running on port ${PORT}`);
  console.log(`Primary model: ${DEFAULT_MODEL}`);
  console.log(`Fallback model: ${FALLBACK_MODEL}`);
});
