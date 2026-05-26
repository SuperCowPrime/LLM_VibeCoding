// ── Dive Map ──────────────────────────────────────────────────────────────────

// Public Overpass mirrors — tried in order until one succeeds.
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.osm.ch/api/interpreter',
];
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';

let mapInstance     = null;
let allFeatures     = [];
let mapMarkers      = [];
let activeMapFilter = 'all'; // 'all' | 'shop' | 'site' | 'workshop'
let fetchController = null;
let moveTimer       = null;

// ── Tab switching ─────────────────────────────────────────────────────────────

function switchAppTab(tab) {
  ['equipment-pane','map-pane','calendar-pane','divelog-pane'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('hidden', id !== tab + '-pane');
  });
  document.querySelectorAll('.app-tab').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.tab === tab)
  );
  if (tab === 'map') {
    initMap();
    setTimeout(() => { if (mapInstance) mapInstance.invalidateSize(); }, 120);
  }
  if (tab === 'calendar') renderCalendar();
  if (tab === 'divelog') {
    if (typeof initDiveLog === 'function') initDiveLog();
  }
}

// ── Map initialisation ────────────────────────────────────────────────────────

function initMap() {
  if (mapInstance) return;

  mapInstance = L.map('map', { zoomControl: true }).setView([20, 15], 3);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  }).addTo(mapInstance);

  mapInstance.on('moveend', () => {
    clearTimeout(moveTimer);
    if (mapInstance.getZoom() >= 9) {
      moveTimer = setTimeout(fetchFromMapCenter, 700);
    }
  });

  mapInstance.on('click', e => {
    if (!addPinMode) return;
    const { lat, lng } = e.latlng;
    const popupContent = `
      <div class="map-popup">
        <div class="map-popup-name" style="margin-bottom:8px;">📌 New Custom Pin</div>
        <div style="margin-bottom:6px;"><input type="text" id="new-pin-name" placeholder="Pin name…" style="width:100%;padding:5px 8px;border:1px solid #ccc;border-radius:6px;font-size:.9rem;" /></div>
        <div style="margin-bottom:8px;"><textarea id="new-pin-notes" placeholder="Notes (optional)" style="width:100%;padding:5px 8px;border:1px solid #ccc;border-radius:6px;font-size:.9rem;height:48px;resize:none;"></textarea></div>
        <div class="map-popup-actions">
          <button class="map-copy-btn" style="background:var(--reef-coral);color:#fff;" onclick="confirmAddPin(${lat},${lng})">📌 Add Pin</button>
          <button class="map-copy-btn" onclick="cancelAddPin()">✕ Cancel</button>
        </div>
      </div>`;
    L.popup({ maxWidth: 240 }).setLatLng([lat, lng]).setContent(popupContent).openOn(mapInstance);
  });

  setMapStatus('Locating you…');
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      pos => {
        const { latitude: lat, longitude: lon } = pos.coords;
        mapInstance.setView([lat, lon], 12);
        fetchDiveLocations(lat, lon);
      },
      () => setMapStatus('Location access denied — search for a place above.')
    );
  } else {
    setMapStatus('Geolocation not supported — search for a place above.');
  }
}

// ── Overpass query ────────────────────────────────────────────────────────────

function fetchFromMapCenter() {
  const c = mapInstance.getCenter();
  fetchDiveLocations(c.lat, c.lng);
}

async function fetchDiveLocations(lat, lon) {
  setMapStatus('Loading dive locations…');

  if (fetchController) fetchController.abort();
  fetchController = new AbortController();

  const radius = 50000; // 50 km
  // nwr = node + way + relation — catches shops/centres mapped as buildings or areas too
  const query = `
[out:json][timeout:30];
(
  nwr["sport"="diving"](around:${radius},${lat},${lon});
  nwr["sport"="scuba_diving"](around:${radius},${lat},${lon});
  nwr["sport"="underwater_diving"](around:${radius},${lat},${lon});
  nwr["shop"="diving"](around:${radius},${lat},${lon});
  nwr["shop"="scuba_diving"](around:${radius},${lat},${lon});
  nwr["leisure"="dive_centre"](around:${radius},${lat},${lon});
  nwr["amenity"="dive_centre"](around:${radius},${lat},${lon});
  nwr["tourism"="dive_site"](around:${radius},${lat},${lon});
  nwr["craft"="diver"](around:${radius},${lat},${lon});
  nwr["repair"="scuba"](around:${radius},${lat},${lon});
  nwr["repair"="diving_equipment"](around:${radius},${lat},${lon});
  nwr["dive"="yes"](around:${radius},${lat},${lon});
  nwr["diving"="yes"](around:${radius},${lat},${lon});
);
out center;`.trim();

  // Try each Overpass endpoint in order, with a per-endpoint timeout.
  for (const endpoint of OVERPASS_ENDPOINTS) {
    // Combine the user-abort signal with a 20 s per-endpoint timeout.
    const timeoutId = setTimeout(() => fetchController.abort(), 20000);
    try {
      const res = await fetch(endpoint, {
        method:  'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body:    'data=' + encodeURIComponent(query),
        signal:  fetchController.signal,
      });
      clearTimeout(timeoutId);

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      allFeatures = data.elements || [];
      renderMarkers();
      return; // success — stop trying other endpoints
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        // If the user navigated away the controller is permanently aborted —
        // reset it so the next manual retry can create a fresh one.
        fetchController = null;
        return;
      }
      console.warn('[Dive Map] endpoint failed:', endpoint, err.message);
      // Reset controller so the next endpoint gets a fresh signal.
      fetchController = new AbortController();
    }
  }

  setMapStatus(
    'Could not load locations — all map servers are currently busy. ' +
    '<button class="map-retry-btn" onclick="fetchFromMapCenter()">↺ Retry</button>'
  );
}

// ── Classification & icons ────────────────────────────────────────────────────

function classifyFeature(tags) {
  if (tags.craft === 'diver' || tags.repair === 'scuba' || tags.repair === 'diving_equipment') {
    return 'workshop';
  }
  if (
    tags.tourism === 'dive_site' ||
    tags.dive === 'yes' ||
    tags.diving === 'yes' ||
    (
      (tags.sport === 'diving' || tags.sport === 'scuba_diving' || tags.sport === 'underwater_diving') &&
      !tags.shop && !tags.leisure && !tags.amenity && !tags.craft
    )
  ) {
    return 'site';
  }
  return 'shop';
}

const TYPE_META = {
  shop:     { emoji: '🏪', label: '🏪 Dive Shop / Centre',  cls: 'map-marker-shop'     },
  site:     { emoji: '🤿', label: '🤿 Dive Site',            cls: 'map-marker-site'     },
  workshop: { emoji: '🔧', label: '🔧 Dive Equipment Workshop', cls: 'map-marker-workshop' },
};

function makeIcon(type) {
  const meta = TYPE_META[type] || TYPE_META.shop;
  return L.divIcon({
    className:   '',
    html:        `<div class="map-marker ${meta.cls}">${meta.emoji}</div>`,
    iconSize:    [36, 36],
    iconAnchor:  [18, 36],
    popupAnchor: [0, -38],
  });
}

// ── Marker rendering ──────────────────────────────────────────────────────────

function renderMarkers() {
  mapMarkers.forEach(m => mapInstance.removeLayer(m));
  mapMarkers = [];

  allFeatures.forEach(el => {
    const tags = el.tags || {};
    const type = classifyFeature(tags);

    if (activeMapFilter !== 'all' && activeMapFilter !== type) return;

    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (lat == null || lon == null) return;

    const meta    = TYPE_META[type] || TYPE_META.shop;
    const name    = tags.name || tags['name:en'] || 'Unnamed location';
    const addr    = [tags['addr:street'], tags['addr:housenumber'],
                     tags['addr:city'],   tags['addr:country']]
                     .filter(Boolean).join(' ');
    const phone   = tags.phone   || tags['contact:phone']   || '';
    const website = tags.website || tags['contact:website'] || tags.url || '';
    const hours   = tags.opening_hours || '';

    // Build a useful copy string: name + address if available, else name + coords.
    const copyText = addr
      ? `${name}, ${addr}`
      : `${name} (${lat.toFixed(5)}, ${lon.toFixed(5)})`;
    const copyEncoded = encodeURIComponent(copyText);
    const nameEncoded = encodeURIComponent(name);

    const popup = `
      <div class="map-popup">
        <div class="map-popup-name">${esc(name)}</div>
        <div class="map-popup-type">${meta.label}</div>
        ${addr    ? `<div class="map-popup-row">📍 ${esc(addr)}</div>`   : ''}
        ${phone   ? `<div class="map-popup-row">📞 ${esc(phone)}</div>`  : ''}
        ${hours   ? `<div class="map-popup-row">🕐 ${esc(hours)}</div>`  : ''}
        ${website ? `<div class="map-popup-row">🌐 <a href="${esc(website)}" target="_blank" rel="noopener noreferrer">Visit website</a></div>` : ''}
        <div class="map-popup-actions">
          <button class="map-copy-btn" onclick="copyMapAddress(this,'${copyEncoded}')">📋 Copy address</button>
          <a class="map-nav-link" href="https://www.google.com/maps?q=${lat},${lon}" target="_blank" rel="noopener noreferrer">🗺 Navigate</a>
          <button class="map-save-fav-btn" onclick="saveFavourite(${lat},${lon},'${nameEncoded}','${type}',this)">⭐ Save</button>
        </div>
      </div>`;

    const marker = L.marker([lat, lon], { icon: makeIcon(type) })
      .addTo(mapInstance)
      .bindPopup(popup, { maxWidth: 260 });
    mapMarkers.push(marker);
  });

  const n = mapMarkers.length;
  setMapStatus(
    n === 0
      ? 'No dive locations found in this area — this may mean they aren\'t mapped in OpenStreetMap yet. Try searching a coastal city or dive destination.'
      : `${n} location${n !== 1 ? 's' : ''} found — click a pin for details.`
  );
  renderCustomPins();
}

// ── Filter ────────────────────────────────────────────────────────────────────

function setMapFilter(filter) {
  activeMapFilter = filter;
  document.querySelectorAll('.map-filter-btn').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.filter === filter)
  );
  renderMarkers();
}

// ── Search ────────────────────────────────────────────────────────────────────

async function mapSearch() {
  const q = document.getElementById('map-search-input').value.trim();
  if (!q) return;
  setMapStatus(`Searching for "${esc(q)}"…`);
  try {
    const res  = await fetch(
      `${NOMINATIM_URL}?q=${encodeURIComponent(q)}&format=json&limit=1`,
      { headers: { 'Accept-Language': 'en' } }
    );
    const data = await res.json();
    if (!data.length) { setMapStatus('Place not found — try a different search.'); return; }
    const { lat, lon } = data[0];
    mapInstance.setView([parseFloat(lat), parseFloat(lon)], 12);
    fetchDiveLocations(lat, lon);
  } catch (err) {
    setMapStatus('Search failed — check your connection.');
    console.error('[Dive Map] Nominatim error:', err);
  }
}

// ── Locate me ─────────────────────────────────────────────────────────────────

function mapLocateMe() {
  if (!navigator.geolocation) { setMapStatus('Geolocation not supported by your browser.'); return; }
  setMapStatus('Locating you…');
  navigator.geolocation.getCurrentPosition(
    pos => {
      const { latitude: lat, longitude: lon } = pos.coords;
      mapInstance.setView([lat, lon], 12);
      fetchDiveLocations(lat, lon);
    },
    () => setMapStatus('Location access denied.')
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function copyMapAddress(btn, encoded) {
  const text = decodeURIComponent(encoded);
  navigator.clipboard.writeText(text).then(() => {
    btn.textContent = '✅ Copied!';
    setTimeout(() => { btn.textContent = '📋 Copy address'; }, 2000);
  }).catch(() => {
    // Clipboard API unavailable — fall back to prompt so user can copy manually.
    window.prompt('Copy this address:', text);
  });
}

function setMapStatus(msg) {
  const el = document.getElementById('map-status');
  if (el) el.innerHTML = msg;
}

function esc(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Map Favourites ────────────────────────────────────────────────────────────

function mapFavKey() {
  const user = (typeof getCurrentUser === 'function') ? getCurrentUser() : null;
  return 'mapFavourites_' + (user || 'guest');
}
function getMapFavourites() { return JSON.parse(localStorage.getItem(mapFavKey()) || '[]'); }
function saveMapFavourites(favs) { localStorage.setItem(mapFavKey(), JSON.stringify(favs)); }

function saveFavourite(lat, lon, nameEncoded, type, btn) {
  const name = decodeURIComponent(nameEncoded);
  const favs = getMapFavourites();
  if (favs.some(f => Math.abs(f.lat - lat) < 0.0001 && Math.abs(f.lon - lon) < 0.0001)) {
    if (btn) { btn.textContent = '⭐ Saved'; btn.disabled = true; }
    return;
  }
  favs.push({ id: crypto.randomUUID(), lat, lon, name, type });
  saveMapFavourites(favs);
  if (btn) { btn.textContent = '⭐ Saved'; btn.disabled = true; }
  renderFavouritesList();
}

function removeFavourite(id) {
  saveMapFavourites(getMapFavourites().filter(f => f.id !== id));
  renderFavouritesList();
}

function toggleFavouritesPanel() {
  const panel = document.getElementById('map-favourites-panel');
  if (!panel) return;
  panel.classList.toggle('hidden');
  if (!panel.classList.contains('hidden')) renderFavouritesList();
}

function renderFavouritesList() {
  const list = document.getElementById('map-favourites-list');
  if (!list) return;
  const favs = getMapFavourites();
  if (!favs.length) {
    list.innerHTML = '<p class="map-fav-empty">No saved locations yet. Click ⭐ Save on any map pin to save it here.</p>';
    return;
  }
  list.innerHTML = favs.map(f => `
    <div class="map-fav-item">
      <div class="map-fav-info">
        <div class="map-fav-name">${esc(f.name)}</div>
        <div class="map-fav-type">${(TYPE_META[f.type] || TYPE_META.shop).label}</div>
      </div>
      <div class="map-fav-btns">
        <button class="map-fav-goto" onclick="goToFavourite(${f.lat},${f.lon})" title="Go to location">📍</button>
        <button class="map-fav-remove" onclick="removeFavourite('${f.id}')" title="Remove">🗑</button>
      </div>
    </div>`).join('');
}

function goToFavourite(lat, lon) {
  if (!mapInstance) return;
  mapInstance.setView([lat, lon], 14);
  toggleFavouritesPanel();
  fetchDiveLocations(lat, lon);
}

// ── Custom Pins ───────────────────────────────────────────────────────────────

function mapPinsKey() {
  const user = (typeof getCurrentUser === 'function') ? getCurrentUser() : null;
  return 'mapCustomPins_' + (user || 'guest');
}
function getCustomPins() { return JSON.parse(localStorage.getItem(mapPinsKey()) || '[]'); }
function saveCustomPins(pins) { localStorage.setItem(mapPinsKey(), JSON.stringify(pins)); }

let addPinMode = false;
let customPinMarkers = [];

function toggleAddPinMode() {
  addPinMode = !addPinMode;
  const btn = document.getElementById('add-pin-btn');
  if (btn) btn.classList.toggle('active', addPinMode);
  if (mapInstance) mapInstance.getContainer().style.cursor = addPinMode ? 'crosshair' : '';
  setMapStatus(addPinMode ? 'Click anywhere on the map to place a custom pin.' : '');
}

function confirmAddPin(lat, lon) {
  const nameInput  = document.getElementById('new-pin-name');
  const notesInput = document.getElementById('new-pin-notes');
  const name  = nameInput?.value.trim() || 'Custom Pin';
  const notes = notesInput?.value.trim() || '';
  const pins = getCustomPins();
  pins.push({ id: crypto.randomUUID(), lat, lon, name, notes });
  saveCustomPins(pins);
  if (mapInstance) mapInstance.closePopup();
  renderCustomPins();
  if (addPinMode) toggleAddPinMode();
}

function cancelAddPin() {
  if (mapInstance) mapInstance.closePopup();
  addPinMode = true; // ensure toggleAddPinMode turns it off
  toggleAddPinMode();
}

function deleteCustomPin(id) {
  saveCustomPins(getCustomPins().filter(p => p.id !== id));
  renderCustomPins();
}

function renderCustomPins() {
  if (!mapInstance) return;
  customPinMarkers.forEach(m => mapInstance.removeLayer(m));
  customPinMarkers = [];
  getCustomPins().forEach(pin => {
    const icon = L.divIcon({
      className: '',
      html: `<div class="map-marker map-marker-custom" title="${esc(pin.name)}">📌</div>`,
      iconSize: [36, 36], iconAnchor: [18, 36], popupAnchor: [0, -38],
    });
    const coordStr = encodeURIComponent(`${pin.name} (${pin.lat.toFixed(5)}, ${pin.lon.toFixed(5)})`);
    const popup = `
      <div class="map-popup">
        <div class="map-popup-name">${esc(pin.name)}</div>
        <div class="map-popup-type">📌 Custom Pin</div>
        ${pin.notes ? `<div class="map-popup-row">${esc(pin.notes)}</div>` : ''}
        <div class="map-popup-actions">
          <button class="map-copy-btn" onclick="copyMapAddress(this,'${coordStr}')">📋 Copy</button>
          <a class="map-nav-link" href="https://www.google.com/maps?q=${pin.lat},${pin.lon}" target="_blank" rel="noopener noreferrer">🗺 Navigate</a>
          <button class="map-copy-btn" style="color:var(--danger)" onclick="deleteCustomPin('${pin.id}')">🗑 Remove</button>
        </div>
      </div>`;
    const marker = L.marker([pin.lat, pin.lon], { icon })
      .addTo(mapInstance)
      .bindPopup(popup, { maxWidth: 260 });
    customPinMarkers.push(marker);
  });
}
