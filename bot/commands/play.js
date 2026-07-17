const { EmbedBuilder } = require('discord.js');
const Queue = require('../structures/queue');
const { msToTime } = require('../utils');
const { resolveExternalUrl, isSpotifyUrl, isDeezerUrl } = require('../utils/resolver');

module.exports = {
  command: 'melodyplay',

  /**
   * @param {string[]} args
   * @param {import('discord.js').Message} message
   * @param {import('discord.js').Client} client
   */
  run: async (args, message, client) => {
    const voiceChannel = message.member?.voice?.channel;
    if (!voiceChannel)
      return message.channel.send('❌ You must be in a voice channel!');

    if (!args.length)
      return message.channel.send(
        '❌ Provide a song name or URL.\n**Example:** `!melodyplay never gonna give you up`'
      );

    const query     = args.join(' ');
    const isUrl     = /^https?:\/\//i.test(query);
    const isExternal = isUrl && (isSpotifyUrl(query) || isDeezerUrl(query));

    const statusMsg = await message.channel.send(`🔍 Searching for **${query}**...`);

    try {
      // Get or create the lavalink player
      let rawPlayer = client.lavalink.getPlayer(message.guild.id);
      if (!rawPlayer) {
        rawPlayer = client.lavalink.createPlayer({
          guildId:        message.guild.id,
          voiceChannelId: voiceChannel.id,
          textChannelId:  message.channel.id,
          selfDeaf:       true,
          volume:         80,
        });
      }

      const queue = new Queue(rawPlayer, client);
      if (!rawPlayer.connected) await queue.connect();

      // ── Spotify / Deezer — resolve metadata then search YouTube ─────────
      if (isExternal) {
        const stubs = await resolveExternalUrl(query);
        await statusMsg.delete().catch(() => {});

        if (!stubs?.length)
          return message.channel.send('❌ Could not resolve that link. Try pasting the song name instead.');

        const source = isSpotifyUrl(query) ? 'Spotify' : 'Deezer';

        if (stubs.length === 1) {
          // Single track — resolve to YouTube immediately
          const stub  = stubs[0];
          const ytRes = await rawPlayer.search(`ytsearch:${stub.author} - ${stub.title}`, message.author.id);
          if (!ytRes?.tracks?.length)
            return message.channel.send(`❌ Could not find **${stub.title}** on YouTube.`);

          const track = ytRes.tracks[0];
          // Preserve original metadata for display
          track.info.title  = stub.title;
          track.info.author = stub.author;
          track.info.uri    = stub.uri;

          queue.add(track);
          if (rawPlayer.playing || rawPlayer.queue.tracks.length > 1)
            message.channel.send({ embeds: [queue.buildTrackAddedEmbed(track, rawPlayer.queue.tracks.length)] });

        } else {
          // Playlist / album — queue all stubs as lazy-resolved tracks
          // Each stub gets resolved to YouTube right before it plays
          // We add them as lightweight pending objects; the trackStart event
          // or Queue.play() will resolve them. For now, bulk-add via ytsearch
          // of the first track immediately and stub the rest.

          // Resolve first track now so playback starts fast
          const first  = stubs[0];
          const ytFirst = await rawPlayer.search(`ytsearch:${first.author} - ${first.title}`, message.author.id);
          if (ytFirst?.tracks?.[0]) {
            const t = ytFirst.tracks[0];
            t.info.title  = first.title;
            t.info.author = first.author;
            t.info.uri    = first.uri;
            queue.add(t);
          }

          // Queue remaining as pending stubs using a custom userdata flag
          // The ready.js trackStart handler should pick these up if wired,
          // but for simplicity we resolve them inline here asynchronously
          // so the queue fills up without blocking the response.
          message.channel.send({
            embeds: [
              new EmbedBuilder()
                .setColor(0x5865f2)
                .setTitle(`📋 ${source} Playlist Added`)
                .setDescription(`Resolving **${stubs.length}** tracks from ${source} via YouTube...`)
                .addFields({ name: 'Source', value: query, inline: false }),
            ],
          });

          // Resolve remaining tracks in the background
          (async () => {
            for (const stub of stubs.slice(1)) {
              try {
                const res = await rawPlayer.search(`ytsearch:${stub.author} - ${stub.title}`, message.author.id);
                if (res?.tracks?.[0]) {
                  const t = res.tracks[0];
                  t.info.title  = stub.title;
                  t.info.author = stub.author;
                  t.info.uri    = stub.uri;
                  queue.add(t);
                }
              } catch {}
            }
          })();
        }

        if (!rawPlayer.playing && !rawPlayer.paused) await queue.play();
        return;
      }

      // ── Standard path — YouTube / SoundCloud / direct URL ───────────────
      const searchQuery = isUrl ? query : `ytsearch:${query}`;
      const res = await rawPlayer.search(searchQuery, message.author.id);
      await statusMsg.delete().catch(() => {});

      if (!res?.tracks?.length)
        return message.channel.send('❌ No results found. Try a different search term.');

      if (res.loadType === 'playlist') {
        for (const t of res.tracks) queue.add(t);

        message.channel.send({
          embeds: [
            new EmbedBuilder()
              .setColor(0x5865f2)
              .setTitle('📋 Playlist Added to Queue')
              .setDescription(`**[${res.playlist?.name || 'Playlist'}](${query})**`)
              .addFields(
                { name: 'Tracks Added', value: `${res.tracks.length}`,             inline: true },
                { name: 'Queue Length', value: `${rawPlayer.queue.tracks.length}`,  inline: true },
              ),
          ],
        });

      } else {
        const track = res.tracks[0];
        queue.add(track);

        if (rawPlayer.playing || rawPlayer.queue.tracks.length > 1)
          message.channel.send({ embeds: [queue.buildTrackAddedEmbed(track, rawPlayer.queue.tracks.length)] });
      }

      if (!rawPlayer.playing && !rawPlayer.paused) await queue.play();

    } catch (err) {
      console.error('[play]', err);
      await statusMsg.delete().catch(() => {});
      message.channel.send('❌ There was an error playing that track.');
    }
  },
};
