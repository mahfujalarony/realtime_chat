const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const config = require("./config");
const parseMultipart = require("./utils/multipartParser");

const MIME_TYPES = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".avi": "video/x-msvideo",
  ".mkv": "video/x-matroska",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".txt": "text/plain",
  ".zip": "application/zip",
  ".rar": "application/vnd.rar",
  ".7z": "application/x-7z-compressed",
  ".tar": "application/x-tar",
  ".gz": "application/gzip",
  ".json": "application/json",
  ".xml": "application/xml",
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript"
};

["public/chat", "public/misc"].forEach((dir) =>
  fs.mkdirSync(path.join(__dirname, dir), { recursive: true })
);

function getMimeType(filePath, requestPath = "") {
  const ext = path.extname(filePath).toLowerCase();
  const normalizedRequestPath = String(requestPath || "").replace(/\\/g, "/").toLowerCase();
  if (normalizedRequestPath.includes("/audios/")) {
    if (ext === ".webm") return "audio/webm";
    if (ext === ".mp4" || ext === ".m4a") return "audio/mp4";
  }
  return MIME_TYPES[ext] || "application/octet-stream";
}

function readJsonBody(req, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk.toString("utf8");
      if (body.length > maxBytes) {
        reject(new Error("Payload too large"));
        req.destroy();
      }
    });

    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });

    req.on("error", reject);
  });
}

const toSafeSegment = (value) => {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "uncategorized";
  const cleaned = raw
    .replace(/\\/g, "/")
    .split("/")
    .pop()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "uncategorized";
};

const toPositiveInt = (value, fallback = 0) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const toSafeScope = (value) => {
  const s = toSafeSegment(value || "misc");
  return s === "uncategorized" ? "misc" : s;
};

const safeFileStem = (value) =>
  String(value || "")
    .trim()
    .replace(/[^\w.-]+/g, "_")
    .replace(/^_+|_+$/g, "");

const getNextNumericCounter = (absoluteDir) => {
  try {
    const entries = fs.readdirSync(absoluteDir, { withFileTypes: true });
    let max = 0;
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const base = path.parse(entry.name).name;
      const num = Number.parseInt(base, 10);
      if (Number.isFinite(num) && num > max) max = num;
    }
    return max + 1;
  } catch {
    return 1;
  }
};

const escapeRegExp = (value) => String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const getNextPrefixedCounter = (absoluteDir, prefix) => {
  const safePrefix = safeFileStem(prefix);
  if (!safePrefix) return 1;
  const matcher = new RegExp(`^${escapeRegExp(safePrefix)}_(\\d+)$`);

  try {
    const entries = fs.readdirSync(absoluteDir, { withFileTypes: true });
    let max = 0;
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const base = path.parse(entry.name).name;
      const match = base.match(matcher);
      if (!match) continue;
      const num = Number.parseInt(match[1], 10);
      if (Number.isFinite(num) && num > max) max = num;
    }
    return max + 1;
  } catch {
    return 1;
  }
};

const extFromContentType = (contentType = "") => {
  const t = String(contentType || "").toLowerCase();
  if (t.includes("png")) return "png";
  if (t.includes("webp")) return "webp";
  if (t.includes("gif")) return "gif";
  return "jpg";
};

const resolveUploadOptions = (fullUrl) => {
  const scope = String(fullUrl.searchParams.get("scope") || "").toLowerCase();
  const subCategory = toSafeSegment(
    fullUrl.searchParams.get("subcategory") || fullUrl.searchParams.get("subCategory")
  );
  const folder = toSafeSegment(fullUrl.searchParams.get("folder") || "");
  const fileNameBase = safeFileStem(fullUrl.searchParams.get("name") || "");
  const entityId = toPositiveInt(
    fullUrl.searchParams.get("entityId") || fullUrl.searchParams.get("id"),
    0
  );
  const productId = toPositiveInt(fullUrl.searchParams.get("productId"), 0);
  const startCount = Math.max(
    0,
    Number.parseInt(fullUrl.searchParams.get("startCount") || "0", 10) || 0
  );

  const parseOptions = {
    uploadDir: "public/misc",
    maxSize: config.LIMITS.IMAGE,
    allowed: config.ALLOWED_IMAGES
  };

  if (scope === "product") {
    parseOptions.uploadDir = `public/products/${subCategory}`;
    if (productId > 0) {
      parseOptions.filenameFactory = ({ index }) => `${productId}_${startCount + index + 1}`;
    }
  } else if (scope) {
    const safeScope = toSafeScope(scope);
    parseOptions.uploadDir =
      folder && folder !== "uncategorized" ? `public/${safeScope}/${folder}` : `public/${safeScope}`;

    if (
      safeScope === "profiles" ||
      safeScope === "offers" ||
      safeScope === "logo" ||
      safeScope === "stories"
    ) {
      const absoluteScopeDir = path.join(__dirname, parseOptions.uploadDir);
      fs.mkdirSync(absoluteScopeDir, { recursive: true });
      const nextCounter = getNextNumericCounter(absoluteScopeDir);
      parseOptions.filenameFactory = ({ index }) => `${nextCounter + index}`;
    } else if (safeScope === "merchant" || safeScope === "wallets") {
      const absoluteScopeDir = path.join(__dirname, parseOptions.uploadDir);
      fs.mkdirSync(absoluteScopeDir, { recursive: true });
      const baseName = fileNameBase || (safeScope === "wallets" ? "wallet" : "merchant");
      const scopedBaseName = entityId > 0 ? `${baseName}_${entityId}` : baseName;
      const nextCounter = getNextPrefixedCounter(absoluteScopeDir, scopedBaseName);
      parseOptions.filenameFactory = ({ index }) => `${scopedBaseName}_${nextCounter + index}`;
    } else if (entityId > 0) {
      parseOptions.filenameFactory = ({ index }) => `${entityId}__${startCount + index + 1}`;
    }
  }

  return parseOptions;
};

const downloadRemoteImage = (url, redirectsLeft = 3) =>
  new Promise((resolve, reject) => {
    if (!/^https?:\/\//i.test(url || "")) return reject(new Error("Invalid URL"));
    const lib = String(url).startsWith("https://") ? https : http;

    const request = lib.get(url, (resp) => {
      if (
        resp.statusCode &&
        resp.statusCode >= 300 &&
        resp.statusCode < 400 &&
        resp.headers.location &&
        redirectsLeft > 0
      ) {
        resolve(downloadRemoteImage(resp.headers.location, redirectsLeft - 1));
        return;
      }

      if (resp.statusCode !== 200) {
        reject(new Error(`Remote fetch failed (${resp.statusCode})`));
        return;
      }

      const chunks = [];
      let total = 0;

      resp.on("data", (chunk) => {
        total += chunk.length;
        if (total > config.LIMITS.IMAGE) {
          request.destroy(new Error("Image too large"));
          return;
        }
        chunks.push(chunk);
      });

      resp.on("end", () =>
        resolve({
          buffer: Buffer.concat(chunks),
          contentType: String(resp.headers["content-type"] || "").toLowerCase()
        })
      );
      resp.on("error", reject);
    });

    request.on("error", reject);
    request.setTimeout(12000, () => request.destroy(new Error("Remote fetch timeout")));
  });

const resolveDeletablePath = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return null;

  let pathname = raw;
  if (/^https?:\/\//i.test(raw)) {
    try {
      pathname = new URL(raw).pathname || "";
    } catch {
      return null;
    }
  }

  const rel = String(pathname)
    .split("?")[0]
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");

  if (!rel.startsWith("public/")) return null;

  const full = path.resolve(__dirname, rel);
  const publicRoot = path.resolve(__dirname, "public");
  if (!full.startsWith(publicRoot)) return null;

  return { rel, full };
};

function sendChatResponse(res, files) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      success: true,
      urls: files.map((file) => {
        const normalized = String(file || "").replace(/\\/g, "/").replace(/^\.?\//, "");
        return `/${normalized.replace(/^\/+/, "")}`;
      })
    })
  );
}

function sendEcommerceResponse(res, files) {
  const normalizedPaths = files.map((file) => {
    const normalized = String(file || "").replace(/\\/g, "/").replace(/^\.?\//, "");
    return `/${normalized.replace(/^\/+/, "")}`;
  });

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      success: true,
      urls: normalizedPaths.map((entry) => `${config.BASE_URL}${entry}`),
      paths: normalizedPaths
    })
  );
}

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  if (req.method === "GET" && req.url.startsWith("/public")) {
    const cleanReqPath = String(req.url || "")
      .split("?")[0]
      .replace(/\\/g, "/")
      .replace(/^\/+/, "");
    const filePath = path.join(__dirname, cleanReqPath);
    const publicRoot = path.join(__dirname, "public");

    if (!filePath.startsWith(publicRoot)) {
      res.writeHead(400);
      return res.end("Invalid path");
    }

    if (fs.existsSync(filePath)) {
      const stat = fs.statSync(filePath);
      const mimeType = getMimeType(filePath, cleanReqPath);
      const fileName = path.basename(filePath);
      const isDownload = String(req.url || "").includes("?download=1");
      const headers = {
        "Content-Type": mimeType,
        "Content-Length": stat.size,
        "Accept-Ranges": "bytes"
      };

      if (cleanReqPath.includes("/files/") || isDownload) {
        headers["Content-Disposition"] = `attachment; filename="${encodeURIComponent(fileName)}"`;
      } else {
        headers["Content-Disposition"] = `inline; filename="${encodeURIComponent(fileName)}"`;
      }

      res.writeHead(200, headers);
      return fs.createReadStream(filePath).pipe(res);
    }

    res.writeHead(404);
    return res.end("File not found");
  }

  try {
    if (req.method === "POST" && req.url === "/create-folder") {
      const data = await readJsonBody(req);
      const { username, targetPath } = data;

      if (!username) {
        res.writeHead(400, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ success: false, error: "username is required" }));
      }

      const basePath = targetPath
        ? path.join(__dirname, "public", String(targetPath).replace(/\.\./g, ""))
        : path.join(__dirname, "public", "chat", username);

      fs.mkdirSync(basePath, { recursive: true });
      fs.mkdirSync(path.join(basePath, "images"), { recursive: true });
      fs.mkdirSync(path.join(basePath, "videos"), { recursive: true });
      fs.mkdirSync(path.join(basePath, "audios"), { recursive: true });
      fs.mkdirSync(path.join(basePath, "files"), { recursive: true });
      fs.mkdirSync(path.join(basePath, "profile"), { recursive: true });

      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(
        JSON.stringify({
          success: true,
          message: "Folder created",
          path: basePath.replace(__dirname, "").replace(/\\/g, "/")
        })
      );
    }

    const chatUploadMatch = req.url.match(/^\/upload\/chat\/([^/?]+)\/(images|videos|audios|files|profile)/);
    if (req.method === "POST" && chatUploadMatch) {
      const username = decodeURIComponent(chatUploadMatch[1]);
      const mediaType = chatUploadMatch[2];

      if (!username) {
        res.writeHead(400, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ success: false, error: "username is required" }));
      }

      const userFolder = path.join("public", "chat", username, mediaType);
      const absoluteFolder = path.join(__dirname, userFolder);
      if (!fs.existsSync(absoluteFolder)) {
        fs.mkdirSync(absoluteFolder, { recursive: true });
      }

      let allowedTypes;
      let maxSize;

      switch (mediaType) {
        case "videos":
          allowedTypes = config.ALLOWED_VIDEOS;
          maxSize = config.LIMITS.VIDEO;
          break;
        case "audios":
          allowedTypes = config.ALLOWED_AUDIOS;
          maxSize = config.LIMITS.AUDIO;
          break;
        case "files":
          allowedTypes = config.ALLOWED_FILES;
          maxSize = config.LIMITS.FILE;
          break;
        case "profile":
          allowedTypes = config.ALLOWED_IMAGES;
          maxSize = config.LIMITS.IMAGE;
          break;
        default:
          allowedTypes = config.ALLOWED_IMAGES;
          maxSize = config.LIMITS.IMAGE;
      }

      const files = await parseMultipart(req, {
        uploadDir: userFolder,
        maxSize,
        allowed: allowedTypes
      });

      return sendChatResponse(res, files);
    }

    const deleteMatch = req.url.match(/^\/delete\/chat\/([^/?]+)\/(images|videos|audios|files|profile)\/([^/?]+)/);
    if (req.method === "DELETE" && deleteMatch) {
      const username = decodeURIComponent(deleteMatch[1]);
      const mediaType = deleteMatch[2];
      const filename = decodeURIComponent(deleteMatch[3]);

      const filePath = path.join(__dirname, "public", "chat", username, mediaType, filename);
      const uploadsRoot = path.join(__dirname, "public");

      if (!filePath.startsWith(uploadsRoot)) {
        res.writeHead(400, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ success: false, error: "Invalid path" }));
      }

      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ success: true, message: "File deleted" }));
      }

      res.writeHead(404, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ success: false, error: "File not found" }));
    }

    const deleteFolderMatch = req.url.match(/^\/delete-folder\/chat\/([^/?]+)/);
    if (req.method === "DELETE" && deleteFolderMatch) {
      const username = decodeURIComponent(deleteFolderMatch[1]);
      const folderPath = path.join(__dirname, "public", "chat", username);
      const uploadsRoot = path.join(__dirname, "public");

      if (!folderPath.startsWith(uploadsRoot)) {
        res.writeHead(400, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ success: false, error: "Invalid path" }));
      }

      if (fs.existsSync(folderPath)) {
        fs.rmSync(folderPath, { recursive: true, force: true });
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ success: true, message: "Folder deleted" }));
    }

    if (req.method === "POST" && req.url.startsWith("/upload/image/url")) {
      const fullUrl = new URL(req.url, config.BASE_URL);
      const uploadOptions = resolveUploadOptions(fullUrl);
      const payload = await readJsonBody(req, 2 * 1024 * 1024);
      const remoteUrl = String(payload.url || "").trim();

      if (!remoteUrl) throw new Error("url is required");

      const remote = await downloadRemoteImage(remoteUrl);
      if (!remote.contentType.startsWith("image/")) throw new Error("Only image URL is allowed");

      const contentType = remote.contentType.split(";")[0];
      if (!config.ALLOWED_IMAGES.includes(contentType)) {
        throw new Error("Unsupported image type");
      }

      const relativeDir = String(uploadOptions.uploadDir || "")
        .replace(/\\/g, "/")
        .replace(/^\/+/, "")
        .replace(/\/+$/, "");
      const absoluteDir = path.join(__dirname, relativeDir);
      fs.mkdirSync(absoluteDir, { recursive: true });

      const ext = extFromContentType(contentType);
      const defaultBase = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const generated =
        typeof uploadOptions.filenameFactory === "function"
          ? uploadOptions.filenameFactory({
              index: 0,
              mime: contentType,
              ext,
              defaultName: defaultBase
            })
          : defaultBase;

      const safeBase = safeFileStem(generated) || defaultBase;
      const fileName = safeBase.endsWith(`.${ext}`) ? safeBase : `${safeBase}.${ext}`;
      fs.writeFileSync(path.join(absoluteDir, fileName), remote.buffer);

      return sendEcommerceResponse(res, [path.posix.join(relativeDir, fileName)]);
    }

    if (req.method === "POST" && req.url.startsWith("/upload/delete")) {
      const payload = await readJsonBody(req, 512 * 1024);
      const target = resolveDeletablePath(payload.path || payload.url);
      if (!target) throw new Error("Invalid file path");

      try {
        fs.unlinkSync(target.full);
      } catch (err) {
        if (!err || err.code !== "ENOENT") throw err;
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(
        JSON.stringify({
          success: true,
          path: `/${target.rel.replace(/^\/+/, "")}`
        })
      );
    }

    if (req.method === "POST" && req.url.startsWith("/upload/image")) {
      const fullUrl = new URL(req.url, config.BASE_URL);
      const parseOptions = resolveUploadOptions(fullUrl);
      const files = await parseMultipart(req, parseOptions);
      return sendEcommerceResponse(res, files);
    }

    res.writeHead(404);
    return res.end("Route not found");
  } catch (err) {
    res.writeHead(400, { "Content-Type": "application/json" });
    return res.end(
      JSON.stringify({
        success: false,
        error: err && err.message ? err.message : String(err)
      })
    );
  }
});

server.listen(config.PORT, () => {
  console.log(`Server running on ${config.BASE_URL}`);
});
