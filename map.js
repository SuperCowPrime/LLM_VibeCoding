// ── Dive Map ──────────────────────────────────────────────────────────────────

// Two public Overpass endpoints — try in order if one is busy/down.
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
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
  document.getElementById('equipment-pane').classList.toggle('hidden', tab !== 'equipment');
  document.getElementById('map-pane').classList.toggle('hidden', tab !== 'map');
  document.querySelectorAll('.app-tab').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.tab === tab)
  );
  if (tab === 'map') {
    initMap();
    setTimeout(() => { if (mapInstance) mapInstance.invalidateSize(); }, 120);
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

  // Try each Overpass endpoint in order.
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method:  'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body:    'data=' + encodeURIComponent(query),
        signal:  fetchController.signal,
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      allFeatures = data.elements || [];
      renderMarkers();
      return; // success — stop trying other endpoints
    } catch (err) {
      if (err.name === 'AbortError') return; // user navigated away
      console.warn('[Dive Map] endpoint failed:', endpoint, err.message);
      // fall through to try the next endpoint
    }
  }

  setMapStatus('Could not load locations — both map servers are unavailable. Try again in a moment.');
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
  if (el) el.textContent = msg;
}

function esc(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
