# Marketing Lab Tools — Web

Web build of the Marketing Lab image tools, so the design team can use them without installing anything.

## Tools

| Tool | What it does |
|------|--------------|
| **Optimizer** | Batch resize, reformat and slugify images for the web. Fixes the colour profile to sRGB so CommerceTools accepts them. |
| **Inspector** | Diagnoses an image's colour model (sRGB / CMYK / uncalibrated) and says whether CommerceTools will accept it. Read only, nothing is written. |
| **PDF to Images** | Rasterises each page of a PDF into a high resolution image. |

## Why this exists

Images that are CMYK, or RGB with no embedded profile, get rejected by CommerceTools with "Unsupported image data. Not able to identify the color model". The failure only shows up days later, in the nightly sync.

The Inspector catches it in two seconds, before the image is ever uploaded to Plytix. The Optimizer fixes it.

**Typical flow:** Inspector (confirms the problem) → Optimizer (fixes it) → Inspector again (confirms it is clean) → upload to Plytix.

## Not included

The Outpaint AI tool from the local build is deliberately left out, since it depends on a paid API key.

## Limits

- 25 MB per file
- 30 files per batch
- Everything runs in memory. Nothing is stored on the server, and no image is kept after the response.

## Running locally

```bash
npm install
npm start
```

Then open http://localhost:3000

## Deploying

Any host that runs Node works. The server binds to `process.env.PORT`.

- Build command: `npm install`
- Start command: `npm start`

Sharp ships prebuilt binaries, so no extra build configuration is needed.

---

Marketing Lab
