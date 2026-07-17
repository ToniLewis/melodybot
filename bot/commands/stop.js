const Queue = require('../structures/queue');

module.exports = {
  command: 'melodystop',

  run: async (args, message, client) => {
    if (!message.member?.voice?.channel)
      return message.channel.send('❌ You must be in a voice channel!');

    const rawPlayer = client.lavalink.getPlayer(message.guild.id);
    if (!rawPlayer) return message.channel.send('❌ Nothing is playing!');

    await new Queue(rawPlayer, client).destroy();
    message.channel.send('⏹️ Stopped playback, cleared the queue, and left the channel.');
  },
};
