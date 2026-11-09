// ============================================================
// e-Patong — Admin Panel (browser code)
//
// Uses helpers you already have:
//   api.js  -> fetchWithTimeout, showToast, formatDate, formatDateTime
//   auth.js -> initAuth, currentUser
//
// IMPORTANT: the REAL lock is on the server (server.js + routes/admin.js).
// The checks in this file only make the page friendlier.
//
// SAFETY NOTE: names, emails and item names come from users, so they
// must NEVER go into the page as raw HTML. Every piece of data goes
// through esc() below. Buttons use data-action attributes instead of
// onclick="..." with text inside, for the same reason.
// ============================================================

const $ = (id) => document.getElementById(id);

// ── Small helpers ──────────────────────────────────────────────
// Turns < > & " ' into harmless text so data can't become HTML.
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}
const num  = (n) => Number(n || 0).toLocaleString('en-PH');
const peso = (n) => '₱' + Number(n || 0).toLocaleString('en-PH', { maximumFractionDigits: 2 });
const badge = (color, text) => `<span class="badge badge-${color}">${esc(text)}</span>`;

const loadingHtml = () => `<div class="loading-overlay" style="grid-column:1/-1"><div class="spinner"></div><p>Loading…</p></div>`;
const emptyHtml   = (msg) => `<div class="loading-overlay" style="grid-column:1/-1"><div style="font-size:2.5rem">📭</div><p>${esc(msg)}</p></div>`;
const errorHtml   = (msg) => `<div class="alert alert-error" style="grid-column:1/-1">${esc(msg)}</div>`;

// ── Talking to the server ──────────────────────────────────────
// Every admin request goes through here.
// Changes (POST/PUT/PATCH) are always sent as JSON.
async function adminApi(path, { method = 'GET', body } = {}) {
  const options = { method, credentials: 'include', headers: {} };
  if (method !== 'GET') {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body || {});
  }
  const res = await fetchWithTimeout(`/api/admin${path}`, options);

  let data = {};
  try { data = await res.json(); } catch (e) { /* no JSON body */ }

  if (res.status === 401) {                 // session ended -> go to login
    window.location.href = '/api/auth/google';
    throw new Error('Please sign in again.');
  }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status}).`);
  return data;
}

// ============================================================
// Tabs
// ============================================================
const loaders = {
  overview:   () => loadOverview(),
  rewards:    () => loadRewards(),
  categories: () => loadCategories(),
  vouchers:   () => $('voucher-code').focus(),
  users:      () => loadList('users'),
  scans:      () => loadList('scans'),
  reviews:    () => loadList('reviews'),
  confidence: () => loadSettings(),
  accuracy:   () => loadAccuracy(),
  logs:       () => loadList('logs'),
};

function showTab(name) {
  document.querySelectorAll('.admin-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.admin-panel').forEach((p) => p.classList.toggle('hidden', p.id !== `panel-${name}`));
  loaders[name]();
}

// ============================================================
// 1) Overview (totals)
// ============================================================
function statCard(icon, title, value, sub) {
  return `
    <div class="card">
      <div class="card-sub">${icon} ${esc(title)}</div>
      <div class="card-value">${num(value)}</div>
      <div class="card-sub">${esc(sub)}</div>
    </div>`;
}

async function loadOverview() {
  const grid = $('stats-grid');
  grid.innerHTML = loadingHtml();
  try {
    const s = await adminApi('/stats');
    grid.innerHTML = [
      statCard('👥', 'Users',        s.users,       'registered accounts'),
      statCard('📷', 'Scans',        s.scans,       `${num(s.guestScans)} by guests`),
      statCard('🎟️', 'Vouchers',     s.vouchers,    `${num(s.vouchersUsed)} used`),
      statCard('⭐', 'Points given', s.pointsGiven, 'earned from scans'),
    ].join('');
  } catch (e) {
    grid.innerHTML = errorHtml(e.message);
  }
}

// ============================================================
// 2) Rewards (add / edit / turn on-off)
// ============================================================
const rewardsById = new Map();
let editingRewardId = null;   // null = adding a new reward

async function loadRewards() {
  const box = $('rewards-table');
  box.innerHTML = loadingHtml();
  try {
    const { rewards } = await adminApi('/rewards');
    rewardsById.clear();
    rewards.forEach((r) => rewardsById.set(Number(r.id), r));

    if (!rewards.length) { box.innerHTML = emptyHtml('No rewards yet. Add the first one!'); return; }

    box.innerHTML = `
      <div class="table-wrapper"><table>
        <thead><tr><th>Reward</th><th>Type</th><th>Points</th><th>Stock</th><th>Status</th><th></th></tr></thead>
        <tbody>
          ${rewards.map((r) => `
            <tr>
              <td>${esc(r.emoji)} <strong style="color:var(--white)">${esc(r.name)}</strong>
                  <div class="text-sm cell-muted">${esc(r.description)}</div></td>
              <td>${esc(r.reward_type)}${r.reward_value ? ' · ' + esc(r.reward_value) : ''}</td>
              <td>⭐ ${num(r.points_required)}</td>
              <td>${r.stock === -1 ? 'Unlimited' : num(r.stock)}</td>
              <td>${r.is_active ? badge('green', 'On') : badge('gray', 'Off')}</td>
              <td class="actions">
                <button class="btn btn-ghost btn-sm" data-action="edit-reward" data-id="${Number(r.id)}">Edit</button>
                <button class="btn ${r.is_active ? 'btn-red' : 'btn-primary'} btn-sm"
                        data-action="toggle-reward" data-id="${Number(r.id)}"
                        data-on="${r.is_active ? '0' : '1'}">${r.is_active ? 'Turn off' : 'Turn on'}</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table></div>`;
  } catch (e) {
    box.innerHTML = errorHtml(e.message);
  }
}

function openRewardModal(reward) {
  editingRewardId = reward ? Number(reward.id) : null;
  $('reward-modal-title').textContent = reward ? 'Edit reward' : 'Add reward';
  $('rw-error').classList.add('hidden');

  $('rw-name').value   = reward ? reward.name : '';
  $('rw-desc').value   = reward ? reward.description : '';
  $('rw-emoji').value  = reward ? reward.emoji : '🎁';
  $('rw-type').value   = reward ? reward.reward_type : 'gcash';
  $('rw-value').value  = reward ? (reward.reward_value || '') : '';
  $('rw-points').value = reward ? reward.points_required : '';

  const unlimited = reward ? reward.stock === -1 : true;
  $('rw-unlimited').checked = unlimited;
  $('rw-stock').value       = unlimited ? '' : reward.stock;
  $('rw-stock').disabled    = unlimited;

  $('reward-modal').classList.remove('hidden');
  $('rw-name').focus();
}

function closeRewardModal() {
  $('reward-modal').classList.add('hidden');
}

async function saveReward() {
  const body = {
    name:            $('rw-name').value,
    description:     $('rw-desc').value,
    emoji:           $('rw-emoji').value,
    reward_type:     $('rw-type').value,
    reward_value:    $('rw-value').value,
    points_required: $('rw-points').value,
    stock:           $('rw-unlimited').checked ? -1 : $('rw-stock').value,
  };

  const btn = $('rw-save');
  btn.disabled = true;
  $('rw-error').classList.add('hidden');
  try {
    if (editingRewardId) {
      await adminApi(`/rewards/${editingRewardId}`, { method: 'PUT', body });
    } else {
      await adminApi('/rewards', { method: 'POST', body });
    }
    closeRewardModal();
    showToast(editingRewardId ? 'Reward updated.' : 'Reward added.', 'success');
    loadRewards();
  } catch (e) {
    $('rw-error').textContent = e.message;       // textContent = safe
    $('rw-error').classList.remove('hidden');
  } finally {
    btn.disabled = false;
  }
}

async function toggleReward(id, turnOn) {
  const reward = rewardsById.get(id);
  if (!turnOn && !confirm(`Turn off "${reward ? reward.name : 'this reward'}"?\n\nUsers will no longer see it in the catalog.`)) return;
  try {
    await adminApi(`/rewards/${id}/active`, { method: 'PATCH', body: { is_active: turnOn } });
    showToast(turnOn ? 'Reward turned on.' : 'Reward turned off.', 'success');
    loadRewards();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

// ============================================================
// 3) E-waste values (peso range + points per category)
// ============================================================
async function loadCategories() {
  const box = $('categories-table');
  box.innerHTML = loadingHtml();
  try {
    const { categories } = await adminApi('/categories');
    if (!categories.length) { box.innerHTML = emptyHtml('No categories found. Run migration 003 first.'); return; }

    box.innerHTML = `
      <div class="table-wrapper"><table>
        <thead><tr><th>Category</th><th>Lowest ₱</th><th>Highest ₱</th><th>Points</th><th>Last changed</th><th></th></tr></thead>
        <tbody>
          ${categories.map((c) => `
            <tr data-category-id="${Number(c.id)}">
              <td><strong style="color:var(--white)">${esc(c.item_name)}</strong></td>
              <td><input class="form-input cell-input" type="number" min="0" step="0.01" inputmode="decimal"
                         data-field="scrap_value_min" value="${Number(c.scrap_value_min)}" aria-label="Lowest peso value"></td>
              <td><input class="form-input cell-input" type="number" min="0" step="0.01" inputmode="decimal"
                         data-field="scrap_value_max" value="${Number(c.scrap_value_max)}" aria-label="Highest peso value"></td>
              <td><input class="form-input cell-input" type="number" min="0" step="1" inputmode="numeric"
                         data-field="points" value="${Number(c.points)}" aria-label="Points"></td>
              <td class="cell-muted" data-field="updated">${c.updated_at ? esc(formatDateTime(c.updated_at)) : '—'}</td>
              <td class="actions"><button class="btn btn-primary btn-sm" data-action="save-category" data-id="${Number(c.id)}">Save</button></td>
            </tr>`).join('')}
        </tbody>
      </table></div>`;
  } catch (e) {
    box.innerHTML = errorHtml(e.message);
  }
}

async function saveCategory(id, btn) {
  const row  = btn.closest('tr');
  const read = (field) => row.querySelector(`[data-field="${field}"]`);
  const body = {
    scrap_value_min: read('scrap_value_min').value,
    scrap_value_max: read('scrap_value_max').value,
    points:          read('points').value,
  };

  btn.disabled = true;
  try {
    const { category } = await adminApi(`/categories/${id}`, { method: 'PUT', body });
    // Show exactly what the server saved
    read('scrap_value_min').value = Number(category.scrap_value_min);
    read('scrap_value_max').value = Number(category.scrap_value_max);
    read('points').value          = Number(category.points);
    read('updated').textContent   = formatDateTime(category.updated_at);
    showToast(`${category.item_name} saved.`, 'success');
  } catch (e) {
    showToast(e.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

// ============================================================
// 4) Vouchers (check + mark as used)
// ============================================================
let currentVoucher = null;

async function checkVoucher(code) {
  const box = $('voucher-result');
  box.innerHTML = loadingHtml();
  currentVoucher = null;
  try {
    const { voucher } = await adminApi(`/vouchers/lookup?code=${encodeURIComponent(code)}`);
    currentVoucher = voucher;
    renderVoucher(voucher);
  } catch (e) {
    box.innerHTML = errorHtml(e.message);
  }
}

function renderVoucher(v) {
  const status = v.effective_status;                       // unused | used | expired
  const color  = { unused: 'green', used: 'gray', expired: 'red' }[status] || 'gray';
  const label  = { unused: 'Unused', used: 'Used', expired: 'Expired' }[status] || status;

  let action = '';
  if (status === 'unused') {
    action = `<button class="btn btn-primary" id="use-voucher-btn" data-action="use-voucher" data-id="${Number(v.id)}">✅ Mark as used</button>`;
  } else if (status === 'used') {
    action = `<div class="alert alert-info">This code was already used. It can never be used again.</div>`;
  } else {
    action = `<div class="alert alert-error">This code is expired and cannot be used.</div>`;
  }

  $('voucher-result').innerHTML = `
    <div class="card voucher-result">
      <div class="flex justify-between items-center" style="flex-wrap:wrap;gap:.75rem">
        <div>
          <div class="voucher-code">${esc(v.code)}</div>
          <div class="voucher-meta">${esc(v.emoji)} ${esc(v.item_name)}${v.reward_value ? ' · ' + esc(v.reward_value) : ''}</div>
        </div>
        ${badge(color, label)}
      </div>
      <dl class="voucher-facts">
        <div><dt>Redeemed by</dt><dd>${esc(v.user_name)}<br><span class="cell-muted">${esc(v.user_email)}</span></dd></div>
        <div><dt>Created</dt><dd>${v.created_at ? esc(formatDateTime(v.created_at)) : '—'}</dd></div>
        <div><dt>Expires</dt><dd>${v.expires_at ? esc(formatDateTime(v.expires_at)) : 'Never'}</dd></div>
        <div><dt>Marked used</dt><dd>${v.redeemed_at ? esc(formatDateTime(v.redeemed_at)) : '—'}</dd></div>
      </dl>
      ${action}
    </div>`;
}

async function markVoucherUsed(id, btn) {
  if (!currentVoucher) return;
  if (!confirm(`Mark ${currentVoucher.code} as USED?\n\nThis cannot be undone.`)) return;

  btn.disabled = true;
  try {
    const { voucher } = await adminApi(`/vouchers/${id}/use`, { method: 'POST' });
    currentVoucher = voucher;
    renderVoucher(voucher);
    showToast('Voucher marked as used.', 'success');
  } catch (e) {
    showToast(e.message, 'error');
    checkVoucher(currentVoucher.code);          // refresh: someone else may have used it
  }
}

// ============================================================
// 5) View-only lists: users, scans, activity log
// ============================================================
const conditionColor = { usable: 'green', for_parts: 'orange', for_disposal: 'red' };
const actionLabels = {
  reward_created:      'Added reward',
  reward_edited:       'Edited reward',
  reward_turned_on:    'Turned reward on',
  reward_turned_off:   'Turned reward off',
  category_edited:     'Changed e-waste values',
  voucher_marked_used: 'Marked voucher used',
  settings_changed:    'Changed confidence cutoffs',
};

const listConfig = {
  users: {
    url: '/users', box: 'users-table', pager: 'users-pager',
    render: (rows) => tableHtml(
      ['Name', 'Email', 'Role', 'Points', 'Scans', 'Joined'],
      rows.map((u) => [
        `<strong style="color:var(--white)">${esc(u.name)}</strong>`,
        esc(u.email),
        u.role === 'admin' ? badge('green', 'admin') : badge('gray', 'user'),
        '⭐ ' + num(u.points),
        num(u.total_scans),
        esc(formatDate(u.created_at)),
      ])
    ),
  },
  scans: {
    url: '/scans', box: 'scans-table', pager: 'scans-pager',
    render: (rows) => tableHtml(
      ['Date', 'User', 'Item', 'Condition', 'Peso value', 'Points'],
      rows.map((s) => [
        esc(formatDateTime(s.created_at)),
        s.user_name
          ? `${esc(s.user_name)}<div class="text-sm cell-muted">${esc(s.user_email)}</div>`
          : '<span class="cell-muted">Guest</span>',
        `<strong style="color:var(--white)">${esc(s.item_name)}</strong>`,
        badge(conditionColor[s.condition_status] || 'gray', s.condition_label || 'Not checked'),
        `${peso(s.scrap_value_min)} – ${peso(s.scrap_value_max)}`,
        '+' + num(s.points_earned),
      ])
    ),
  },
  reviews: {
    url: '/scan-reviews', box: 'reviews-table', pager: 'reviews-pager',
    render: (rows) => tableHtml(
      ['Date', 'Level', '1st guess', '2nd guess', 'User picked'],
      rows.map((r) => [
        esc(formatDateTime(r.created_at)),
        r.confidence_level === 'medium' ? badge('orange', '⚠️ Medium') : badge('red', '❌ Low'),
        guessCell(r.top1_category, r.top1_confidence),
        guessCell(r.top2_category, r.top2_confidence),
        pickedCell(r),
      ])
    ),
    after: (data) => {
      const s = data.summary || {};
      $('reviews-summary').innerHTML = [
        `⚠️ Medium: <strong>${num(s.medium)}</strong>`,
        `❌ Low: <strong>${num(s.low)}</strong>`,
        `Medium scans where the user picked: <strong>${num(s.mediumPicked)}</strong>`,
        `Picked the 2nd guess (model's 1st guess was wrong): <strong>${num(s.pickedSecond)}</strong>`,
      ].map((t) => `<span class="review-chip">${t}</span>`).join('');
    },
  },
  logs: {
    url: '/logs', box: 'logs-table', pager: 'logs-pager',
    render: (rows) => tableHtml(
      ['When', 'Admin', 'Action', 'Details'],
      rows.map((l) => [
        esc(formatDateTime(l.created_at)),
        esc(l.admin_name || '(removed user)'),
        badge('green', actionLabels[l.action] || l.action),
        esc(l.details),
      ])
    ),
  },
};
const listState = {
  users:   { q: '', page: 1 },
  scans:   { q: '', page: 1 },
  reviews: { q: '', page: 1, level: '' },
  logs:    { q: '', page: 1 },
};

// "Laptop 62%" — whole percent, rounded DOWN (same as the scan page)
function guessCell(name, confidence) {
  const pct = Math.floor(Math.round(Number(confidence) * 10000) / 100);
  return `<strong style="color:var(--white)">${esc(name)}</strong> <span class="cell-muted">${num(pct)}%</span>`;
}
function pickedCell(r) {
  if (r.confidence_level === 'low') {
    return r.actual_category ? `User says: ${esc(r.actual_category)}` : '<span class="cell-muted">—</span>';
  }
  if (r.confidence_level !== 'medium') return '<span class="cell-muted">—</span>';
  if (!r.user_confirmed)               return '<span class="cell-muted">Did not pick</span>';
  const first = r.final_category === r.top1_category;
  return `${esc(r.final_category)} ${first ? badge('green', '1st guess') : badge('orange', '2nd guess')}`;
}

// cells are ALREADY escaped by the caller
function tableHtml(headings, rows) {
  return `
    <div class="table-wrapper"><table>
      <thead><tr>${headings.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((cells) => `<tr>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody>
    </table></div>`;
}

async function loadList(kind) {
  const cfg = listConfig[kind];
  const st  = listState[kind];
  const box = $(cfg.box);
  box.innerHTML = loadingHtml();
  try {
    const params = new URLSearchParams({ page: st.page });
    if (st.q) params.set('q', st.q);
    if (st.level) params.set('level', st.level);
    const data = await adminApi(`${cfg.url}?${params}`);
    if (cfg.after) cfg.after(data);

    box.innerHTML = data.rows.length
      ? cfg.render(data.rows)
      : emptyHtml(st.q ? 'Nothing matches your search.' : 'Nothing here yet.');

    const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
    $(cfg.pager).innerHTML = `
      <button class="btn btn-ghost btn-sm" data-action="page" data-kind="${kind}" data-page="${data.page - 1}" ${data.page <= 1 ? 'disabled' : ''}>← Prev</button>
      <span>Page ${num(data.page)} of ${num(pages)} · ${num(data.total)} total</span>
      <button class="btn btn-ghost btn-sm" data-action="page" data-kind="${kind}" data-page="${data.page + 1}" ${data.page >= pages ? 'disabled' : ''}>Next →</button>`;
  } catch (e) {
    box.innerHTML = errorHtml(e.message);
    $(cfg.pager).innerHTML = '';
  }
}

// ============================================================
// 6) Confidence cutoffs (LOW / HIGH)
// The page shows PERCENT (60) — the server stores 0–1 (0.60).
// ============================================================
const toPercent = (decimal) => Math.round(Number(decimal) * 10000) / 100;
const toDecimal = (percent) => Number((Number(percent) / 100).toFixed(4));

function updateCutPreview() {
  const low  = $('cut-low').value.trim();
  const high = $('cut-high').value.trim();
  if (low === '' || high === '') { $('cut-preview').innerHTML = ''; return; }
  $('cut-preview').innerHTML = `
    <div>❌ <strong>LOW</strong>: below ${esc(low)}%</div>
    <div>⚠️ <strong>MEDIUM</strong>: ${esc(low)}% up to just under ${esc(high)}%</div>
    <div>✅ <strong>HIGH</strong>: ${esc(high)}% or more</div>`;
}

async function loadSettings() {
  $('cut-error').classList.add('hidden');
  try {
    const s = await adminApi('/settings');
    $('cut-low').value  = toPercent(s.low_cutoff);
    $('cut-high').value = toPercent(s.high_cutoff);
    $('cut-updated').textContent = s.updated_at ? `Last changed: ${formatDateTime(s.updated_at)}` : '';
    updateCutPreview();
  } catch (e) {
    $('cut-error').textContent = e.message;
    $('cut-error').classList.remove('hidden');
  }
}

async function saveCutoffs() {
  const lowText  = $('cut-low').value.trim();
  const highText = $('cut-high').value.trim();
  const btn = $('cut-save');
  $('cut-error').classList.add('hidden');

  // Friendly checks here; the SERVER checks again and is the real judge.
  if (lowText === '' || highText === '') { return showCutError('Please fill in both cutoffs.'); }

  btn.disabled = true;
  try {
    await adminApi('/settings', {
      method: 'PUT',
      body: { low_cutoff: toDecimal(lowText), high_cutoff: toDecimal(highText) },
    });
    showToast('Cutoffs saved.', 'success');
    loadSettings();
  } catch (e) {
    showCutError(e.message);
  } finally {
    btn.disabled = false;
  }
}

function showCutError(message) {
  $('cut-error').textContent = message;          // textContent = safe
  $('cut-error').classList.remove('hidden');
}

// ============================================================
// 7) Accuracy (from "Was this right?" and MEDIUM picks)
// ============================================================
const pctText = (x) => (x === null || x === undefined ? '—' : `${Math.round(x * 100)}%`);

async function loadAccuracy() {
  const cards = $('accuracy-cards');
  cards.innerHTML = loadingHtml();
  try {
    const a = await adminApi('/accuracy');
    const h = a.high, m = a.medium;
    cards.innerHTML = [
      statCard('✅', 'Rated HIGH scans', h.rated, `of ${num(h.saved)} saved HIGH scans`),
      `<div class="card"><div class="card-sub">👍 Said "right"</div><div class="card-value">${esc(pctText(h.accuracy))}</div><div class="card-sub">${num(h.right)} right · ${num(h.wrong)} wrong</div></div>`,
      `<div class="card"><div class="card-sub">⚠️ MEDIUM: 1st guess right</div><div class="card-value">${esc(pctText(m.firstRate))}</div><div class="card-sub">${num(m.first)} of ${num(m.picked)} picks</div></div>`,
      statCard('🚫', 'HIGH but not e-waste', h.notEwaste, 'users said it was not e-waste'),
    ].join('');

    $('accuracy-by-category').innerHTML = a.byCategory.length
      ? tableHtml(['Model said', 'Right', 'Wrong', 'Accuracy'],
          a.byCategory.map((r) => [`<strong style="color:var(--white)">${esc(r.category)}</strong>`, num(r.right), num(r.wrong), esc(pctText(r.accuracy))]))
      : emptyHtml('No ratings yet.');

    $('accuracy-confusions').innerHTML = a.confusions.length
      ? tableHtml(['Model said', 'Users say it was', 'Times'],
          a.confusions.map((r) => [esc(r.said), esc(r.actually), num(r.n)]))
      : emptyHtml('No mix-ups reported yet.');

    $('accuracy-low').innerHTML = a.low.list.length
      ? `<p class="text-sm mb-1">${num(a.low.named)} of ${num(a.low.total)} LOW scans were named by the user.</p>` +
        tableHtml(['Users say it was', 'Times'], a.low.list.map((r) => [esc(r.actually), num(r.n)]))
      : emptyHtml(`${num(a.low.total)} LOW scans so far. None named by users yet.`);
  } catch (e) {
    cards.innerHTML = errorHtml(e.message);
  }
}

// ============================================================
// Start-up + button clicks
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
  const user = await initAuth();            // draws the navbar + Admin link
  $('auth-loading').classList.add('hidden');

  // Friendly check only. The server already blocks non-admins.
  if (!user || user.role !== 'admin') {
    $('admin-denied').classList.remove('hidden');
    return;
  }
  $('admin-content').classList.remove('hidden');

  // Tabs
  $('admin-tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('[data-tab]');
    if (tab) showTab(tab.dataset.tab);
  });

  // All buttons marked with data-action
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const id = Number(el.dataset.id);

    switch (el.dataset.action) {
      case 'add-reward':    openRewardModal(null); break;
      case 'edit-reward':   openRewardModal(rewardsById.get(id)); break;
      case 'toggle-reward': toggleReward(id, el.dataset.on === '1'); break;
      case 'close-reward':  closeRewardModal(); break;
      case 'save-reward':   saveReward(); break;
      case 'save-category': saveCategory(id, el); break;
      case 'use-voucher':   markVoucherUsed(id, el); break;
      case 'save-cutoffs':  saveCutoffs(); break;
      case 'page': {
        const kind = el.dataset.kind;
        if (listState[kind]) {
          listState[kind].page = Math.max(1, Number(el.dataset.page) || 1);
          loadList(kind);
        }
        break;
      }
    }
  });

  // "Unlimited stock" checkbox
  $('rw-unlimited').addEventListener('change', (e) => {
    $('rw-stock').disabled = e.target.checked;
    if (e.target.checked) $('rw-stock').value = '';
  });

  // Esc closes the reward window
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeRewardModal();
  });

  // Confidence page: live preview while typing
  ['cut-low', 'cut-high'].forEach((id) => $(id).addEventListener('input', updateCutPreview));

  // Review page: filter by level
  $('reviews-level').addEventListener('change', (e) => {
    listState.reviews.level = e.target.value;
    listState.reviews.page  = 1;
    loadList('reviews');
  });

  // Voucher form
  $('voucher-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const code = $('voucher-code').value.trim().toUpperCase();
    if (!code) { showToast('Type a voucher code first.', 'info'); return; }
    checkVoucher(code);
  });

  // Search forms
  ['users', 'scans'].forEach((kind) => {
    $(`${kind}-search`).addEventListener('submit', (e) => {
      e.preventDefault();
      listState[kind].q    = e.target.querySelector('input').value.trim();
      listState[kind].page = 1;
      loadList(kind);
    });
  });

  showTab('overview');
});
