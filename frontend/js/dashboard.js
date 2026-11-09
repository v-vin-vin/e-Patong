// ── e-Patong Dashboard Logic ───────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  const user = await gatePage();
  if (!user) return;

  renderProfile(user);
  await loadStats(user);
  await loadScanHistory();
});

function renderProfile(user) {
  const avatarEl = document.getElementById('profile-avatar');
  if (avatarEl) {
    if (user.avatar) {
      avatarEl.innerHTML = `<img src="${user.avatar}" alt="${user.name}" class="profile-avatar">`;
    } else {
      avatarEl.innerHTML = `<div class="profile-avatar-fallback">${user.name[0].toUpperCase()}</div>`;
    }
  }
  setText('profile-name',    user.name);
  setText('profile-email',   user.email);
  setText('profile-points',  user.points.toLocaleString());
  setText('profile-scans',   user.total_scans.toLocaleString());

  // Member since
  const since = document.getElementById('member-since');
  if (since) since.textContent = `Member since ${formatDate(user.created_at)}`;
}

async function loadStats(user) {
  // Stat cards
  setText('stat-points', user.points.toLocaleString());
  setText('stat-scans',  user.total_scans.toLocaleString());

  try {
    const vData = await api.getVouchers();
    const vouchers = vData.vouchers || [];
    setText('stat-vouchers', vouchers.length.toLocaleString());

    // Next reward progress
    const catalog = await api.getCatalog();
    const items   = (catalog.items || []).filter(i => i.points_required > user.points);
    if (items.length > 0) {
      const next = items[0];
      const pct  = Math.min(100, Math.round((user.points / next.points_required) * 100));
      const progressEl = document.getElementById('next-reward-progress');
      if (progressEl) {
        progressEl.innerHTML = `
          <div class="flex justify-between text-sm mb-1">
            <span style="color:var(--gray)">Next: <strong style="color:var(--white)">${next.name}</strong></span>
            <span style="color:var(--accent)">${user.points} / ${next.points_required} pts</span>
          </div>
          <div class="progress-bar">
            <div class="progress-fill" style="width:${pct}%"></div>
          </div>
          <p class="text-sm mt-1" style="color:var(--gray)">
            ${next.points_required - user.points} more points needed
          </p>
        `;
      }
    } else {
      const progressEl = document.getElementById('next-reward-progress');
      if (progressEl) progressEl.innerHTML = `<div class="alert alert-success">🎉 You can redeem all rewards!</div>`;
    }
  } catch (e) { /* non-critical */ }
}

async function loadScanHistory() {
  const container = document.getElementById('scan-history');
  if (!container) return;

  container.innerHTML = `<div class="loading-overlay"><div class="spinner"></div><p>Loading history...</p></div>`;

  try {
    const data  = await api.getScanHistory();
    const scans = data.scans || [];

    if (scans.length === 0) {
      container.innerHTML = `
        <div class="loading-overlay">
          <div style="font-size:3rem">📭</div>
          <p>No scans yet. <a href="/pages/scan.html">Scan your first e-waste!</a></p>
        </div>`;
      return;
    }

    container.innerHTML = `
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th>Condition</th>
              <th>Scrap Value</th>
              <th>Points</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            ${scans.map(s => `
              <tr>
                <td><strong style="color:var(--white)">${s.item_name}</strong></td>
                <td>${conditionBadge(s.condition_status, s.condition_label)}</td>
                <td style="color:var(--accent)">₱${s.scrap_value_min}–₱${s.scrap_value_max}</td>
                <td><span style="color:var(--accent);font-weight:700">+${s.points_earned}</span></td>
                <td style="color:var(--gray)">${formatDateTime(s.created_at)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>`;
  } catch (e) {
    container.innerHTML = `<div class="alert alert-error">Failed to load scan history.</div>`;
  }
}

function conditionBadge(status, label) {
  const map = { usable: 'badge-green', for_parts: 'badge-orange', for_disposal: 'badge-red' };
  return `<span class="badge ${map[status] || 'badge-gray'}">${label}</span>`;
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}
