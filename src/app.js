const express = require('express');
const multer = require('multer');
const path = require('path');

const { slugifyName } = require('./slugify');
const { parseOptions, optimizeImage } = require('./optimizer');
const { inspectImage } = require('./inspector');
const { pdfToImages } = require('./pdf-to-images');

// ─── Constants ───────────────────────────────────────────────────
// Lower than the local tool on purpose: this runs on a shared host with
// limited memory, and everything is processed in RAM.
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB per file
const MAX_FILES_PER_BATCH = 30;
const ALLOWED_FORMATS = /jpeg|jpg|png|webp|gif|tiff|avif|heic/i;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_FORMATS.test(path.extname(file.originalname)) || ALLOWED_FORMATS.test(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Formato no soportado: ${file.originalname}`));
    }
  }
});

// Separate multer for PDFs (the image one rejects non-image mimetypes).
const uploadPdf = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    if (/pdf/i.test(path.extname(file.originalname)) || /pdf/i.test(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Not a PDF: ${file.originalname}`));
    }
  }
});

// Build a unique output filename for a slug, tracking duplicates across the batch.
function buildOutputName(slug, ext, usedNames) {
  if (!usedNames[slug]) {
    usedNames[slug] = 1;
    return `${slug}_formatted.${ext}`;
  }
  usedNames[slug]++;
  return `${slug}-${usedNames[slug]}_formatted.${ext}`;
}

function createApp() {
  const app = express();

  app.use(express.static(PUBLIC_DIR));

  // SSE endpoint: processes images one by one and streams each result
  app.post('/optimize-stream', upload.array('images', MAX_FILES_PER_BATCH), async (req, res) => {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No se recibieron imágenes' });
    }

    const options = parseOptions(req.body);

    // SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const send = (data) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    const total = req.files.length;
    const usedNames = {}; // track duplicate slugs across the batch

    for (let i = 0; i < total; i++) {
      const file = req.files[i];

      // Notify start of this image
      send({ type: 'progress', current: i + 1, total, name: file.originalname });

      try {
        const originalSize = file.buffer.length;
        const { outputBuffer, outputFormat, originalMeta, optimizedMeta } =
          await optimizeImage(file.buffer, options);

        const ext = outputFormat === 'jpeg' ? 'jpg' : outputFormat;
        const slug = slugifyName(file.originalname);
        const outputName = buildOutputName(slug, ext, usedNames);

        send({
          type: 'result',
          current: i + 1,
          total,
          name: file.originalname,
          outputName,
          originalSize,
          optimizedSize: outputBuffer.length,
          originalWidth: originalMeta.width,
          originalHeight: originalMeta.height,
          outputWidth: optimizedMeta.width,
          outputHeight: optimizedMeta.height,
          savings: Math.round((1 - outputBuffer.length / originalSize) * 100),
          data: outputBuffer.toString('base64'),
          mimeType: `image/${outputFormat === 'jpg' ? 'jpeg' : outputFormat}`
        });

      } catch (err) {
        send({ type: 'result', current: i + 1, total, name: file.originalname, error: err.message });
      }
    }

    send({ type: 'done', total });
    res.end();
  });

  // ─── Inspector (color model / ICC diagnostic) ─────────────────
  // Receives images, returns color-space diagnostics for each. Read-only:
  // no image is written, only metadata is analyzed. Used to detect the
  // "Unsupported image data / color model" rejections in CommerceTools.
  app.post('/inspect', upload.array('images', MAX_FILES_PER_BATCH), async (req, res) => {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No se recibieron imágenes' });
    }

    const results = [];
    for (const file of req.files) {
      try {
        results.push({ name: file.originalname, ...(await inspectImage(file.buffer)) });
      } catch (err) {
        results.push({ name: file.originalname, error: err.message });
      }
    }
    res.json({ results });
  });

  // ─── PDF to Images ─────────────────────────────────────────────
  // Receives a PDF, rasterizes each page to a high-res PNG (or JPEG),
  // ready to drop into Figma for markup. One image per page.
  app.post('/pdf-to-images', uploadPdf.single('pdf'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'No PDF received' });
      const format = req.body.format === 'png' ? 'png' : 'jpeg';
      const pages = await pdfToImages(req.file.buffer, {
        scale: req.body.scale,
        format,
        maxWidth: req.body.maxWidth,
        quality: req.body.quality,
      });
      const base = slugifyName(req.file.originalname).replace(/_formatted$/, '');
      const ext = format === 'jpeg' ? 'jpg' : 'png';
      const pad = String(pages.length).length;
      res.json({
        results: pages.map((p) => ({
          page: p.page,
          outputName: `${base}_page-${String(p.page).padStart(pad, '0')}.${ext}`,
          width: p.width,
          height: p.height,
          size: p.buffer.length,
          data: p.buffer.toString('base64'),
          mimeType: format === 'jpeg' ? 'image/jpeg' : 'image/png',
        })),
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Multer and other upload errors arrive here. Without this, a file over the
  // limit returns an opaque 500 and the UI just looks broken.
  app.use((err, req, res, next) => {
    if (err && err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'File too large. Max 25 MB per file.' });
    }
    if (err && err.code === 'LIMIT_FILE_COUNT') {
      return res.status(413).json({ error: 'Too many files. Max 30 per batch.' });
    }
    if (err) return res.status(400).json({ error: err.message });
    next();
  });

  app.get('/health', (req, res) => res.json({ status: 'ok' }));

  return app;
}

module.exports = { createApp };
