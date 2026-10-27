// Works out where a photo was taken: GPS saved in the photo first, then the device's live GPS,
// then turns the coordinates into a street address via OpenStreetMap.

import exifr from 'exifr/dist/lite.esm.mjs';

/**
 * Reads the GPS position and capture time saved inside the photo (EXIF), for JPEG and HEIC.
 * Note: some phone browsers strip this from uploaded photos for privacy, so it can be missing.
 * @returns {Promise<{ point: { lat, lon, accuracy: null, source: 'photo' } | null, takenAt: number | null }>}
 */
export async function readPhotoMeta(file) {
  let point = null;
  let takenAt = null;
  try {
    const gps = await exifr.gps(file);
    const { latitude: lat, longitude: lon } = gps ?? {};
    if (Number.isFinite(lat) && Number.isFinite(lon) && !(lat === 0 && lon === 0)) {
      point = { lat, lon, accuracy: null, source: 'photo' };
    }
  } catch {
    // No or unreadable metadata.
  }
  try {
    const meta = await exifr.parse(file, ['DateTimeOriginal']);
    const when = meta?.DateTimeOriginal;
    if (when instanceof Date && !Number.isNaN(when.getTime())) takenAt = when.getTime();
  } catch {
    // No capture time.
  }
  return { point, takenAt };
}


const GEO_ERRORS = {
  1: 'Location permission is blocked for this site.',
  2: 'This device could not determine its position (location services may be off).',
  3: 'Timed out waiting for a GPS fix.',
};

/**
 * Watches the device's GPS for a few seconds and keeps the most accurate fix,
 * stopping early once it is within `goodEnough` metres.
 */
export function getDeviceLocation({ timeout = 12000, goodEnough = 20, onFix = () => {} } = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('This browser cannot access location.'));
      return;
    }
    let best = null;
    let done = false;
    let watchId;
    const finish = (error) => {
      if (done) return;
      done = true;
      navigator.geolocation.clearWatch(watchId);
      clearTimeout(timer);
      if (best) resolve(best);
      else reject(error ?? new Error(GEO_ERRORS[3]));
    };
    watchId = navigator.geolocation.watchPosition(
      ({ coords }) => {
        if (!best || coords.accuracy < best.accuracy) {
          best = { lat: coords.latitude, lon: coords.longitude, accuracy: coords.accuracy, source: 'device' };
          onFix(best);
        }
        if (coords.accuracy <= goodEnough) finish();
      },
      (err) => finish(new Error(GEO_ERRORS[err.code] ?? err.message)),
      { enableHighAccuracy: true, maximumAge: 0, timeout }
    );
    const timer = setTimeout(() => finish(), timeout);
  });
}

/** City-level position from the network's IP address. Only used when GPS is unavailable. */
async function getNetworkLocation() {
  const res = await fetch('https://get.geojs.io/v1/ip/geo.json');
  if (!res.ok) throw new Error('Network location lookup failed.');
  const d = await res.json();
  if (!d.city) throw new Error('Network location only knows the country.');
  return {
    address: [d.city, d.region].filter(Boolean).join(', '),
    area: { city: d.city, district: null, corporation: null, village: null },
  };
}

/** fetch with a time limit, so a stalled lookup can't hold up the whole report. */
async function fetchJson(url, timeoutMs = 8000) {
  // OpenStreetMap asks servers to identify themselves; browsers send their own User-Agent.
  const headers = typeof window === 'undefined' ? { 'User-Agent': 'CivicLens/1.0 (https://civiclens-rouge.vercel.app)' } : {};
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** Readable address + structured area (for routing) from a Nominatim result. */
function fromNominatim(data) {
  const a = data.address ?? {};
  // House numbers belong to the nearest building, not the spot on the road, so they're left out;
  // a nearby named place is added as a landmark instead.
  const parts = [
    a.road || a.pedestrian || a.footway,
    a.neighbourhood || a.quarter,
    a.suburb,
    a.city || a.town || a.village || a.county,
    // Outside city limits there's no city name, so add the district (e.g. "Mysuru") for context.
    !a.city && a.state_district?.replace(/ District$/, ''),
    a.postcode,
  ].filter(Boolean);
  const unique = parts.filter((p, i) => parts.indexOf(p) === i);
  const landmark = a.amenity || a.shop || a.building || a.tourism || a.leisure;
  const address = unique.length
    ? unique.join(', ') + (landmark && landmark !== 'yes' ? ` (near ${landmark})` : '')
    : data.display_name ?? '';
  // Structured pieces used to pick the responsible authority (see authorities.js).
  const area = {
    city: a.city || a.town || null,
    village: a.village || null,
    district: a.state_district?.replace(/ District$/, '') || null,
    corporation: /City Corporation/.test(a.city_district ?? '') ? a.city_district : null,
  };
  return { address, area };
}

/** Street-level address from OpenStreetMap Nominatim. */
async function nominatimAddress(lat, lon) {
  return fromNominatim(
    await fetchJson(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&addressdetails=1&accept-language=en` +
        `&lat=${lat}&lon=${lon}`
    )
  );
}

/**
 * Finds a place the user typed ("Kuvempunagar", "near Mysore Palace") when GPS isn't available.
 * Searches Karnataka first. Returns { lat, lon, accuracy: null, source: 'typed', address, area } or null.
 */
export async function geocodeText(text) {
  const q = text.trim();
  if (!q) return null;
  const search = (query) =>
    fetchJson(
      `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=1&countrycodes=in&accept-language=en` +
        `&q=${encodeURIComponent(query)}`
    );
  let [hit] = await search(/karnataka/i.test(q) ? q : `${q}, Karnataka`);
  if (!hit) [hit] = await search(q);
  if (!hit) return null;
  const { address, area } = fromNominatim(hit);
  // Keep the user's own place name if the map labels the spot differently (e.g. a neighbouring area).
  const typedPlace = q.split(',')[0].trim();
  const town = [area.city || area.village, area.district !== (area.city || area.village) ? area.district : null]
    .filter(Boolean)
    .join(', ');
  const label = address.toLowerCase().includes(typedPlace.toLowerCase()) ? address : [typedPlace, town].filter(Boolean).join(', ');
  return { lat: Number(hit.lat), lon: Number(hit.lon), accuracy: null, source: 'typed', address: label || q, area };
}

/** Tries the device GPS again (e.g. after the user switched location on). Returns a place or { error }. */
export async function locateNow() {
  try {
    const point = await getDeviceLocation();
    try {
      return { ...point, ...(await reverseGeocode(point.lat, point.lon)) };
    } catch (e) {
      return { ...point, address: '', area: null, addressError: e.message };
    }
  } catch (e) {
    return { error: e.message };
  }
}

/** Locality-level address from BigDataCloud; less detailed, used when Nominatim can't be reached. */
async function bigDataCloudAddress(lat, lon) {
  const d = await fetchJson(
    `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`
  );
  const parts = [d.locality, d.city, d.principalSubdivision, d.postcode].filter(Boolean);
  const district = d.localityInfo?.administrative?.find((x) => /district/i.test(x.description ?? ''))?.name;
  return {
    address: parts.filter((p, i) => parts.indexOf(p) === i).join(', '),
    area: { city: d.city || null, village: null, district: district?.replace(/ district$/i, '') || null, corporation: null },
  };
}

/**
 * Converts coordinates to { address, area }: Nominatim (tried twice), then BigDataCloud.
 * @param {(detail: string) => void} [onProgress]
 */
export async function reverseGeocode(lat, lon, onProgress = () => {}) {
  const attempts = [
    ['OpenStreetMap', nominatimAddress],
    ['OpenStreetMap (retry)', nominatimAddress],
    ['BigDataCloud', bigDataCloudAddress],
  ];
  const failures = [];
  for (const [name, lookup] of attempts) {
    onProgress(failures.length ? `${failures.at(-1)} — trying ${name}` : `Looking up the street address (${name})`);
    try {
      const found = await lookup(lat, lon);
      if (found.address) return found;
      failures.push(`${name}: no address found`);
    } catch (e) {
      failures.push(`${name}: ${e.name === 'TimeoutError' ? 'timed out' : e.message}`);
    }
  }
  throw new Error(failures.join('; '));
}

/**
 * Best-effort location for a photo. Never throws.
 * Returns { lat, lon, accuracy, source, address, area } for a real fix,
 * { approximate: true, address, area, reason } when only the city could be found, or { error }.
 * @param {(detail: string) => void} [onProgress]
 */
/** A photo taken more than this long ago probably wasn't taken where the phone is now. */
const STALE_PHOTO_MS = 15 * 60 * 1000;

export async function locate(file, onProgress = () => {}, { fromCamera = false } = {}) {
  onProgress('Checking the photo for its saved location');
  const meta = fromCamera ? { point: null, takenAt: Date.now() } : await readPhotoMeta(file);
  let point = meta.point;
  // An older gallery photo without saved GPS: the phone's current position may be somewhere else.
  const takenAt = meta.takenAt ?? file.lastModified ?? null;
  const staleFallback = !point && !fromCamera && takenAt !== null && Date.now() - takenAt > STALE_PHOTO_MS;
  if (!point) {
    onProgress('No GPS in photo — asking this device for its location');
    try {
      point = await getDeviceLocation({
        onFix: (fix) => onProgress(`Got a fix accurate to ±${Math.round(fix.accuracy)} m — refining`),
      });
    } catch (e) {
      onProgress(`${e.message} Falling back to network location`);
      try {
        return { approximate: true, ...(await getNetworkLocation()), reason: e.message };
      } catch {
        return { error: e.message };
      }
    }
  }

  try {
    return { ...point, staleFallback, ...(await reverseGeocode(point.lat, point.lon, onProgress)) };
  } catch (e) {
    // Coordinates and the map link are still precise; only the street name is missing.
    return { ...point, staleFallback, address: '', addressError: e.message };
  }
}

export const mapsLink = ({ lat, lon }) => `https://maps.google.com/?q=${lat.toFixed(6)},${lon.toFixed(6)}`;
