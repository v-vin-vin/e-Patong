// ── e-Patong Catalog Logic ─────────────────────────────────────

let userPoints  = 0;
let catalogItems = [];

document.addEventListener('DOMContentLoaded', async () => {
  const user = await gatePage();
  if (!user) return;

  userPoints = user.points;
  updatePointsDisplay(userPoints);

  await loadCatalog();
  await loadVouchers();
});

function updatePointsDisplay(pts) {
  document.querySelectorAll('.user-points-display').forEach(el => {
    el.textContent = pts.toLocaleString();
  });
}

// ── Load Redemption Catalog ────────────────────────────────────
async function loadCatalog() {
  const container = document.getElementById('catalog-grid');
  if (!container) return;

  container.innerHTML = `<div class="loading-overlay" style="grid-column:1/-1"><div class="spinner"></div><p>Loading rewards...</p></div>`;

  try {
    const data = await api.getCatalog();
    catalogItems = data.items || [];

    if (catalogItems.length === 0) {
      container.innerHTML = `<p class="text-gray" style="grid-column:1/-1">No rewards available at the moment.</p>`;
      return;
    }

    container.innerHTML = catalogItems.map(item => {
      const canAfford = userPoints >= item.points_required;
      return `
        <div class="reward-card ${canAfford ? '' : 'cannot-afford'}" id="reward-${item.id}">
          <div class="reward-emoji">${item.emoji || '🎁'}</div>
          <div>
            <div class="reward-name">${item.name}</div>
            <div class="reward-desc">${item.description}</div>
          </div>
          <div class="reward-cost">
            ⭐ ${item.points_required.toLocaleString()} <span>points</span>
          </div>
          ${item.stock === 0
            ? `<div class="badge badge-red">Out of Stock</div>`
            : canAfford
              ? `<button class="btn btn-primary btn-sm" onclick="confirmRedeem(${item.id}, '${item.name.replace(/'/g,"\\'")}', ${item.points_required})">
                   Redeem →
                 </button>`
              : `<div class="text-sm" style="color:var(--gray)">Need ${(item.points_required - userPoints).toLocaleString()} more pts</div>`
          }
        </div>`;
    }).join('');

  } catch (e) {
    container.innerHTML = `<div class="alert alert-error" style="grid-column:1/-1">Failed to load catalog.</div>`;
  }
}

// ── Confirm Redeem Modal ───────────────────────────────────────
function confirmRedeem(itemId, itemName, pointsCost) {
  const modal = document.getElementById('confirm-modal');
  document.getElementById('confirm-item-name').textContent  = itemName;
  document.getElementById('confirm-item-cost').textContent  = pointsCost.toLocaleString();
  document.getElementById('confirm-balance-after').textContent = (userPoints - pointsCost).toLocaleString();

  document.getElementById('confirm-redeem-btn').onclick = () => {
    closeModal();
    redeemItem(itemId);
  };
  modal.classList.remove('hidden');
}

function closeModal() {
  document.getElementById('confirm-modal').classList.add('hidden');
}

// ── Execute Redemption ─────────────────────────────────────────
async function redeemItem(itemId) {
  const btn = document.querySelector(`#reward-${itemId} .btn`);
  if (btn) { btn.disabled = true; btn.textContent = 'Redeeming...'; }

  try {
    const result = await api.redeemReward(itemId);
    if (result.error) { showToast(result.error, 'error'); if (btn) { btn.disabled = false; btn.textContent = 'Redeem →'; } return; }

    userPoints = result.remaining_points;
    updatePointsDisplay(userPoints);

    showToast(`🎉 Redeemed! Your voucher code: ${result.voucher.code}`, 'success', 6000);

    // Refresh catalog and vouchers
    await loadCatalog();
    await loadVouchers();

    // Scroll to vouchers
    document.getElementById('vouchers-section')?.scrollIntoView({ behavior: 'smooth' });

  } catch (e) {
    showToast('Redemption failed. Please try again.', 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Redeem →'; }
  }
}

// ── Load User Vouchers ─────────────────────────────────────────
async function loadVouchers() {
  const container = document.getElementById('vouchers-list');
  if (!container) return;

  try {
    const data     = await api.getVouchers();
    const vouchers = data.vouchers || [];

    document.getElementById('voucher-count').textContent = vouchers.length;

    if (vouchers.length === 0) {
      container.innerHTML = `
        <div class="loading-overlay">
          <div style="font-size:2.5rem">🎟️</div>
          <p style="color:var(--gray)">No vouchers yet. Redeem your points above!</p>
        </div>`;
      return;
    }

    container.innerHTML = vouchers.map(v => `
      <div class="voucher-card">
        <div class="voucher-emoji">${v.emoji || '🎁'}</div>
        <div style="flex:1">
          <div style="font-weight:600;color:var(--white)">${v.item_name}</div>
          <div class="voucher-code">${v.code}</div>
          <div class="voucher-meta">
            Redeemed ${formatDate(v.created_at)}
            ${v.expires_at ? ` · Expires ${formatDate(v.expires_at)}` : ''}
          </div>
        </div>
        <div>
          ${statusBadge(v.status)}
          <button class="btn btn-ghost btn-sm mt-1" onclick="copyCode('${v.code}')">Copy</button>
        </div>
      </div>`
    ).join('');

  } catch (e) {
    container.innerHTML = `<div class="alert alert-error">Failed to load vouchers.</div>`;
  }
}

function statusBadge(status) {
  const map = { unused: ['badge-green','Unused'], used: ['badge-gray','Used'], expired: ['badge-red','Expired'] };
  const [cls, label] = map[status] || ['badge-gray', status];
  return `<span class="badge ${cls}">${label}</span>`;
}

async function copyCode(code) {
  try {
    await navigator.clipboard.writeText(code);
    showToast(`Copied: ${code}`, 'success', 2500);
  } catch {
    showToast(`Code: ${code}`, 'info', 4000);
  }
}
