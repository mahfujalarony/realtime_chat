const fs = require("fs");
const path = require("path");

const CRLF = Buffer.from("\r\n");
const HEADER_SEPARATOR = Buffer.from("\r\n\r\n");

function resolveNextSequentialFileName(absoluteDir, extension) {
  const safeExtension = String(extension || "bin").replace(/^\.+/, "") || "bin";
  const names = fs.existsSync(absoluteDir) ? fs.readdirSync(absoluteDir) : [];
  let maxNumber = 0;

  for (const name of names) {
    const parsed = path.parse(name);
    const number = Number(parsed.name);
    if (Number.isInteger(number) && number > maxNumber) {
      maxNumber = number;
    }
  }

  return `${maxNumber + 1}.${safeExtension}`;
}

function trimPartBuffer(partBuffer) {
  let start = 0;
  let end = partBuffer.length;

  if (partBuffer.slice(0, CRLF.length).equals(CRLF)) start += CRLF.length;
  if (end >= CRLF.length && partBuffer.slice(end - CRLF.length, end).equals(CRLF)) end -= CRLF.length;

  return partBuffer.slice(start, end);
}

function parseMultipart(req, options) {
  return new Promise((resolve, reject) => {
    const boundary = req.headers["content-type"]?.split("boundary=")?.[1];
    if (!boundary) {
      reject("Invalid multipart boundary");
      return;
    }

    const boundaryBuffer = Buffer.from(`--${boundary}`);
    let buffer = Buffer.alloc(0);
    const files = [];

    req.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);

      if (buffer.length > options.maxSize) {
        reject("File size exceeded");
        req.destroy();
      }
    });

    req.on("error", reject);

    req.on("end", () => {
      let searchFrom = 0;

      while (searchFrom < buffer.length) {
        const boundaryStart = buffer.indexOf(boundaryBuffer, searchFrom);
        if (boundaryStart === -1) break;

        let cursor = boundaryStart + boundaryBuffer.length;

        if (buffer.slice(cursor, cursor + 2).toString("ascii") === "--") break;

        const nextBoundary = buffer.indexOf(boundaryBuffer, cursor);
        if (nextBoundary === -1) break;

        const partBuffer = trimPartBuffer(buffer.slice(cursor, nextBoundary));
        searchFrom = nextBoundary;

        if (!partBuffer.length) continue;

        const headerEnd = partBuffer.indexOf(HEADER_SEPARATOR);
        if (headerEnd === -1) continue;

        const headerText = partBuffer.slice(0, headerEnd).toString("utf8");
        if (!headerText.includes("filename=")) continue;

        const mime = headerText.match(/Content-Type:\s*([^\r\n]+)/i)?.[1]?.trim();
        const baseMime = mime ? mime.split(";")[0].trim() : "";
        const isAllowed =
          options.allowed.includes("*") ||
          options.allowed.includes(mime) ||
          options.allowed.includes(baseMime);
        if (!isAllowed) continue;

        const filenameMatch = headerText.match(/filename="([^"]+)"/i);
        const originalName = filenameMatch ? filenameMatch[1] : "";
        const originalExt = originalName ? path.extname(originalName).slice(1) : "";
        const extension = originalExt || (baseMime ? baseMime.split("/")[1] : "bin");
        const fileData = partBuffer.slice(headerEnd + HEADER_SEPARATOR.length);

        const rawDir = String(options.uploadDir || "").replace(/\\/g, "/").replace(/^\/+/, "");
        const relativeDir = rawDir.replace(/\/+$/, "");
        const absoluteDir = path.join(__dirname, "..", relativeDir);

        fs.mkdirSync(absoluteDir, { recursive: true });

        const fileName = resolveNextSequentialFileName(absoluteDir, extension);
        const savePath = path.join(absoluteDir, fileName);
        fs.writeFileSync(savePath, fileData);

        files.push(path.posix.join(relativeDir, fileName));
      }

      resolve(files);
    });
  });
}

module.exports = parseMultipart;
