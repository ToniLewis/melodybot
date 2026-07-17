const Queue = require('../structures/queue');

module.exports = {
  command: 'melodypause',

  run: async (args, message, client) => {
    if (!message.member?.voice?.channel)
      return message.channel.send('❌ You must be in a voice channel!');

    const rawPlayer = client.lavalink.getPlayer(message.guild.id);
    if (!rawPlayer?.queue?.current)
      return message.channel.send('❌ Nothing is playing!');

    const queue  = new Queue(rawPlayer, client);
    const paused = await queue.pause();
    message.channel.send(paused ? '⏸️ Paused.' : '▶️ Resumed.');
  },
};
