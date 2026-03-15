const { parseEmailResponse, processAiDecision } = require("./email-logic");

describe("Email Logic", () => {

  describe("parseEmailResponse", () => {
    test("parses valid JSON email", () => {
      const text = 'Here: {"subject": "Hello", "body": "Content here"}';
      const result = parseEmailResponse(text);
      expect(result.subject).toBe("Hello");
      expect(result.body).toBe("Content here");
      expect(result.parsed).toBe(true);
    });

    test("falls back to first line as subject", () => {
      const result = parseEmailResponse("First Line\nSecond Line");
      expect(result.subject).toBe("First Line");
      expect(result.body).toBe("First Line\nSecond Line");
      expect(result.parsed).toBe(false);
    });

    test("handles empty text", () => {
      const result = parseEmailResponse("");
      expect(result.subject).toBe("이메일 제목");
      expect(result.parsed).toBe(false);
    });

    test("handles JSON with missing fields", () => {
      const result = parseEmailResponse('{"subject":"Only Subject"}');
      expect(result.parsed).toBe(false); // body is missing
    });
  });

  describe("processAiDecision", () => {
    test("returns ready with valid email", () => {
      const text = '{"status":"ready","to":"test@example.com","subject":"Sub","body":"Body"}';
      const result = processAiDecision(text, null);
      expect(result.status).toBe("ready");
      expect(result.to).toBe("test@example.com");
      expect(result.subject).toBe("Sub");
    });

    test("uses fallback receiver when AI provides none", () => {
      const text = '{"status":"ready","subject":"Sub","body":"Body"}';
      const result = processAiDecision(text, "fallback@test.com");
      expect(result.to).toBe("fallback@test.com");
    });

    test("returns ask when email is invalid", () => {
      const text = '{"status":"ready","to":"noemail","subject":"Sub","body":"Body"}';
      expect(processAiDecision(text, null).status).toBe("ask");
    });

    test("returns ask when status is ask", () => {
      const text = '{"status":"ask","message":"Need more info"}';
      const result = processAiDecision(text, null);
      expect(result.status).toBe("ask");
      expect(result.message).toBe("Need more info");
    });

    test("handles unparseable text", () => {
      const result = processAiDecision("not json", null);
      expect(result.status).toBe("ask");
    });
  });
});
