module.exports = {
  PORT: 5001,
  BASE_URL: "http://localhost:5001",

  LIMITS: {
    IMAGE: 10 * 1024 * 1024,
    VIDEO: 50 * 1024 * 1024,
    AUDIO: 10 * 1024 * 1024,
    FILE: 25 * 1024 * 1024
  },

  ALLOWED_IMAGES: ["image/jpeg", "image/png", "image/webp", "image/gif"],
  ALLOWED_VIDEOS: ["video/mp4", "video/webm", "video/quicktime"],
  ALLOWED_AUDIOS: [
    "audio/mpeg",
    "audio/mp3",
    "audio/wav",
    "audio/ogg",
    "audio/webm",
    "audio/aac",
    "audio/m4a",
    "audio/mp4"
  ],
  ALLOWED_FILES: ["*"]
};
