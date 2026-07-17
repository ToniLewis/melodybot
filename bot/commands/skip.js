const Queue = require('../structures/queue');

module.exports = {
  command: 'melodyskip',

  run: async (args, message, client) => {
    if (!message.member?.voice?.channel)
      return message.channel.send('❌ You must be in a voice channel!');

    const rawPlayer = client.lavalink.getPlayer(message.guild.id);
    if (!rawPlayer?.playing)
      return message.channel.send('❌ Nothing is playing!');

    const queue   = new Queue(rawPlayer, client);
    const current = queue.current;

    await queue.skip();
    message.channel.send(`⏭️ Skipped **${current?.info?.title || 'the current track'}**.`);
  },
};
