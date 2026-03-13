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
  for (const line of lines) {
    try {
      const ev = JSON.parse(line);
      if (ev.type === "text" && ev.part && ev.part.text) {
        parts.push(ev.part.text);
      } else if (ev.type === "assistant" && ev.properties && Array.isArray(ev.properties.content)) {
        for (const block of ev.properties.content) {
          if (block.type === "text" && block.text) parts.push(block.text);
        }
      }
    } catch { /* skip */ }
  }
  if (parts.length > 0) return parts.join("").trim();
  return stripAnsi(stdout).trim() || "(no output)";
}

async function runOpencode(prompt, model) {
  // Shell-safe encoding: escape single quotes inside a single-quoted bash string
  const safePrompt = prompt.replace(/'/g, "'\\''");
  const cmd = `"${OPENCODE_PATH}" run --model "${model}" --format json '${safePrompt}' < /dev/null`;
  
  try {
    const { stdout, stderr } = await execAsync(cmd, {
      timeout: TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024,
      cwd: "/tmp",
      env: { ...process.env, PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin" },
    });
    if (stderr) console.warn("stderr:", stderr.slice(0, 500));
    return { text: extractAnswer(stdout), model };
  } catch (err) {
    console.error("Exec Exception:", err.message);
    if (err.stdout) console.log("stdout:", err.stdout.slice(0, 500));
    if (err.stderr) console.error("stderr:", err.stderr.slice(0, 500));
    throw err;
  }
}



async function runWithFallback(prompt) {
  try {
    return await runOpencode(prompt, DEFAULT_MODEL);
  } catch (err) {
    const msg = (err.stderr || err.message || "").toLowerCase();
    const isQuota = /quota|rate|429|overload|limit|unavailable/.test(msg);
    if (isQuota) {
      console.warn(`Primary model quota hit, falling back to ${FALLBACK_MODEL}`);
      return await runOpencode(prompt, FALLBACK_MODEL);
    }
    throw err;
  }
}

const server = http.createServer(async (req, res) => {
  // Health check
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", model: DEFAULT_MODEL }));
    return;
  }

  // Run opencode
  if (req.method === "POST" && req.url === "/run") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      try {
        const { prompt, model } = JSON.parse(body);
        if (!prompt) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "prompt is required" }));
          return;
        }
        console.log(`[${new Date().toISOString()}] Processing: "${prompt.slice(0, 50)}..." (model: ${model || DEFAULT_MODEL})`);
        
        let result;
        if (model) {
          result = await runOpencode(prompt, model);
        } else {
          result = await runWithFallback(prompt);
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
