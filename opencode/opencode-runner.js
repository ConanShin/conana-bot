const { exec } = require("child_process");
const { promisify } = require("util");
const sessionManager = require("./session-manager");

const execAsync = promisify(exec);

const OPENCODE_PATH = process.env.OPENCODE_PATH || "/usr/local/bin/opencode";
const DEFAULT_MODEL = process.env.PRIMARY_MODEL || "google/antigravity-gemini-3.1-pro";
const FALLBACK_MODEL = process.env.FALLBACK_MODEL || "google/antigravity-gemini-3-flash";
const TIMEOUT_MS = parseInt(process.env.OPENCODE_TIMEOUT_MS) || 600000;

function stripAnsi(str) {
  return str.replace(
    /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><~]/g,
    ""
  );
}

function extractAnswer(stdout) {
  const lines = stdout.split("\n");
  const parts = [];
  const errors = [];
  let sessionId = null;
  let hasValidResponse = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Detect if this line looks like start of a JSON block
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        const ev = JSON.parse(trimmed);
        if (ev.sessionID && !sessionId) {
          sessionId = ev.sessionID;
        }

        // Response content extraction
        if (ev.type === "text" && ev.part?.text) {
          parts.push(ev.part.text);
          hasValidResponse = true;
        } else if (ev.type === "assistant" && ev.properties?.content) {
          for (const block of ev.properties.content) {
            if (block.type === "text" && block.text) {
              parts.push(block.text);
              hasValidResponse = true;
            }
          }
        } else if (ev.type === "assistant" && ev.part?.text) {
          parts.push(ev.part.text);
          hasValidResponse = true;
        } else if (ev.type === "error" && ev.error) {
          const errMsg = ev.error.data?.message || ev.error.message || ev.error.name || JSON.stringify(ev.error);
          errors.push(errMsg);
        }
      } catch { /* likely partial or multi-line JSON, skip or wait */ }
    }
  }

  let text = parts.join("").trim();

  // Refined fallback: remove ANY line that looks like it could be part of JSON
  if (!text) {
    const cleaned = stripAnsi(stdout)
      .split("\n")
      .filter(l => {
        const t = l.trim();
        // Filter out JSON markers or lines starting with JSON-common keys
        if (!t) return false;
        if (t.startsWith("{") || t.startsWith("}") || t.startsWith("[") || t.startsWith("]")) return false;
        if (t.startsWith('"') && t.includes('":')) return false; // JSON key-value pair
        return true;
      })
      .join("\n")
      .trim();
    text = cleaned || "(no output)";
  }

  return { text, sessionId, errors, hasValidResponse };
}

async function runOpencode(prompt, model, sessionId, chatIdStr, files = []) {
  const safePrompt = prompt.replace(/'/g, "'\\''");
  let cmd = `"${OPENCODE_PATH}" run --model "${model}"`;

  if (sessionId && sessionId !== 'none') {
    cmd += ` --session "${sessionId}" --continue`;
  }

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

    let finalSessionId = sessionId;

    if (extracted.hasValidResponse && extracted.sessionId) {
      finalSessionId = extracted.sessionId;
    }

    console.log(`[RunOpencode] Session: in=${sessionId || "none"} -> out=${finalSessionId || "none"} (valid=${extracted.hasValidResponse})`);

    if (extracted.errors.length > 0) {
      const errMsg = extracted.errors.join('; ');
      console.warn(`OpenCode error trace: ${errMsg}`);
      if (/quota|rate\.limit|429|overload/i.test(errMsg)) {
        const qErr = new Error(errMsg);
        qErr.stderr = errMsg;
        throw qErr;
      }
    }

    if (chatIdStr && finalSessionId && finalSessionId !== "none" && extracted.hasValidResponse) {
      sessionManager.set(chatIdStr, finalSessionId);
    }

    return { text: extracted.text, model, sessionId: finalSessionId || 'none' };
  } catch (err) {
    console.error("Exec Exception:", err.message);
    throw err;
  }
}

async function runWithFallback(prompt, sessionId, chatIdStr) {
  try {
    return await runOpencode(prompt, DEFAULT_MODEL, sessionId, chatIdStr);
  } catch (err) {
    const msg = (err.stderr || err.message || "").toLowerCase();
    const isQuota = /quota|rate|429|overload|limit|unavailable/.test(msg);
    if (isQuota) {
      console.warn(`Primary model quota hit, falling back to ${FALLBACK_MODEL}`);
      return await runOpencode(prompt, FALLBACK_MODEL, sessionId, chatIdStr);
    }
    throw err; // Not a quota issue, rethrow
  }
}

module.exports = {
  runOpencode,
  runWithFallback,
};
