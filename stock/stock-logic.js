function parseStockJson(text) {
  if (!text) return null;
  const match = text.match(/\{[\s\S]*"stocks"[\s\S]*\}/i);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    return (parsed.stocks && parsed.stocks.length > 0) ? parsed : null;
  } catch {
    return null;
  }
}

function formatStockList(stockData) {
  if (!stockData || !stockData.stocks || stockData.stocks.length === 0) return "";
  
  let report = '📋 <b>현재 보유 주식 현황</b>\n━━━━━━━━━━━━━━━━━━━━\n';
  for (const s of stockData.stocks) {
    const emoji = (s.profitLoss || 0) >= 0 ? '🟢' : '🔴';
    const sign = (s.profitLoss || 0) >= 0 ? '+' : '';
    report += `${emoji} <b>${s.name}</b>: ${s.shares}주\n`;
    report += `   평가액: ${s.totalValue?.toLocaleString()}원 | 수익: ${sign}${s.profitLoss?.toLocaleString()}원\n`;
  }
  report += '\n💰 <b>총 평가액:</b> <code>' + (stockData.totalPortfolioValue?.toLocaleString() || '0') + '원</code>';
  return report;
}

module.exports = { parseStockJson, formatStockList };
