// ─── State ───────────────────────────────────────────────────────
let results = [];

// ─── DOM refs ────────────────────────────────────────────────────
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const qualityInput = document.getElementById('quality');
const qualityLabel = document.getElementById('qualityLabel');
const formatSelect = document.getElementById('format');
const keepFormatToggle = document.getElementById('keepFormat');
const fixColorToggle = document.getElementById('fixColor');
const maxWidthInput = document.getElementById('maxWidth');
const maxHeightInput = document.getElementById('maxHeight');
const downloadAllBtn = document.getElementById('downloadAllBtn');
const clearBtn = document.getElementById('clearBtn');
const resultsList = document.getElementById('resultsList');
const emptyState = document.getElementById('emptyState');
const resultsHeader = document.getElementById('resultsHeader');
const resultCount = document.getElementById('resultCount');
const processingOverlay = document.getElementById('processingOverlay');
const processingTitle = document.getElementById('processingTitle');
const processingSubtitle = document.getElementById('processingSubtitle');

// ─── Size presets ─────────────────────────────────────────────────
document.getElementById('sizePresets').addEventListener('click', e => {
  const btn = e.target.closest('.preset-btn');
  if (!btn) return;
  maxWidthInput.value = btn.dataset.w;
  maxHeightInput.value = btn.dataset.h;
  document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
});

// Deactivate preset if user manually edits inputs
[maxWidthInput, maxHeightInput].forEach(input => {
  input.addEventListener('input', () => {
    document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
  });
});

// ─── Quality slider ───────────────────────────────────────────────
qualityInput.addEventListener('input', () => {
  qualityLabel.textContent = qualityInput.value + '%';
});

// ─── Keep format toggle ───────────────────────────────────────────
keepFormatToggle.addEventListener('change', () => {
  formatSelect.disabled = keepFormatToggle.checked;
  formatSelect.style.opacity = keepFormatToggle.checked ? '0.4' : '1';
});

// ─── Drag & Drop ─────────────────────────────────────────────────
dropzone.addEventListener('dragover', e => {
  e.preventDefault();
  dropzone.classList.add('dragging');
});
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragging'));
dropzone.addEventListener('drop', e => {
  e.preventDefault();
  dropzone.classList.remove('dragging');
  const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/') || /\.(heic|heif|tiff?|avif)$/i.test(f.name));
  if (files.length) processFiles(files);
});
dropzone.addEventListener('click', e => {
  if (e.target.tagName !== 'STRONG') fileInput.click();
});
fileInput.addEventListener('change', () => {
  if (fileInput.files.length) processFiles(Array.from(fileInput.files));
  fileInput.value = '';
});

// ─── Format helpers ───────────────────────────────────────────────
function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

// ─── Process files (SSE streaming) ───────────────────────────────
async function processFiles(files) {
  if (!files.length) return;

  const total = files.length;
  const progFill = document.getElementById('progressFillOverlay');
  const progCurrent = document.getElementById('progressCurrent');
  const progPct = document.getElementById('progressPct');
  const progName = document.getElementById('progressCurrentName');

  // Reset and show overlay
  progFill.style.width = '0%';
  progCurrent.textContent = `0 / ${total}`;
  progPct.textContent = '0%';
  progName.textContent = '';
  processingTitle.textContent = `Optimizing ${total} image${total > 1 ? 's' : ''}...`;
  processingSubtitle.textContent = 'Uploading files to server...';
  processingOverlay.classList.add('visible');

  const formData = new FormData();
  files.forEach(f => formData.append('images', f));
  formData.append('quality', qualityInput.value);
  formData.append('maxWidth', maxWidthInput.value);
  formData.append('maxHeight', maxHeightInput.value);
  formData.append('format', formatSelect.value);
  formData.append('keepOriginalFormat', keepFormatToggle.checked);
  formData.append('fixColorProfile', fixColorToggle.checked);

  try {
    const res = await fetch('/optimize-stream', { method: 'POST', body: formData });
    if (!res.ok) throw new Error(`Error ${res.status}: ${await res.text()}`);

    processingSubtitle.textContent = 'Processing with Sharp...';

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep incomplete line

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        let msg;
        try { msg = JSON.parse(line.slice(6)); } catch { continue; }

        if (msg.type === 'progress') {
          const pct = Math.round((msg.current - 1) / total * 100);
          progFill.style.width = pct + '%';
          progCurrent.textContent = `${msg.current - 1} / ${total}`;
          progPct.textContent = pct + '%';
          progName.textContent = msg.name;
        }

        if (msg.type === 'result') {
          const pct = Math.round(msg.current / total * 100);
          progFill.style.width = pct + '%';
          progCurrent.textContent = `${msg.current} / ${total}`;
          progPct.textContent = pct + '%';
          progName.textContent = msg.error ? `⚠ ${msg.name}` : `✓ ${msg.name}`;

          // Append to live list as they come in
          results.push(msg);
          appendResult(msg);
          updateStats();
        }

        if (msg.type === 'done') {
          progFill.style.width = '100%';
          progCurrent.textContent = `${total} / ${total}`;
          progPct.textContent = '100%';
        }
      }
    }
  } catch (err) {
    alert('Processing error: ' + err.message);
  } finally {
    setTimeout(() => processingOverlay.classList.remove('visible'), 300);
  }
}

// ─── Build a single result DOM item ──────────────────────────────
function buildResultItem(r) {
  const item = document.createElement('div');
  item.className = 'result-item' + (r.error ? ' error' : '');

  if (r.error) {
    item.innerHTML = `
      <div class="result-thumb placeholder">⚠️</div>
      <div class="result-info">
        <div class="result-name">${r.name}</div>
        <div class="error-msg">${r.error}</div>
      </div>
      <div class="result-actions"></div>
    `;
  } else {
    const pillClass = r.savings < 10 ? 'bad' : '';
    const imgSrc = `data:${r.mimeType};base64,${r.data}`;
    item.innerHTML = `
      <img class="result-thumb" src="${imgSrc}" alt="${r.name}" />
      <div class="result-info">
        <div class="result-name" title="${r.outputName}">${r.name}</div>
        <div class="result-meta">
          <span>${formatBytes(r.originalSize)}</span>
          <span class="arrow">→</span>
          <span>${formatBytes(r.optimizedSize)}</span>
          <span class="savings-pill ${pillClass}">-${r.savings}%</span>
          ${r.outputWidth ? `<span style="color:var(--text-muted)">${r.outputWidth}×${r.outputHeight}px</span>` : ''}
        </div>
      </div>
      <div class="result-actions">
        <a class="btn-icon" href="${imgSrc}" download="${r.outputName}" title="Download">⬇</a>
      </div>
    `;
  }
  return item;
}

// ─── Append a single result (called in real-time during stream) ───
function appendResult(r) {
  emptyState.style.display = 'none';
  resultsHeader.style.display = 'flex';
  resultCount.textContent = results.length;
  resultsList.appendChild(buildResultItem(r));
  downloadAllBtn.disabled = results.filter(x => !x.error).length === 0;
  clearBtn.disabled = false;
}

// ─── Full re-render (used after clear/reload) ─────────────────────
function renderResults() {
  emptyState.style.display = 'none';
  resultsHeader.style.display = 'flex';
  resultCount.textContent = results.length;
  resultsList.innerHTML = '';
  results.forEach(r => resultsList.appendChild(buildResultItem(r)));
  downloadAllBtn.disabled = results.filter(r => !r.error).length === 0;
  clearBtn.disabled = false;
}

// ─── Stats ────────────────────────────────────────────────────────
function updateStats() {
  const valid = results.filter(r => !r.error);
  const totalOrig = valid.reduce((s, r) => s + r.originalSize, 0);
  const totalOpt = valid.reduce((s, r) => s + r.optimizedSize, 0);
  const saved = totalOrig - totalOpt;

  document.getElementById('statCount').textContent = valid.length;
  document.getElementById('statOriginal').textContent = formatBytes(totalOrig);
  document.getElementById('statSaved').textContent = saved > 0 ? formatBytes(saved) : '—';
}

// ─── Download all as ZIP ──────────────────────────────────────────
downloadAllBtn.addEventListener('click', async () => {
  const valid = results.filter(r => !r.error);
  if (!valid.length) return;

  downloadAllBtn.disabled = true;
  downloadAllBtn.textContent = 'Generating ZIP...';

  try {
    // Load JSZip dynamically
    if (!window.JSZip) {
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js');
    }

    const zip = new JSZip();
    const folder = zip.folder('optimized-images');

    // Handle duplicate filenames
    const nameCount = {};
    valid.forEach(r => {
      let name = r.outputName;
      if (nameCount[name] !== undefined) {
        nameCount[name]++;
        const ext = name.lastIndexOf('.');
        name = name.slice(0, ext) + `_${nameCount[name]}` + name.slice(ext);
      } else {
        nameCount[r.outputName] = 0;
      }
      const byteString = atob(r.data);
      const bytes = new Uint8Array(byteString.length);
      for (let i = 0; i < byteString.length; i++) bytes[i] = byteString.charCodeAt(i);
      folder.file(name, bytes);
    });

    const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'optimized-images.zip';
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    alert('Error generating ZIP: ' + err.message);
  } finally {
    downloadAllBtn.disabled = false;
    downloadAllBtn.textContent = 'Download all (ZIP)';
  }
});

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

// ─── Clear ────────────────────────────────────────────────────────
clearBtn.addEventListener('click', () => {
  results = [];
  resultsList.innerHTML = '';
  emptyState.style.display = 'flex';
  resultsHeader.style.display = 'none';
  downloadAllBtn.disabled = true;
  clearBtn.disabled = true;
  updateStats();
});

// ─── Copy summary ─────────────────────────────────────────────────
document.getElementById('copyAllBtn').addEventListener('click', () => {
  const valid = results.filter(r => !r.error);
  const lines = valid.map(r => `${r.name} → ${r.outputName}: ${formatBytes(r.originalSize)} → ${formatBytes(r.optimizedSize)} (-${r.savings}%)`);
  const totalOrig = valid.reduce((s, r) => s + r.originalSize, 0);
  const totalOpt = valid.reduce((s, r) => s + r.optimizedSize, 0);
  lines.push('');
  lines.push(`Total: ${formatBytes(totalOrig)} → ${formatBytes(totalOpt)} (-${Math.round((1 - totalOpt/totalOrig)*100)}%)`);
  navigator.clipboard.writeText(lines.join('\n')).then(() => {
    const btn = document.getElementById('copyAllBtn');
    btn.textContent = 'Copied!';
    setTimeout(() => btn.textContent = 'Copy summary', 2000);
  });
});
