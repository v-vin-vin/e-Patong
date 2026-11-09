// ── e-Patong Scan Logic ────────────────────────────────────────

// E-waste categories with metadata
const EWASTE_DATA = {
  'Mobile Phone':    { key:'mobile_phone',  icon:'📱', scrapMin:50,  scrapMax:200, points:50,  hazardous:['Lead','Mercury','Cadmium'],      disposal:'Remove battery before drop-off. Wipe personal data first.', usabilityNote:'Check screen, battery health, and charging port.' },
  'Laptop':          { key:'laptop',        icon:'💻', scrapMin:200, scrapMax:800, points:150, hazardous:['Lead','Cadmium','Chromium'],      disposal:'Backup and wipe HDD. Drop at authorized e-waste facility.', usabilityNote:'Check screen, keyboard, battery, and boot capability.' },
  'Tablet':          { key:'tablet',        icon:'📱', scrapMin:100, scrapMax:400, points:80,  hazardous:['Lithium','Lead'],                 disposal:'Remove SIM and memory card. Factory reset before drop-off.', usabilityNote:'Check screen, battery life, and charging port.' },
  'Battery':         { key:'battery',       icon:'🔋', scrapMin:15,  scrapMax:50,  points:30,  hazardous:['Lithium','Lead','Acid'],           disposal:'Never puncture or throw in trash. Drop at battery collection point.', usabilityNote:'Check for swelling, leakage, or corrosion.' },
  'Charger/Adapter': { key:'charger',       icon:'🔌', scrapMin:10,  scrapMax:40,  points:20,  hazardous:['Lead','PVC'],                     disposal:'Bundle cables neatly. Drop at any e-waste bin or electronics store.', usabilityNote:'Inspect for frayed cables, bent pins, or burn marks.' },
  'Circuit Board':   { key:'pcb',           icon:'🖥️', scrapMin:100, scrapMax:400, points:100, hazardous:['Lead','Arsenic','Beryllium'],     disposal:'Place in anti-static bag. Handle with gloves to avoid skin contact.', usabilityNote:'Check for burned components, corrosion, or physical damage.' },
  'Monitor/Display': { key:'monitor',       icon:'🖥️', scrapMin:150, scrapMax:500, points:120, hazardous:['Lead','Mercury','Cadmium'],      disposal:'Do not crack or break. CRTs contain toxic lead — handle carefully.', usabilityNote:'Check screen for dead pixels, burn-in, or cracks.' },
  'Keyboard':        { key:'keyboard',      icon:'⌨️', scrapMin:20,  scrapMax:80,  points:25,  hazardous:['PVC','BFRs'],                     disposal:'Can be disassembled for plastic and metal recovery.', usabilityNote:'Check keys for sticking, missing caps, or connectivity issues.' },
  'Mouse':           { key:'mouse',         icon:'🖱️', scrapMin:10,  scrapMax:40,  points:15,  hazardous:['PVC','BFRs'],                     disposal:'Remove batteries if any. Drop at e-waste collection points.', usabilityNote:'Check buttons, scroll wheel, and connectivity.' },
  'Television':      { key:'television',    icon:'📺', scrapMin:200, scrapMax:600, points:130, hazardous:['Lead','Mercury','Cadmium'],       disposal:'TVs are bulky — contact the Barangay Hall of Brgy. 49 Youngfield for scheduled e-waste collection days.', usabilityNote:'Check screen, remote, and AV ports for functionality.' },
};

// ─────────────────────────────────────────────────────────────
let tmModel      = null;  // Teachable Machine model
let stream       = null;  // Camera stream
let cameraMode   = false;
let currentImage = null;  // Current image element for inference
let modelLoaded  = false;
let modelFailed  = false; // the scanner could not load (library or model) -> scanning is switched OFF
let demoMode     = false;
let lastGuesses  = null;  // the model's top 2 guesses for the current photo
let pendingHigh  = null;  // HIGH result waiting for the "Save" click
let mediumRef    = null;  // claim ticket from the server for a MEDIUM scan
let feedbackRef  = null;  // claim ticket for "Was this right?" (HIGH after saving, or LOW)

// Demo mode is ONLY for testing: open the scan page as  scan.html?demo=1
// Results are made up, NOTHING is saved and NO points are given.
// (Before, demo mode switched on by itself whenever the model failed to load —
//  which could give real points for random answers.)
const DEMO_REQUESTED = new URLSearchParams(window.location.search).has('demo');

// ── Load the latest peso values & points (set by the admin) ────
// EWASTE_DATA above is the built-in backup. If the server has newer
// numbers, copy them in. If the request fails, we simply keep the backup,
// so scanning never breaks.
async function loadCategoryValues() {
  try {
    const res  = await fetchWithTimeout('/api/scan/categories', { credentials: 'include' });
    const data = await res.json();
    (data.categories || []).forEach(c => {
      const item = EWASTE_DATA[c.item_name];
      if (!item) return;
      item.scrapMin = Number(c.scrap_value_min);
      item.scrapMax = Number(c.scrap_value_max);
      item.points   = Number(c.points);
    });
  } catch (e) {
    console.warn('[e-Patong] Using built-in e-waste values:', e.message);
  }
}

// ── Load Teachable Machine Model ──────────────────────────────
async function loadModel() {
  const statusEl = document.getElementById('model-status');
  const MODEL_URL = '../assets/model/model.json';

  // Test mode (?demo=1): no model at all, simulated answers, nothing is saved
  if (DEMO_REQUESTED) {
    demoMode = true;
    modelLoaded = true;
    if (statusEl) { statusEl.textContent = '⚡ Demo mode (nothing is saved)'; statusEl.style.color = 'var(--orange)'; }
    showDemoBanner();
    return;
  }

  try {
    if (typeof tmImage === 'undefined') throw new Error('The AI library did not load');
    // Check if model files exist
    const testRes = await fetch(MODEL_URL, { method: 'HEAD' });
    if (!testRes.ok) throw new Error('Model not found');

    if (statusEl) statusEl.textContent = 'Loading AI model...';
    tmModel = await tmImage.load(MODEL_URL, '../assets/model/metadata.json');
    modelLoaded = true;
    demoMode = false;
    if (statusEl) { statusEl.textContent = '✅ AI Model loaded'; statusEl.style.color = 'var(--accent)'; }
    console.log('✅ Teachable Machine model loaded');

  } catch (e) {
    // The scanner can not work. Say so clearly. Do NOT make up answers.
    modelFailed = true;
    console.error('❌ Scanner could not load:', e);
    if (statusEl) { statusEl.textContent = "❌ The scanner couldn't load. Check your internet and refresh the page."; statusEl.style.color = 'var(--red)'; }
    ['scan-btn', 'camera-scan-btn'].forEach((id) => {
      const btn = document.getElementById(id);
      if (btn) { btn.disabled = true; btn.textContent = '⚠️ Scanner unavailable'; }
    });
    showToast("The scanner couldn't load. Check your internet and refresh the page.", 'error');
  }
}

function showDemoBanner() {
  const banner = document.getElementById('demo-banner');
  if (banner) banner.classList.remove('hidden');
}

// ── Check the photo BEFORE the model sees it ───────────────────
// Looks at a small copy of the photo (see js/photo-quality.js).
// If anything goes wrong while checking, we do NOT block the user.
function checkPhotoQuality(imgEl) {
  try {
    if (typeof PhotoQuality === 'undefined') return { ok: true, blocked: false, issues: [] };
    const nw = imgEl.naturalWidth || imgEl.width, nh = imgEl.naturalHeight || imgEl.height;
    if (!nw || !nh) return { ok: true, blocked: false, issues: [] };
    const scale = Math.min(1, 256 / Math.max(nw, nh));
    const w = Math.max(3, Math.round(nw * scale)), h = Math.max(3, Math.round(nh * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(imgEl, 0, 0, w, h);
    return PhotoQuality.assessPhotoQuality(ctx.getImageData(0, 0, w, h).data, w, h, nw, nh);
  } catch (e) {
    console.warn('[e-Patong] Photo check skipped:', e.message);
    return { ok: true, blocked: false, issues: [] };
  }
}

// ── Small helpers ──────────────────────────────────────────────
// Names come from the model, so they are never put into the page as raw HTML.
function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, ch => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}
const round4 = (n) => Math.round(n * 10000) / 10000;           // 4 decimals, same as the database
// Whole percent, rounded DOWN — so "85%" is never shown for a scan that is not HIGH.
const pctOf  = (c) => Math.floor(Math.round(c * 10000) / 100);

// ── Run model inference ────────────────────────────────────────
// Returns the model's TOP 2 guesses (name + confidence 0–1).
// Only these numbers go to the server. The photo itself never leaves the phone.
async function classify(imgEl) {
  const categories = Object.keys(EWASTE_DATA);

  if (demoMode) {
    // Demo: make up two guesses so you can try all three levels
    const shuffled = [...categories].sort(() => Math.random() - 0.5);
    const c1 = 0.30 + Math.random() * 0.69;               // 30% – 99%
    const c2 = (1 - c1) * (0.2 + Math.random() * 0.7);    // part of what is left
    return {
      top1: { name: shuffled[0], confidence: round4(c1) },
      top2: { name: shuffled[1], confidence: round4(c2) },
    };
  }

  // Real Teachable Machine inference
  const predictions = await tmModel.predict(imgEl);
  predictions.sort((a, b) => b.probability - a.probability);
  return {
    top1: { name: predictions[0].className, confidence: round4(predictions[0].probability) },
    top2: { name: predictions[1].className, confidence: round4(predictions[1].probability) },
  };
}

// ── Pieces used by more than one level ─────────────────────────
// Every level has an ICON and TEXT (never colour alone).
const LEVEL_ICONS = { high: '✅', medium: '⚠️', low: '❌' };

function levelBanner(level, title, text, icon) {
  return `
    <div class="level-banner level-${level}" role="status">
      <span class="level-icon" aria-hidden="true">${icon || LEVEL_ICONS[level]}</span>
      <div>
        <div class="level-title">${title}</div>
        ${text ? `<div class="level-text">${text}</div>` : ''}
      </div>
    </div>`;
}

function photoTipsHtml() {
  return `
    <div class="photo-tips-box">
      <div class="photo-tips-title">📸 Photo tips</div>
      <ul class="photo-tips">
        <li>🖼️ Plain background</li>
        <li>💡 Good light</li>
        <li>1️⃣ One item only</li>
        <li>🔍 Fill the frame</li>
      </ul>
    </div>`;
}

function retakeButtonHtml() {
  return `<button class="btn btn-ghost btn-full retake-btn" data-action="retake">📷 Retake photo</button>`;
}

function hazardAndDisposalHtml(data) {
  return `
    <div class="result-row">
      <div style="width:100%">
        <div class="result-label mb-1">⚠️ Hazardous Materials</div>
        <div>${data.hazardous.map(h => `<span class="hazard-tag">${h}</span>`).join(' ')}</div>
      </div>
    </div>
    <div class="result-row" style="display:block">
      <div class="result-label mb-1">🗑️ Proper Disposal</div>
      <p style="font-size:0.88rem;color:var(--gray)">${data.disposal}</p>
      <div class="tsd-links mt-1">
        <a href="https://www.denr.gov.ph" target="_blank">🔗 DENR Website</a>
        <a href="https://emb.gov.ph/hazardouswaste/" target="_blank">🔗 EMB Hazardous Waste</a>
      </div>
    </div>`;
}

// Put HTML into the result panel (and hide the "Results will appear here" card).
function showPanel(html) {
  const panel = document.getElementById('result-panel');
  document.getElementById('result-placeholder')?.classList.add('hidden');
  panel.innerHTML = html;
  panel.classList.remove('hidden');
  // On a phone the result is below the photo, so bring it into view.
  if (panel.scrollIntoView && window.matchMedia && window.matchMedia('(max-width: 800px)').matches) {
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

// Forget the current result (new photo chosen, or "Retake photo").
function clearResult() {
  lastGuesses = null; pendingHigh = null; mediumRef = null; feedbackRef = null;
  const panel = document.getElementById('result-panel');
  panel.classList.add('hidden');
  panel.innerHTML = '';
  document.getElementById('result-placeholder')?.classList.remove('hidden');
}

// ── Photo is not good enough: say what is wrong, BEFORE scanning ──
// Hard problems (dark, washed out, blank): nothing to identify -> Retake only.
// Soft problems (blurry, small): the user may still choose "Scan anyway".
function renderQualityProblem(quality) {
  const reasons = quality.issues.map(i => escapeHtml(i.message)).join(' ');
  showPanel(`
    ${levelBanner('medium', "Let's try a better photo", reasons, '📷')}
    ${photoTipsHtml()}
    ${quality.blocked ? '' : '<button class="btn btn-ghost btn-full mt-2" data-action="scan-anyway">Scan anyway</button>'}
    ${retakeButtonHtml()}
  `);
}

// ── HIGH: the 3 condition questions (replace the old brightness guess) ──
function conditionFormHtml() {
  return `
    <div class="condition-form">
      <div class="cf-title">🔎 How is it right now?</div>
      <div class="cf-sub">3 quick questions. They decide the usability label and the peso range.</div>
      ${ConditionRules.QUESTIONS.map(q => `
        <fieldset class="q-block">
          <legend class="q-title">${escapeHtml(q.title)}</legend>
          <div class="choices">
            ${q.choices.map(c => `
              <label class="choice">
                <input type="radio" name="q-${q.key}" value="${c.value}">
                <span>${escapeHtml(c.text)}</span>
              </label>`).join('')}
          </div>
        </fieldset>`).join('')}
    </div>
    <div id="condition-result"></div>`;
}

// The user answered (or changed) a question
function onAnswerChange() {
  if (!pendingHigh) return;
  const answers = {};
  ConditionRules.QUESTIONS.forEach(q => {
    const picked = document.querySelector(`input[name="q-${q.key}"]:checked`);
    if (picked) answers[q.key] = picked.value;
  });

  const data      = pendingHigh.data;
  const condition = ConditionRules.decideCondition(answers);   // null until all 3 are answered
  pendingHigh.answers   = answers;
  pendingHigh.condition = condition;

  const resultBox = document.getElementById('condition-result');
  const valueEl   = document.getElementById('scrap-value');
  const saveBtn   = document.getElementById('save-btn');
  const hintEl    = document.getElementById('save-hint');

  if (!condition) {                       // not finished yet
    resultBox.innerHTML = '';
    valueEl.textContent = `₱${data.scrapMin} – ₱${data.scrapMax}`;
    if (saveBtn) saveBtn.disabled = true;
    if (hintEl)  hintEl.classList.remove('hidden');
    return;
  }

  resultBox.innerHTML = `
    <div class="condition-banner ${condition.status}">
      <div class="condition-banner-icon">${condition.icon}</div>
      <div>
        <div class="condition-title">${condition.label}</div>
        <div class="condition-desc">${condition.description}</div>
        <div class="condition-desc mt-1"><strong>Tip:</strong> ${data.usabilityNote}</div>
      </div>
    </div>`;
  const band = ConditionRules.bandFor(condition.status, data.scrapMin, data.scrapMax);
  valueEl.textContent = `₱${band.min} – ₱${band.max}`;
  if (saveBtn) saveBtn.disabled = false;
  if (hintEl)  hintEl.classList.add('hidden');
}

// ── "Was this right?" ──────────────────────────────────────────
function feedbackOptionsHtml() {
  return ['<option value="">What is it?</option>']
    .concat(Object.keys(EWASTE_DATA).map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`))
    .concat(['<option value="Not e-waste">Not e-waste</option>'])
    .join('');
}

function feedbackBoxHtml(kind) {
  if (!feedbackRef || demoMode) return '';
  if (kind === 'low') {
    return `
      <div class="feedback-box" id="feedback-box">
        <div class="fb-title">Do you know what it is? <span class="fb-optional">(optional)</span></div>
        <div class="fb-row">
          <select class="form-input" id="fb-actual" aria-label="What is it?">${feedbackOptionsHtml()}</select>
          <button class="btn btn-ghost btn-sm" data-action="fb-send">Send</button>
        </div>
      </div>`;
  }
  return `
    <div class="feedback-box" id="feedback-box">
      <div class="fb-title">Was this result right?</div>
      <div class="fb-row">
        <button class="btn btn-ghost btn-sm" data-action="fb-yes">👍 Yes</button>
        <button class="btn btn-ghost btn-sm" data-action="fb-no">👎 No</button>
      </div>
      <div class="fb-more hidden" id="fb-more">
        <div class="fb-row">
          <select class="form-input" id="fb-actual" aria-label="What is it really?">${feedbackOptionsHtml()}</select>
          <button class="btn btn-ghost btn-sm" data-action="fb-send">Send</button>
        </div>
      </div>
    </div>`;
}

async function sendFeedback(correct) {
  if (!feedbackRef) return;
  const box    = document.getElementById('feedback-box');
  const actual = document.getElementById('fb-actual')?.value || '';
  const isLow  = box && !box.querySelector('[data-action="fb-yes"]');
  if (isLow && !actual) { showToast('Pick what it is, or just skip this.', 'info'); return; }

  box?.querySelectorAll('button').forEach(b => { b.disabled = true; });
  try {
    const payload = { scan_ref: feedbackRef, correct };
    if (!correct && actual) payload.actual_category = actual;
    const result = await api.sendScanFeedback(payload);
    if (result.error) {
      showToast(result.error, 'error');
      box?.querySelectorAll('button').forEach(b => { b.disabled = false; });
      return;
    }
    feedbackRef = null;
    if (box) box.innerHTML = '<div class="fb-title">🙏 Thanks! This helps us improve the scanner.</div>';
  } catch (e) {
    showToast('Could not send your answer. Please try again.', 'error');
    box?.querySelectorAll('button').forEach(b => { b.disabled = false; });
  }
}

// ── HIGH: the normal result + the 3 condition questions ────────
function renderResult(guesses) {
  const { top1, top2 } = guesses;
  const data = EWASTE_DATA[top1.name] || EWASTE_DATA['Mobile Phone'];
  const pct  = pctOf(top1.confidence);

  // Remember what the Save button will send (the condition answers are filled in by the user)
  pendingHigh = { top1, top2, data, answers: {}, condition: null };

  showPanel(`
    ${levelBanner('high', 'High confidence', "We're sure about this one.")}
    <div class="result-item-name">${data.icon} ${escapeHtml(top1.name)}</div>
    <div class="result-confidence">Confidence: <strong>${pct}%</strong>
      <div class="progress-bar mt-1" style="width:200px">
        <div class="progress-fill" style="width:${pct}%"></div>
      </div>
    </div>

    ${conditionFormHtml()}

    <div class="result-row">
      <span class="result-label">💰 Estimated Scrap Value</span>
      <span class="result-value accent" id="scrap-value">₱${data.scrapMin} – ₱${data.scrapMax}</span>
    </div>
    <div class="result-row">
      <span class="result-label">⭐ Points Earned</span>
      <span class="result-value accent" id="pts-earned">+${data.points} pts (log in to earn)</span>
    </div>
    ${hazardAndDisposalHtml(data)}

    <div class="mt-3" id="save-area">
      ${demoMode
        ? '<div class="alert alert-info">⚡ Demo mode — this scan is not saved and gives no points.</div>'
        : `<button class="btn btn-primary btn-full" id="save-btn" data-action="save" disabled>
             💾 Save Scan & Earn Points
           </button>
           <div class="text-sm mt-1" id="save-hint" style="color:var(--gray)">Answer the 3 questions above to save.</div>`}
    </div>
  `);
}

// ── MEDIUM: "not fully sure" — user picks one of the 2 guesses ──
function renderMedium(guesses) {
  const { top1, top2 } = guesses;
  const d1 = EWASTE_DATA[top1.name] || {};
  const d2 = EWASTE_DATA[top2.name] || {};
  const p1 = pctOf(top1.confidence);
  const p2 = pctOf(top2.confidence);

  showPanel(`
    ${levelBanner('medium', "We're not fully sure about this one.", '')}
    <p class="guess-question">
      <strong>${escapeHtml(top1.name)} (${p1}%)</strong> or
      <strong>${escapeHtml(top2.name)} (${p2}%)</strong>. Which is it?
    </p>
    <div class="guess-buttons">
      <button class="guess-btn" data-action="pick" data-which="top1">
        <span class="guess-icon" aria-hidden="true">${d1.icon || '❔'}</span>
        <span class="guess-name">${escapeHtml(top1.name)}</span>
        <span class="guess-pct">${p1}%</span>
      </button>
      <button class="guess-btn" data-action="pick" data-which="top2">
        <span class="guess-icon" aria-hidden="true">${d2.icon || '❔'}</span>
        <span class="guess-name">${escapeHtml(top2.name)}</span>
        <span class="guess-pct">${p2}%</span>
      </button>
    </div>

    <div class="condition-banner not-checked mt-2">
      <div class="condition-banner-icon">ℹ️</div>
      <div><div class="condition-desc">Condition not checked. Try a clearer photo.</div></div>
    </div>

    ${photoTipsHtml()}
    ${retakeButtonHtml()}
  `);
}

// ── MEDIUM, after the user picked: now show value and points ───
function renderPicked(name, result) {
  const data   = EWASTE_DATA[name] || EWASTE_DATA['Mobile Phone'];
  const scan   = result.scan || {};
  const min    = scan.scrap_value_min != null ? Number(scan.scrap_value_min) : data.scrapMin;
  const max    = scan.scrap_value_max != null ? Number(scan.scrap_value_max) : data.scrapMax;
  const points = result.pointsEarned;
  const note   = result.demo ? '<small style="color:var(--gray)">(demo — nothing saved)</small>'
               : result.isGuest ? '<small style="color:var(--gray)">(log in to earn)</small>' : '✅';

  showPanel(`
    ${levelBanner('medium', 'You picked this one.', "We weren't fully sure, so we used your answer.")}
    <div class="result-item-name">${data.icon} ${escapeHtml(name)}</div>

    <div class="condition-banner not-checked">
      <div class="condition-banner-icon">ℹ️</div>
      <div><div class="condition-desc">Condition not checked. Try a clearer photo.</div></div>
    </div>

    <div class="result-row">
      <span class="result-label">💰 Estimated Scrap Value</span>
      <span class="result-value accent">₱${min} – ₱${max}</span>
    </div>
    <div class="result-row">
      <span class="result-label">⭐ Points Earned</span>
      <span class="result-value accent" id="pts-earned">
        +${points} pts ${note}
      </span>
    </div>
    ${hazardAndDisposalHtml(data)}
    ${retakeButtonHtml()}
  `);
}

// ── LOW: we could not identify it. No category, value, or points ──
function renderLow() {
  showPanel(`
    ${levelBanner('low', "We couldn't identify this item.", '')}
    ${photoTipsHtml()}
    ${retakeButtonHtml()}

    <div class="result-row mt-2" style="display:block">
      <div class="result-label mb-1">🗑️ What to do with it</div>
      <p style="font-size:0.88rem;color:var(--gray)">
        Don't throw electronics in the trash — they can contain harmful materials
        like lead and mercury. Take them to an e-waste collection point, or ask
        the Barangay Hall of Brgy. 49 Youngfield about collection days.
      </p>
      <div class="tsd-links mt-1">
        <a href="https://r8.emb.gov.ph" target="_blank" rel="noopener">📍 EMB Region 8 – Eastern Visayas</a>
        <a href="https://ncr.emb.gov.ph" target="_blank" rel="noopener">📍 EMB NCR – TSD Facilities Directory</a>
      </div>
    </div>
    ${feedbackBoxHtml('low')}
  `);
}

// ── Ask the SERVER for the level, then show the right screen ───
// The browser does NOT decide the level. It only draws what the server says.
async function evaluateAndRender(guesses) {
  const payload = {
    top1_category:   guesses.top1.name,
    top1_confidence: guesses.top1.confidence,
    top2_category:   guesses.top2.name,
    top2_confidence: guesses.top2.confidence,
  };
  if (demoMode) payload.demo = true;       // demo: the server answers but saves nothing

  const verdict = await api.evaluateScan(payload);
  if (verdict.error) throw new Error(verdict.error);

  clearResult();
  lastGuesses = guesses;
  mediumRef   = verdict.level === 'medium' ? (verdict.scan_ref || null) : null;
  feedbackRef = verdict.level === 'low'    ? (verdict.scan_ref || null) : null;

  if (verdict.level === 'high')   return renderResult(guesses);
  if (verdict.level === 'medium') return renderMedium(guesses);
  return renderLow();
}

// ── HIGH: save the scan and earn points ────────────────────────
async function saveScan() {
  if (!pendingHigh || !pendingHigh.condition) return;      // the 3 questions must be answered
  const btn = document.getElementById('save-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }

  try {
    const result = await api.saveScan({
      top1_category:   pendingHigh.top1.name,
      top1_confidence: pendingHigh.top1.confidence,
      top2_category:   pendingHigh.top2.name,
      top2_confidence: pendingHigh.top2.confidence,
      condition:       pendingHigh.answers,        // the server works out the label itself
    });

    if (result.error) {
      showToast(result.error, 'error');
      if (result.level && result.level !== 'high' && lastGuesses) {
        // The admin changed the rules while this page was open: show the right screen.
        await evaluateAndRender(lastGuesses);
      } else if (btn) {
        btn.disabled = false; btn.textContent = '💾 Save Scan & Earn Points';
      }
      return;
    }

    pendingHigh = null;
    document.querySelectorAll('.condition-form input').forEach(i => { i.disabled = true; });
    document.getElementById('save-hint')?.classList.add('hidden');

    // Show exactly the peso range that was saved
    const saved = result.scan || {};
    if (saved.scrap_value_min != null) {
      const valueEl = document.getElementById('scrap-value');
      if (valueEl) valueEl.textContent = `₱${Number(saved.scrap_value_min)} – ₱${Number(saved.scrap_value_max)}`;
    }

    const saveArea = document.getElementById('save-area');
    if (saveArea) {
      saveArea.innerHTML = `<div class="alert alert-success">✅ Scan saved! You earned <strong>${result.pointsEarned} points</strong>. ${result.isGuest ? '<a href="/api/auth/google">Log in</a> to track your points.' : ''}</div>`;
      feedbackRef = result.scan_ref || null;
      saveArea.insertAdjacentHTML('afterend', feedbackBoxHtml('high'));
    }
    // Refresh points display if logged in
    if (result.pointsEarned > 0) {
      const ptsEl = document.getElementById('pts-earned');
      if (ptsEl) ptsEl.innerHTML = `<span style="color:var(--accent)">+${result.pointsEarned} pts ✅</span>`;
      showToast(`+${result.pointsEarned} points earned!`, 'success');
    } else {
      showToast('Scan saved! Log in to earn points.', 'info');
    }
  } catch (e) {
    showToast('Could not save scan. Is the server running?', 'error');
    if (btn) { btn.disabled = false; btn.textContent = '💾 Save Scan & Earn Points'; }
  }
}

// ── MEDIUM: the user tapped one of the two guesses ─────────────
async function pickGuess(which) {
  const guess = lastGuesses && lastGuesses[which];
  if (!guess) return;

  if (demoMode) {          // demo: show the screen, but nothing is saved and no points
    renderPicked(guess.name, { scan: {}, pointsEarned: 0, isGuest: true, demo: true });
    return;
  }
  if (!mediumRef) return;

  const buttons = document.querySelectorAll('.guess-btn');
  buttons.forEach(b => { b.disabled = true; });

  try {
    const result = await api.confirmScan({ scan_ref: mediumRef, chosen_category: guess.name });
    if (result.error) {
      showToast(result.error, 'error');
      buttons.forEach(b => { b.disabled = false; });
      return;
    }
    mediumRef = null;
    renderPicked(guess.name, result);
    if (result.pointsEarned > 0) showToast(`+${result.pointsEarned} points earned!`, 'success');
    else showToast('Thanks! Log in to earn points.', 'info');
  } catch (e) {
    showToast('Could not save your answer. Is the server running?', 'error');
    buttons.forEach(b => { b.disabled = false; });
  }
}

// ── "Retake photo": clear everything so a new photo can be taken ─
function resetScan() {
  currentImage = null;
  clearResult();

  const preview = document.getElementById('preview-img');
  preview.classList.add('hidden');
  preview.removeAttribute('src');
  document.getElementById('scan-box').classList.remove('has-image');
  if (!cameraMode) document.getElementById('scan-placeholder').classList.remove('hidden');

  const fileInput = document.getElementById('file-input');
  if (fileInput) fileInput.value = '';          // so choosing the same file again still works

  const box = document.getElementById('scan-box');
  if (box.scrollIntoView) box.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// One click handler for all buttons inside the result panel
function onResultClick(e) {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  switch (el.dataset.action) {
    case 'pick':        pickGuess(el.dataset.which === 'top2' ? 'top2' : 'top1'); break;
    case 'retake':      resetScan(); break;
    case 'save':        saveScan(); break;
    case 'scan-anyway': runScan({ skipQuality: true }); break;
    case 'fb-yes':      sendFeedback(true); break;
    case 'fb-no':       document.getElementById('fb-more')?.classList.remove('hidden'); break;
    case 'fb-send':     sendFeedback(false); break;
  }
}

// ── Camera handling ────────────────────────────────────────────
async function startCamera() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    const video = document.getElementById('camera-video');
    video.srcObject = stream;
    video.classList.remove('hidden');
    document.getElementById('preview-img').classList.add('hidden');
    document.getElementById('scan-placeholder').classList.add('hidden');
    document.getElementById('camera-scan-btn').classList.remove('hidden');
    document.getElementById('stop-camera-btn').classList.remove('hidden');
    document.getElementById('start-camera-btn').classList.add('hidden');
    cameraMode = true;
  } catch (e) {
    showToast('Camera access denied or unavailable. Use image upload instead.', 'error');
  }
}

function stopCamera() {
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  document.getElementById('camera-video').classList.add('hidden');
  document.getElementById('scan-placeholder').classList.remove('hidden');
  document.getElementById('camera-scan-btn').classList.add('hidden');
  document.getElementById('stop-camera-btn').classList.add('hidden');
  document.getElementById('start-camera-btn').classList.remove('hidden');
  cameraMode = false;
}

function captureFromCamera() {
  const video  = document.getElementById('camera-video');
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth; canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  const img = new Image();
  img.onload = async () => {
    currentImage = img;
    document.getElementById('preview-img').src = canvas.toDataURL();
    document.getElementById('preview-img').classList.remove('hidden');
    stopCamera();
    await runScan();
  };
  img.src = canvas.toDataURL();
}

// ── File upload handling ───────────────────────────────────────
function handleFileUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    const img = new Image();
    img.onload = () => {
      currentImage = img;
      document.getElementById('preview-img').src = ev.target.result;
      document.getElementById('preview-img').classList.remove('hidden');
      document.getElementById('scan-placeholder').classList.add('hidden');
      document.getElementById('scan-box').classList.add('has-image');
      clearResult();
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

// ── Run full scan pipeline ─────────────────────────────────────
async function runScan(options = {}) {
  if (modelFailed) { showToast("The scanner isn't available. Check your internet and refresh the page.", 'error'); return; }
  if (!currentImage) { showToast('Please upload or capture an image first.', 'info'); return; }
  if (!modelLoaded)  { showToast('Model is still loading...', 'info'); return; }

  // 1) Is the photo good enough? (dark / blank / blurry photos never reach the model)
  if (!options.skipQuality) {
    const quality = checkPhotoQuality(currentImage);
    if (!quality.ok) { renderQualityProblem(quality); return; }
  }

  const scanBtn = document.getElementById('scan-btn');
  const origText = scanBtn?.textContent;
  if (scanBtn) { scanBtn.disabled = true; scanBtn.textContent = '🔍 Scanning...'; }

  try {
    const guesses = await classify(currentImage);   // 2) the model (in the browser)
    await evaluateAndRender(guesses);               // 3) the server decides the level
  } catch (e) {
    showToast('We could not check this scan. Please try again.', 'error');
    console.error(e);
  } finally {
    if (scanBtn) { scanBtn.disabled = false; scanBtn.textContent = origText; }
  }
}

// ── Init page ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // Buttons first, so they already react while the model is still loading
  // (runScan then shows "Model is still loading..." instead of doing nothing).
  document.getElementById('file-input')?.addEventListener('change', handleFileUpload);
  document.getElementById('scan-btn')?.addEventListener('click', () => runScan());
  document.getElementById('start-camera-btn')?.addEventListener('click', startCamera);
  document.getElementById('stop-camera-btn')?.addEventListener('click', stopCamera);
  document.getElementById('camera-scan-btn')?.addEventListener('click', captureFromCamera);

  const panel = document.getElementById('result-panel');
  panel?.addEventListener('click', onResultClick);
  // A condition question was answered
  panel?.addEventListener('change', (e) => {
    if (e.target.matches('input[type="radio"][name^="q-"]')) onAnswerChange();
  });

  await initAuth();
  await Promise.all([loadModel(), loadCategoryValues()]);
});
