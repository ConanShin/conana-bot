const { classifyIntent } = require("./intent-classifier");
jest.mock("../shared", () => ({
  httpRequest: jest.fn()
}));
const { httpRequest } = require("../shared");

describe("Router Intent Classifier", () => {
  beforeEach(() => jest.clearAllMocks());

  test("classifies blog intent", async () => {
    httpRequest.mockResolvedValue({ text: '{"intent":"blog","confidence":0.95,"reason":"user wants article"}' });
    const result = await classifyIntent("블로그 글 써줘");
    expect(result.intent).toBe("blog");
  });

  test("classifies stock intent", async () => {
    httpRequest.mockResolvedValue({ text: '{"intent":"stock","subIntent":"analyze","confidence":0.9}' });
    const result = await classifyIntent("주식 분석해줘");
    expect(result.intent).toBe("stock");
  });

  test("falls back to general on parse error", async () => {
    httpRequest.mockResolvedValue({ text: "not json at all" });
    const result = await classifyIntent("hello");
    expect(result.intent).toBe("general");
    expect(result.reason).toBe("fallback");
  });

  test("falls back to general on network error", async () => {
    httpRequest.mockRejectedValue(new Error("connection refused"));
    const result = await classifyIntent("test");
    expect(result.intent).toBe("general");
  });
});
