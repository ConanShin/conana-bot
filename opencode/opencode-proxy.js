const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const sessionManager = require("./session-manager");
const { runOpencode, runWithFallback } = require("./opencode-runner");

let nodemailer;
try {
  nodemailer = require("nodemailer");
} catch (e) {
  console.warn("Nodemailer not installed. /send-email will fail.");
}

const PORT = process.env.OPENCODE_PROXY_PORT || 3284;
const DEFAULT_MODEL = process.env.PRIMARY_MODEL || "google/antigravity-gemini-3.1-pro";
const FALLBACK_MODEL = process.env.FALLBACK_MODEL || "google/antigravity-gemini-3-flash";

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(destPath);
    proto.get(url, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        downloadFile(response.headers.location, destPath).then(resolve).catch(reject);
        return;
      }
      response.pipe(file);
      file.on('finish', () => { file.close(); resolve(destPath); });
    }).on('error', (err) => {
      fs.unlink(destPath, () => { });
      reject(err);
    });
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try { resolve(JSON.parse(body)); }
      catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const respond = (code, data) => {
    res.writeHead(code, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  };

  // ─── Health ────────────────────────────────────────────────────────
  if (req.method === "GET" && req.url === "/health") {
    return respond(200, { status: "ok", model: DEFAULT_MODEL });
  }

  // ═════════════════════════════════════════════════════════════════════
  //  SESSION ENDPOINTS
  // ═════════════════════════════════════════════════════════════════════

  // GET /session?chatId=xxx
  if (req.method === "GET" && req.url.startsWith("/session")) {
    const parsedUrl = new URL(req.url, 'http://localhost');
    const chatId = parsedUrl.searchParams.get("chatId");
    const sessionId = chatId ? sessionManager.get(chatId) : "none";
    return respond(200, { sessionId });
  }

  // POST /session/clear
  if (req.method === "POST" && req.url === "/session/clear") {
    try {
      const { chatId } = await readBody(req);
      const chatIdStr = chatId ? String(chatId) : null;
      sessionManager.clear(chatIdStr);
      console.log(`[${new Date().toISOString()}] Resetting session for chatId: ${chatIdStr}`);

      // Run a dummy prompt to trigger a new session and get a real ID
      const result = await runOpencode("New session initialized.", DEFAULT_MODEL, null, chatIdStr);
      const newSessionId = result.sessionId || 'none';

      return respond(200, {
        ok: true,
        sessionId: newSessionId,
        message: "✨ 새로운 세션이 발급되었습니다!"
      });
    } catch (err) {
      console.error("Failed to reset session:", err);
      return respond(500, { error: "Failed to initialize new session" });
    }
  }

  // ═════════════════════════════════════════════════════════════════════
  //  MEDIA GROUP ENDPOINTS
  // ═════════════════════════════════════════════════════════════════════

  // POST /media-group/add
  if (req.method === "POST" && req.url === "/media-group/add") {
    try {
      const { mediaGroupId, fileId } = await readBody(req);
      if (!mediaGroupId || !fileId) {
        return respond(400, { error: "mediaGroupId and fileId are required" });
      }
      const count = sessionManager.bufferMedia(mediaGroupId, fileId);
      console.log(`[MediaGroup] Buffered photo for ${mediaGroupId}, total: ${count}`);
      return respond(200, { ok: true, count });
    } catch (err) {
      return respond(400, { error: err.message });
    }
  }

  // GET /media-group/collect?id=xxx&waitMs=2000
  if (req.method === "GET" && req.url.startsWith("/media-group/collect")) {
    const parsedUrl = new URL(req.url, 'http://localhost');
    const mediaGroupId = parsedUrl.searchParams.get("id");
    const waitMs = parseInt(parsedUrl.searchParams.get("waitMs")) || 2000;

    if (!mediaGroupId) {
      return respond(400, { error: "id parameter is required" });
    }

    setTimeout(() => {
      const fileIds = sessionManager.collectMedia(mediaGroupId);
      console.log(`[MediaGroup] Collecting ${mediaGroupId}: ${fileIds.length} photos`);
      respond(200, { fileIds });
    }, waitMs);
    return;
  }

  // ═════════════════════════════════════════════════════════════════════
  //  OPENCODE RUNNER ENDPOINTS
  // ═════════════════════════════════════════════════════════════════════

  // POST /run
  if (req.method === "POST" && req.url === "/run") {
    try {
      const { prompt, model, chatId } = await readBody(req);
      const chatIdStr = chatId ? String(chatId) : null;
      if (!prompt) {
        return respond(400, { error: "prompt is required" });
      }

      const sessionId = chatIdStr ? sessionManager.get(chatIdStr) : null;
      console.log(`[${new Date().toISOString()}] Processing: "${prompt.slice(0, 50)}..." (model: ${model || DEFAULT_MODEL}, session: ${sessionId || "none"})`);

      let result;
      if (model) {
        result = await runOpencode(prompt, model, sessionId, chatIdStr);
      } else {
        result = await runWithFallback(prompt, sessionId, chatIdStr);
      }

      return respond(200, result);
    } catch (err) {
      console.error("Error:", err.message);
      return respond(500, {
        error: true,
        text: "❌ 오류 발생: " + (err.message || "").slice(0, 500),
        model: "Error"
      });
    }
  }

  // POST /analyze-image
  if (req.method === "POST" && req.url === "/analyze-image") {
    const tempFiles = [];
    try {
      const { prompt, imageUrls, chatId } = await readBody(req);
      const chatIdStr = chatId ? String(chatId) : null;
      if (!prompt || !imageUrls || !imageUrls.length) {
        return respond(400, { error: "prompt and imageUrls are required" });
      }

      const tmpDir = '/tmp/stock-images';
      if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

      for (let i = 0; i < imageUrls.length; i++) {
        const tmpPath = path.join(tmpDir, `${crypto.randomUUID()}.jpg`);
        await downloadFile(imageUrls[i], tmpPath);
        tempFiles.push(tmpPath);
        console.log(`Downloaded image ${i + 1}/${imageUrls.length} to ${tmpPath}`);
      }

      const sessionId = chatIdStr ? sessionManager.get(chatIdStr) : null;
      console.log(`[${new Date().toISOString()}] Analyzing ${tempFiles.length} images with ${DEFAULT_MODEL} (session: ${sessionId || 'none'})`);

      let result;
      try {
        result = await runOpencode(prompt, DEFAULT_MODEL, sessionId, chatIdStr, tempFiles);
      } catch (err) {
        const msg = (err.stderr || err.message || "").toLowerCase();
        const isQuota = /quota|rate|429|overload|limit|unavailable/.test(msg);
        if (isQuota) {
          console.warn(`Vision model quota hit, falling back to ${FALLBACK_MODEL}`);
          result = await runOpencode(prompt, FALLBACK_MODEL, sessionId, chatIdStr, tempFiles);
        } else {
          throw err;
        }
      }

      return respond(200, result);
    } catch (err) {
      console.error("Image analysis error:", err.message);
      return respond(500, {
        error: true,
        text: "❌ 이미지 분석 오류: " + (err.message || "").slice(0, 500),
        model: "Error"
      });
    } finally {
      for (const f of tempFiles) {
        try { fs.unlinkSync(f); } catch { }
      }
    }
  }

  // ═════════════════════════════════════════════════════════════════════
  //  EMAIL ENDPOINTS
  // ═════════════════════════════════════════════════════════════════════

  // POST /generate-email
  if (req.method === "POST" && req.url === "/generate-email") {
    try {
      const { query, chatId } = await readBody(req);
      const chatIdStr = chatId ? String(chatId) : null;
      if (!query) return respond(400, { error: "query is required" });

      const emailPrompt = `당신은 비서 AI입니다. 사용자의 요청을 바탕으로 아주 예의 바르고 전문적인 이메일을 작성해야 합니다.

사용자 요청: "${query}"

요구사항:
- 제목과 본문을 포함하는 JSON 형식으로만 답변하세요.
- 제목 필드명: "subject"
- 본문 필드명: "body"
- 전문적이고 정중한 톤을 사용하세요.
- 다른 설명 없이 JSON만 반환하세요.

출력 형식 예시:
{
  "subject": "주제...",
  "body": "안녕하세요, ...\\n본문...\\n감사합니다."
}`;

      const sessionId = chatIdStr ? sessionManager.get(chatIdStr) : null;
      console.log(`[EmailGen] Generating email for query: "${query.slice(0, 30)}..."`);
      
      const result = await runWithFallback(emailPrompt, sessionId, chatIdStr);
      let text = result.text || "";
      console.log(`[EmailGen] AI response received (${text.length} chars)`);
      
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          if (parsed.subject && parsed.body) {
            return respond(200, { ok: true, subject: parsed.subject, body: parsed.body, model: result.model });
          }
        } catch (e) { 
          console.warn("[EmailGen] JSON parse failed, using raw fallback");
        }
      }
      
      // Fallback: use first line as subject if no JSON
      const lines = text.split('\n').filter(l => l.trim());
      const subject = lines[0] ? lines[0].slice(0, 100) : "이메일 제목";
      return respond(200, { ok: true, subject, body: text, model: result.model });
    } catch (err) {
      console.error("Email generation error:", err);
      return respond(500, { error: true, text: "AI 이메일 생성 실패: " + err.message });
    }
  }

  // POST /send-email
  if (req.method === "POST" && req.url === "/send-email") {
    try {
      const { to, subject, body } = await readBody(req);
      if (!to || !subject || !body) {
        return respond(400, { error: "to, subject, and body are required" });
      }

      if (!nodemailer) {
        return respond(500, { error: true, text: "nodemailer 모듈이 설치되지 않았습니다. 빌드를 다시 확인해주세요." });
      }

      const GMAIL_USER = process.env.GMAIL_USER;
      const GMAIL_PASS = process.env.GMAIL_APP_PASSWORD;

      if (!GMAIL_USER || !GMAIL_PASS || GMAIL_USER.includes('your_email')) {
        console.error("[EmailSend] Gmail credentials missing or default");
        return respond(500, { error: true, text: "Gmail 설정이 완료되지 않았습니다. .env 파일을 확인하세요." });
      }

      const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: { user: GMAIL_USER, pass: GMAIL_PASS }
      });

      console.log(`[EmailSend] Sending email to ${to}...`);
      const info = await transporter.sendMail({
        from: `Conana Bot <${GMAIL_USER}>`,
        to,
        subject,
        text: body
      });

      console.log(`[EmailSend] Success: ${info.messageId}`);
      return respond(200, { ok: true, messageId: info.messageId });
    } catch (err) {
      console.error("Email send error:", err);
      return respond(500, { error: true, text: "Gmail 발송 실패: " + err.message });
    }
  }

  res.writeHead(404);
  res.end("Not found");
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`OpenCode proxy server running on port ${PORT}`);
  console.log(`Primary model: ${DEFAULT_MODEL}`);
  console.log(`Fallback model: ${FALLBACK_MODEL}`);
});
