const http = require("http");
const { exec } = require("child_process");
const { promisify } = require("util");

const execAsync = promisify(exec);

const PORT = process.env.OPENCODE_PROXY_PORT || 3284;
const OPENCODE_PATH = process.env.OPENCODE_PATH || "/usr/local/bin/opencode";
const DEFAULT_MODEL = process.env.PRIMARY_MODEL || "google/antigravity-gemini-3-flash";
const FALLBACK_MODEL = process.env.FALLBACK_MODEL || "google/antigravity-gemini-3.1-pro";
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
      }
    } catch { /* skip */ }
  }
  const text = parts.length > 0 ? parts.join("").trim() : (stripAnsi(stdout).trim() || "(no output)");
  return { text, sessionId };
}

async function runOpencode(prompt, model, sessionId, chatId) {
  // Shell-safe encoding: escape single quotes inside a single-quoted bash string
  const safePrompt = prompt.replace(/'/g, "'\\''");
  let cmd = `"${OPENCODE_PATH}" run --model "${model}"`;
  if (sessionId && sessionId !== 'none') {
    cmd += ` --session "${sessionId}" --continue`;
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
