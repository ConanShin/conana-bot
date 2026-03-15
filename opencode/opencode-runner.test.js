// Mock child_process BEFORE requiring opencode-runner
jest.mock("child_process", () => ({
  exec: jest.fn()
}));
jest.mock("./session-manager", () => ({
  get: jest.fn(() => "none"),
  set: jest.fn(),
  clear: jest.fn()
}));

const child_process = require("child_process");
const sessionManager = require("./session-manager");

// Helper: mock exec to call callback(err, {stdout, stderr})
function mockExec(stdout, stderr = "") {
  child_process.exec.mockImplementation((cmd, opts, cb) => {
    // promisify(exec) calls exec(cmd, opts, callback)
    if (typeof opts === "function") { cb = opts; }
    process.nextTick(() => cb(null, { stdout, stderr }));
  });
}

function mockExecError(errMsg) {
  child_process.exec.mockImplementation((cmd, opts, cb) => {
    if (typeof opts === "function") { cb = opts; }
    process.nextTick(() => cb(new Error(errMsg)));
  });
}

// Fresh require for each test suite
let runOpencode, runWithFallback;
beforeAll(() => {
  const runner = require("./opencode-runner");
  runOpencode = runner.runOpencode;
  runWithFallback = runner.runWithFallback;
});

beforeEach(() => jest.clearAllMocks());

describe("OpenCode Runner", () => {

  describe("extractAnswer (via runOpencode)", () => {
    test("parses text parts and extracts session ID", async () => {
      mockExec([
        '{"sessionID":"ses_123"}',
        '{"type":"text","part":{"text":"Hello"}}',
        '{"type":"text","part":{"text":" World"}}'
      ].join("\n"));

      const result = await runOpencode("hi", "model-x", null, "user1");
      expect(result.text).toBe("Hello World");
      expect(result.sessionId).toBe("ses_123");
    });

    test("parses assistant properties content", async () => {
      mockExec([
        '{"sessionID":"ses_456"}',
        '{"type":"assistant","properties":{"content":[{"type":"text","text":"Response here"}]}}'
      ].join("\n"));

      const result = await runOpencode("hi", "model-x", null, "user1");
      expect(result.text).toBe("Response here");
    });

    test("falls back to cleaned text for non-JSON output", async () => {
      mockExec("Plain text answer");
      const result = await runOpencode("hi", "model-x", null, "user1");
      expect(result.text).toBe("Plain text answer");
    });

    test("returns (no output) for empty stdout", async () => {
      mockExec("");
      const result = await runOpencode("hi", "model-x", null, "user1");
      expect(result.text).toBe("(no output)");
    });

    test("filters out raw JSON lines in fallback", async () => {
      mockExec('{"type":"session","sessionID":"ses_x"}\n{"unknown":"data"}');
      const result = await runOpencode("hi", "model-x", null, "user1");
      expect(result.text).toBe("(no output)");
    });
  });

  describe("Session persistence", () => {
    test("persists session when valid response received", async () => {
      mockExec('{"sessionID":"ses_new"}\n{"type":"text","part":{"text":"hi"}}');
      await runOpencode("hi", "model-x", "ses_old", "user1");
      expect(sessionManager.set).toHaveBeenCalledWith("user1", "ses_new");
    });

    test("does NOT persist session when no valid response", async () => {
      mockExec('{"sessionID":"ses_garbage"}');
      await runOpencode("hi", "model-x", "ses_old", "user1");
      expect(sessionManager.set).not.toHaveBeenCalled();
    });

    test("keeps input session ID when no new session returned", async () => {
      mockExec('{"type":"text","part":{"text":"hi"}}');
      const result = await runOpencode("hi", "model-x", "ses_keep", "user1");
      expect(result.sessionId).toBe("ses_keep");
    });
  });

  describe("Quota/Error handling", () => {
    test("throws on quota errors", async () => {
      mockExec('{"type":"error","error":{"message":"429 rate limit exceeded"}}');
      await expect(runOpencode("hi", "model-x", null, "user1")).rejects.toThrow("429 rate limit exceeded");
    });

    test("runWithFallback switches model on quota error", async () => {
      let callCount = 0;
      child_process.exec.mockImplementation((cmd, opts, cb) => {
        if (typeof opts === "function") { cb = opts; }
        callCount++;
        if (callCount === 1) {
          process.nextTick(() => cb(null, { stdout: '{"type":"error","error":{"message":"429 quota"}}', stderr: "" }));
        } else {
          process.nextTick(() => cb(null, { stdout: '{"type":"text","part":{"text":"fallback ok"}}', stderr: "" }));
        }
      });

      const result = await runWithFallback("hi", null, "user1");
      expect(result.text).toBe("fallback ok");
      expect(callCount).toBe(2);
    });
  });
});
