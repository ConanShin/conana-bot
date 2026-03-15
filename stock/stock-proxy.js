const http = require("http");

const PORT = 3286;
const OPENCODE_URL = process.env.OPENCODE_URL || "http://opencode-proxy:3284";
const STOCK_MODEL = process.env.STOCK_MODEL || "google/antigravity-claude-opus-4-6-thinking";
const TG_TOKEN = process.env.TELEGRAM_TOKEN;

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

function escapeHTML(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function httpRequest(options, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(options.url);
    const protocol = url.protocol === 'https:' ? require('https') : http;
    const reqOptions = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
      }
    };

    const req = protocol.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve(data);
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

const server = http.createServer(async (req, res) => {
  const respond = (code, data) => {
    res.writeHead(code, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  };

  if (req.method === "GET" && req.url === "/health") {
    return respond(200, { status: "ok" });
  }

  if (req.method === "POST" && req.url === "/analyze-portfolio") {
    try {
      const { chatId, msgId, sessionId, photoFileIds, mediaGroupId } = await readBody(req);
      let files = photoFileIds || [];

      // 1. Collect media group photos if needed
      if (mediaGroupId) {
        try {
          const collected = await httpRequest({
            url: `${OPENCODE_URL}/media-group/collect?id=${mediaGroupId}&waitMs=2000`
          });
          if (collected.fileIds && collected.fileIds.length > 0) {
            files = collected.fileIds;
          }
        } catch (e) {
          console.error('[Stock] Media collection failed:', e.message);
        }
      }

      if (!files.length) {
        return respond(200, { 
          chatId, msgId, formattedText: "❌ 사진이 첨부되지 않았습니다. /stock 명령어와 함께 주식 스크린샷을 보내주세요.", 
          sessionId 
        });
      }

      // 2. Resolve image URLs from Telegram
      const imageUrls = [];
      for (const fileId of files) {
        const fileInfo = await httpRequest({
          url: `https://api.telegram.org/bot${TG_TOKEN}/getFile?file_id=${fileId}`
        });
        if (fileInfo.ok && fileInfo.result.file_path) {
          imageUrls.push(`https://api.telegram.org/file/bot${TG_TOKEN}/${fileInfo.result.file_path}`);
        }
      }

      // 3. Analyze images via OpenCode Vision
      const analysisPrompt = `You are a financial data extraction expert. Analyze the attached stock portfolio screenshot(s) carefully.
Extract ALL stock holdings. Return ONLY valid JSON:
{
  "stocks": [
    { "name": "...", "ticker": "...", "shares": 0, "totalValue": 0, "profitLoss": 0, "profitLossPercent": 0, "market": "domestic" }
  ],
  "totalPortfolioValue": 0,
  "totalProfitLoss": 0,
  "overallProfitPercent": 0
}`;

      console.log(`[Stock] Analyzing ${imageUrls.length} images...`);
      const visionResult = await httpRequest({
        method: 'POST',
        url: `${OPENCODE_URL}/analyze-image`
      }, { prompt: analysisPrompt, imageUrls, chatId: String(chatId) });

      let rawText = visionResult.text || '';
      const jsonMatch = rawText.match(/\{[\s\S]*\"stocks\"[\s\S]*\}/);
      if (!jsonMatch) {
        return respond(200, { chatId, msgId, formattedText: `❌ 분석 실패 (JSON 파싱 불가)\n\n<pre>${rawText.slice(0, 500)}</pre>`, sessionId });
      }
      const stockData = JSON.parse(jsonMatch[0]);

      // 4. Generate Recommendations
      const today = new Date().toISOString().split('T')[0];
      const stockList = stockData.stocks.map(s => 
        `- ${s.name}: ${s.shares}주, 평가액 ${s.totalValue?.toLocaleString()}원, 수익 ${s.profitLoss?.toLocaleString()}원 (${s.profitLossPercent}%)`
      ).join('\n');

      const recommendPrompt = `당신은 전문 투자 애널리스트입니다. 날짜: ${today}\n포트폴리오:\n${stockList}\n\n각 종목에 대해 BUY/SELL/HOLD 분석을 JSON으로 반환하세요:\n{\n  "recommendations": [\n    { "name": "종목명", "action": "HOLD", "reason": "...", "risk": "MEDIUM", "targetPrice": "..." }\n  ],\n  "portfolioSummary": "...", "marketOutlook": "..."\n}`;

      const recResult = await httpRequest({
        method: 'POST',
        url: `${OPENCODE_URL}/run`
      }, { prompt: recommendPrompt, chatId: String(chatId) });

      let recText = recResult.text || '';
      const recJsonMatch = recText.match(/\{[\s\S]*\"recommendations\"[\s\S]*\}/);
      const recommendations = recJsonMatch ? JSON.parse(recJsonMatch[0]) : null;

      // 5. Format Final Report
      let report = `🏷️ <b>Session:</b> <code>${sessionId || 'none'}</code>\n\n`;
      report += '📊 <b>주식 포트폴리오 분석 리포트</b>\n';
      report += `📅 ${new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })}\n\n`;

      if (stockData) {
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
      }

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

      return respond(200, { chatId, msgId, formattedText: report, sessionId });
    } catch (err) {
      console.error("[Stock] Error:", err.message);
      return respond(500, { error: err.message });
    }
  }

  respond(404, { error: "Not found" });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Stock proxy server running on port ${PORT}`);
  console.log(`OpenCode URL: ${OPENCODE_URL}`);
});
