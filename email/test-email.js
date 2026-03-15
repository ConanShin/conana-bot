const nodemailer = require("nodemailer");
const path = require("path");
// Load .env from the root directory
require("dotenv").config({ path: path.join(__dirname, "../.env") });

async function testGmailLogin() {
  const GMAIL_USER = process.env.GMAIL_USER;
  const GMAIL_PASS = (process.env.GMAIL_APP_PASSWORD || "").replace(/\s+/g, "");

  console.log("------------------------------------------");
  console.log("📧 Email Module Diagnostic Test");
  console.log("------------------------------------------");
  console.log(`User: ${GMAIL_USER}`);
  console.log(`Pass Length: ${GMAIL_PASS.length} characters`);
  console.log("------------------------------------------");

  if (!GMAIL_USER || !GMAIL_PASS) {
    console.error("❌ ERROR: GMAIL_USER or GMAIL_APP_PASSWORD not found in .env");
    process.exit(1);
  }

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: GMAIL_USER,
      pass: GMAIL_PASS,
    },
  });

  try {
    console.log("⏳ Verifying SMTP connection...");
    const success = await transporter.verify();
    if (success) {
      console.log("✅ SUCCESS: Gmail SMTP credentials are valid!");
    }
  } catch (error) {
    console.error("❌ FAILED: SMTP Verification Error");
    console.error("------------------------------------------");
    console.error(error);
    console.error("------------------------------------------");
    console.log("\n💡 Possible causes:");
    console.log("1. The App Password is incorrect (check for typos).");
    console.log("2. 2-Step Verification is not enabled.");
    console.log("3. You used your regular Gmail password instead of an 'App Password'.");
    console.log("4. Google is blocking the connection (rare for App Passwords).");
    process.exit(1);
  }
}

testGmailLogin();
