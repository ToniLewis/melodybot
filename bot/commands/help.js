const { EmbedBuilder } = require('discord.js');

const COMMANDS = [
  { name: '!melodyplay <query or URL>', desc: 'Play from YouTube, Spotify, SoundCloud, and more' },
  { name: '!melodysearch <query>',      desc: 'Search and pick a track with buttons' },
  { name: '!melodyskip',               desc: 'Skip the current track' },
  { name: '!melodystop',               desc: 'Stop playback, clear queue, leave channel' },
  { name: '!melodypause',              desc: 'Toggle pause / resume' },
  { name: '!melodynp',                 desc: 'Show the now playing track + progress bar' },
  { name: '!melodyqueue',              desc: 'Show the queue (paginated)' },
  { name: '!melodyvolume [1-150]',     desc: 'View or set the volume' },
  { name: '!melodyloop',               desc: 'Cycle loop mode: off → track → queue' },
  { name: '!melodyshuffle',            desc: 'Shuffle the queue' },
  { name: '!melodyremove <position>',  desc: 'Remove a track from the queue' },
  { name: '!melodyseek <time>',        desc: 'Seek to a position, e.g. `1:30` or `90`' },
];

module.exports = {
  command: 'melodyhelp',

  run: async (args, message) => {
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('🎵 Melody — Command List')
      .setDescription('Commands are typed directly after the prefix with **no space**.\n**Example:** `!melodyplay never gonna give you up`')
      .addFields(
        COMMANDS.map(c => ({ name: `\`${c.name}\``, value: c.desc }))
      )
      .setFooter({ text: 'Powered by Lavalink • Fluxer Platform' });

    message.channel.send({ embeds: [embed] });
  },
};
