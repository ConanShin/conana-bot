const { stripHTML, escapeHTML, formatReply } = require("./index");

describe("Shared Utils", () => {

  describe("stripHTML", () => {
    test("removes tags and converts breaks", () => {
      expect(stripHTML("<h2>Title</h2><p>Hello<br>World</p>")).toBe("Title\n\nHello\nWorld");
    });
    test("decodes HTML entities", () => {
      expect(stripHTML("&amp; &lt; &gt;")).toBe("& < >");
      expect(stripHTML("&nbsp;")).toBe(""); // nbsp becomes space, then trimmed
    });
    test("handles null/undefined", () => {
      expect(stripHTML(null)).toBe("");
      expect(stripHTML(undefined)).toBe("");
    });
    test("collapses excessive newlines", () => {
      expect(stripHTML("<p>A</p><p></p><p></p><p>B</p>")).not.toContain("\n\n\n");
    });
  });

  describe("escapeHTML", () => {
    test("escapes &, <, >", () => {
      expect(escapeHTML("A & B < C > D")).toBe("A &amp; B &lt; C &gt; D");
    });
    test("handles null/undefined", () => {
      expect(escapeHTML(null)).toBe("");
      expect(escapeHTML(undefined)).toBe("");
    });
  });

  describe("formatReply", () => {
    test("includes model, module, and session", () => {
      const result = formatReply("Hello", { model: "m1", moduleName: "General", sessionId: "ses_abc" });
      expect(result).toContain("🤖 <b>Model:</b> <code>m1</code>");
      expect(result).toContain("🧩 <b>Module:</b> <code>General</code>");
      expect(result).toContain("🏷️ <b>Session:</b> <code>abc</code>");
      expect(result).toContain("Hello");
    });

    test("strips ses_ prefix from session ID", () => {
      const result = formatReply("x", { sessionId: "ses_ses_123" });
      expect(result).toContain("<code>123</code>");
    });

    test("system messages have correct header", () => {
      const result = formatReply("Update", { isSystem: true, sessionId: "abc", moduleName: "Email" });
      expect(result).toContain("✨ <b>System Message:</b>");
      expect(result).toContain("🧩 <b>Module:</b> <code>Email</code>");
      expect(result).not.toContain("🤖 <b>Model:</b>");
    });

    test("handles missing optional fields", () => {
      const result = formatReply("Hi", {});
      expect(result).toContain("Hi");
      expect(result).toContain("none");
      expect(result).not.toContain("🤖");
      expect(result).not.toContain("🧩");
    });
  });
});
