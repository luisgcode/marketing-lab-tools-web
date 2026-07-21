const path = require('path');

// ─── Slug helper ─────────────────────────────────────────────────
// Strategy: remove known "noise" patterns, keep everything else.
//
// Rules (in order):
//  1. Strip leading sequence number:  "08_", "003 - ", "12."
//  2. Strip standalone numeric codes ≥ 6 digits (SKU/product codes)
//  3. Strip standalone Roman numerals surrounded by separators (II, III, IV…)
//     but NOT when attached to a word (e.g. "Vista130" stays)
//  4. Collapse separators (_, space, .) → hyphen
//  5. Remove any character that isn't alphanumeric or hyphen
//  6. Collapse / trim hyphens, lowercase
//
// Examples:
//  "08_Dimplex_Vista 130 III_400001671_Detail Temperature" → "dimplex-vista-130-detail-temperature"
//  "Product_Hero_Banner_1920x1080"                        → "product-hero-banner-1920x1080"
//  "GlowStix-XL-Detail-Shot_v2"                          → "glowstix-xl-detail-shot-v2"
//  "dimplex_logo_white"                                   → "dimplex-logo-white"
function slugifyName(filename) {
  const base = path.basename(filename, path.extname(filename));
  return base
    // 1. Leading sequence number (digits followed by separator at the very start)
    .replace(/^\d+[\s_\-\.]+/, '')
    // 2. Standalone numeric codes with 6+ digits (SKUs like 400001671)
    .replace(/(^|[\s_\-])(\d{6,})(?=[\s_\-]|$)/g, '$1')
    // 3. Standalone Roman numerals (only when isolated by separators or at end)
    .replace(/(^|[\s_\-])(X{0,3}(?:IX|IV|V?I{0,3}))(?=[\s_\-]|$)/gi, (m, sep, roman) =>
      roman.trim() === '' ? m : sep
    )
    // 4. Separators (underscore, space, dot) → hyphen
    .replace(/[\s_\.]+/g, '-')
    // 5. Remove any char that isn't alphanumeric or hyphen
    .replace(/[^a-zA-Z0-9\-]/g, '')
    // 6. Collapse multiple hyphens, trim edges, lowercase
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

module.exports = { slugifyName };
