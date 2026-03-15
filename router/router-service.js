const http = require("http");
const { readBody, respond } = require("../shared");
const { classifyIntent } = require("./intent-classifier");

const PORT = process.env.ROUTER_PORT || 3287;

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    return respond(res, 200, { status: "ok" });
  }

  if (req.method === "POST" && req.url === "/router/intent") {
    try {
      const { message } = await readBody(req);
      if (!message) {
        return respond(res, 400, { error: "message is required" });
      }

      console.log(`[Router] Classifying intent for: "${message.slice(0, 50)}..."`);
      const result = await classifyIntent(message);
      
      console.log(`[Router] Classified Result: ${JSON.stringify(result)}`);
      return respond(res, 200, result);
    } catch (err) {
      console.error("[Router] Error:", err.message);
      return respond(res, 500, { error: err.message });
    }
  }

  respond(res, 404, { error: "Not found" });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Router service running on port ${PORT}`);
});
