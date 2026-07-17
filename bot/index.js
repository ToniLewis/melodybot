import { Client, Events } from '@fluxerjs/core';
import { getVoiceManager } from '@fluxerjs/voice';
import { spawn } from 'child_process';
import { createRequire } from 'module';
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Readable } from 'stream';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const config = require('./config.json');

// ─── Single Instance Lock ─────────────────────────────────────────────────────
const LOCK_FILE = resolve(__dirname, 'bot.pid');

if (existsSync(LOCK_FILE)) {
  const oldPid = parseInt(readFileSync(LOCK_FILE, 'utf8').trim());
  if (!isNaN(oldPid) && oldPid !== process.pid) {
    try {
      process.kill(oldPid, 'SIGTERM');
      console.log(`Killed existing bot instance (PID ${oldPid})`);
      // Give it a moment to clean up before we start
      await new Promise(r => setTimeout(r, 2000));
    } catch {
      // Process no longer exists — lock file was stale
    }
  }
}
writeFileSync(LOCK_FILE, String(process.pid));

// Remove lock file on exit
const _removeLock = () => { try { unlinkSync(LOCK_FILE); } catch {} };
process.on('exit', _removeLock);

const token = process.env['FLUXER_BOT_TOKEN'] || config.token;
const LAVALINK_YML = process.env.LAVALINK_YML ?? resolve(__dirname, '../server/application.yml');
const LAVALINK_JAR = process.env.LAVALINK_JAR ?? resolve(__dirname, '../server/Lavalink.jar');

// ─── Credentials Storage ──────────────────────────────────────────────────────
const CREDS_FILE = './credentials.json';
let credentials = {
  applemusic: null,          // JWT token string
  spotifyClientId: null,
  spotifyClientSecret: null,
  youtubeCookies: null,      // raw cookie string
};

if (existsSync(CREDS_FILE)) {
  try {
    credentials = {
      ...credentials,
      ...JSON.parse(readFileSync(CREDS_FILE, 'utf8')),
    };
  } catch {
    // ignore parse errors, keep defaults
  }
}

function saveCreds() {
  writeFileSync(CREDS_FILE, JSON.stringify(credentials, null, 2));
}

// Seed from environment if not already stored
if (!credentials.spotifyClientId && process.env.SPOTIFY_CLIENT_ID) {
  credentials.spotifyClientId = process.env.SPOTIFY_CLIENT_ID;
  console.log('Spotify Client ID seeded from environment');
}
if (!credentials.spotifyClientSecret && process.env.SPOTIFY_CLIENT_SECRET) {
  credentials.spotifyClientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  console.log('Spotify Client Secret seeded from environment');
}
saveCreds();

// ─── Lavalink Process Manager + application.yml sync ──────────────────────────
let lavalinkProcess = null;

function updateApplicationYml() {
  if (!existsSync(LAVALINK_YML)) {
    console.warn('application.yml not found at:', LAVALINK_YML);
    return;
  }

  let yml = readFileSync(LAVALINK_YML, 'utf8');
  let changed = false;

  // Apple Music — target mediaAPIToken inside the applemusic: block
  if (credentials.applemusic) {
    const before = yml;
    yml = yml.replace(
      /(applemusic:\s*\n(?:[ \t]+\S[^\n]*\n)*?[ \t]+mediaAPIToken:\s*)(".*?"|'.*?'|\S+)/m,
      `$1"${credentials.applemusic}"`
    );
    yml = yml.replace(/(sources:\s*\n(?:[ \t]+\S[^\n]*\n)*?[ \t]+applemusic:\s*)false/m, '$1true');
    if (yml !== before) changed = true;
  }

  // Spotify is configured statically in application.yml with preferAnonymousToken: true
  // No credential sync needed from the bot side

  if (changed) {
    writeFileSync(LAVALINK_YML, yml);
    console.log('application.yml updated with credentials');
  }
}

async function restartLavalink() {
  return new Promise((resolve) => {
    if (lavalinkProcess) {
      console.log('Stopping Lavalink...');
      lavalinkProcess.kill('SIGTERM');
      lavalinkProcess = null;
    }

    setTimeout(() => startLavalink().then(resolve), 3000);
  });
}

function startLavalink() {
  return new Promise((resolve) => {
    if (!existsSync(LAVALINK_JAR)) {
      console.warn('Lavalink.jar not found, skipping auto-start');
      return resolve();
    }
    console.log('Starting Lavalink...');
    lavalinkProcess = spawn('java', ['-jar', LAVALINK_JAR], {
      cwd: dirname(LAVALINK_JAR),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    lavalinkProcess.stdout.on('data', (d) => {
      const line = d.toString();
      if (line.includes('Lavalink is ready to accept connections')) {
        console.log('✅ Lavalink restarted and ready');
        resolve();
      }
    });

    lavalinkProcess.stderr.on('data', () => {});
    lavalinkProcess.on('close', () => { lavalinkProcess = null; });
    setTimeout(resolve, 30000);
  });
}

// ─── Creds Sessions ───────────────────────────────────────────────────────────
const credsSessions = new Map(); // userId -> { step, type, channelId, data: {} }
if (!token) throw new Error('No bot token found!');

const PREFIX = config.prefix || '!melody';
const FFMPEG = process.env.FFMPEG_BIN ?? 'ffmpeg';

// ─── Lavalink HTTP client ─────────────────────────────────────────────────────
const LAVA = config.nodes[0];
const LAVA_BASE = `http://${LAVA.host}:${LAVA.port}`;
const LAVA_AUTH = { Authorization: LAVA.password, 'Content-Type': 'application/json' };

async function lavalinkGet(path) {
  const res = await fetch(`${LAVA_BASE}/v4${path}`, { headers: LAVA_AUTH });
  if (!res.ok) throw new Error(`Lavalink ${path} → ${res.status}`);
  return res.json();
}

// ─── Spotify token cache (Client Credentials) ────────────────────────────────
let _spotifyToken = null;
let _spotifyTokenExpiry = 0;

async function getSpotifyToken() {
  if (_spotifyToken && Date.now() < _spotifyTokenExpiry) return _spotifyToken;
  if (!credentials.spotifyClientId || !credentials.spotifyClientSecret) return null;
  try {
    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ' + Buffer.from(
          `${credentials.spotifyClientId}:${credentials.spotifyClientSecret}`
        ).toString('base64'),
      },
      body: 'grant_type=client_credentials',
    });
    if (!res.ok) { console.error('[Spotify token]', res.status, await res.text()); return null; }
    const json = await res.json();
    _spotifyToken = json.access_token;
    _spotifyTokenExpiry = Date.now() + (json.expires_in - 60) * 1000;
    return _spotifyToken;
  } catch (e) { console.error('[Spotify token]', e.message); return null; }
}

// Spotify metadata via official Web API — clientId/clientSecret only, no user auth needed
// Only basic metadata endpoints are used (tracks, albums, playlists) which still work for new apps
async function resolveSpotify(url) {
  const token = await getSpotifyToken();
  if (!token) return null;

  const idMatch = url.match(/\/(track|album|playlist)\/([A-Za-z0-9]+)/);
  if (!idMatch) return null;
  const [, type, id] = idMatch;

  const endpointMap = {
    track:    `https://api.spotify.com/v1/tracks/${id}`,
    album:    `https://api.spotify.com/v1/albums/${id}/tracks?limit=50`,
    playlist: `https://api.spotify.com/v1/playlists/${id}/tracks?limit=100`,
  };

  try {
    if (type === 'track') {
      const res = await fetch(endpointMap.track, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) { console.error('[Spotify track]', res.status, await res.text()); return null; }
      const t = await res.json();
      if (!t?.name) return null;
      return [{ title: t.name, author: t.artists?.[0]?.name ?? 'Unknown', durationMs: t.duration_ms ?? 0, uri: url }];
    }

    let items = [];
    let nextUrl = endpointMap[type];
    while (nextUrl) {
      const res = await fetch(nextUrl, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) { console.error('[Spotify list]', res.status, await res.text()); break; }
      const json = await res.json();
      items.push(...(json.items ?? []));
      nextUrl = json.next ?? null;
      if (items.length >= 500) break;
    }

    return items.map(item => {
      const t = type === 'playlist' ? (item.track ?? item) : item;
      if (!t?.name) return null;
      return {
        title:      t.name,
        author:     t.artists?.[0]?.name ?? 'Unknown',
        durationMs: t.duration_ms ?? 0,
        uri:        t.external_urls?.spotify ?? url,
      };
    }).filter(Boolean);
  } catch (e) { console.error('[Spotify resolve]', e.message); return null; }
}

function isSpotifyUrl(q) {
  return /spotify\.com\/(track|album|playlist)\//.test(q);
}

function isDeezerUrl(q) {
  return /deezer\.com|link\.deezer\.com/.test(q);
}

// Deezer via free public api.deezer.com — no key needed
// track:    GET /track/ID          → { title, artist: { name }, duration (s), link }
// album:    GET /album/ID/tracks   → { data: [...] }
// playlist: GET /playlist/ID/tracks → { data: [...] }
async function resolveDeezer(url) {
  try {
    let resolved = url;
    if (url.includes('link.deezer.com')) {
      const r = await fetch(url, { redirect: 'follow' });
      resolved = r.url || url;
    }
    const typeMatch = resolved.match(/deezer\.com\/(?:[a-z]{2}\/)?(?:us\/)?(track|album|playlist)\/(\d+)/);
    if (!typeMatch) { console.error('[Deezer] Cannot parse URL:', resolved); return null; }
    const [, type, id] = typeMatch;
    const endpointMap = {
      track:    `https://api.deezer.com/track/${id}`,
      album:    `https://api.deezer.com/album/${id}/tracks?limit=200`,
      playlist: `https://api.deezer.com/playlist/${id}/tracks?limit=200`,
    };
    const res = await fetch(endpointMap[type]);
    if (!res.ok) { console.error('[Deezer]', res.status); return null; }
    const json = await res.json();
    if (type === 'track') {
      return [{ title: json.title ?? 'Unknown', author: json.artist?.name ?? 'Unknown',
                durationMs: (json.duration ?? 0) * 1000, uri: json.link ?? url }];
    }
    return (json.data ?? []).map(t => ({
      title: t.title ?? 'Unknown', author: t.artist?.name ?? 'Unknown',
      durationMs: (t.duration ?? 0) * 1000, uri: t.link ?? url,
    })).filter(t => t.title !== 'Unknown');
  } catch (e) { console.error('[Deezer resolve]', e.message); return null; }
}

// Resolve a metadata stub to a real Lavalink track via ytsearch
async function stubToLavalinkTrack(stub, requester) {
  const query = `${stub.author} - ${stub.title}`;
  let data;
  try {
    data = await lavalinkGet(`/loadtracks?identifier=${encodeURIComponent(`ytsearch:${query}`)}`);
  } catch (e) { console.error('[YT search]', query, e.message); return null; }
  if (!data || ['error', 'empty', 'NO_MATCHES'].includes(data.loadType)) return null;
  const raw = Array.isArray(data.data) ? data.data[0] : data.data;
  if (!raw) return null;
  const info = raw.info ?? raw;
  const ytUri = info.uri ?? info.url;
  return {
    ...info,
    encoded: raw.encoded ?? raw.track,
    requester,
    _sourceName: 'youtube',
    _ytSearchQuery: query,
    title: stub.title,
    author: stub.author,
    uri: ytUri,
    length: info.length || stub.durationMs,
  };
}

async function searchTracks(query) {
  // Spotify URLs — resolve metadata via Client Credentials API then ytsearch
  if (isSpotifyUrl(query)) {
    console.log('[search] Spotify URL → resolving via Client Credentials API');
    const stubs = await resolveSpotify(query);
    if (stubs?.length) {
      return {
        loadType: stubs.length > 1 ? 'playlist' : 'track',
        tracks: stubs,
        playlistInfo: { name: 'Spotify' },
        _stubs: true,
      };
    }
    console.warn('[search] Spotify resolve failed, no results');
    return null;
  }

  // Deezer URLs — resolve via public API then ytsearch
  if (isDeezerUrl(query)) {
    console.log('[search] Deezer URL → resolving via public API');
    const stubs = await resolveDeezer(query);
    if (stubs?.length) {
      return {
        loadType: stubs.length > 1 ? 'playlist' : 'track',
        tracks: stubs,
        playlistInfo: { name: 'Deezer' },
        _stubs: true,
      };
    }
    console.warn('[search] Deezer resolve failed, no results');
    return null;
  }

  // Everything else (including Spotify) goes directly to Lavalink
  const id = /^https?:\/\//.test(query) ? query : `ytsearch:${query}`;
  let data;
  try {
    data = await lavalinkGet(`/loadtracks?identifier=${encodeURIComponent(id)}`);
  } catch (e) {
    console.error('Search error:', e.message);
    return null;
  }

  console.log('Lavalink loadType:', data?.loadType);
  if (!data || ['error', 'empty', 'NO_MATCHES'].includes(data.loadType)) {
    if (data?.loadType === 'error') {
      console.error('Lavalink error response:', JSON.stringify(data?.data ?? data));
    }
    return null;
  }

  if (!data.tracks && data.data) {
    if (data.loadType === 'playlist') {
      data.tracks = data.data.tracks ?? [];
      data.playlistInfo = data.data.info ?? {};
    } else {
      data.tracks = Array.isArray(data.data) ? data.data : [data.data];
    }
  }

  if (!data.tracks?.length) return null;
  return data;
}

function normalizeTrack(t, requester) {
  const info = t.info ?? t;
  const pluginInfo = t.pluginInfo ?? {};
  return {
    ...info,
    encoded: t.encoded ?? t.track,
    requester,
    _sourceName: info.sourceName,
    _ytSearchQuery: info.title && info.author ? `${info.author} - ${info.title}` : info.title,
  };
}

// ─── Client + Voice ───────────────────────────────────────────────────────────
const client = new Client({ intents: 0 });
const voiceManager = getVoiceManager(client);

// ─── Server Config ────────────────────────────────────────────────────────────
const CONFIG_FILE = './server-configs.json';
let serverConfigs = {};
if (existsSync(CONFIG_FILE)) {
  try {
    serverConfigs = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
  } catch {}
}

function saveConfigs() {
  writeFileSync(CONFIG_FILE, JSON.stringify(serverConfigs, null, 2));
}

// ─── State ────────────────────────────────────────────────────────────────────
const setupSessions = new Map();
const pendingSearches = new Map();
const guildQueues = new Map(); // { tracks[], current, playing, loop, volume, connection, channelId, textChannelId }

// ─── Helpers ──────────────────────────────────────────────────────────────────
function msToTime(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`;
}

async function sendMsg(channelId, content) {
  const ch = await client.channels.fetch(channelId);
  return ch.send(typeof content === 'string' ? { content } : content);
}

function embed(color, description, extra = {}) {
  return { embeds: [{ color, description, ...extra }] };
}

function nowPlayingEmbed(queue, track) {
  const loopIcon = queue.loop === 'track' ? '🔂' : queue.loop === 'queue' ? '🔁' : '';
  return {
    embeds: [{
      color: 0x5865F2,
      author: { name: '🎵 Now Playing' },
      title: track.title ?? 'Unknown',
      url: track.uri,
      thumbnail: track.artworkUrl ? { url: track.artworkUrl } : undefined,
      fields: [
        { name: 'Artist', value: track.author || 'Unknown', inline: true },
        { name: '🔊 Volume', value: `${queue.volume}%`, inline: true },
        { name: 'Queue', value: `${queue.tracks.length} track(s)`, inline: true },
      ],
      footer: { text: `${loopIcon ? loopIcon + ' ' : ''}Requested by ${track.requester?.username ?? 'Unknown'}` },
    }],
  };
}

function getBestVoiceChannel(guildId) {
  const cfg = serverConfigs[guildId];
  if (!cfg?.voiceChannels?.length) return null;
  const withUsers = cfg.voiceChannels.filter(vc =>
    voiceManager.listParticipantsInChannel(guildId, vc.id).length > 0
  );
  return withUsers[0] || cfg.voiceChannels[0];
}

// ─── Audio Pipeline ───────────────────────────────────────────────────────────
const YTDLP = process.env.YTDLP_BIN ?? 'yt-dlp';

async function getDirectAudioUrl(url, track) {
  const sourceName = track?._sourceName ?? '';
  const isAppleMusic = url.includes('music.apple.com') || sourceName === 'applemusic';
  const isDeezer = url.includes('deezer.com') || sourceName === 'deezer';
  const isSpotify = url.includes('spotify.com') || sourceName === 'spotify';

  const needsYtSearch = isAppleMusic || isSpotify || isDeezer;
  let searchUrl = url;

  if (needsYtSearch && track?._ytSearchQuery) {
    searchUrl = `ytsearch1:${track._ytSearchQuery}`;
    console.log(`${sourceName || 'unknown'} → searching YouTube for:`, track._ytSearchQuery);
  } else {
    console.log('Direct URL:', url.slice(0, 60));
  }

  return new Promise((resolve, reject) => {
    const proc = spawn(YTDLP, [
      '--no-playlist',
      '-f', 'bestaudio[ext=webm]/bestaudio/bestaudio*',
      '--get-url',
      searchUrl,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    let out = '';
    let err = '';
    proc.stdout.on('data', d => out += d.toString());
    proc.stderr.on('data', d => err += d.toString());
    proc.on('close', code => {
      const directUrl = out.trim().split('\n')[0];
      if (code === 0 && directUrl) resolve(directUrl);
      else reject(new Error(`yt-dlp failed: ${err.slice(0, 300)}`));
    });
    proc.on('error', reject);
  });
}

async function playTrack(queue, track) {
  console.log('Fetching audio for:', track.title, '| duration:', track.duration, '| length:', track.length);

  let audioUrl;
  try {
    audioUrl = await getDirectAudioUrl(track.uri, track);
    console.log('Direct URL obtained from yt-dlp');
  } catch (e) {
    throw new Error(`Could not get audio URL: ${e.message}`);
  }

  const durationMs = track.length ?? track.duration ?? 0;

  const ffmpeg = spawn(FFMPEG, [
    '-reconnect', '1',
    '-reconnect_streamed', '1',
    '-reconnect_delay_max', '5',
    '-i', audioUrl,
    '-vn',
    '-c:a', 'libopus',
    '-b:a', '128k',
    '-application', 'audio',
    '-f', 'webm',
    'pipe:1',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  ffmpeg.stderr.on('data', () => {});
  ffmpeg.on('error', e => console.error('FFmpeg spawn error:', e.message));

  console.log('Sending to LiveKit...');

  // Kill ffmpeg immediately if the room disconnects mid-track
  const onDisconnect = () => {
    console.log('[playTrack] Room disconnected mid-track, killing ffmpeg');
    queue._roomDisconnected = true;
    try { ffmpeg.kill('SIGKILL'); } catch {}
  };
  queue.connection?.once?.('disconnected', onDisconnect);

  queue.connection.play(ffmpeg.stdout).catch(err => {
    if (!err.message?.includes('closed')) console.error('Play error:', err.message);
  });

  const startTime = Date.now();

  if (durationMs > 0) {
    console.log('Waiting', Math.round(durationMs / 1000) + 's for track to finish:', track.title);
    await new Promise(r => setTimeout(r, durationMs + 1000));
  } else {
    await new Promise((resolve) => {
      ffmpeg.on('close', resolve);
      ffmpeg.on('error', resolve);
    });
    await new Promise(r => setTimeout(r, 1500));
  }

  queue.connection?.off?.('disconnected', onDisconnect);
  try { ffmpeg.kill('SIGKILL'); } catch {}
  console.log('Playback complete:', track.title, '— actual time:', Math.round((Date.now() - startTime) / 1000) + 's');
}

async function startQueue(guildId) {
  const queue = guildQueues.get(guildId);
  if (!queue || queue.playing) return;

  if (!queue.tracks.length) {
    queue.current = null;
    sendMsg(queue.textChannelId, embed(0x5865F2, '✅ Queue finished!')).catch(() => null);
    return;
  }

  // Claim this loop iteration with a unique ID — if a newer loop starts, this one exits
  queue._loopId = (queue._loopId ?? 0) + 1;
  const myLoopId = queue._loopId;

  let track = queue.tracks.shift();
  queue.playing = true;

  // Lazy-resolve metadata stubs to real YouTube-backed tracks
  if (track._stub) {
    const resolved = await stubToLavalinkTrack(track, track.requester);
    if (!resolved) {
      console.error('[queue] Could not resolve stub:', track.title);
      sendMsg(queue.textChannelId, embed(0xED4245, `⏭️ Skipped **${track.title}** — could not find on YouTube.`)).catch(() => null);
      queue.playing = false;
      if (queue._loopId === myLoopId) setTimeout(() => startQueue(guildId), 300);
      return;
    }
    track = resolved;
  }

  queue.current = track;

  // Guard: reconnect if LiveKit room fully disconnected between tracks
  if (queue._roomDisconnected || !queue.connection?.isConnected?.()) {
    console.log('[queue] Reconnecting to voice channel...');
    await new Promise(r => setTimeout(r, 2000));
    try {
      await joinChannel(guildId, queue.channelId, queue.textChannelId);
      console.log('[queue] Reconnected successfully');
    } catch (e) {
      console.error('[queue] Reconnect failed:', e.message);
      queue.playing = false;
      if (queue._loopId === myLoopId) setTimeout(() => startQueue(guildId), 5000);
      return;
    }
  }

  // Bail out if a newer loop has taken over (e.g. user rejoined mid-track)
  if (queue._loopId !== myLoopId) {
    console.log('[queue] Loop superseded, exiting stale loop');
    queue.playing = false;
    return;
  }

  try {
    await sendMsg(queue.textChannelId, nowPlayingEmbed(queue, track));
  } catch {}

  try {
    await playTrack(queue, track);
  } catch (err) {
    console.error('Playback error:', err.message);
    sendMsg(queue.textChannelId, embed(0xED4245, `❌ Playback error: \`${err.message}\``)).catch(() => null);
  }

  queue.playing = false;

  if (queue.loop === 'track') {
    queue.tracks.unshift(track);
  } else if (queue.loop === 'queue') {
    queue.tracks.push(track);
  }

  // Only continue the loop if we are still the current loop owner
  if (queue._loopId === myLoopId) {
    setTimeout(() => startQueue(guildId), 300);
  }
}

const _joiningGuilds = new Set(); // prevent concurrent join attempts

async function joinChannel(guildId, channelId, textChannelId) {
  // Do not join before the bot is fully ready — prevents platform auto-join from starting playback
  if (!_botReady) {
    console.log('[joinChannel] Ignoring join attempt before Ready event');
    return null;
  }

  let queue = guildQueues.get(guildId);
  if (queue?.connection?.isConnected?.() && queue.channelId === channelId) return queue;

  // If already mid-join, wait for it rather than firing a second join
  if (_joiningGuilds.has(guildId)) {
    await new Promise(r => setTimeout(r, 3000));
    return guildQueues.get(guildId) ?? queue;
  }
  _joiningGuilds.add(guildId);

  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel) throw new Error('Voice channel not found');

    const connection = await voiceManager.join(channel);

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(resolve, 8000);
      connection.once('ready', () => { clearTimeout(timeout); resolve(); });
      connection.once('error', (e) => { clearTimeout(timeout); reject(e); });
    });

    if (!queue) {
      queue = { tracks: [], current: null, playing: false, loop: 'off', volume: 100, connection, channelId, textChannelId, _roomDisconnected: false, _loopId: 0 };
      guildQueues.set(guildId, queue);
    } else {
      queue.connection = connection;
      queue.channelId = channelId;
      queue.textChannelId = textChannelId;
      queue._roomDisconnected = false;
    }

    connection.once('disconnected', () => {
      queue._roomDisconnected = true;
      console.log('[voice] Room disconnected — will reconnect on next track');
    });

    connection.setVolume?.(queue.volume);
    return queue;
  } finally {
    _joiningGuilds.delete(guildId);
  }
}

// ─── Commands ─────────────────────────────────────────────────────────────────
async function cmdJoin(msg, args) {
  const cfg = serverConfigs[msg.guildId];
  if (!cfg) return msg.reply('⚠️ Not set up. Server owner run `!melodysetup`.');
  const channelId = args[0]?.replace(/\D/g, '') || getBestVoiceChannel(msg.guildId)?.id;
  if (!channelId) return msg.reply('❌ No voice channels available.');
  try {
    await joinChannel(msg.guildId, channelId, msg.channelId);
    const name = cfg.voiceChannels.find(v => v.id === channelId)?.name || channelId;
    msg.reply(embed(0x57F287, `✅ Joined **${name}**`));
  } catch (e) {
    msg.reply(`❌ Failed to join: \`${e.message}\``);
  }
}

async function cmdMove(msg, args) {
  const channelId = args[0]?.replace(/\D/g, '');
  if (!channelId) return msg.reply('❌ Provide a voice channel ID.');
  try {
    await joinChannel(msg.guildId, channelId, msg.channelId);
    const name = serverConfigs[msg.guildId]?.voiceChannels.find(v => v.id === channelId)?.name || channelId;
    msg.reply(embed(0x57F287, `✅ Moved to **${name}**`));
  } catch (e) {
    msg.reply(`❌ Failed to move: \`${e.message}\``);
  }
}

async function cmdLeave(msg) {
  const queue = guildQueues.get(msg.guildId);
  if (queue?.connection) queue.connection.destroy();
  voiceManager.leave(msg.guildId);
  guildQueues.delete(msg.guildId);
  msg.reply(embed(0xED4245, '👋 Left the voice channel.'));
}

async function cmdPlay(msg, args) {
  if (!args.length) return msg.reply('❌ Provide a song name or URL.');
  const cfg = serverConfigs[msg.guildId];
  if (!cfg) return msg.reply('⚠️ Not set up. Server owner run `!melodysetup`.');

  let queue = guildQueues.get(msg.guildId);
  if (!queue?.connection?.isConnected?.()) {
    const vc = getBestVoiceChannel(msg.guildId);
    if (!vc) return msg.reply('❌ No voice channels available.');
    try {
      queue = await joinChannel(msg.guildId, vc.id, msg.channelId);
      // Bump the loop ID so any stale playback loop from before the reconnect exits cleanly
      queue._loopId = (queue._loopId ?? 0) + 1;
      queue.playing = false;
    } catch (e) {
      return msg.reply(`❌ Failed to join: \`${e.message}\``);
    }
  }

  queue.textChannelId = msg.channelId;

  const data = await searchTracks(args.join(' '));
  if (!data) return msg.reply('❌ No results found.');

  if (data._stubs) {
    const stubs = data.tracks.map(s => ({ ...s, requester: msg.author, _stub: true }));
    if (stubs.length === 1) {
      queue.tracks.push(stubs[0]);
      if (queue.playing)
        await msg.reply(embed(0x57F287, `✅ Added **${stubs[0].title}** — position #${queue.tracks.length}`));
    } else {
      // Prevent adding a playlist that is already fully queued
      const firstTitle = stubs[0].title;
      const alreadyQueued = queue.tracks.some(t => t._stub && t.title === firstTitle);
      if (alreadyQueued) {
        return msg.reply(embed(0xED4245, '⚠️ That playlist is already in the queue.'));
      }
      queue.tracks.push(...stubs);
      await msg.reply(embed(0x57F287, `📋 Added **${data.playlistInfo?.name ?? 'Playlist'}** — **${stubs.length}** tracks.`));
    }
  } else if (data.loadType === 'playlist') {
    const tracks = data.tracks.map(t => normalizeTrack(t, msg.author));
    queue.tracks.push(...tracks);
    await msg.reply(embed(0x57F287, `📋 Added playlist **${data.playlistInfo?.name ?? 'Unknown'}** — **${tracks.length}** tracks.`));
  } else {
    const track = normalizeTrack(data.tracks[0], msg.author);
    queue.tracks.push(track);
    if (queue.playing) {
      await msg.reply(embed(0x57F287, `✅ Added **[${track.title}](${track.uri})** — position #${queue.tracks.length}`));
    }
  }

  if (!queue.playing) startQueue(msg.guildId);
}

async function cmdSearch(msg, args) {
  if (!args.length) return msg.reply('❌ Provide a search term.');
  const data = await searchTracks(args.join(' '));
  if (!data?.tracks?.length) return msg.reply('❌ No results found.');
  const top5 = data.tracks.slice(0, 5).map(t => normalizeTrack(t, null));
  await msg.reply({
    embeds: [{
      color: 0x5865F2,
      title: `🔍 Search: ${args.join(' ')}`,
      description: top5.map((t, i) =>
        `**${i + 1}.** [${t.title}](${t.uri}) — \`${msToTime(t.length ?? t.duration ?? 0)}\``
      ).join('\n'),
      footer: { text: 'Reply with 1–5 or "cancel"' },
    }],
  });
  pendingSearches.set(msg.author.id, { tracks: top5, guildId: msg.guildId, channelId: msg.channelId });
  setTimeout(() => pendingSearches.delete(msg.author.id), 20000);
}

async function cmdSkip(msg, args) {
  const queue = guildQueues.get(msg.guildId);
  if (!queue?.playing) return msg.reply('❌ Nothing is playing.');
  const amount = parseInt(args[0]) || 1;
  const title = queue.current?.title ?? 'track';
  if (amount > 1) queue.tracks.splice(0, Math.min(amount - 1, queue.tracks.length));
  queue.connection?.stop();
  msg.reply(embed(0x57F287, `⏭️ Skipped **${amount > 1 ? amount + ' tracks' : title}**.`));
}

async function cmdStop(msg) {
  const queue = guildQueues.get(msg.guildId);
  if (!queue) return msg.reply('❌ Nothing is playing.');
  queue.tracks = [];
  queue.current = null;
  queue.connection?.stop();
  msg.reply(embed(0xED4245, '⏹️ Stopped and cleared queue.'));
}

async function cmdPause(msg) {
  const queue = guildQueues.get(msg.guildId);
  if (!queue?.playing) return msg.reply('❌ Nothing is playing.');
  msg.reply(embed(0x5865F2, '⏸️ Use `!melodyskip` to skip or `!melodystop` to stop. (Pause not supported yet)'));
}

async function cmdQueue(msg, args) {
  const queue = guildQueues.get(msg.guildId);
  if (!queue?.current && !queue?.tracks.length) return msg.reply('❌ Nothing is playing.');
  const pageSize = 10;
  const page = Math.max(1, parseInt(args[0]) || 1);
  const total = Math.max(1, Math.ceil(queue.tracks.length / pageSize));
  const cur = Math.min(page, total);
  const start = (cur - 1) * pageSize;
  const items = queue.tracks.slice(start, start + pageSize);
  msg.reply({
    embeds: [{
      color: 0x5865F2,
      title: `📋 Queue — Page ${cur}/${total}`,
      description:
        (queue.current ? `**Now Playing:** [${queue.current.title}](${queue.current.uri}) \`${msToTime(queue.current.length ?? queue.current.duration ?? 0)}\`\n\n` : '') +
        (items.map((t, i) =>
          `**${start + i + 1}.** [${t.title}](${t.uri}) \`${msToTime(t.length ?? t.duration ?? 0)}\``
        ).join('\n') || 'No upcoming tracks.'),
      footer: { text: `${queue.tracks.length} track(s) in queue` },
    }],
  });
}

async function cmdShuffle(msg) {
  const queue = guildQueues.get(msg.guildId);
  if (!queue?.tracks.length) return msg.reply('❌ Queue is empty.');
  for (let i = queue.tracks.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [queue.tracks[i], queue.tracks[j]] = [queue.tracks[j], queue.tracks[i]];
  }
  msg.reply(embed(0x57F287, '🔀 Queue shuffled!'));
}

async function cmdLoop(msg, args) {
  const queue = guildQueues.get(msg.guildId);
  if (!queue) return msg.reply('❌ Nothing is playing.');
  const mode = args[0]?.toLowerCase();
  const newMode = !mode
    ? (queue.loop === 'off' ? 'track' : queue.loop === 'track' ? 'queue' : 'off')
    : (['off', 'track', 'queue'].includes(mode) ? mode : null);
  if (!newMode) return msg.reply('❌ Valid modes: `off`, `track`, `queue`');
  queue.loop = newMode;
  msg.reply(embed(0x57F287, `${{ off: '➡️', track: '🔂', queue: '🔁' }[newMode]} Loop: **${newMode}**`));
}

async function cmdVolume(msg, args) {
  const queue = guildQueues.get(msg.guildId);
  if (!queue) return msg.reply('❌ Nothing is playing.');
  const vol = parseInt(args[0]);
  if (isNaN(vol) || vol < 0 || vol > 200) return msg.reply('❌ Volume must be 0–200.');
  queue.volume = vol;
  queue.connection?.setVolume?.(vol);
  msg.reply(embed(0x57F287, `🔊 Volume: **${vol}%**`));
}

async function cmdNp(msg) {
  const queue = guildQueues.get(msg.guildId);
  if (!queue?.current) return msg.reply('❌ Nothing is playing.');
  msg.reply(nowPlayingEmbed(queue, queue.current));
}

async function cmdRemove(msg, args) {
  const queue = guildQueues.get(msg.guildId);
  if (!queue?.tracks.length) return msg.reply('❌ Queue is empty.');
  const pos = parseInt(args[0]);
  if (isNaN(pos) || pos < 1 || pos > queue.tracks.length) {
    return msg.reply(`❌ Invalid position (1–${queue.tracks.length}).`);
  }
  const [removed] = queue.tracks.splice(pos - 1, 1);
  msg.reply(embed(0x57F287, `🗑️ Removed **${removed.title}**`));
}

async function cmdHelp(msg) {
  const cfg = serverConfigs[msg.guildId];
  msg.reply({
    embeds: [{
      color: 0x5865F2,
      title: '🎵 Melody Bot — Commands',
      description: `Prefix: \`${PREFIX}\`${!cfg ? `\n\n⚠️ **Not set up!** Server owner run \`${PREFIX}setup\`` : ''}`,
      fields: [
        { name: '🔌 Voice', value: '`join [id]` · `move ` · `leave`' },
        { name: '▶️ Playback', value: '`play ` · `search ` · `skip [n]` · `stop` · `np`' },
        { name: '📋 Queue', value: '`queue [page]` · `shuffle` · `loop [off/track/queue]` · `remove `' },
        { name: '⚙️ Settings', value: '`volume <0-200>` · `setup` (owner only)' },
      ],
    }],
  });
}

// ─── Setup Flow ───────────────────────────────────────────────────────────────
async function cmdSetup(msg, args) {
  const guild = msg.guild ?? await client.guilds.fetch(msg.guildId);
  if (guild.ownerId !== msg.author.id) return msg.reply('❌ Only the server owner can run setup.');
  const sub = args[0]?.toLowerCase();

  if (sub === 'reset') {
    delete serverConfigs[msg.guildId];
    saveConfigs();
    setupSessions.delete(msg.guildId);
    return msg.reply('🗑️ Config reset. Run `!melodysetup` again.');
  }

  if (sub === 'status') {
    const cfg = serverConfigs[msg.guildId];
    if (!cfg) return msg.reply('⚠️ Not set up yet.');
    return msg.reply({
      embeds: [{
        color: 0x57F287,
        title: '⚙️ Setup',
        fields: [
          { name: 'Control Channel', value: `<#${cfg.controlChannelId}>`, inline: true },
          {
            name: 'Voice Channels',
            value: cfg.voiceChannels.map((v, i) => `${i + 1}. ${v.name} (\`${v.id}\`)`).join('\n') || 'None',
          },
        ],
      }],
    });
  }

  setupSessions.set(msg.guildId, {
    step: 1,
    ownerId: msg.author.id,
    channelId: msg.channelId,
    data: { voiceChannels: [] },
  });
  sendMsg(msg.channelId, {
    embeds: [{
      color: 0x5865F2,
      title: '⚙️ Setup — Step 1/3',
      description:
        'Reply with the **channel ID** of your control channel.\n\n' +
        '> Right-click channel → Copy ID\n' +
        '> *(Enable Developer Mode in Settings → Advanced)*',
      footer: { text: 'Type cancel to abort.' },
    }],
  });
}

async function continueSetup(guildId, session, msg) {
  const text = msg.content.trim();
  if (text.toLowerCase() === 'cancel') {
    setupSessions.delete(guildId);
    return sendMsg(session.channelId, '❌ Setup cancelled.');
  }

  if (session.step === 1) {
    const id = text.replace(/\D/g, '');
    if (!id) return sendMsg(session.channelId, '❌ Invalid ID. Try again.');
    session.data.controlChannelId = id;
    session.step = 2;
    return sendMsg(session.channelId, {
      embeds: [{
        color: 0x5865F2,
        title: '⚙️ Setup — Step 2/3',
        description: 'Send up to **10 voice channel IDs** one at a time.\nType **done** when finished.',
        footer: { text: '0/10 added.' },
      }],
    });
  }

  if (session.step === 2) {
    if (text.toLowerCase() === 'done') {
      if (!session.data.voiceChannels.length) {
        return sendMsg(session.channelId, '❌ Add at least one voice channel.');
      }
      session.step = 3;
      return sendMsg(session.channelId, {
        embeds: [{
          color: 0x5865F2,
          title: '⚙️ Setup — Step 3/3',
          description:
            `**Control:** <#${session.data.controlChannelId}>\n` +
            `**Voice channels:**\n` +
            session.data.voiceChannels.map((v, i) => `${i + 1}. ${v.name} (\`${v.id}\`)`).join('\n') +
            '\n\nType **confirm** to save or **back** to redo.',
        }],
      });
    }

    if (session.data.voiceChannels.length >= 10) {
      return sendMsg(session.channelId, '⚠️ Max 10. Type **done**.');
    }

    const id = text.replace(/\D/g, '');
    if (!id) return sendMsg(session.channelId, '❌ Invalid ID.');
    if (session.data.voiceChannels.find(v => v.id === id)) {
      return sendMsg(session.channelId, '⚠️ Already added.');
    }

    let name = id;
    try {
      const ch = await client.channels.fetch(id);
      name = ch.name || id;
    } catch {}

    session.data.voiceChannels.push({ id, name });
    return sendMsg(session.channelId, embed(
      0x57F287,
      `✅ Added **${name}** (${session.data.voiceChannels.length}/10). Add more or type **done**.`
    ));
  }

  if (session.step === 3) {
    if (text.toLowerCase() === 'back') {
      session.step = 2;
      session.data.voiceChannels = [];
      return sendMsg(session.channelId, '↩️ Cleared. Send IDs again then **done**.');
    }

    if (text.toLowerCase() === 'confirm') {
      serverConfigs[guildId] = {
        controlChannelId: session.data.controlChannelId,
        voiceChannels: session.data.voiceChannels,
        ownerId: msg.author.id,
      };
      saveConfigs();
      setupSessions.delete(guildId);
      return sendMsg(session.channelId, embed(
        0x57F287,
        `✅ Setup complete! Use <#${session.data.controlChannelId}> for commands.`
      ));
    }
  }
}

// ─── Credentials Command ─────────────────────────────────────────────────────
const CREDS_INSTRUCTIONS = {
  applemusic: {
    name: 'Apple Music',
    emoji: '🍎',
    steps: [
      '**Getting your Apple Music token:**',
      '1. Open **Edge** or **Chrome**',
      '2. Go to **music.apple.com** and open any song page',
      '3. Press **F12** to open DevTools',
      '4. Click the **Network** tab',
      '5. Type `amp-api` in the filter box',
      '6. **Play any song** on the page to trigger API requests',
      '7. Click one of the `amp-api.music.apple.com` requests',
      '8. In **Request Headers**, find `authorization: Bearer eyJ...`',
      '9. Copy everything **after** `Bearer ` (the long `eyJ...` string)',
      '',
      'Paste your token here:',
    ].join('\n'),
  },
  spotify: {
    name: 'Spotify',
    emoji: '🎵',
    steps: [
      '**Getting your Spotify credentials:**',
      '⚠️ The Spotify account that creates the app **must have Premium**.',
      '',
      '1. Go to **developer.spotify.com/dashboard**',
      '2. Log in with your **Premium** Spotify account',
      '3. Click **Create App**',
      '4. Fill in any name/description, set Redirect URI = `http://localhost:8080`',
      '5. Click **Save**, then copy your **Client ID**',
      '',
      'Paste your **Client ID** here:',
    ].join('\n'),
  },
  spotify_secret: {
    name: 'Spotify Secret',
    emoji: '🎵',
    steps: 'Now paste your **Client Secret** (click "View client secret" on the dashboard):',
  },
  youtube: {
    name: 'YouTube Cookies',
    emoji: '▶️',
    steps: [
      '**Getting YouTube cookies (for age-restricted videos):**',
      '1. Open **Edge** or **Chrome**',
      '2. Go to **youtube.com** and log in',
      '3. Press **F12** → **Application** tab',
      '4. Click **Cookies** → `https://www.youtube.com`',
      '5. Find cookies named `SAPISID`, `SSID`, `APISID`, `SID`, `HSID`',
      '6. Format them as: `SAPISID=value; SSID=value; APISID=value; SID=value; HSID=value`',
      '',
      'Paste your cookies string here:',
    ].join('\n'),
  },
};

async function cmdCreds(msg, args) {
  const guild = msg.guild ?? await client.guilds.fetch(msg.guildId);
  if (guild.ownerId !== msg.author.id) {
    return msg.reply('❌ Only the server owner can manage credentials.');
  }

  const sub = args[0]?.toLowerCase();

  if (sub === 'status') {
    return msg.reply({
      embeds: [{
        color: 0x5865F2,
        title: '🔑 Credentials Status',
        fields: [
          { name: '🍎 Apple Music', value: credentials.applemusic ? '✅ Set' : '❌ Not set', inline: true },
          { name: '🎵 Spotify', value: credentials.spotifyClientId ? '✅ Set' : '❌ Not set', inline: true },
          { name: '🎶 Deezer', value: '✅ Active (metadata only via YouTube)', inline: true },
          { name: '▶️ YouTube Cookies', value: credentials.youtubeCookies ? '✅ Set' : '❌ Not set', inline: true },
        ],
      }],
    });
  }

  if (sub === 'clear') {
    const type = args[1]?.toLowerCase();
    const map = {
      applemusic: 'applemusic',
      spotify: ['spotifyClientId', 'spotifyClientSecret'],
      youtube: 'youtubeCookies',
    };
    if (!map[type]) {
      return msg.reply('❌ Valid types: `applemusic`, `spotify`, `youtube`');
    }
    const keys = Array.isArray(map[type]) ? map[type] : [map[type]];
    keys.forEach(k => credentials[k] = null);
    saveCreds();
    return msg.reply(embed(0x57F287, `🗑️ Cleared **${type}** credentials.`));
  }

  const validTypes = ['applemusic', 'spotify', 'youtube'];
  if (!sub || !validTypes.includes(sub)) {
    return msg.reply({
      embeds: [{
        color: 0x5865F2,
        title: '🔑 Credential Setup',
        description: [
          'Use one of these commands to set credentials:',
          '',
          '`!melodycreds applemusic` — Set Apple Music token',
          '`!melodycreds spotify` — Set Spotify Client ID + Secret *(requires Premium account)*',
          '`!melodycreds youtube` — Set YouTube cookies',
          '`!melodycreds status` — View current credential status',
          '`!melodycreds clear <type>` — Remove credentials',
        ].join('\n'),
      }],
    });
  }

  const info = CREDS_INSTRUCTIONS[sub];
  credsSessions.set(msg.author.id, {
    step: sub,
    channelId: msg.channelId,
    guildId: msg.guildId,
    data: {},
  });
  setTimeout(() => credsSessions.delete(msg.author.id), 120000);

  msg.reply({
    embeds: [{
      color: 0x5865F2,
      title: `${info.emoji} ${info.name} Setup`,
      description: info.steps,
      footer: { text: 'Type cancel to abort.' },
    }],
  });
}

async function continueCredsSession(userId, session, msg) {
  const text = msg.content.trim();

  if (text.toLowerCase() === 'cancel') {
    credsSessions.delete(userId);
    return msg.reply('❌ Cancelled.');
  }

  if (session.step === 'applemusic') {
    if (!text.startsWith('eyJ')) {
      return msg.reply('❌ That does not look like a valid Apple Music token. It should start with eyJ. Try again or type cancel.');
    }
    credentials.applemusic = text;
    saveCreds();
    credsSessions.delete(userId);
    await msg.reply(embed(0x57F287, '✅ Apple Music token saved! Updating config and restarting Lavalink...'));
    updateApplicationYml();
    await restartLavalink();
    return sendMsg(session.channelId, embed(0x57F287, '✅ Lavalink restarted! Apple Music is now active.'));
  }

  if (session.step === 'spotify') {
    if (text.length < 20) {
      return msg.reply('❌ That does not look like a valid Client ID. Try again or type cancel.');
    }
    session.data.clientId = text;
    session.step = 'spotify_secret';
    credsSessions.set(userId, session);
    const info = CREDS_INSTRUCTIONS.spotify_secret;
    return msg.reply({
      embeds: [{
        color: 0x5865F2,
        title: `${info.emoji} ${info.name}`,
        description: info.steps,
      }],
    });
  }

  if (session.step === 'spotify_secret') {
    if (text.length < 20) {
      return msg.reply('❌ That does not look like a valid Client Secret. Try again or type cancel.');
    }
    credentials.spotifyClientId = session.data.clientId;
    credentials.spotifyClientSecret = text;
    // Reset cached token so next search uses the new credentials
    _spotifyToken = null;
    _spotifyTokenExpiry = 0;
    saveCreds();
    credsSessions.delete(userId);
    return msg.reply(embed(0x57F287, '✅ Spotify credentials saved! Spotify links will now resolve correctly.'));
  }

  if (session.step === 'youtube') {
    credentials.youtubeCookies = text;
    saveCreds();
    credsSessions.delete(userId);
    writeFileSync('./youtube-cookies.txt',
      `# Netscape HTTP Cookie File\n# YouTube cookies\n` +
      `.youtube.com\tTRUE\t/\tTRUE\t0\t` +
      text.split(';').map(c => {
        const [k, v] = c.trim().split('=');
        return `${k}\t${v}`;
      }).join('\n.youtube.com\tTRUE\t/\tTRUE\t0\t')
    );
    return msg.reply(embed(0x57F287, '✅ YouTube cookies saved! They will be used on the next search.'));
  }

}

// ─── Command Router ───────────────────────────────────────────────────────────
const commandMap = {
  join: cmdJoin,
  move: cmdMove,
  leave: cmdLeave,
  play: cmdPlay,
  p: cmdPlay,
  search: cmdSearch,
  skip: cmdSkip,
  s: cmdSkip,
  stop: cmdStop,
  pause: cmdPause,
  queue: cmdQueue,
  q: cmdQueue,
  shuffle: cmdShuffle,
  loop: cmdLoop,
  volume: cmdVolume,
  nowplaying: cmdNp,
  np: cmdNp,
  remove: cmdRemove,
  help: cmdHelp,
  setup: cmdSetup,
  creds: cmdCreds,
};

// ─── Events ───────────────────────────────────────────────────────────────────
let _botReady = false;

// Stash voice channel config before login so the platform cannot auto-join on startup.
// It gets restored after Ready fires and queues are cleared.
const _stashedVoiceChannels = {};
for (const [gid, cfg] of Object.entries(serverConfigs)) {
  _stashedVoiceChannels[gid] = cfg.voiceChannels;
  cfg.voiceChannels = [];
}

client.on(Events.Ready, () => {
  console.log(`✅ Logged in as @${client.user.username}`);
  updateApplicationYml();
  // Restore voice channel config now that we are ready
  for (const [gid, vcs] of Object.entries(_stashedVoiceChannels)) {
    if (serverConfigs[gid]) serverConfigs[gid].voiceChannels = vcs;
  }
  // Clear any stale queue state so playback never auto-resumes on restart
  guildQueues.clear();
  _botReady = true;
  console.log('[bot] Ready — voice channel config restored, accepting commands');
});

client.on(Events.MessageCreate, async (msg) => {
  if (!_botReady) return;
  if (msg.author?.bot || !msg.guildId) return;

  const guildId = msg.guildId;
  const cfg = serverConfigs[guildId];

  // Creds session
  const credsSession = credsSessions.get(msg.author.id);
  if (credsSession && credsSession.channelId === msg.channelId) {
    await continueCredsSession(msg.author.id, credsSession, msg);
    return;
  }

  // Setup session
  const session = setupSessions.get(guildId);
  if (session?.ownerId === msg.author.id) {
    await continueSetup(guildId, session, msg);
    return;
  }

  // Pending search pick
  const pending = pendingSearches.get(msg.author.id);
  if (pending?.channelId === msg.channelId) {
    const text = msg.content.trim().toLowerCase();
    if (text === 'cancel') {
      pendingSearches.delete(msg.author.id);
      return msg.reply('❌ Cancelled.');
    }
    const n = parseInt(text);
    if (n >= 1 && n <= pending.tracks.length) {
      pendingSearches.delete(msg.author.id);
      const track = { ...pending.tracks[n - 1], requester: msg.author };
      let queue = guildQueues.get(guildId);
      if (!queue?.connection?.isConnected?.()) {
        const vc = getBestVoiceChannel(guildId);
        if (!vc) return msg.reply('❌ No voice channels available.');
        queue = await joinChannel(guildId, vc.id, msg.channelId);
      }
      queue.textChannelId = msg.channelId;
      queue.tracks.push(track);
      if (queue.playing) {
        return msg.reply(embed(0x57F287, `✅ Added **[${track.title}](${track.uri})** to queue.`));
      }
      startQueue(guildId);
      return;
    }
  }

  const content = msg.content?.toLowerCase() ?? '';
  const isGlobal =
    content.startsWith(`${PREFIX.toLowerCase()}setup`) ||
    content.startsWith(`${PREFIX.toLowerCase()}help`);
  if (cfg && msg.channelId !== cfg.controlChannelId && !isGlobal) return;
  if (!content.startsWith(PREFIX.toLowerCase())) return;

  const args = msg.content.slice(PREFIX.length).trim().split(/\s+/);
  const cmdName = args.shift().toLowerCase();
  const handler = commandMap[cmdName];
  if (!handler) return;

  try {
    await handler(msg, args);
  } catch (err) {
    console.error(`Error in "${cmdName}":`, err);
    msg.reply(`❌ Error: \`${err.message}\``).catch(() => null);
  }
});

client.on(Events.Error, (err) => console.error('Client error:', err));

// Graceful shutdown — leave all voice channels so a restarted instance doesn't see a ghost connection
async function shutdown() {
  console.log('Shutting down...');
  for (const [guildId, queue] of guildQueues) {
    try {
      if (queue.connection) queue.connection.destroy();
      voiceManager.leave(guildId);
    } catch {}
  }
  guildQueues.clear();
  if (lavalinkProcess) { try { lavalinkProcess.kill('SIGTERM'); } catch {} }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('unhandledRejection', (err) => console.error('Unhandled rejection:', err));
process.on('uncaughtException', (err) => console.error('Uncaught exception:', err));

console.log('Logging in with token:', token.slice(0, 20) + '...');
client.on(Events.Debug, (msg) => console.log('[debug]', msg));
await client.login(token);
console.log('Login called successfully');
