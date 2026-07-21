const sharp = require('sharp');

// Clamp a quality value into the valid 1–100 range, defaulting to 85.
function normalizeQuality(raw) {
  return Math.max(1, Math.min(100, parseInt(raw) || 95));
}

// Build the optimization options object from raw request fields.
function parseOptions(body = {}) {
  return {
    quality: normalizeQuality(body.quality),
    maxWidth: parseInt(body.maxWidth) || 0,
    maxHeight: parseInt(body.maxHeight) || 0,
    format: body.format || 'jpeg',
    keepOriginalFormat: body.keepOriginalFormat === 'true',
    // Force output to sRGB with an embedded ICC profile (fixes CMYK /
    // "uncalibrated" images that CommerceTools rejects). Defaults to on.
    fixColorProfile: body.fixColorProfile !== 'false'
  };
}

// Run a single image buffer through Sharp: optional resize + format encode.
// Returns { outputBuffer, outputFormat, originalMeta, optimizedMeta }.
async function optimizeImage(buffer, options) {
  const { quality, maxWidth, maxHeight, format, keepOriginalFormat, fixColorProfile } = options;

  let pipeline = sharp(buffer, { failOn: 'none' });
  const originalMeta = await pipeline.metadata();

  if (maxWidth > 0 || maxHeight > 0) {
    const resizeOptions = { fit: 'inside', withoutEnlargement: true };
    if (maxWidth > 0) resizeOptions.width = maxWidth;
    if (maxHeight > 0) resizeOptions.height = maxHeight;
    pipeline = pipeline.resize(resizeOptions);
  }

  // Normalize the color model so the output is identifiable sRGB with an
  // embedded ICC profile. Without this, Sharp drops metadata on re-encode and
  // CMYK / "uncalibrated" images stay unusable — CommerceTools rejects them with
  // "Unsupported image data. Not able to identify the color model". Optional.
  if (fixColorProfile) {
    pipeline = pipeline.toColorspace('srgb').withIccProfile('srgb');
  }

  let outputFormat = keepOriginalFormat ? (originalMeta.format || 'jpeg') : format;

  switch (outputFormat) {
    case 'webp':  pipeline = pipeline.webp({ quality, effort: 4 }); break;
    case 'jpeg':
    case 'jpg':   pipeline = pipeline.jpeg({ quality, mozjpeg: true }); break;
    case 'png':   pipeline = pipeline.png({ quality, compressionLevel: 9 }); break;
    case 'avif':  pipeline = pipeline.avif({ quality, effort: 4 }); break;
    default:      pipeline = pipeline.jpeg({ quality, mozjpeg: true }); outputFormat = 'jpeg';
  }

  const outputBuffer = await pipeline.toBuffer();
  const optimizedMeta = await sharp(outputBuffer).metadata();

  return { outputBuffer, outputFormat, originalMeta, optimizedMeta };
}

module.exports = { parseOptions, optimizeImage };
