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
      const { message, hasPhoto } = await readBody(req);
      const text = message || '';

      // 1. Check for slash commands
      if (text.startsWith('/')) {
        const lower = text.toLowerCase();
        if (lower.startsWith('/stock')) return respond(res, 200, { intent: 'stock', subIntent: 'analyze' });
        if (lower.startsWith('/naverblog')) {
          const topic = text.replace(/^\/naverblog\s*/i, '').trim();
          return respond(res, 200, { intent: 'blog', topic });
        }
        if (lower.startsWith('/mail')) {
          const parts = text.match(/\/mail\s+([^\s]+)\s+["']?(.*)["']?/i);
          return respond(res, 200, { 
            intent: 'email', 
            receiver: parts ? parts[1] : '', 
            query: parts ? (parts[2] || '').replace(/["']$/, '') : '' 
          });
        }
        return respond(res, 200, { intent: 'general', isCommand: true });
      }

      // 2. Handle empty text with photo
      if (!text && hasPhoto) {
        return respond(res, 200, { intent: 'stock', subIntent: 'analyze' });
      }

      if (!text) return respond(res, 200, { intent: 'general', empty: true });

      // 3. Fallback to LLM classification
      console.log(`[Router] Classifying intent for: "${text.slice(0, 50)}..."`);
      const result = await classifyIntent(text);
      
      // Post-process LLM result for specific fields
      if (result.intent === 'blog') result.topic = text;
      if (result.intent === 'email') result.query = text;

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
