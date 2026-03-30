import type { Express } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";

const UPLOADS_DIR = path.join(process.cwd(), "server", "uploads");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}_${safe}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

export function registerUploadRoutes(app: Express) {
  app.post("/api/upload", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No file provided" });
      res.json({ url: `/uploads/${req.file.filename}`, filename: req.file.filename });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.delete("/api/upload", async (req, res) => {
    try {
      const { path: filePath } = req.body;
      if (!filePath) return res.status(400).json({ message: "Path required" });
      const filename = String(filePath).replace(/\//g, '_').replace(/^_uploads_/, '');
      const fullPath = path.join(UPLOADS_DIR, path.basename(filename));
      if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });
}
