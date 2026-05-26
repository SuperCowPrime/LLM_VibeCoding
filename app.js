const form = document.getElementById('gear-form');
const gearList = document.getElementById('gear-list');
const gearCount = document.getElementById('gear-count');
const searchInput = document.getElementById('search');

const SERVICE_INTERVALS = {
  'BCD':                   { days: 365,  label: 'Annual service' },
  'Regulator':             { days: 365,  label: 'Annual service' },
  'Octopus':               { days: 365,  label: 'Annual service' },
  'Tank':                  { days: 365,  label: 'Annual visual inspection' },
  'Wetsuit':               { days: 730,  label: 'Every 2 years' },
  'Drysuit':               { days: 365,  label: 'Annual service' },
  'Hood':                  { days: 730,  label: 'Every 2 years' },
  'Gloves':                { days: 730,  label: 'Every 2 years' },
  'Boots':                 { days: 730,  label: 'Every 2 years' },
  'Mask':                  { days: 730,  label: 'Every 2 years' },
  'Fins':                  { days: 730,  label: 'Every 2 years' },
  'Compass':               { days: 730,  label: 'Every 2 years' },
  'Dive Computer':         { days: 365,  label: 'Annual service' },
  'Dive Light':            { days: 365,  label: 'Annual O-ring service' },
  'Surface Marker Buoy':   { days: 730,  label: 'Every 2 years' },
  'Knife/Cutter':          { days: 180,  label: 'Every 6 months' },
  'Weight System':         { days: 365,  label: 'Annual inspection' },
  'Underwater Camera':     { days: 365,  label: 'Annual O-ring service' },
  'Dive Bag':              { days: 730,  label: 'Every 2 years' },
  'Other':                 { days: 365,  label: 'Annual check' },
};

function serviceIntervalFor(category) {
  return SERVICE_INTERVALS[category] || SERVICE_INTERVALS['Other'];
}

function addDaysToDate(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

function calcNextService(category, lastService, purchaseDate) {
  const { days } = serviceIntervalFor(category);
  const base = lastService || purchaseDate;
  if (base) return addDaysToDate(base, days);
  const today = new Date().toISOString().split('T')[0];
  return addDaysToDate(today, days);
}

function prefillNextService() {
  const category     = document.getElementById('category').value;
  const lastService  = document.getElementById('last-service').value;
  const purchaseDate = document.getElementById('purchase-date').value;
  document.getElementById('next-service').value = calcNextService(category, lastService, purchaseDate);
}

document.getElementById('category').addEventListener('change', prefillNextService);
document.getElementById('last-service').addEventListener('change', prefillNextService);
document.getElementById('purchase-date').addEventListener('change', prefillNextService);

// ── Gear storage ──────────────────────────────────────────────────────────────

let gear = [];
let activeProfileFilter = new Set(); // empty = show all
let editingId = null;     // id of item being edited, null = add mode
let formReminders = [];   // reminders staged in the add/edit form
let activeSortOption = 'default';
let bulkSelected     = new Set();
let calendarYear     = new Date().getFullYear();
let calendarMonth    = new Date().getMonth();

function gearKey() {
  return 'diveGear_' + (getCurrentUser() || 'guest');
}

function saveGear() {
  localStorage.setItem(gearKey(), JSON.stringify(gear));
}

function initGear() {
  gear = JSON.parse(localStorage.getItem(gearKey()) || '[]');
  activeProfileFilter.clear();
  searchInput.value = '';
  renderProfileManager();
  updateUI();
  renderFormReminders();
  checkAndSendReminders();
}

// ── Profiles ──────────────────────────────────────────────────────────────────

function profilesKey() {
  return 'diveProfiles_' + (getCurrentUser() || 'guest');
}

function getProfiles() {
  return JSON.parse(localStorage.getItem(profilesKey()) || '[]');
}

function saveProfiles(profiles) {
  localStorage.setItem(profilesKey(), JSON.stringify(profiles));
}

function createProfile(name) {
  const profiles = getProfiles();
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: 'Profile name cannot be empty.' };
  if (profiles.some(p => p.name.toLowerCase() === trimmed.toLowerCase()))
    return { ok: false, error: 'A profile with that name already exists.' };
  profiles.push({ id: crypto.randomUUID(), name: trimmed });
  saveProfiles(profiles);
  return { ok: true };
}

function deleteProfile(id) {
  let profiles = getProfiles();
  profiles = profiles.filter(p => p.id !== id);
  saveProfiles(profiles);
  activeProfileFilter.delete(id);
  gear.forEach(item => { if (item.profileId === id) item.profileId = null; });
  saveGear();
}

function getProfileName(profileId) {
  if (!profileId) return null;
  const p = getProfiles().find(p => p.id === profileId);
  return p ? p.name : null;
}

function handleAddProfile() {
  const input = document.getElementById('new-profile-name');
  const errorEl = document.getElementById('profile-error');
  const result = createProfile(input.value);
  if (!result.ok) { errorEl.textContent = result.error; return; }
  errorEl.textContent = '';
  input.value = '';
  renderProfileManager();
}

function handleDeleteProfile(id) {
  const profiles = getProfiles();
  const profile = profiles.find(p => p.id === id);
  const count = gear.filter(g => g.profileId === id).length;
  let msg = `Delete profile "${profile?.name}"?`;
  if (count > 0) msg += ` ${count} item(s) will become unassigned.`;
  if (!confirm(msg)) return;
  deleteProfile(id);
  renderProfileManager();
  updateUI();
}

function renderProfileManager() {
  const profiles = getProfiles();
  const list = document.getElementById('profile-chips');
  if (!list) return;
  list.innerHTML = profiles.length
    ? profiles.map(p => `
        <span class="profile-chip">
          ${escapeHTML(p.name)}
          <button class="profile-chip-delete" onclick="handleDeleteProfile('${p.id}')" title="Delete">&times;</button>
        </span>`).join('')
    : '<span class="no-profiles">No profiles yet.</span>';
  updateProfileSelect();
  renderProfileFilter();
}

function updateProfileSelect() {
  const select = document.getElementById('profile-select');
  if (!select) return;
  const profiles = getProfiles();
  const current = select.value;
  select.innerHTML = '<option value="">— No profile —</option>' +
    profiles.map(p => `<option value="${p.id}"${p.id === current ? ' selected' : ''}>${escapeHTML(p.name)}</option>`).join('');
}

function renderProfileFilter() {
  const container = document.getElementById('profile-filter');
  if (!container) return;
  const profiles = getProfiles();
  if (!profiles.length) { container.innerHTML = ''; return; }

  const allActive = activeProfileFilter.size === 0;
  let html = `<button class="profile-filter-btn${allActive ? ' active' : ''}" onclick="setProfileFilter('all')">All</button>`;
  html += profiles.map(p => `
    <button class="profile-filter-btn${activeProfileFilter.has(p.id) ? ' active' : ''}" onclick="setProfileFilter('${p.id}')">
      ${escapeHTML(p.name)}
    </button>`).join('');
  if (gear.some(g => !g.profileId)) {
    html += `<button class="profile-filter-btn${activeProfileFilter.has('__none__') ? ' active' : ''}" onclick="setProfileFilter('__none__')">Unassigned</button>`;
  }
  container.innerHTML = html;
}

function setProfileFilter(id) {
  if (id === 'all') {
    activeProfileFilter.clear();
  } else {
    activeProfileFilter.has(id) ? activeProfileFilter.delete(id) : activeProfileFilter.add(id);
  }
  renderProfileFilter();
  updateUI();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function escapeHTML(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function conditionClass(condition) {
  return 'condition-' + condition.replace(/[\s/]+/g, '-');
}

function serviceStatus(nextService, category) {
  if (!nextService) return '';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(nextService);
  const diff = Math.ceil((due - today) / (1000 * 60 * 60 * 24));
  const intervalLabel = serviceIntervalFor(category).label;

  let cls;
  let icon;
  let label;
  if (diff < 0) {
    cls = 'service-counter overdue';
    icon = '⚠';
    label = `Overdue by ${Math.abs(diff)} day${Math.abs(diff) !== 1 ? 's' : ''}`;
  } else if (diff === 0) {
    cls = 'service-counter overdue';
    icon = '⚠';
    label = 'Due today!';
  } else if (diff <= 30) {
    cls = 'service-counter soon';
    icon = '⏰';
    label = `${diff} day${diff !== 1 ? 's' : ''} until service`;
  } else {
    cls = 'service-counter ok';
    icon = '🔧';
    label = `${diff} days until service`;
  }

  return `<div class="${cls}">
    <span class="counter-icon">${icon}</span>
    <span class="counter-label">${label}</span>
    <span class="counter-date">${formatDate(nextService)} · ${intervalLabel}</span>
  </div>`;
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

// ── Render ────────────────────────────────────────────────────────────────────

function renderGear(items) {
  if (items.length === 0) {
    gearList.innerHTML = '<p class="empty-state">No equipment found.</p>';
    return;
  }

  gearList.innerHTML = items.map(item => {
    const profileName = getProfileName(item.profileId);
    const isBroken    = item.condition === 'Broken/Malfunction';
    const isSelected  = bulkSelected.has(item.id);
    const hasHistory  = item.serviceHistory?.length > 0;
    return `
    <div class="gear-item${isBroken ? ' broken' : ''}${isSelected ? ' bulk-selected' : ''}" data-id="${item.id}" onclick="openModal('${item.id}')" title="Click for maintenance guide">
      <div class="gear-item-main">
        <div class="gear-item-title">
          <label class="bulk-check-wrap" onclick="event.stopPropagation()">
            <input type="checkbox" class="bulk-checkbox" data-id="${item.id}" ${isSelected ? 'checked' : ''} onchange="toggleBulkSelect(event,'${item.id}')" />
          </label>
          ${escapeHTML(item.name)}
          <span class="condition-pill ${conditionClass(item.condition)}">${escapeHTML(item.condition)}</span>
          ${profileName ? `<span class="profile-badge">${escapeHTML(profileName)}</span>` : ''}
        </div>
        <div class="gear-item-meta">
          <span>📂 ${escapeHTML(item.category)}</span>
          ${item.brand ? `<span>🏷 ${escapeHTML(item.brand)}</span>` : ''}
          ${item.purchaseDate ? `<span>🛒 Bought: ${formatDate(item.purchaseDate)}</span>` : ''}
          ${item.lastService ? `<span>🔧 Serviced: ${formatDate(item.lastService)}</span>` : ''}
          ${item.serial ? `<span>🔢 S/N: ${escapeHTML(item.serial)}</span>` : ''}
          ${item.reminders?.length ? (() => {
            const sorted = [...item.reminders].sort((a, b) => b.days - a.days);
            const rows = sorted.map(r => `<div class="reminder-popup-row">⏰ ${r.days} day${r.days !== 1 ? 's' : ''} before service</div>`).join('');
            const n = item.reminders.length;
            return `<button class="reminder-indicator" onclick="toggleReminderPopup(event,'${item.id}')" title="View reminders">🔔 ${n} reminder${n !== 1 ? 's' : ''}<div class="reminder-popup" id="reminder-popup-${item.id}"><div class="reminder-popup-header">Email Reminders</div>${rows}</div></button>`;
          })() : ''}
        </div>
        ${isBroken
          ? `<div class="gear-item-meta"><div class="repair-badge">🔴 In Need of Repair</div></div>`
          : (item.nextService ? `<div class="gear-item-meta">${serviceStatus(item.nextService, item.category)}</div>` : '')}
        ${hasHistory ? `
          <div class="service-history" onclick="event.stopPropagation()">
            <button class="service-history-toggle" onclick="toggleServiceHistory(event,'${item.id}')">
              📋 Service History (${item.serviceHistory.length})
            </button>
            <div class="service-history-list" id="svc-hist-${item.id}">
              ${[...item.serviceHistory].reverse().map(d => `<div class="svc-hist-entry">✅ ${formatDate(d)}</div>`).join('')}
            </div>
          </div>` : ''}
        ${item.notes ? `<div class="gear-item-notes">${escapeHTML(item.notes)}</div>` : ''}
      </div>
      <div class="gear-item-actions" onclick="event.stopPropagation()">
        <button class="btn-icon edit" title="Edit" onclick="startEdit('${item.id}')">✏️</button>
        <button class="btn-icon service" title="Mark as serviced today" onclick="markServiced('${item.id}')">✅</button>
        <button class="btn-icon delete" title="Delete" onclick="deleteItem('${item.id}')">🗑</button>
      </div>
    </div>
  `;
  }).join('');
}

function updateUI() {
  const query = searchInput.value.toLowerCase();
  let filtered = gear.filter(item =>
    item.name.toLowerCase().includes(query) ||
    item.category.toLowerCase().includes(query) ||
    (item.brand || '').toLowerCase().includes(query)
  );
  if (activeProfileFilter.size > 0) {
    filtered = filtered.filter(item => {
      if (activeProfileFilter.has('__none__') && !item.profileId) return true;
      return item.profileId && activeProfileFilter.has(item.profileId);
    });
  }
  filtered = sortGear(filtered);
  gearCount.textContent = gear.length;
  updateStatsCard();
  renderGear(filtered);
}

// ── Edit mode ─────────────────────────────────────────────────────────────────

function startEdit(id) {
  const item = gear.find(g => g.id === id);
  if (!item) return;
  editingId = id;

  document.getElementById('category').value = item.category;
  brandSelectCtrl.setValue(item.brand || '');
  itemNameSelectCtrl.setValue(item.name);
  document.getElementById('purchase-date').value = item.purchaseDate || '';
  document.getElementById('condition').value     = item.condition;
  document.getElementById('last-service').value  = item.lastService || '';
  document.getElementById('next-service').value  = item.nextService || '';
  document.getElementById('serial').value        = item.serial || '';
  document.getElementById('notes').value         = item.notes || '';
  document.getElementById('profile-select').value = item.profileId || '';

  formReminders = (item.reminders || []).map(r => ({ ...r }));
  renderFormReminders();

  document.getElementById('add-section-title').innerHTML = 'Edit <span class="em">Equipment</span>';
  document.getElementById('submit-btn').textContent = 'Save Changes';
  document.getElementById('cancel-edit-btn').classList.remove('hidden');
  document.getElementById('add-section').classList.add('editing');

  document.getElementById('add-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function cancelEdit() {
  editingId = null;
  form.reset();
  brandSelectCtrl.clear();
  itemNameSelectCtrl.clear();
  updateProfileSelect();
  formReminders = [];
  renderFormReminders();
  document.getElementById('add-section-title').innerHTML = 'Add <span class="em">Equipment</span>';
  document.getElementById('submit-btn').textContent = 'Add to Gear List';
  document.getElementById('cancel-edit-btn').classList.add('hidden');
  document.getElementById('add-section').classList.remove('editing');
}

// ── Reminders ─────────────────────────────────────────────────────────────────

function renderFormReminders() {
  const list = document.getElementById('reminder-list');
  if (!list) return;
  if (!formReminders.length) {
    list.innerHTML = '<p class="no-reminders">No reminders added yet.</p>';
    return;
  }
  const sorted = [...formReminders].sort((a, b) => b.days - a.days);
  list.innerHTML = sorted.map(r => `
    <div class="reminder-chip">
      <span>⏰ ${r.days} day${r.days !== 1 ? 's' : ''} before service</span>
      <button type="button" class="reminder-chip-delete" onclick="removeReminderField('${r.id}')" title="Remove">×</button>
    </div>
  `).join('');
}

function addReminderField() {
  const input = document.getElementById('reminder-days-input');
  const days = parseInt(input.value, 10);
  if (!days || days < 1 || days > 365) { input.focus(); return; }
  if (formReminders.some(r => r.days === days)) { input.value = ''; input.focus(); return; }
  formReminders.push({ id: crypto.randomUUID(), days, lastSentForService: null });
  input.value = '';
  input.focus();
  renderFormReminders();
}

function removeReminderField(id) {
  formReminders = formReminders.filter(r => r.id !== id);
  renderFormReminders();
}

function checkAndSendReminders() {
  const username = getCurrentUser();
  if (!username) return;
  const email = (typeof getUserEmail === 'function') ? getUserEmail(username) : null;
  if (!email) return;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let changed = false;

  gear.forEach(item => {
    if (!item.nextService || !item.reminders?.length) return;
    const due = new Date(item.nextService);
    const daysUntil = Math.ceil((due - today) / (1000 * 60 * 60 * 24));

    item.reminders.forEach(reminder => {
      if (daysUntil > reminder.days) return;                         // threshold not yet reached
      if (reminder.lastSentForService === item.nextService) return;  // already sent this cycle
      if (typeof sendReminderEmail === 'function') {
        sendReminderEmail(email, username, item, daysUntil);
      }
      reminder.lastSentForService = item.nextService;
      changed = true;
    });
  });

  if (changed) saveGear();
}

// ── Actions ───────────────────────────────────────────────────────────────────

function markServiced(id) {
  const item = gear.find(g => g.id === id);
  if (!item) return;
  const today = new Date().toISOString().split('T')[0];
  item.serviceHistory = item.serviceHistory || [];
  item.serviceHistory.push(today);
  item.lastService = today;
  item.nextService = calcNextService(item.category, today, item.purchaseDate);
  if (item.condition === 'Needs Service' || item.condition === 'Broken/Malfunction') item.condition = 'Good';
  // Reset reminder "sent" flags so they fire again in the new service cycle.
  if (item.reminders) item.reminders.forEach(r => { r.lastSentForService = null; });
  saveGear();
  updateUI();
}

// ── Reminder popup ────────────────────────────────────────────────────────────

function toggleReminderPopup(event, itemId) {
  event.stopPropagation();
  const popup = document.getElementById('reminder-popup-' + itemId);
  if (!popup) return;
  const wasOpen = popup.classList.contains('open');
  // Close all open popups first
  document.querySelectorAll('.reminder-popup.open').forEach(p => p.classList.remove('open'));
  if (!wasOpen) popup.classList.add('open');
}

// Close reminder popups when clicking anywhere outside
document.addEventListener('click', () => {
  document.querySelectorAll('.reminder-popup.open').forEach(p => p.classList.remove('open'));
});

function deleteItem(id) {
  if (!confirm('Remove this item from your gear list?')) return;
  gear = gear.filter(item => item.id !== id);
  saveGear();
  renderProfileFilter();
  updateUI();
}

form.addEventListener('submit', e => {
  e.preventDefault();
  const data = new FormData(form);

  const fields = {
    category:     data.get('category'),
    name:         data.get('item-name').trim(),
    brand:        data.get('brand').trim(),
    purchaseDate: data.get('purchase-date'),
    condition:    data.get('condition'),
    lastService:  data.get('last-service'),
    nextService:  data.get('next-service') || calcNextService(data.get('category'), data.get('last-service'), data.get('purchase-date')),
    serial:       data.get('serial').trim(),
    notes:        data.get('notes').trim(),
    profileId:    data.get('profile-id') || null,
    reminders:    formReminders.map(r => ({ ...r })),
  };

  if (editingId) {
    const oldItem = gear.find(g => g.id === editingId);
    // If the item was broken and is now being marked as something else,
    // start the service countdown fresh from today.
    if (oldItem?.condition === 'Broken/Malfunction' && fields.condition !== 'Broken/Malfunction') {
      const today = new Date().toISOString().split('T')[0];
      fields.lastService = today;
      fields.nextService = calcNextService(fields.category, today, fields.purchaseDate);
    }
    const idx = gear.findIndex(g => g.id === editingId);
    if (idx !== -1) gear[idx] = { ...gear[idx], ...fields };
    saveGear();
    renderProfileFilter();
    updateUI();
    cancelEdit();
  } else {
    gear.unshift({ id: crypto.randomUUID(), ...fields });
    saveGear();
    renderProfileFilter();
    updateUI();
    form.reset();
    brandSelectCtrl.clear();
    itemNameSelectCtrl.clear();
    updateProfileSelect();
    formReminders = [];
    renderFormReminders();
  }
});

searchInput.addEventListener('input', updateUI);

// ── Sort ──────────────────────────────────────────────────────────────────────

const CONDITION_ORDER = {
  'Broken/Malfunction': 0,
  'Needs Service': 1,
  'Fair': 2,
  'Good': 3,
  'Excellent': 4,
  'New': 5,
};

function sortGear(items) {
  const sorted = [...items];
  switch (activeSortOption) {
    case 'name-asc':
      return sorted.sort((a, b) => a.name.localeCompare(b.name));
    case 'name-desc':
      return sorted.sort((a, b) => b.name.localeCompare(a.name));
    case 'condition':
      return sorted.sort((a, b) => (CONDITION_ORDER[a.condition] ?? 3) - (CONDITION_ORDER[b.condition] ?? 3));
    case 'next-service':
      return sorted.sort((a, b) => {
        const da = a.nextService || '9999-12-31';
        const db = b.nextService || '9999-12-31';
        return da < db ? -1 : da > db ? 1 : 0;
      });
    case 'purchase-date':
      return sorted.sort((a, b) => {
        const da = a.purchaseDate || '0000-00-00';
        const db = b.purchaseDate || '0000-00-00';
        return db > da ? 1 : db < da ? -1 : 0; // newest first
      });
    default:
      return sorted;
  }
}

function setSort(value) {
  activeSortOption = value;
  updateUI();
}

// ── Stats card ────────────────────────────────────────────────────────────────

function updateStatsCard() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let overdue = 0, soon = 0, broken = 0;
  gear.forEach(item => {
    if (item.condition === 'Broken/Malfunction') broken++;
    if (item.nextService) {
      const due = new Date(item.nextService);
      const diff = Math.ceil((due - today) / (1000 * 60 * 60 * 24));
      if (diff < 0) overdue++;
      else if (diff <= 30) soon++;
    }
  });
  const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  setEl('stat-total',   gear.length);
  setEl('stat-overdue', overdue);
  setEl('stat-soon',    soon);
  setEl('stat-broken',  broken);
}

// ── Service history toggle ────────────────────────────────────────────────────

function toggleServiceHistory(event, itemId) {
  event.stopPropagation();
  const hist = document.getElementById('svc-hist-' + itemId);
  if (hist) hist.classList.toggle('open');
}

// ── Bulk actions ──────────────────────────────────────────────────────────────

function toggleBulkSelect(event, id) {
  event.stopPropagation();
  bulkSelected.has(id) ? bulkSelected.delete(id) : bulkSelected.add(id);
  updateBulkBar();
  const card = document.querySelector(`.gear-item[data-id="${id}"]`);
  if (card) card.classList.toggle('bulk-selected', bulkSelected.has(id));
}

function updateBulkBar() {
  const bar     = document.getElementById('bulk-action-bar');
  const countEl = document.getElementById('bulk-count');
  if (!bar) return;
  const n = bulkSelected.size;
  bar.classList.toggle('hidden', n === 0);
  if (countEl) countEl.textContent = `${n} item${n !== 1 ? 's' : ''} selected`;
  const sel = document.getElementById('bulk-profile-select');
  if (sel) {
    sel.innerHTML = '<option value="">— Assign profile —</option>' +
      getProfiles().map(p => `<option value="${p.id}">${escapeHTML(p.name)}</option>`).join('') +
      '<option value="__none__">Remove profile</option>';
  }
}

function clearBulkSelection() {
  bulkSelected.clear();
  updateBulkBar();
  updateUI();
}

function bulkDelete() {
  const n = bulkSelected.size;
  if (!n) return;
  if (!confirm(`Delete ${n} item${n !== 1 ? 's' : ''}? This cannot be undone.`)) return;
  gear = gear.filter(item => !bulkSelected.has(item.id));
  bulkSelected.clear();
  saveGear();
  renderProfileFilter();
  updateBulkBar();
  updateUI();
}

function bulkReassign() {
  const sel = document.getElementById('bulk-profile-select');
  if (!sel || !sel.value) return;
  const profileId = sel.value === '__none__' ? null : sel.value;
  gear.forEach(item => { if (bulkSelected.has(item.id)) item.profileId = profileId; });
  bulkSelected.clear();
  saveGear();
  renderProfileFilter();
  updateBulkBar();
  updateUI();
}

// ── Service calendar ──────────────────────────────────────────────────────────

const MONTH_NAMES = ['January','February','March','April','May','June',
                     'July','August','September','October','November','December'];
const DAY_NAMES_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
let selectedCalDay = null;

function calNavMonth(delta) {
  calendarMonth += delta;
  if (calendarMonth > 11) { calendarMonth = 0; calendarYear++; }
  if (calendarMonth < 0)  { calendarMonth = 11; calendarYear--; }
  selectedCalDay = null;
  renderCalendar();
}

function renderCalendar() {
  const labelEl = document.getElementById('calendar-month-label');
  const gridEl  = document.getElementById('calendar-grid');
  if (!labelEl || !gridEl) return;

  labelEl.textContent = `${MONTH_NAMES[calendarMonth]} ${calendarYear}`;

  // Build map: day-of-month → items due that day
  const dateMap = {};
  gear.forEach(item => {
    if (!item.nextService) return;
    const parts = item.nextService.split('-').map(Number);
    if (parts[0] === calendarYear && (parts[1] - 1) === calendarMonth) {
      const d = parts[2];
      if (!dateMap[d]) dateMap[d] = [];
      dateMap[d].push(item);
    }
  });

  const firstDay    = new Date(calendarYear, calendarMonth, 1).getDay();
  const daysInMonth = new Date(calendarYear, calendarMonth + 1, 0).getDate();
  const todayStr    = new Date().toISOString().split('T')[0];

  let html = `<div class="cal-day-headers">${DAY_NAMES_SHORT.map(d => `<div class="cal-header">${d}</div>`).join('')}</div><div class="cal-body">`;
  for (let i = 0; i < firstDay; i++) html += '<div class="cal-cell empty"></div>';
  for (let d = 1; d <= daysInMonth; d++) {
    const ds  = `${calendarYear}-${String(calendarMonth + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const its = dateMap[d] || [];
    let cls = 'cal-cell';
    if (ds === todayStr)       cls += ' today';
    if (its.length)            cls += ' has-items';
    if (selectedCalDay === d)  cls += ' selected';
    html += `<div class="${cls}" onclick="selectCalDay(${d})">${d}${its.length ? '<span class="cal-dot"></span>' : ''}</div>`;
  }
  html += '</div>';
  gridEl.innerHTML = html;
  renderCalendarDetail(selectedCalDay);
}

function selectCalDay(d) {
  selectedCalDay = (selectedCalDay === d) ? null : d;
  renderCalendar();
}

function renderCalendarDetail(d) {
  const detailEl = document.getElementById('calendar-detail');
  if (!detailEl) return;
  if (!d) { detailEl.innerHTML = ''; return; }
  const ds = `${calendarYear}-${String(calendarMonth + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  const items = gear.filter(item => item.nextService === ds);
  if (!items.length) { detailEl.innerHTML = ''; return; }
  detailEl.innerHTML = `
    <div class="cal-detail-header">📅 ${formatDate(ds)} — ${items.length} item${items.length !== 1 ? 's' : ''} due for service</div>
    ${items.map(item => `
      <div class="cal-detail-item">
        <span class="cal-detail-name">${escapeHTML(item.name)}</span>
        <span class="condition-pill ${conditionClass(item.condition)}">${escapeHTML(item.condition)}</span>
        ${getProfileName(item.profileId) ? `<span class="profile-badge">${escapeHTML(getProfileName(item.profileId))}</span>` : ''}
      </div>`).join('')}
  `;
}
