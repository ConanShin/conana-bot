# Conana-Bot API Specification

This document defines the formal request and response structures for each microservice module.

## 1. OpenCode Proxy (`:3284`)
*Core execution and session management service.*

### `POST /run`
Runs a prompt through the LLM.
- **Request Body:**
  ```json
  {
    "prompt": "string (required)",
    "model": "string (optional)",
    "chatId": "string (optional)",
    "sessionId": "string (optional)"
  }
  ```
- **Response Body:**
  ```json
  {
    "text": "string",
    "model": "string",
    "sessionId": "string",
    "formattedText": "string (HTML for Telegram)"
  }
  ```

### `GET /session`
Retrieves or initializes a session for a user.
- **Query Params:** `chatId` (required)
- **Response Body:** `{ "sessionId": "string" }`

---

## 2. Naver Proxy (`:3285`)
*Blog article generation.*

### `POST /generate-article`
- **Request Body:**
  ```json
  {
    "topic": "string (required)",
    "chatId": "string (required)",
    "msgId": "number (required)",
    "sessionId": "string (optional)"
  }
  ```
- **Response Body:**
  ```json
  {
    "chatId": "string",
    "msgId": "number",
    "formattedText": "string (HTML)",
    "sessionId": "string"
  }
  ```

---

## 3. Stock Proxy (`:3286`)
*Portfolio analysis and market data.*

### `POST /analyze-portfolio`
- **Request Body:**
  ```json
  {
    "chatId": "string (required)",
    "msgId": "number (required)",
    "sessionId": "string (required)",
    "message": "string (optional)",
    "photoFileIds": "string[] (optional)",
    "mediaGroupId": "string (optional)",
    "subIntent": " 'analyze' | 'list' (optional) "
  }
  ```
- **Response Body:**
  ```json
  {
    "chatId": "string",
    "msgId": "number",
    "formattedText": "string (HTML)",
    "sessionId": "string"
  }
  ```

---

## 4. Email Proxy (`:3288`)
*AI-powered email drafting and sending.*

### `POST /send-ai-email`
Interactive flow that either sends an email or asks for info.
- **Request Body:**
  ```json
  {
    "query": "string (required)",
    "receiver": "string (optional)",
    "chatId": "string (required)",
    "sessionId": "string (required)"
  }
  ```
- **Response Body:**
  ```json
  {
    "ok": true,
    "formattedText": "string (HTML)",
    "isAsking": "boolean (true if needs more info)",
    "sessionId": "string"
  }
  ```
