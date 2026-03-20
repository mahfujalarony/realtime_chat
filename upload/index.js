const http = require("http");
const fs = require("fs");
const path = require("path");
const config = require("./config");
const parseMultipart = require("./utils/multipartParser");

/* MIME type mapping */
const MIME_TYPES = {
  // Images
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  // Videos
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".avi": "video/x-msvideo",
  ".mkv": "video/x-matroska",
  // Audio
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  // Documents
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".txt": "text/plain",
  // Archives
  ".zip": "application/zip",
  ".rar": "application/vnd.rar",
  ".7z": "application/x-7z-compressed",
  ".tar": "application/x-tar",
  ".gz": "application/gzip",
  // Others
  ".json": "application/json",
  ".xml": "application/xml",
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
};

function getMimeType(filePath, requestPath = "") {
  const ext = path.extname(filePath).toLowerCase();
  const normalizedRequestPath = String(requestPath || "").replace(/\\/g, "/").toLowerCase();
  if (normalizedRequestPath.includes("/audios/")) {
    if (ext === ".webm") return "audio/webm";
    if (ext === ".mp4" || ext === ".m4a") return "audio/mp4";
  }
  return MIME_TYPES[ext] || "application/octet-stream";
}

/* ensure upload folder exists */
["public/chat"].forEach((dir) =>
  fs.mkdirSync(path.join(__dirname, dir), { recursive: true })
);

/* helper to read JSON body */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  /* CORS */
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  /* serve static uploaded files */
  if (req.method === "GET" && req.url.startsWith("/public")) {
    const cleanReqPath = String(req.url || "")
      .split("?")[0]
      .replace(/\\/g, "/")
      .replace(/^\/+/, "");
    const filePath = path.join(__dirname, cleanReqPath);
    const uploadsRoot = path.join(__dirname, "public");

    if (!filePath.startsWith(uploadsRoot)) {
      res.writeHead(400);
      return res.end("Invalid path");
    }

    if (fs.existsSync(filePath)) {
      const stat = fs.statSync(filePath);
      const mimeType = getMimeType(filePath, cleanReqPath);
      const fileName = path.basename(filePath);
      const isDownload = req.url.includes("?download=1");
      
      const headers = {
        "Content-Type": mimeType,
        "Content-Length": stat.size,
        "Accept-Ranges": "bytes",
      };
      
      // For files folder or if download param is set, force download
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
    /* create user folder for chat */
    if (req.method === "POST" && req.url === "/create-folder") {
      const data = await readJsonBody(req);
      const { username, targetPath } = data;

      if (!username) {
        res.writeHead(400, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ success: false, error: "username is required" }));
      }

      const basePath = targetPath
        ? path.join(__dirname, "public", targetPath.replace(/\.\./g, ""))
        : path.join(__dirname, "public", "chat", username);

      /* create main folder + subfolders for all media types */
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
          path: basePath.replace(__dirname, "").replace(/\\/g, "/"),
        })
      );
    }

    /* upload media to user's chat folder */
    /* Routes: /upload/chat/:username/images|videos|audios|files|profile */
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

      /* ensure user folder exists */
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
        maxSize: maxSize,
        allowed: allowedTypes,
      });

      return send(res, files);
    }

    /* DELETE file from chat folder */
    /* Route: DELETE /delete/chat/:username/:mediaType/:filename */
    const deleteMatch = req.url.match(/^\/delete\/chat\/([^/?]+)\/(images|videos|audios|files|profile)\/([^/?]+)/);
    if (req.method === "DELETE" && deleteMatch) {
      const username = decodeURIComponent(deleteMatch[1]);
      const mediaType = deleteMatch[2];
      const filename = decodeURIComponent(deleteMatch[3]);

      const filePath = path.join(__dirname, "public", "chat", username, mediaType, filename);
      const uploadsRoot = path.join(__dirname, "public");

      /* security: ensure path is within uploads folder */
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

    /* DELETE entire user chat folder */
    /* Route: DELETE /delete-folder/chat/:username */
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

    res.writeHead(404);
    return res.end("Route not found");
  } catch (err) {
    res.writeHead(400, { "Content-Type": "application/json" });
    return res.end(
      JSON.stringify({
        success: false,
        error: err.toString(),
      })
    );
  }
});

function send(res, files) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      success: true,
      urls: files.map((f) => {
        const normalized = String(f || "").replace(/\\/g, "/").replace(/^\.?\//, "");
        return `/${normalized}`;
      }),
    })
  );
}

server.listen(config.PORT, () => {
  console.log(`Server running on ${config.BASE_URL}`);
});
