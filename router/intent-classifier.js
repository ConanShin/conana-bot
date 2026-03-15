const { httpRequest } = require("../shared");

const OPENCODE_URL = process.env.OPENCODE_URL || "http://opencode-proxy:3284";

/**
 * Classifies the intent of a user message using Gemini via OpenCode.
 */
async function classifyIntent(message) {
  const prompt = `You are an intent classifier for a chatbot called conana-bot.
Classify the user's message into one of the following intents:

- blog: Writing a blog post, article, or long-form content.
- email: Drafting, writing, or sending emails.
- search: Searching the web for information or news.
- stock: Analyzing stock portfolios, market data, or financial advice. (Sub-intents: "analyze" for full report/recommendation, "list" for just showing current holdings)
- qa: General questions, facts, or helpful assistant tasks.
- general: Greeting, casual talk, or undefined tasks.

User message: "${message}"

Return ONLY valid JSON in this format:
{
  "intent": "intent_name",
  "subIntent": "sub_intent_name or null",
  "confidence": 0.0 to 1.0,
  "reason": "short explanation"
}`;

  try {
    const response = await httpRequest({
      method: "POST",
      url: `${OPENCODE_URL}/run`,
    }, { prompt });

    const text = response.text || "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.intent) return parsed;
      } catch (e) {
        console.warn("[Router] Failed to parse LLM JSON response");
      }
    }

    // Fallback if LLM fails to return valid JSON
    return { intent: "general", confidence: 0.5, reason: "fallback" };
  } catch (err) {
    console.error("[Router] LLM classification failed:", err.message);
    return { intent: "general", confidence: 0, error: err.message };
  }
}

module.exports = { classifyIntent };
