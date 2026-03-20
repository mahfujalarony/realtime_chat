const fs = require("fs");
const path = require("path");

const CRLF = Buffer.from("\r\n");
const HEADER_SEPARATOR = Buffer.from("\r\n\r\n");

function sanitizeFileStem(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  return raw
    .replace(/\\/g, "/")
    .split("/")
    .pop()
    .replace(/[^\w.-]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function extensionFromMime(mime = "") {
  const clean = String(mime || "").trim().toLowerCase();
  if (clean === "image/jpeg") return "jpg";
  if (clean === "audio/mpeg") return "mp3";
  const part = clean.split("/")[1] || "";
  return part.replace(/[^\w]/g, "") || "bin";
}

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
      reject(new Error("Invalid multipart boundary"));
      return;
    }

    const boundaryBuffer = Buffer.from(`--${boundary}`);
    let buffer = Buffer.alloc(0);
    const files = [];

    req.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);

      if (buffer.length > options.maxSize) {
        reject(new Error("File size exceeded"));
        req.destroy();
      }
    });

    req.on("error", reject);

    req.on("end", () => {
      try {
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

          const mime = headerText.match(/Content-Type:\s*([^\r\n]+)/i)?.[1]?.trim() || "";
          const baseMime = mime.split(";")[0].trim();
          const isAllowed =
            options.allowed.includes("*") ||
            options.allowed.includes(mime) ||
            options.allowed.includes(baseMime);
          if (!isAllowed) continue;

          const filenameMatch = headerText.match(/filename="([^"]+)"/i);
          const originalName = filenameMatch ? filenameMatch[1] : "";
          const originalExt = originalName ? path.extname(originalName).slice(1) : "";
          const extension = originalExt || extensionFromMime(baseMime);
          const fileData = partBuffer.slice(headerEnd + HEADER_SEPARATOR.length);

          const rawDir = String(options.uploadDir || "").replace(/\\/g, "/").replace(/^\/+/, "");
          const relativeDir = rawDir.replace(/\/+$/, "");
          const absoluteDir = path.join(__dirname, "..", relativeDir);

          fs.mkdirSync(absoluteDir, { recursive: true });

          let savedFileName = "";
          if (typeof options.filenameFactory === "function") {
            const generatedBaseName = options.filenameFactory({
              index: files.length,
              mime: baseMime,
              ext: extension,
              defaultName: path.parse(originalName).name || `${Date.now()}-${files.length + 1}`
            });
            const safeBaseName = sanitizeFileStem(generatedBaseName) || `${Date.now()}-${files.length + 1}`;
            let attempt = 0;

            while (attempt < 100) {
              const candidateBase = attempt === 0 ? safeBaseName : `${safeBaseName}_${attempt}`;
              const candidateFile = candidateBase.endsWith(`.${extension}`)
                ? candidateBase
                : `${candidateBase}.${extension}`;
              const savePath = path.join(absoluteDir, candidateFile);

              try {
                fs.writeFileSync(savePath, fileData, { flag: "wx" });
                savedFileName = candidateFile;
                break;
              } catch (err) {
                if (err && err.code === "EEXIST") {
                  attempt += 1;
                  continue;
                }
                throw err;
              }
            }

            if (!savedFileName) {
              throw new Error("Failed to allocate unique filename");
            }
          } else {
            savedFileName = resolveNextSequentialFileName(absoluteDir, extension);
            fs.writeFileSync(path.join(absoluteDir, savedFileName), fileData);
          }

          files.push(path.posix.join(relativeDir, savedFileName));
        }

        resolve(files);
      } catch (err) {
        reject(err);
      }
    });
  });
}

module.exports = parseMultipart;
