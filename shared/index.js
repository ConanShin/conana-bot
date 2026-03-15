const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

let nodemailer;
try {
  nodemailer = require("nodemailer");
} catch (e) {
  console.warn("Nodemailer not installed. Mail functions may fail.");
}

const readBody = (req) => {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
};

const httpRequest = async (options, body) => {
  return new Promise((resolve, reject) => {
    const url = new URL(options.url);
    const protocol = url.protocol === "https:" ? https : http;
    const reqOptions = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: options.method || "GET",
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    };

    const req = protocol.request(reqOptions, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve(data);
        }
      });
    });

    req.on("error", reject);
    if (body) {
      req.write(typeof body === "string" ? body : JSON.stringify(body));
    }
    req.end();
  });
};

const respond = (res, code, data) => {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
};

const stripHTML = (html) => {
  return String(html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(h[1-6]|p|li|div|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

const escapeHTML = (str) => {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
};

const downloadFile = (url, destPath) => {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith("https") ? https : http;
    const file = fs.createWriteStream(destPath);
    proto
      .get(url, (response) => {
        if (response.statusCode === 301 || response.statusCode === 302) {
          downloadFile(response.headers.location, destPath)
            .then(resolve)
            .catch(reject);
          return;
        }
        response.pipe(file);
        file.on("finish", () => {
          file.close();
          resolve(destPath);
        });
      })
      .on("error", (err) => {
        fs.unlink(destPath, () => {});
        reject(err);
      });
  });
};

module.exports = {
  readBody,
  httpRequest,
  respond,
  stripHTML,
  escapeHTML,
  downloadFile,
  nodemailer,
  fs,
  path,
  crypto,
};
