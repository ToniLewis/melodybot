const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const Queue = require('../structures/queue');
const { msToTime } = require('../utils');

const PER_PAGE = 10;

module.exports = {
  command: 'melodyqueue',

  run: async (args, message, client) => {
    const rawPlayer = client.lavalink.getPlayer(message.guild.id);
    if (!rawPlayer?.queue?.current)
      return message.channel.send('❌ Nothing is playing!');

    const queue      = new Queue(rawPlayer, client);
    const tracks     = queue.tracks;
    const current    = queue.current;
    const totalPages = Math.max(1, Math.ceil(tracks.length / PER_PAGE));
    let   page       = 0;

    const buildEmbed = (p) => {
      const slice        = tracks.slice(p * PER_PAGE, p * PER_PAGE + PER_PAGE);
      const totalMs      = tracks.reduce((a, t) => a + (t.info.duration || 0), 0);
      const loopLabel    = queue.repeatMode === 'track' ? '🔂 Track' : queue.repeatMode === 'queue' ? '🔁 Queue' : '❌ Off';

      return new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(`📋 Queue — ${message.guild.name}`)
        .setDescription(
          `**Now Playing:**\n` +
          `🎵 [${current.info.title}](${current.info.uri}) — ` +
          `${current.info.isStream ? '🔴 LIVE' : msToTime(current.info.duration)}\n\n` +
          (slice.length
            ? `**Up Next:**\n` + slice.map((t, i) =>
                `\`${p * PER_PAGE + i + 1}.\` [${t.info.title}](${t.info.uri}) — ` +
                `${t.info.isStream ? '🔴 LIVE' : msToTime(t.info.duration)} | <@${t.requester}>`
              ).join('\n')
            : '*No more tracks queued.*'
          )
        )
        .addFields(
          { name: 'Tracks',    value: `${tracks.length}`,     inline: true },
          { name: 'Duration',  value: msToTime(totalMs),       inline: true },
          { name: 'Loop',      value: loopLabel,               inline: true },
        )
        .setFooter({ text: `Page ${p + 1}/${totalPages}` });
    };

    const buildRow = (p) => new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('q_prev').setLabel('◀ Prev').setStyle(ButtonStyle.Secondary).setDisabled(p === 0),
      new ButtonBuilder().setCustomId('q_next').setLabel('Next ▶').setStyle(ButtonStyle.Secondary).setDisabled(p >= totalPages - 1),
    );

    const reply = await message.channel.send({
      embeds: [buildEmbed(0)],
      components: totalPages > 1 ? [buildRow(0)] : [],
    });

    if (totalPages <= 1) return;

    const collector = reply.createMessageComponentCollector({
      filter: b => b.user.id === message.author.id,
      time: 60_000,
    });

    collector.on('collect', async interaction => {
      if (interaction.customId === 'q_prev' && page > 0) page--;
      else if (interaction.customId === 'q_next' && page < totalPages - 1) page++;
      await interaction.update({ embeds: [buildEmbed(page)], components: [buildRow(page)] });
    });

    collector.on('end', () => reply.edit({ components: [] }).catch(() => {}));
  },
};
