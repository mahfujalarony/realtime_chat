const fs = require("fs");
const path = require("path");

function parseMultipart(req, options) {
  return new Promise((resolve, reject) => {

    const boundary = req.headers["content-type"].split("boundary=")[1];
    let buffer = Buffer.alloc(0);
    let files = [];

    req.on("data", chunk => {
      buffer = Buffer.concat([buffer, chunk]);

      if (buffer.length > options.maxSize) {
        reject("File size exceeded");
        req.destroy();
      }
    });

    req.on("end", () => {

      const parts = buffer.toString("binary").split("--" + boundary);

      parts.forEach(part => {

        if (!part.includes("filename")) return;

        const mime = part.match(/Content-Type:(.*)/)?.[1]?.trim();
        // Check if file type is allowed - "*" means allow all types
        // Handle MIME types with codec suffixes like "audio/webm;codecs=opus"
        const baseMime = mime ? mime.split(';')[0].trim() : '';
        const isAllowed = options.allowed.includes("*") || options.allowed.includes(mime) || options.allowed.includes(baseMime);
        if (!isAllowed) return;

        // Extract original filename from Content-Disposition header
        const filenameMatch = part.match(/filename="([^"]+)"/);
        const originalName = filenameMatch ? filenameMatch[1] : "";
        const originalExt = originalName ? path.extname(originalName).slice(1) : "";

        const uniqueId = Date.now() + "-" + Math.random().toString(36).slice(2);
        
        // Use original extension if available, otherwise derive from mime type
        // Handle MIME types with codec suffixes for extension extraction
        const extension = originalExt || (baseMime ? baseMime.split("/")[1] : "bin");

        // header আর body আলাদা করা - \r\n\r\n দিয়ে
        const headerEnd = part.indexOf("\r\n\r\n");
        if (headerEnd === -1) return;
        let fileData = part.substring(headerEnd + 4);
        // trailing \r\n সরানো (boundary এর আগের part)
        if (fileData.endsWith("\r\n")) {
          fileData = fileData.slice(0, -2);
        }

        const rawDir = String(options.uploadDir || "").replace(/\\/g, "/").replace(/^\/+/, "");
        const relativeDir = rawDir.replace(/\/+$/, "");
        const absoluteDir = path.join(__dirname, "..", relativeDir);

        fs.mkdirSync(absoluteDir, { recursive: true });

        const fileName = `${uniqueId}.${extension}`;
        const savePath = path.join(absoluteDir, fileName);
        fs.writeFileSync(savePath, Buffer.from(fileData, "binary"));

        files.push(path.posix.join(relativeDir, fileName));
      });

      resolve(files);
    });
  });
}

module.exports = parseMultipart;
