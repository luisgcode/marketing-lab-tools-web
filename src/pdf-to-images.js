// PDF to Images — rasterizes each page of a PDF into an optimized image,
// ready to drop into Figma for annotation/markup. Local, free, no page limit,
// no watermark, no upload to a third party. Uses pdf-to-img (pdf.js under the hood)
// then optimizes each page with Sharp so the files stay light for Figma.

const sharp = require('sharp');
const path = require('path');

// Path to pdf.js standard fonts so PDFs that rely on base-14 fonts
// (Helvetica, Times, etc.) render correctly instead of warning/blank.
const STANDARD_FONTS =
  path.join(require.resolve('pdfjs-dist/package.json'), '..', 'standard_fonts')
    .replace(/\\/g, '/') + '/';

// scale = render density. Higher = sharper text but bigger source before optimize.
// 2.5 ≈ ~180 DPI, crisp enough to read/annotate without a huge source render.
const DEFAULT_SCALE = 2.5;
// Max width of the exported image (px). Caps the file size so pages don't come
// out at multiple MB each. 2000px is plenty to read and annotate in Figma.
const DEFAULT_MAX_WIDTH = 2000;
const JPEG_QUALITY = 82; // sweet spot: sharp text, small file

/**
 * Convert a PDF buffer into an array of optimized page images.
 * @param {Buffer} pdfBuffer
 * @param {object} opts
 * @param {number} [opts.scale=2.5]    render scale (1-5)
 * @param {string} [opts.format=jpeg]  'jpeg' | 'png'
 * @param {number} [opts.maxWidth=2000] cap output width in px
 * @param {number} [opts.quality=82]   jpeg quality
 * @returns {Promise<Array<{page:number,buffer:Buffer,width:number,height:number}>>}
 */
async function pdfToImages(pdfBuffer, opts = {}) {
  const scale = clamp(Number(opts.scale) || DEFAULT_SCALE, 1, 5);
  const format = opts.format === 'png' ? 'png' : 'jpeg';
  const maxWidth = clamp(Number(opts.maxWidth) || DEFAULT_MAX_WIDTH, 500, 6000);
  const quality = clamp(Number(opts.quality) || JPEG_QUALITY, 40, 100);

  // pdf-to-img is ESM-only; load it dynamically from CommonJS.
  const { pdf } = await import('pdf-to-img');
  const document = await pdf(pdfBuffer, { scale, docInitParams: { standardFontDataUrl: STANDARD_FONTS } });

  const pages = [];
  let pageNum = 0;
  for await (const pageImage of document) {
    pageNum++;

    // pageImage is a raw PNG buffer from pdf.js. Optimize it with Sharp:
    // resize down to maxWidth (never up), then encode light.
    let pipeline = sharp(pageImage).resize({
      width: maxWidth,
      withoutEnlargement: true,
      fit: 'inside',
    });

    let buffer;
    if (format === 'png') {
      // PNG: keep it lossless but compressed + palette where possible.
      buffer = await pipeline.png({ compressionLevel: 9, palette: true }).toBuffer();
    } else {
      // JPEG on a white background (PDFs are transparent-less anyway),
      // mozjpeg for smaller files. This is the light default for Figma.
      buffer = await pipeline
        .flatten({ background: '#ffffff' })
        .jpeg({ quality, mozjpeg: true })
        .toBuffer();
    }

    const meta = await sharp(buffer).metadata();
    pages.push({ page: pageNum, buffer, width: meta.width, height: meta.height });
  }

  if (pages.length === 0) {
    throw new Error('The PDF has no renderable pages.');
  }

  return pages;
}

function clamp(n, min, max) {
  if (Number.isNaN(n)) return min;
  return Math.min(max, Math.max(min, n));
}

module.exports = { pdfToImages, DEFAULT_SCALE, DEFAULT_MAX_WIDTH };
