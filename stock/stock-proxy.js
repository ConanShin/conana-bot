const http = require("http");
const { readBody, respond, httpRequest, escapeHTML, formatReply } = require("../shared");

const PORT = 3286;
const OPENCODE_URL = process.env.OPENCODE_URL || "http://opencode-proxy:3284";
const STOCK_MODEL = process.env.STOCK_MODEL || "google/antigravity-claude-opus-4-6-thinking";
const TG_TOKEN = process.env.TELEGRAM_TOKEN;

const MODULE_NAME = "Stock";

// ─── Helpers ──────────────────────────────────────────────────────────

/** Extract stock JSON from LLM response text */
function parseStockJson(text) {
  const match = (text || "").match(/\{[\s\S]*"stocks"[\s\S]*\}/i);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    return (parsed.stocks && parsed.stocks.length > 0) ? parsed : null;
  } catch { return null; }
}

/** Format stock list for Telegram */
function formatStockList(stockData) {
  let report = "📋 <b>현재 보유 주식 현황</b>\n━━━━━━━━━━━━━━━━━━━━\n";
  for (const s of stockData.stocks) {
    const emoji = (s.profitLoss || 0) >= 0 ? "🟢" : "🔴";
    const sign = (s.profitLoss || 0) >= 0 ? "+" : "";
    report += `${emoji} <b>${escapeHTML(s.name)}</b>: ${s.shares}주\n`;
    report += `   평가액: ${s.totalValue?.toLocaleString()}원 | 수익: ${sign}${s.profitLoss?.toLocaleString()}원\n`;
  }
  report += `\n💰 <b>총 평가액:</b> <code>${stockData.totalPortfolioValue?.toLocaleString() || "0"}원</code>`;
  return report;
}

/** Format full analysis report for Telegram */
function formatAnalysisReport(stockData, recommendations) {
  let report = "📊 <b>주식 포트폴리오 분석 리포트</b>\n";
  report += `📅 ${new Date().toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" })}\n\n`;

  report += "━━━━━━━━━━━━━━━━━━━━\n💰 <b>포트폴리오 요약</b>\n";
  report += `총 평가액: <code>${stockData.totalPortfolioValue?.toLocaleString()}원</code>\n`;
  const plEmoji = stockData.totalProfitLoss >= 0 ? "📈" : "📉";
  report += `총 수익: ${plEmoji} <code>${stockData.totalProfitLoss?.toLocaleString()}원 (${stockData.overallProfitPercent}%)</code>\n\n`;

  report += "📋 <b>종목별 현황</b>\n\n";
  for (const s of stockData.stocks) {
    const emoji = (s.profitLoss || 0) >= 0 ? "🟢" : "🔴";
    const sign = (s.profitLoss || 0) >= 0 ? "+" : "";
    report += `${emoji} <b>${escapeHTML(s.name)}</b>\n`;
    report += `   ${s.shares}주 | ${s.totalValue?.toLocaleString()}원 | ${sign}${s.profitLoss?.toLocaleString()}원 (${s.profitLossPercent}%)\n`;
  }
  report += "\n";

  if (recommendations?.recommendations) {
    report += "━━━━━━━━━━━━━━━━━━━━\n🎯 <b>오늘의 투자 전략</b>\n\n";
    for (const rec of recommendations.recommendations) {
      const icon = rec.action === "BUY" ? "🟢" : rec.action === "SELL" ? "🔴" : "⏸️";
      report += `${icon} <b>${escapeHTML(rec.name)}</b> → <b>${rec.action}</b>\n   📝 ${escapeHTML(rec.reason)}\n\n`;
    }
    if (recommendations.portfolioSummary) {
      report += `━━━━━━━━━━━━━━━━━━━━\n📌 <b>총평</b>\n${escapeHTML(recommendations.portfolioSummary)}\n`;
    }
  }
  return report;
}

/** Resolve Telegram photo file IDs to URLs */
async function resolveImageUrls(fileIds) {
  const urls = [];
  for (const fileId of fileIds) {
    try {
      const info = await httpRequest({ url: `https://api.telegram.org/bot${TG_TOKEN}/getFile?file_id=${fileId}` });
      if (info.ok && info.result.file_path) {
        urls.push(`https://api.telegram.org/file/bot${TG_TOKEN}/${info.result.file_path}`);
      }
    } catch (e) {
      console.error(`[Stock] Failed to resolve fileId ${fileId}:`, e.message);
    }
  }
  return urls;
}

/** Try to extract stock data from various sources in order */
async function extractStockData(files, cleanMessage, isListOnly, chatId, sessionId) {
  // Step A: Vision
  if (files.length > 0) {
    const imageUrls = await resolveImageUrls(files);
    if (imageUrls.length > 0) {
      const visionPrompt = `You are a financial data extraction expert. Analyze the attached stock portfolio screenshot(s) carefully.\nExtract ALL stock holdings. Return ONLY valid JSON:\n{\n  "stocks": [{ "name": "...", "ticker": "...", "shares": 0, "totalValue": 0, "profitLoss": 0, "profitLossPercent": 0, "market": "domestic" }],\n  "totalPortfolioValue": 0, "totalProfitLoss": 0, "overallProfitPercent": 0\n}`;
      console.log(`[Stock] Vision analysis (${imageUrls.length} images)...`);
      const result = await httpRequest({ method: "POST", url: `${OPENCODE_URL}/analyze-image` }, { prompt: visionPrompt, imageUrls, chatId: String(chatId), sessionId });
      const data = parseStockJson(result.text);
      if (data) { console.log(`[Stock] Vision: ${data.stocks.length} stocks`); return data; }
    }
  }

  // Step B: Text extraction
  if (cleanMessage && cleanMessage.length > 3 && !isListOnly) {
    const textPrompt = `Extract stock holdings from the following text. Return ONLY valid JSON:\n{\n  "stocks": [{ "name": "...", "shares": 0, "totalValue": 0, "profitLoss": 0, "profitLossPercent": 0 }],\n  "totalPortfolioValue": 0, "totalProfitLoss": 0, "overallProfitPercent": 0\n}\nText: ${cleanMessage}`;
    console.log("[Stock] Text extraction...");
    const result = await httpRequest({ method: "POST", url: `${OPENCODE_URL}/run` }, { prompt: textPrompt, chatId: String(chatId), sessionId });
    const data = parseStockJson(result.text);
    if (data) { console.log(`[Stock] Text: ${data.stocks.length} stocks`); return data; }
  }

  // Step C: Session memory
  console.log("[Stock] Session memory fallback...");
  const memPrompt = `Based on your previous memory in this session, provide the current stock holdings list.\nReturn ONLY valid JSON including "stocks" array:\n{\n  "stocks": [{ "name": "...", "shares": 0, "totalValue": 0, "profitLoss": 0, "profitLossPercent": 0 }],\n  "totalPortfolioValue": 0, "totalProfitLoss": 0, "overallProfitPercent": 0\n}`;
  const result = await httpRequest({ method: "POST", url: `${OPENCODE_URL}/run` }, { prompt: memPrompt, chatId: String(chatId), sessionId });
  return parseStockJson(result.text);
}

// ─── Server ───────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {

  if (req.method === "GET" && req.url === "/health") {
    return respond(res, 200, { status: "ok" });
  }

  if (req.method === "POST" && req.url === "/analyze-portfolio") {
    try {
      const { chatId, msgId, sessionId, photoFileIds, mediaGroupId, message, subIntent } = await readBody(req);
      let files = photoFileIds || [];
      const cleanMessage = (message || "").trim().replace(/^\/stock\s*/i, "");
      const isListOnly = subIntent === "list";

      // Collect album photos
      if (mediaGroupId) {
        try {
          const collected = await httpRequest({ url: `${OPENCODE_URL}/media-group/collect?id=${mediaGroupId}&waitMs=2000` });
          if (collected.fileIds?.length > 0) files = collected.fileIds;
        } catch (e) {
          console.error("[Stock] Media collection failed:", e.message);
        }
      }

      const stockData = await extractStockData(files, cleanMessage, isListOnly, chatId, sessionId);

      // No data found → guide
      if (!stockData) {
        const guide = isListOnly
          ? "📭 <b>보유 주식 없음</b>\n현재 세션에 저장된 주식 정보가 없습니다."
          : "📊 <b>주식 분석 안내</b>\n\n분석할 주식 정보를 제공해주세요!\n\n1️⃣ <b>사진 전송</b>: 계좌 스크린샷을 보내주세요.\n2️⃣ <b>텍스트 전송</b>: 종목명과 보유 수량을 적어주세요. (예: <code>삼성전자 10주</code>)";
        return respond(res, 200, {
          chatId, msgId,
          formattedText: formatReply(guide, { sessionId, isSystem: true, moduleName: MODULE_NAME }),
          sessionId
        });
      }

      // List mode
      if (isListOnly) {
        const report = formatStockList(stockData);
        return respond(res, 200, {
          chatId, msgId,
          formattedText: formatReply(report, { sessionId, model: STOCK_MODEL, moduleName: MODULE_NAME }),
          sessionId
        });
      }

      // Analysis mode — generate recommendations
      const today = new Date().toISOString().split("T")[0];
      const summary = stockData.stocks.map(s =>
        `- ${s.name}: ${s.shares}주, 평가액 ${s.totalValue?.toLocaleString()}원, 수익 ${s.profitLoss?.toLocaleString()}원 (${s.profitLossPercent}%)`
      ).join("\n");

      const recPrompt = `당신은 전문 투자 애널리스트입니다. 날짜: ${today}\n포트폴리오:\n${summary}\n\n각 종목에 대해 BUY/SELL/HOLD 분석을 JSON으로 반환하세요:\n{\n  "recommendations": [{ "name": "종목명", "action": "HOLD", "reason": "...", "risk": "MEDIUM", "targetPrice": "..." }],\n  "portfolioSummary": "...", "marketOutlook": "..."\n}`;

      const recResult = await httpRequest({ method: "POST", url: `${OPENCODE_URL}/run` }, { prompt: recPrompt, chatId: String(chatId), sessionId });
      let recommendations = null;
      const recMatch = (recResult.text || "").match(/\{[\s\S]*"recommendations"[\s\S]*\}/);
      if (recMatch) {
        try { recommendations = JSON.parse(recMatch[0]); } catch { /* ignore */ }
      }

      const report = formatAnalysisReport(stockData, recommendations);
      const formattedText = formatReply(report, { model: STOCK_MODEL, sessionId, moduleName: MODULE_NAME });
      return respond(res, 200, { chatId, msgId, formattedText, sessionId });
    } catch (err) {
      console.error("[Stock] Error:", err.message);
      return respond(res, 500, { error: err.message });
    }
  }

  respond(res, 404, { error: "Not found" });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Stock proxy running on port ${PORT}`);
});
