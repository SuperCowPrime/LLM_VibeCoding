// ── Dive Log ──────────────────────────────────────────────────────────────────

let activeDiveLogProfileFilter = '';

function diveLogKey() {
  return 'diveLog_' + (getCurrentUser() || 'guest');
}

function getDiveLog() {
  return JSON.parse(localStorage.getItem(diveLogKey()) || '[]');
}

function saveDiveLog(log) {
  localStorage.setItem(diveLogKey(), JSON.stringify(log));
}

function initDiveLog() {
  activeDiveLogProfileFilter = '';
  updateDiveLogProfileSelects();
  renderDiveLog();
  // Default date to today if not set
  const dateInput = document.getElementById('dive-date');
  if (dateInput && !dateInput.value) {
    dateInput.value = new Date().toISOString().split('T')[0];
  }
}

function updateDiveLogProfileSelects() {
  const profiles = (typeof getProfiles === 'function') ? getProfiles() : [];

  const filterSel = document.getElementById('dive-log-profile');
  if (filterSel) {
    const cur = filterSel.value;
    filterSel.innerHTML = '<option value="">All Profiles</option>' +
      profiles.map(p => `<option value="${p.id}"${p.id === cur ? ' selected' : ''}>${escapeHTML(p.name)}</option>`).join('');
  }

  const formSel = document.getElementById('dive-profile');
  if (formSel) {
    const cur = formSel.value;
    formSel.innerHTML = '<option value="">— No profile —</option>' +
      profiles.map(p => `<option value="${p.id}"${p.id === cur ? ' selected' : ''}>${escapeHTML(p.name)}</option>`).join('');
  }
}

function setDiveLogProfile(profileId) {
  activeDiveLogProfileFilter = profileId;
  renderDiveLog();
}

function renderDiveLog() {
  const list = document.getElementById('dive-log-list');
  if (!list) return;

  let entries = getDiveLog();
  if (activeDiveLogProfileFilter) {
    entries = entries.filter(e => e.profileId === activeDiveLogProfileFilter);
  }
  entries = [...entries].sort((a, b) => b.date.localeCompare(a.date));

  if (!entries.length) {
    list.innerHTML = '<p class="empty-state">No dives logged yet. Use the form above to add your first dive!</p>';
    return;
  }

  const getProfileNameSafe = (typeof getProfileName === 'function') ? getProfileName : () => null;

  list.innerHTML = `
    <div class="dive-log-summary">
      <span>📊 ${entries.length} dive${entries.length !== 1 ? 's' : ''}${activeDiveLogProfileFilter ? ' for this profile' : ' total'}</span>
    </div>
    ${entries.map(entry => {
      const profileName = getProfileNameSafe(entry.profileId);
      return `
        <div class="dive-log-entry">
          <div class="dive-entry-header">
            <div class="dive-entry-date">📅 ${(typeof formatDate === 'function') ? formatDate(entry.date) : entry.date}</div>
            <div class="dive-entry-location">📍 ${escapeHTML(entry.location)}</div>
            ${profileName ? `<span class="profile-badge">${escapeHTML(profileName)}</span>` : ''}
            <button class="btn-icon delete" onclick="deleteDiveEntry('${entry.id}')" title="Delete dive">🗑</button>
          </div>
          <div class="dive-entry-stats">
            ${entry.depth    ? `<span>🌊 ${entry.depth} m depth</span>` : ''}
            ${entry.duration ? `<span>⏱ ${entry.duration} min</span>`  : ''}
          </div>
          ${entry.notes ? `<div class="dive-entry-notes">${escapeHTML(entry.notes)}</div>` : ''}
        </div>`;
    }).join('')}
  `;
}

function deleteDiveEntry(id) {
  if (!confirm('Remove this dive entry?')) return;
  saveDiveLog(getDiveLog().filter(e => e.id !== id));
  renderDiveLog();
}

// Dive form submission
document.addEventListener('DOMContentLoaded', () => {
  const diveForm = document.getElementById('dive-form');
  if (!diveForm) return;

  // Set default date
  const dateInput = document.getElementById('dive-date');
  if (dateInput) dateInput.value = new Date().toISOString().split('T')[0];

  diveForm.addEventListener('submit', e => {
    e.preventDefault();
    const data = new FormData(diveForm);
    const entry = {
      id:        crypto.randomUUID(),
      date:      data.get('dive-date'),
      location:  data.get('dive-location').trim(),
      depth:     data.get('dive-depth')    ? parseFloat(data.get('dive-depth'))    : null,
      duration:  data.get('dive-duration') ? parseInt(data.get('dive-duration'), 10) : null,
      profileId: data.get('dive-profile') || null,
      notes:     (data.get('dive-notes') || '').trim(),
    };
    if (!entry.date || !entry.location) return;
    const log = getDiveLog();
    log.unshift(entry);
    saveDiveLog(log);
    renderDiveLog();
    diveForm.reset();
    // Restore today's date after reset
    const di = document.getElementById('dive-date');
    if (di) di.value = new Date().toISOString().split('T')[0];
    updateDiveLogProfileSelects();
  });
});
