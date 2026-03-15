const fs = require("fs");
const path = require("path");

const SESSION_FILE = path.join(__dirname, "sessions.json");

let userSessions = new Map(); // chatId -> sessionId
const mediaGroupBuffer = new Map(); // mediaGroupId -> { fileIds: [], timestamp }

// Load sessions from file on startup
try {
  if (fs.existsSync(SESSION_FILE)) {
    const data = JSON.parse(fs.readFileSync(SESSION_FILE, "utf8"));
    userSessions = new Map(Object.entries(data));
    console.log(`[SessionManager] Loaded ${userSessions.size} sessions from file.`);
  }
} catch (e) {
  console.error("[SessionManager] Failed to load sessions:", e);
}

const saveSessions = () => {
  try {
    const data = Object.fromEntries(userSessions);
    fs.writeFileSync(SESSION_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error("[SessionManager] Failed to save sessions:", e);
  }
};

// Auto-cleanup stale media buffers (older than 60 seconds)
setInterval(() => {
  const now = Date.now();
  for (const [id, data] of mediaGroupBuffer) {
    if (now - data.timestamp > 60000) {
      mediaGroupBuffer.delete(id);
    }
  }
}, 30000);

const sessionManager = {
  // ─── Chat Sessions ───────────────────────────────────────────────
  get(chatId) {
    if (!chatId) return "none";
    const key = String(chatId);
    return userSessions.get(key) || "none";
  },

  set(chatId, sessionId) {
    if (chatId && sessionId && sessionId !== "none") {
      userSessions.set(String(chatId), sessionId);
      saveSessions();
    }
  },

  clear(chatId) {
    if (chatId) {
      userSessions.set(String(chatId), "none");
      saveSessions();
    }
  },

  // ─── Media Group Buffer ──────────────────────────────────────────
  bufferMedia(mediaGroupId, fileId) {
    if (!mediaGroupBuffer.has(mediaGroupId)) {
      mediaGroupBuffer.set(mediaGroupId, { fileIds: [], timestamp: Date.now() });
    }
    const group = mediaGroupBuffer.get(mediaGroupId);
    if (!group.fileIds.includes(fileId)) {
      group.fileIds.push(fileId);
    }
    group.timestamp = Date.now();
    return group.fileIds.length;
  },

  collectMedia(mediaGroupId) {
    const group = mediaGroupBuffer.get(mediaGroupId);
    const fileIds = group ? group.fileIds : [];
    mediaGroupBuffer.delete(mediaGroupId);
    return fileIds;
  }
};

module.exports = sessionManager;
