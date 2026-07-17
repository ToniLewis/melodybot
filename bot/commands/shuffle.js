const Queue = require('../structures/queue');

module.exports = {
  command: 'melodyshuffle',

  run: async (args, message, client) => {
    if (!message.member?.voice?.channel)
      return message.channel.send('❌ You must be in a voice channel!');

    const rawPlayer = client.lavalink.getPlayer(message.guild.id);
    if (!rawPlayer?.queue?.tracks?.length)
      return message.channel.send('❌ No tracks in the queue to shuffle!');

    const count = new Queue(rawPlayer, client).shuffle();
    message.channel.send(`🔀 Shuffled **${count}** track(s).`);
  },
};
