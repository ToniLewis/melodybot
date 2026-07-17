const Queue = require('../structures/queue');

const MODES  = ['none', 'track', 'queue'];
const LABELS = { none: '❌ Loop **disabled**.', track: '🔂 Now looping the **current track**.', queue: '🔁 Now looping the **entire queue**.' };

module.exports = {
  command: 'melodyloop',

  run: async (args, message, client) => {
    if (!message.member?.voice?.channel)
      return message.channel.send('❌ You must be in a voice channel!');

    const rawPlayer = client.lavalink.getPlayer(message.guild.id);
    if (!rawPlayer) return message.channel.send('❌ Nothing is playing!');

    const queue    = new Queue(rawPlayer, client);
    const next     = MODES[(MODES.indexOf(queue.repeatMode ?? 'none') + 1) % MODES.length];

    await queue.setRepeatMode(next);
    message.channel.send(LABELS[next]);
  },
};
