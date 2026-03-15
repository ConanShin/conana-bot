jest.mock("fs");
const sessionManager = require("./session-manager");
const fs = require("fs");

describe("Session Manager", () => {

  describe("Chat Sessions", () => {
    test("returns 'none' for unknown user", () => {
      expect(sessionManager.get("unknown-user-999")).toBe("none");
    });

    test("returns 'none' for null chatId", () => {
      expect(sessionManager.get(null)).toBe("none");
    });

    test("set and get works", () => {
      sessionManager.set("u1", "ses_abc");
      expect(sessionManager.get("u1")).toBe("ses_abc");
      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    test("set ignores invalid values", () => {
      sessionManager.set(null, "ses_abc");
      sessionManager.set("u2", null);
      sessionManager.set("u3", "none");
      expect(sessionManager.get("u2")).toBe("none");
      expect(sessionManager.get("u3")).toBe("none");
    });

    test("clear resets session", () => {
      sessionManager.set("u4", "ses_abc");
      sessionManager.clear("u4");
      expect(sessionManager.get("u4")).toBe("none");
    });

    test("clear with null is a no-op", () => {
      sessionManager.clear(null); // should not throw
    });
  });

  describe("Media Group Buffer", () => {
    test("buffers and collects fileIds", () => {
      sessionManager.bufferMedia("mg1", "file_a");
      sessionManager.bufferMedia("mg1", "file_b");
      expect(sessionManager.collectMedia("mg1")).toEqual(["file_a", "file_b"]);
    });

    test("collect returns empty for unknown group", () => {
      expect(sessionManager.collectMedia("unknown")).toEqual([]);
    });

    test("collect clears the buffer", () => {
      sessionManager.bufferMedia("mg2", "file_x");
      sessionManager.collectMedia("mg2");
      expect(sessionManager.collectMedia("mg2")).toEqual([]);
    });

    test("deduplicates fileIds", () => {
      sessionManager.bufferMedia("mg3", "file_dup");
      sessionManager.bufferMedia("mg3", "file_dup");
      expect(sessionManager.collectMedia("mg3")).toEqual(["file_dup"]);
    });
  });
});
