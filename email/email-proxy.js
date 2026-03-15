const http = require("http");
const nodemailer = require("nodemailer");
const { readBody, respond, httpRequest, formatReply } = require("../shared");

const PORT = 3288;
const OPENCODE_URL = process.env.OPENCODE_URL || "http://opencode-proxy:3284";

const MODULE_NAME = "Email";

// ─── Helpers ──────────────────────────────────────────────────────────

/** Parse email JSON (subject + body) from LLM response */
function parseEmailResponse(text) {
  const match = (text || "").match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]);
      if (parsed.subject && parsed.body) return { ...parsed, parsed: true };
    } catch { /* ignore */ }
  }
  const lines = text.split("\n").filter(l => l.trim());
  return { subject: (lines[0] || "이메일 제목").slice(0, 100), body: text, parsed: false };
}

/** Parse AI decision (ask vs ready) from LLM response */
function parseAiDecision(text, fallbackReceiver) {
  const match = (text || "").match(/\{[\s\S]*\}/);
  let decision = { status: "ask", message: "이메일 작성을 위해 추가 정보가 필요합니다." };

  if (match) {
    try { decision = JSON.parse(match[0]); } catch { /* ignore */ }
  }

  if (decision.status === "ready") {
    const to = decision.to || fallbackReceiver;
    if (!to || !to.includes("@")) {
      return { status: "ask", message: "수신인 이메일 주소가 올바르지 않거나 누락되었습니다." };
    }
    return { status: "ready", to, subject: decision.subject || "이메일 알림", body: decision.body || "" };
  }

  return { status: "ask", message: decision.message || "추가 정보가 필요합니다." };
}

/** Create Gmail transporter */
function createTransporter() {
  const user = process.env.GMAIL_USER;
  const pass = (process.env.GMAIL_APP_PASSWORD || "").replace(/\s+/g, "");
  if (!user || !pass || user.includes("your_email")) return null;
  return { transporter: nodemailer.createTransport({ service: "gmail", auth: { user, pass } }), user };
}

// ─── Server ───────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {

  if (req.method === "GET" && req.url === "/health") {
    return respond(res, 200, { status: "ok" });
  }

  // Generate email content only (no send)
  if (req.method === "POST" && req.url === "/generate-email") {
    try {
      const { query, chatId } = await readBody(req);
      if (!query) return respond(res, 400, { error: "query is required" });

      const prompt = `당신은 비서 AI입니다. 사용자의 요청을 바탕으로 아주 예의 바르고 전문적인 이메일을 작성해야 합니다.\n\n사용자 요청: "${query}"\n\n요구사항:\n- 제목과 본문을 포함하는 JSON 형식으로만 답변하세요.\n- 제목 필드명: "subject"\n- 본문 필드명: "body"\n- 전문적이고 정중한 톤을 사용하세요.\n- 다른 설명 없이 JSON만 반환하세요.\n\n출력 형식 예시:\n{\n  "subject": "주제...",\n  "body": "안녕하세요, ...\\n본문...\\n감사합니다."\n}`;

      console.log(`[Email] Generating for: "${query.slice(0, 30)}..."`);
      const result = await httpRequest({ method: "POST", url: `${OPENCODE_URL}/run` }, {
        prompt, chatId: chatId ? String(chatId) : null
      });

      const parsed = parseEmailResponse(result.text || "");
      return respond(res, 200, { ok: true, subject: parsed.subject, body: parsed.body, model: result.model });
    } catch (err) {
      console.error("[Email] Generate error:", err.message);
      return respond(res, 500, { error: true, text: "AI 이메일 생성 실패: " + err.message });
    }
  }

  // Direct send (no AI)
  if (req.method === "POST" && req.url === "/send-email") {
    try {
      const { to, subject, body } = await readBody(req);
      if (!to || !subject || !body) return respond(res, 400, { error: "to, subject, and body are required" });

      const gmail = createTransporter();
      if (!gmail) return respond(res, 500, { error: true, text: "Gmail 설정이 완료되지 않았습니다." });

      console.log(`[Email] Sending to ${to}...`);
      const info = await gmail.transporter.sendMail({
        from: `Conana Bot <${gmail.user}>`, to, subject, text: body
      });

      console.log(`[Email] Sent: ${info.messageId}`);
      return respond(res, 200, { ok: true, messageId: info.messageId });
    } catch (err) {
      console.error("[Email] Send error:", err.message);
      return respond(res, 500, { error: true, text: "Gmail 발송 실패: " + err.message });
    }
  }

  // AI-powered interactive email flow
  if (req.method === "POST" && req.url === "/send-ai-email") {
    try {
      const { query, receiver, chatId, sessionId } = await readBody(req);

      const prompt = `당신은 비서 AI입니다. 사용자의 요청을 바탕으로 이메일 발송 여부를 결정하세요.\n사용자 요청: "${query}"\n현재 지정된 수신인: ${receiver || "없음"}\n\n요구사항:\n1. 수신인 이메일 주소와 구체적인 이메일 내용이 모두 갖춰졌는지 확인하세요.\n2. 정보가 충분하면 status: "ready"와 함께 수신인(to), 제목(subject), 본문(body)을 포함한 JSON을 반환하세요.\n3. 정보가 부족하면 status: "ask"와 함께 추가 정보를 요청하는 메시지(message)를 포함한 JSON을 반환하세요.\n4. 반드시 JSON 형식으로만 응답하세요.`;

      const aiResult = await httpRequest({ method: "POST", url: `${OPENCODE_URL}/run` }, {
        prompt, chatId: String(chatId), sessionId
      });

      const returnedSessionId = aiResult.sessionId || sessionId || "none";
      const decision = parseAiDecision(aiResult.text || "", receiver);

      // Ask for more info
      if (decision.status === "ask") {
        const content = `📧 <b>추가 정보 필요</b>\n\n${decision.message}`;
        return respond(res, 200, {
          ok: true,
          formattedText: formatReply(content, { model: aiResult.model, sessionId: returnedSessionId, isSystem: true, moduleName: MODULE_NAME }),
          isAsking: true,
          sessionId: returnedSessionId
        });
      }

      // Ready to send
      const gmail = createTransporter();
      if (!gmail) {
        return respond(res, 200, {
          ok: true,
          formattedText: formatReply("📧 <b>Gmail 설정이 완료되지 않았습니다.</b>", { sessionId: returnedSessionId, isSystem: true, moduleName: MODULE_NAME }),
          isAsking: true,
          sessionId: returnedSessionId
        });
      }

      await gmail.transporter.sendMail({
        from: `Conana Bot <${gmail.user}>`, to: decision.to, subject: decision.subject, text: decision.body
      });

      const resultText = `✅ <b>이메일 발송 성공!</b>\n📬 <b>To:</b> ${decision.to}\n📌 <b>Subject:</b> ${decision.subject}\n\n${decision.body.slice(0, 500)}${decision.body.length > 500 ? "..." : ""}`;
      return respond(res, 200, {
        ok: true,
        formattedText: formatReply(resultText, { model: aiResult.model, sessionId: returnedSessionId, moduleName: MODULE_NAME }),
        sessionId: returnedSessionId
      });
    } catch (err) {
      console.error("[Email] AI flow error:", err.message);
      return respond(res, 500, { error: true, formattedText: `❌ <b>이메일 오류:</b>\n<pre>${err.message}</pre>` });
    }
  }

  respond(res, 404, { error: "Not found" });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Email proxy running on port ${PORT}`);
});
