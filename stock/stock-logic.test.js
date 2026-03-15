const { formatStockList, parseStockJson } = require("./stock-logic");

describe("Stock Logic", () => {

  describe("parseStockJson", () => {
    test("extracts stocks from JSON in text", () => {
      const text = 'Data: {"stocks":[{"name":"Samsung","shares":10}],"totalPortfolioValue":1000}';
      const result = parseStockJson(text);
      expect(result).not.toBeNull();
      expect(result.stocks).toHaveLength(1);
      expect(result.stocks[0].name).toBe("Samsung");
    });

    test("returns null for invalid JSON", () => {
      expect(parseStockJson("no json here")).toBeNull();
    });

    test("returns null for empty stocks array", () => {
      expect(parseStockJson('{"stocks":[]}')).toBeNull();
    });

    test("returns null for null/empty input", () => {
      expect(parseStockJson(null)).toBeNull();
      expect(parseStockJson("")).toBeNull();
    });
  });

  describe("formatStockList", () => {
    test("formats stock data with profit", () => {
      const data = {
        stocks: [{ name: "SK하이닉스", shares: 5, totalValue: 500000, profitLoss: 50000 }],
        totalPortfolioValue: 500000
      };
      const report = formatStockList(data);
      expect(report).toContain("🟢 <b>SK하이닉스</b>");
      expect(report).toContain("500,000원");
    });

    test("shows red emoji for loss", () => {
      const data = {
        stocks: [{ name: "LossStock", shares: 1, totalValue: 100, profitLoss: -50 }],
        totalPortfolioValue: 100
      };
      const report = formatStockList(data);
      expect(report).toContain("🔴 <b>LossStock</b>");
    });

    test("returns empty for null data", () => {
      expect(formatStockList(null)).toBe("");
      expect(formatStockList({ stocks: [] })).toBe("");
    });
  });
});
