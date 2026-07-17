'use strict';

/**
 * resolver.js
 *
 * Resolves Spotify and Deezer URLs into plain { title, author, durationMs, uri }
 * metadata objects so they can be searched on YouTube via Lavalink.
 *
 * Spotify  → spotify23.p.rapidapi.com  (requires RAPIDAPI_KEY env or credentials.json)
 * Deezer   → api.deezer.com            (free public API, no key needed)
 */

const { existsSync, readFileSync } = require('fs');
const path = require('path');

// ── Load credentials (same file the bot uses) ─────────────────────────────────
let _creds = {};
const CREDS_FILE = path.resolve(__dirname, '../credentials.json');
if (existsSync(CREDS_FILE)) {
  try { _creds = JSON.parse(readFileSync(CREDS_FILE, 'utf8')); } catch {}
}
function getRapidApiKey() {
  return process.env.RAPIDAPI_KEY || _creds.rapidApiKey || null;
}

// ── URL detection ─────────────────────────────────────────────────────────────
function isSpotifyUrl(q) {
  return /spotify\.com\/(track|album|playlist)\//.test(q);
}
function isDeezerUrl(q) {
  return /deezer\.com|link\.deezer\.com/.test(q);
}

// ── Spotify resolver ──────────────────────────────────────────────────────────
// Endpoints (spotify23.p.rapidapi.com):
//   track:    GET /tracks/?ids=ID        → { tracks: [{ name, artists, duration_ms }] }
//   album:    GET /album_tracks/?id=ID   → { items: [{ name, artists, duration_ms, external_urls }] }
//   playlist: GET /playlist_tracks/?id=ID → { items: [{ track: { name, artists, duration_ms, external_urls } }] }
async function resolveSpotify(url) {
  const key = getRapidApiKey();
  if (!key) {
    console.warn('[resolver] No RapidAPI key set — cannot resolve Spotify URL');
    return null;
  }

  const idMatch = url.match(/\/(track|album|playlist)\/([A-Za-z0-9]+)/);
  if (!idMatch) return null;
  const [, type, id] = idMatch;

  const endpointMap = {
    track:    `https://spotify23.p.rapidapi.com/tracks/?ids=${id}`,
    album:    `https://spotify23.p.rapidapi.com/album_tracks/?id=${id}&limit=300`,
    playlist: `https://spotify23.p.rapidapi.com/playlist_tracks/?id=${id}&limit=300`,
  };

  let json;
  try {
    const res = await fetch(endpointMap[type], {
      headers: {
        'x-rapidapi-key':  key,
        'x-rapidapi-host': 'spotify23.p.rapidapi.com',
      },
    });
    if (!res.ok) {
      console.error(`[resolver] Spotify API ${res.status}:`, await res.text());
      return null;
    }
    json = await res.json();
  } catch (e) {
    console.error('[resolver] Spotify fetch error:', e.message);
    return null;
  }

  if (type === 'track') {
    const t = json.tracks?.[0];
    if (!t?.name) return null;
    return [{
      title:      t.name,
      author:     t.artists?.[0]?.name ?? 'Unknown',
      durationMs: t.duration_ms ?? 0,
      uri:        url,
    }];
  }

  if (type === 'album') {
    const items = json.items ?? json.tracks?.items ?? [];
    return items
      .map(t => ({
        title:      t.name ?? 'Unknown',
        author:     t.artists?.[0]?.name ?? 'Unknown',
        durationMs: t.duration_ms ?? 0,
        uri:        t.external_urls?.spotify ?? url,
      }))
      .filter(t => t.title !== 'Unknown');
  }

  // playlist
  const items = json.items ?? [];
  return items
    .map(item => {
      const t = item.track ?? item;
      return {
        title:      t.name ?? 'Unknown',
        author:     t.artists?.[0]?.name ?? 'Unknown',
        durationMs: t.duration_ms ?? 0,
        uri:        t.external_urls?.spotify ?? url,
      };
    })
    .filter(t => t.title !== 'Unknown');
}

// ── Deezer resolver ───────────────────────────────────────────────────────────
// Uses the free public Deezer API — no key needed.
// Endpoints (api.deezer.com):
//   track:    GET /track/ID             → { title, artist: { name }, duration (s), link }
//   album:    GET /album/ID/tracks      → { data: [{ title, artist, duration, link }] }
//   playlist: GET /playlist/ID/tracks   → { data: [{ title, artist, duration, link }] }
async function resolveDeezer(url) {
  try {
    // Follow short link redirects
    let resolved = url;
    if (url.includes('link.deezer.com')) {
      const r = await fetch(url, { redirect: 'follow' });
      resolved = r.url || url;
    }

    const typeMatch = resolved.match(/deezer\.com\/(?:[a-z]{2}\/)?(?:us\/)?(track|album|playlist)\/(\d+)/);
    if (!typeMatch) {
      console.error('[resolver] Could not parse Deezer URL:', resolved);
      return null;
    }
    const [, type, id] = typeMatch;

    const endpointMap = {
      track:    `https://api.deezer.com/track/${id}`,
      album:    `https://api.deezer.com/album/${id}/tracks?limit=200`,
      playlist: `https://api.deezer.com/playlist/${id}/tracks?limit=200`,
    };

    const res = await fetch(endpointMap[type]);
    if (!res.ok) {
      console.error('[resolver] Deezer API error:', res.status);
      return null;
    }
    const json = await res.json();

    if (type === 'track') {
      return [{
        title:      json.title ?? 'Unknown',
        author:     json.artist?.name ?? 'Unknown',
        durationMs: (json.duration ?? 0) * 1000,
        uri:        json.link ?? url,
      }];
    }

    return (json.data ?? [])
      .map(t => ({
        title:      t.title ?? 'Unknown',
        author:     t.artist?.name ?? 'Unknown',
        durationMs: (t.duration ?? 0) * 1000,
        uri:        t.link ?? url,
      }))
      .filter(t => t.title !== 'Unknown');

  } catch (e) {
    console.error('[resolver] Deezer fetch error:', e.message);
    return null;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Resolve a URL to metadata stubs if it is a Spotify or Deezer link.
 * Returns null if the URL is not a known external source or resolution fails.
 *
 * @param {string} url
 * @returns {Promise<Array<{title:string, author:string, durationMs:number, uri:string}>|null>}
 */
async function resolveExternalUrl(url) {
  if (isSpotifyUrl(url)) return resolveSpotify(url);
  if (isDeezerUrl(url))  return resolveDeezer(url);
  return null;
}

module.exports = { resolveExternalUrl, isSpotifyUrl, isDeezerUrl };
