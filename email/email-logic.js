function parseEmailResponse(text) {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.subject && parsed.body) {
        return { subject: parsed.subject, body: parsed.body, parsed: true };
      }
    } catch (e) {
      // ignore parse error
    }
  }
  const lines = text.split('\n').filter(l => l.trim());
  const subject = lines[0] ? lines[0].slice(0, 100) : "이메일 제목";
  return { subject, body: text, parsed: false };
}

function processAiDecision(aiResponseText, receiver) {
  const jsonMatch = aiResponseText.match(/\{[\s\S]*\}/);
  let resObj = { status: "ask", message: "이메일 작성을 위해 추가 정보가 필요합니다." };
  
  if (jsonMatch) {
    try {
      resObj = JSON.parse(jsonMatch[0]);
    } catch (e) {}
  }

  if (resObj.status === "ready") {
    const to = resObj.to || receiver;
    if (!to || !to.includes('@')) {
      return { status: "ask", message: "수신인 이메일 주소가 올바르지 않거나 누락되었습니다." };
    }
    return { 
      status: "ready", 
      to, 
      subject: resObj.subject || "이메일 알림", 
      body: resObj.body || "" 
    };
  }

  return { 
    status: "ask", 
    message: resObj.message || "추가 정보가 필요합니다." 
  };
}

module.exports = { parseEmailResponse, processAiDecision };
