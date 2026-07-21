const sharp = require('sharp');

// Color spaces that CommerceTools' importer accepts without complaint.
// The importer needs an identifiable RGB-family color model with (ideally)
// an embedded ICC profile. CMYK and "unidentified" color models trigger the
// "Unsupported image data. Not able to identify the color model" rejection.
const SAFE_SPACES = ['srgb', 'rgb', 'rgb16'];

// Analyze one image buffer and return a color-model diagnostic.
// Read-only: only reads metadata, never re-encodes or writes the image.
async function inspectImage(buffer) {
  const meta = await sharp(buffer, { failOn: 'none' }).metadata();

  const space = meta.space || null;          // e.g. 'srgb', 'cmyk', 'b-w'
  const channels = meta.channels || null;    // 3 = RGB, 4 = CMYK/RGBA
  const hasProfile = !!meta.icc;             // ICC profile embedded?
  const depth = meta.depth || null;          // e.g. '8bit'
  const bitsPerChannel = depth === ' uchar' || depth === '8bit' ? 8 : null;

  // Decide the CommerceTools verdict.
  const isCmyk = space === 'cmyk' || channels === 4 && space !== 'srgb';
  const isSafeSpace = SAFE_SPACES.includes(space);

  let verdict, reason, fix;

  if (isCmyk) {
    verdict = 'fail';
    reason = 'CMYK color model (4 channels). CommerceTools does not accept it.';
    fix = 'Convert to sRGB (the Optimizer does this when reprocessing to JPEG).';
  } else if (!isSafeSpace) {
    verdict = 'fail';
    reason = `Color model "${space || 'unknown'}" is not recognized by CommerceTools.`;
    fix = 'Convert to sRGB with an embedded profile (run it through the Optimizer).';
  } else if (!hasProfile) {
    verdict = 'warn';
    reason = 'RGB but with NO embedded ICC profile ("Uncalibrated"). CommerceTools may reject it because it cannot identify the color model.';
    fix = 'Reprocess through the Optimizer to embed a standard sRGB profile.';
  } else {
    verdict = 'ok';
    reason = 'sRGB with an embedded ICC profile. Compatible with CommerceTools.';
    fix = null;
  }

  return {
    space,
    channels,
    hasProfile,
    iccDescription: meta.icc ? describeIcc(buffer) : null,
    depth,
    bitsPerChannel,
    width: meta.width || null,
    height: meta.height || null,
    format: meta.format || null,
    density: meta.density || null,       // DPI
    sizeBytes: buffer.length,
    verdict,
    reason,
    fix,
  };
}

// Best-effort extraction of the ICC profile description string, if present.
// Kept defensive: any parse issue just returns null rather than throwing.
function describeIcc() {
  return null; // Sharp exposes icc as a raw Buffer; description parsing is optional.
}

module.exports = { inspectImage };
