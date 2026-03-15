const http = require("http");

const PORT = 3286;
const OPENCODE_URL = process.env.OPENCODE_URL || "http://opencode-proxy:3284";
const STOCK_MODEL = process.env.STOCK_MODEL || "google/antigravity-claude-opus-4-6-thinking";
const TG_TOKEN = process.env.TELEGRAM_TOKEN;

const { readBody, respond, httpRequest, escapeHTML } = require("../shared");

const server = http.createServer(async (req, res) => {

  if (req.method === "GET" && req.url === "/health") {
    return respond(200, { status: "ok" });
  }

  if (req.method === "POST" && req.url === "/analyze-portfolio") {
    try {
      const { chatId, msgId, sessionId, photoFileIds, mediaGroupId, message, subIntent } = await readBody(req);
      let files = photoFileIds || [];
      const cleanMessage = (message || '').trim().replace(/^\/stock\s*/i, '');
      const isListOnly = subIntent === 'list';
      let stockData = null;

      // 1. Collect media group photos if needed
      if (mediaGroupId) {
        try {
          const collected = await httpRequest({
            url: `${OPENCODE_URL}/media-group/collect?id=${mediaGroupId}&waitMs=2000`
          });
          if (collected.fileIds && collected.fileIds.length > 0) files = collected.fileIds;
        } catch (e) {
          console.error('[Stock] Media collection failed:', e.message);
        }
      }

      // --- DATA EXTRACTION CHAIN ---

      // Step A: Vision (if photos attached)
      if (files.length > 0) {
        const imageUrls = [];
        for (const fileId of files) {
          const fileInfo = await httpRequest({ url: `https://api.telegram.org/bot${TG_TOKEN}/getFile?file_id=${fileId}` });
          if (fileInfo.ok && fileInfo.result.file_path) {
            imageUrls.push(`https://api.telegram.org/file/bot${TG_TOKEN}/${fileInfo.result.file_path}`);
          }
        }

        const visionPrompt = `You are a financial data extraction expert. Analyze the attached stock portfolio screenshot(s) carefully.
Extract ALL stock holdings. Return ONLY valid JSON:
{
  "stocks": [
    { "name": "...", "ticker": "...", "shares": 0, "totalValue": 0, "profitLoss": 0, "profitLossPercent": 0, "market": "domestic" }
  ],
  "totalPortfolioValue": 0, "totalProfitLoss": 0, "overallProfitPercent": 0
}`;

        console.log(`[Stock] Trying Vision Analysis (${imageUrls.length} images)...`);
        const visionResult = await httpRequest({ method: 'POST', url: `${OPENCODE_URL}/analyze-image` }, { prompt: visionPrompt, imageUrls, chatId: String(chatId) });
        const jsonMatch = (visionResult.text || '').match(/\{[\s\S]*\"stocks\"[\s\S]*\}/i);
        if (jsonMatch) {
          try {
            stockData = JSON.parse(jsonMatch[0]);
            console.log(`[Stock] Vision success: ${stockData.stocks?.length} stocks`);
          } catch (e) { console.error('[Stock] Vision JSON parse error'); }
        }
      }

      // Step B: Text Extraction (if no stocks from vision and message looks like data)
      if ((!stockData || !stockData.stocks || stockData.stocks.length === 0) && cleanMessage) {
        // Basic heuristic: if message is short and doesn't contain numbers/korean stock names, skip?
        // Let's just try.
        if (cleanMessage.length > 3 && !isListOnly) {
          const textPrompt = `Extract stock holdings from the following text. Return ONLY valid JSON:
{
  "stocks": [
    { "name": "...", "shares": 0, "totalValue": 0, "profitLoss": 0, "profitLossPercent": 0 }
  ],
  "totalPortfolioValue": 0, "totalProfitLoss": 0, "overallProfitPercent": 0
}
Text: ${cleanMessage}`;

          console.log(`[Stock] Trying Text Extraction...`);
          const textResult = await httpRequest({ method: 'POST', url: `${OPENCODE_URL}/run` }, { prompt: textPrompt, chatId: String(chatId) });
          const jsonMatch = (textResult.text || '').match(/\{[\s\S]*\"stocks\"[\s\S]*\}/i);
          if (jsonMatch) {
            try {
              const parsed = JSON.parse(jsonMatch[0]);
              if (parsed.stocks && parsed.stocks.length > 0) {
                stockData = parsed;
                console.log(`[Stock] Text extraction success: ${stockData.stocks.length} stocks`);
              }
            } catch (e) {}
          }
        }
      }

      // Step C: Session Memory (last resort)
      if (!stockData || !stockData.stocks || stockData.stocks.length === 0) {
        console.log(`[Stock] Trying Session Memory...`);
        const sessionPrompt = `Based on your previous memory in this session, provide the current stock holdings list. 
Return ONLY valid JSON including "stocks" array:
{
  "stocks": [{ "name": "...", "shares": 0, "totalValue": 0, "profitLoss": 0, "profitLossPercent": 0 }],
  "totalPortfolioValue": 0, "totalProfitLoss": 0, "overallProfitPercent": 0
}`;
        const sessionResult = await httpRequest({ method: 'POST', url: `${OPENCODE_URL}/run` }, { prompt: sessionPrompt, chatId: String(chatId) });
        const jsonMatch = (sessionResult.text || '').match(/\{[\s\S]*\"stocks\"[\s\S]*\}/i);
        if (jsonMatch) {
          try {
            const parsed = JSON.parse(jsonMatch[0]);
            if (parsed.stocks && parsed.stocks.length > 0) {
              stockData = parsed;
              console.log(`[Stock] Session memory success: ${stockData.stocks.length} stocks`);
            }
          } catch (e) {}
        }
      }

      // --- RESPONSE FORMATTING ---

      const sessionHtml = `\n\n🏷️ <b>Session:</b> <code>${sessionId || 'none'}</code>`;

      // 5. If still no data found -> Show Guide or Placeholder
      if (!stockData || !stockData.stocks || stockData.stocks.length === 0) {
        if (isListOnly) {
          return respond(res, 200, { chatId, msgId, formattedText: `📭 <b>보유 주식 없음</b>\n현재 세션에 저장된 주식 정보가 없습니다. 먼저 스크린샷이나 텍스트로 정보를 알려주세요.${sessionHtml}`, sessionId });
        }
        return respond(res, 200, { 
          chatId, msgId, 
          formattedText: `📊 <b>주식 분석 안내</b>\n\n분석할 주식 정보를 제공해주세요!\n\n1️⃣ <b>사진 전송</b>: 계좌 스크린샷을 보내주세요.\n2️⃣ <b>텍스트 전송</b>: 종목명과 보유 수량을 적어주세요. (예: <code>삼성전자 10주</code>)${sessionHtml}`, 
          sessionId 
        });
      }

      // 6. Handle LIST ONLY mode
      if (isListOnly) {
        let listReport = `🏷️ <b>Session:</b> <code>${sessionId || 'none'}</code>\n\n`;
        listReport += '📋 <b>현재 보유 주식 현황</b>\n';
        listReport += '━━━━━━━━━━━━━━━━━━━━\n';
        for (const s of stockData.stocks) {
          const emoji = (s.profitLoss || 0) >= 0 ? '🟢' : '🔴';
          listReport += `${emoji} <b>${escapeHTML(s.name)}</b>: ${s.shares}주\n`;
          listReport += `   평가액: ${s.totalValue?.toLocaleString()}원 | 수익: ${(s.profitLoss || 0) >= 0 ? '+' : ''}${s.profitLoss?.toLocaleString()}원\n`;
        }
        listReport += '\n💰 <b>총 평가액:</b> <code>' + (stockData.totalPortfolioValue?.toLocaleString() || '0') + '원</code>';
        return respond(res, 200, { chatId, msgId, formattedText: listReport, sessionId });
      }

      // 7. Generate Recommendations (ANALYZE mode)
      const today = new Date().toISOString().split('T')[0];
      const stocksSummary = stockData.stocks.map(s => 
        `- ${s.name}: ${s.shares}주, 평가액 ${s.totalValue?.toLocaleString()}원, 수익 ${s.profitLoss?.toLocaleString()}원 (${s.profitLossPercent}%)`
      ).join('\n');

      const recommendPrompt = `당신은 전문 투자 애널리스트입니다. 날짜: ${today}\n포트폴리오:\n${stocksSummary}\n\n각 종목에 대해 BUY/SELL/HOLD 분석을 JSON으로 반환하세요:\n{\n  "recommendations": [\n    { "name": "종목명", "action": "HOLD", "reason": "...", "risk": "MEDIUM", "targetPrice": "..." }\n  ],\n  "portfolioSummary": "...", "marketOutlook": "..."\n}`;

      const recResult = await httpRequest({
        method: 'POST',
        url: `${OPENCODE_URL}/run`
      }, { prompt: recommendPrompt, chatId: String(chatId) });

      let recText = recResult.text || '';
      const recJsonMatch = recText.match(/\{[\s\S]*\"recommendations\"[\s\S]*\}/);
      const recommendations = recJsonMatch ? JSON.parse(recJsonMatch[0]) : null;

      // 7. Format Final Report
      let report = `🏷️ <b>Session:</b> <code>${sessionId || 'none'}</code>\n\n`;
      report += '📊 <b>주식 포트폴리오 분석 리포트</b>\n';
      report += `📅 ${new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })}\n\n`;

      report += '━━━━━━━━━━━━━━━━━━━━\n';
      report += '💰 <b>포트폴리오 요약</b>\n';
      report += `총 평가액: <code>${stockData.totalPortfolioValue?.toLocaleString()}원</code>\n`;
      report += `총 수익: ${stockData.totalProfitLoss >= 0 ? '📈' : '📉'} <code>${stockData.totalProfitLoss?.toLocaleString()}원 (${stockData.overallProfitPercent}%)</code>\n\n`;
      
      report += '📋 <b>종목별 현황</b>\n\n';
      for (const s of (stockData.stocks || [])) {
        const emoji = (s.profitLoss || 0) >= 0 ? '🟢' : '🔴';
        report += `${emoji} <b>${escapeHTML(s.name)}</b>\n`;
        report += `   ${s.shares}주 | ${s.totalValue?.toLocaleString()}원 | ${(s.profitLoss || 0) >= 0 ? '+' : ''}${s.profitLoss?.toLocaleString()}원 (${s.profitLossPercent}%)\n`;
      }
      report += '\n';

      if (recommendations) {
        report += '━━━━━━━━━━━━━━━━━━━━\n';
        report += '🎯 <b>오늘의 투자 전략</b>\n\n';
        for (const rec of recommendations.recommendations) {
          const actionEmoji = rec.action === 'BUY' ? '🟢' : (rec.action === 'SELL' ? '🔴' : '⏸️');
          report += `${actionEmoji} <b>${escapeHTML(rec.name)}</b> → <b>${rec.action}</b>\n`;
          report += `   📝 ${escapeHTML(rec.reason)}\n\n`;
        }
        if (recommendations.portfolioSummary) {
          report += '━━━━━━━━━━━━━━━━━━━━\n';
          report += `📌 <b>총평</b>\n${escapeHTML(recommendations.portfolioSummary)}\n`;
        }
      }

      return respond(res, 200, { chatId, msgId, formattedText: report, sessionId });
    } catch (err) {
      console.error("[Stock] Error:", err.message);
      return respond(res, 500, { error: err.message });
    }
  }

  respond(res, 404, { error: "Not found" });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Stock proxy server running on port ${PORT}`);
  console.log(`OpenCode URL: ${OPENCODE_URL}`);
});
