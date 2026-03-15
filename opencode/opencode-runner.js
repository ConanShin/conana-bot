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
        const errMsg = ev.error.data?.message || ev.error.message || ev.error.name || JSON.stringify(ev.error);
        errors.push(errMsg);
      }
    } catch { /* skip */ }
  }
  const text = parts.length > 0 ? parts.join("").trim() : (stripAnsi(stdout).trim() || "(no output)");
  return { text, sessionId, errors };
}

async function runOpencode(prompt, model, sessionId, chatIdStr, files = []) {
  const safePrompt = prompt.replace(/'/g, "'\\''");
  let cmd = `"${OPENCODE_PATH}" run --model "${model}"`;

  // Use 'none' explicit checks to avoid sending the literal string 'none' as session
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
    const finalSessionId = extracted.sessionId || sessionId;

    // Check for quota/rate-limit errors mapping
    if (extracted.errors && extracted.errors.length > 0) {
      const errMsg = extracted.errors.join('; ');
      console.warn(`OpenCode returned error event: ${errMsg}`);
      const isQuota = /quota|rate\.limit|429|overload|limit|unavailable/i.test(errMsg);
      if (isQuota) {
        const quotaErr = new Error(errMsg);
        quotaErr.stderr = errMsg;
        throw quotaErr;
      }
    }

    // Persist session if we have a valid one
    if (chatIdStr && finalSessionId && finalSessionId !== "none") {
      sessionManager.set(chatIdStr, finalSessionId);
    }

    return { text: extracted.text, model, sessionId: finalSessionId || 'none' };
  } catch (err) {
    console.error("Exec Exception:", err.message);
    if (err.stdout) console.log("stdout:", err.stdout.slice(0, 500));
    if (err.stderr) console.error("stderr:", err.stderr.slice(0, 500));
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
