const { EmbedBuilder } = require('discord.js');
const { msToTime, progressBar } = require('../utils');

/**
 * Queue — wraps a lavalink-client Player instance.
 * All commands interact with this class instead of the raw player.
 */
class Queue {
  /**
   * @param {import('lavalink-client').Player} player
   * @param {import('discord.js').Client} client
   */
  constructor(player, client) {
    this.player = player;
    this.client = client;
  }

  // ── Getters ──────────────────────────────────────────────────────────────

  get current()        { return this.player.queue.current; }
  get tracks()         { return this.player.queue.tracks; }
  get playing()        { return this.player.playing; }
  get paused()         { return this.player.paused; }
  get volume()         { return this.player.volume; }
  get position()       { return this.player.position; }
  get repeatMode()     { return this.player.repeatMode; }
  get textChannelId()  { return this.player.textChannelId; }
  get voiceChannelId() { return this.player.voiceChannelId; }
  get guildId()        { return this.player.guildId; }

  // ── Playback ─────────────────────────────────────────────────────────────

  async connect()        { return this.player.connect(); }
  async play()           { return this.player.play(); }
  async skip()           { return this.player.skip(); }
  async destroy()        { return this.player.destroy(); }

  async pause(state) {
    await this.player.pause(state ?? !this.player.paused);
    return this.player.paused;
  }

  async setVolume(vol) {
    if (vol < 1 || vol > 150) throw new RangeError('Volume must be 1–150.');
    return this.player.setVolume(vol);
  }

  async seek(ms) {
    if (!this.current)                 throw new Error('Nothing is playing.');
    if (this.current.info.isStream)    throw new Error('Cannot seek in a live stream.');
    if (ms < 0 || ms > this.current.info.duration) throw new RangeError('Seek position out of range.');
    return this.player.seek(ms);
  }

  async setRepeatMode(mode) {
    // mode: 'none' | 'track' | 'queue'
    return this.player.setRepeatMode(mode);
  }

  // ── Queue Management ─────────────────────────────────────────────────────

  add(track) { return this.player.queue.add(track); }

  async search(query, requesterId) {
    return this.player.search(query, requesterId);
  }

  shuffle() {
    const q = this.player.queue.tracks;
    for (let i = q.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [q[i], q[j]] = [q[j], q[i]];
    }
    return q.length;
  }

  removeAt(index) {
    const q = this.player.queue.tracks;
    if (index < 0 || index >= q.length) throw new RangeError('Index out of range.');
    return q.splice(index, 1)[0];
  }

  // ── Embed Builders ───────────────────────────────────────────────────────

  buildNowPlayingEmbed() {
    const track = this.current;
    if (!track) return null;
    const pos = this.position || 0;
    const dur = track.info.duration || 0;
    const bar = track.info.isStream
      ? '🔴 **LIVE STREAM**'
      : `${progressBar(pos, dur)}  \`${msToTime(pos)} / ${msToTime(dur)}\``;

    return new EmbedBuilder()
      .setColor(0x5865f2)
      .setAuthor({ name: '🎵 Now Playing' })
      .setTitle(track.info.title)
      .setURL(track.info.uri)
      .setThumbnail(track.info.artworkUrl || '')
      .setDescription(bar)
      .addFields(
        { name: 'Artist',       value: track.info.author     || 'Unknown', inline: true },
        { name: 'Source',       value: track.info.sourceName || 'Unknown', inline: true },
        { name: 'Requested by', value: track.requester ? `<@${track.requester}>` : 'Unknown', inline: true },
        { name: 'Volume',       value: `${this.volume}%`,   inline: true },
        { name: 'Loop',         value: this.repeatMode === 'track' ? '🔂 Track' : this.repeatMode === 'queue' ? '🔁 Queue' : '❌ Off', inline: true },
        { name: 'Paused',       value: this.paused ? '⏸️ Yes' : '▶️ No', inline: true },
      );
  }

  buildTrackAddedEmbed(track, position) {
    return new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('➕ Added to Queue')
      .setDescription(`**[${track.info.title}](${track.info.uri})**`)
      .setThumbnail(track.info.artworkUrl || '')
      .addFields(
        { name: 'Artist',   value: track.info.author || 'Unknown', inline: true },
        { name: 'Duration', value: track.info.isStream ? '🔴 LIVE' : msToTime(track.info.duration), inline: true },
        { name: 'Position', value: `#${position}`,                 inline: true },
      );
  }
}

module.exports = Queue;
