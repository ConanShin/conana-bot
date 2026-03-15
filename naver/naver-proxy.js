const http = require("http");

const PORT = 3285;
const OPENCODE_URL = process.env.OPENCODE_URL || "http://opencode-proxy:3284";

const { readBody, respond, httpRequest, stripHTML } = require("../shared");

const server = http.createServer(async (req, res) => {

  if (req.method === "GET" && req.url === "/health") {
    return respond(res, 200, { status: "ok" });
  }

  if (req.method === "POST" && req.url === "/generate-article") {
    try {
      const { topic, chatId, msgId, sessionId } = await readBody(req);
      if (!topic) return respond(res, 400, { error: "topic is required" });

      const prompt = `당신은 전문 블로그 작가입니다. 아래 주제를 바탕으로 네이버 블로그에 올릴 완성도 높은 글을 HTML 형식으로 작성해주세요.\n\n주제: ${topic}\n\n요구사항:\n- 제목(title)과 본문(content)을 JSON 형식으로 반환하세요\n- 본문은 HTML 태그를 사용하세요 (<h2>, <p>, <ul>, <li>, <strong>, <em> 등)\n- 최소 1000자 이상 작성\n- 소제목을 3~5개 포함\n- 독자 친화적이고 SEO에 최적화된 글\n- 마지막에 요약/결론 섹션 포함\n\n반드시 아래 JSON 형식으로만 답변하세요 (다른 텍스트 없이):\n{"title": "글 제목", "content": "<html 본문>"}`;

      console.log(`[Naver] Generating article for topic: ${topic}`);
      const result = await httpRequest({
        method: 'POST',
        url: `${OPENCODE_URL}/run`
      }, { prompt, chatId: String(chatId) });

      let rawText = result.text || '';
      const jsonMatch = rawText.match(/\{[\s\S]*\"title\"[\s\S]*\"content\"[\s\S]*\}/);
      const returnedSessionId = result.sessionId ? result.sessionId.replace(/^ses_/, '') : sessionId;

      let title, content;
      if (!jsonMatch) {
        title = `${topic}에 대한 정리`;
        content = `<p>${rawText.slice(0, 3000)}</p>`;
      } else {
        const parsed = JSON.parse(jsonMatch[0]);
        title = parsed.title;
        content = parsed.content;
      }

      const plainContent = stripHTML(content);
      const MAX_CONTENT = 3800;
      const truncated = plainContent.length > MAX_CONTENT
        ? plainContent.slice(0, MAX_CONTENT) + '\n\n... (내용이 길어 일부 생략되었습니다)'
        : plainContent;

      const model = result.model || 'OpenCode';
      const formattedText = `🤖 <b>Model:</b> <code>${model}</code>\n🏷️ <b>Session:</b> <code>${returnedSessionId || 'none'}</code>\n\n📰 <b>${title}</b>\n\n${truncated}`;

      return respond(res, 200, { chatId, msgId, formattedText, sessionId: returnedSessionId });
    } catch (err) {
      console.error("[Naver] Error:", err.message);
      return respond(res, 500, { error: err.message });
    }
  }

  respond(res, 404, { error: "Not found" });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Naver proxy server running on port ${PORT}`);
  console.log(`OpenCode URL: ${OPENCODE_URL}`);
});
