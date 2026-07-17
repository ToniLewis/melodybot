const Queue = require('../structures/queue');

module.exports = {
  command: 'melodynp',

  run: async (args, message, client) => {
    const rawPlayer = client.lavalink.getPlayer(message.guild.id);
    if (!rawPlayer?.queue?.current)
      return message.channel.send('❌ Nothing is playing!');

    const queue = new Queue(rawPlayer, client);
    const embed = queue.buildNowPlayingEmbed();
    message.channel.send({ embeds: [embed] });
  },
};
