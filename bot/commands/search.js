const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const Queue = require('../structures/queue');
const { msToTime } = require('../utils');

module.exports = {
  command: 'melodysearch',

  run: async (args, message, client) => {
    const voiceChannel = message.member?.voice?.channel;
    if (!voiceChannel)
      return message.channel.send('❌ You must be in a voice channel!');

    if (!args.length)
      return message.channel.send(
        '❌ Provide a search term.\n**Example:** `!melodysearch lofi beats`'
      );

    const statusMsg = await message.channel.send('🔍 Searching...');

    try {
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
      const res   = await rawPlayer.search(`ytsearch:${args.join(' ')}`, message.author.id);

      await statusMsg.delete().catch(() => {});

      if (!res?.tracks?.length)
        return message.channel.send('❌ No results found.');

      const top5 = res.tracks.slice(0, 5);

      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(`🔍 Results for: ${args.join(' ')}`)
        .setDescription(
          top5.map((t, i) =>
            `**${i + 1}.** [${t.info.title}](${t.info.uri})\n` +
            `┗ 👤 ${t.info.author} • ⏱️ ${t.info.isStream ? '🔴 LIVE' : msToTime(t.info.duration)}`
          ).join('\n\n')
        )
        .setFooter({ text: 'Pick a track below • expires in 30s' });

      const row = new ActionRowBuilder().addComponents(
        top5.map((_, i) =>
          new ButtonBuilder()
            .setCustomId(`search_pick_${i}`)
            .setLabel(String(i + 1))
            .setStyle(ButtonStyle.Secondary)
        )
      );

      const reply = await message.channel.send({ embeds: [embed], components: [row] });

      const collector = reply.createMessageComponentCollector({
        componentType: ComponentType.Button,
        filter: b => b.user.id === message.author.id,
        time: 30_000,
        max: 1,
      });

      collector.on('collect', async interaction => {
        const idx   = parseInt(interaction.customId.split('_').pop());
        const track = top5[idx];

        queue.add(track);
        if (!rawPlayer.connected) await queue.connect();
        if (!rawPlayer.playing && !rawPlayer.paused) await queue.play();

        await interaction.update({
          embeds: [queue.buildTrackAddedEmbed(track, rawPlayer.queue.tracks.length)],
          components: [],
        });
      });

      collector.on('end', (_, reason) => {
        if (reason === 'time') reply.edit({ components: [] }).catch(() => {});
      });

    } catch (err) {
      console.error('[search]', err);
      message.channel.send('❌ There was an error searching for that.');
    }
  },
};
