const Queue = require('../structures/queue');

module.exports = {
  command: 'melodyremove',

  run: async (args, message, client) => {
    if (!message.member?.voice?.channel)
      return message.channel.send('❌ You must be in a voice channel!');

    const rawPlayer = client.lavalink.getPlayer(message.guild.id);
    if (!rawPlayer?.queue?.tracks?.length)
      return message.channel.send('❌ No tracks in the queue!');

    const queue = new Queue(rawPlayer, client);
    const pos   = parseInt(args[0]);

    if (isNaN(pos) || pos < 1 || pos > queue.tracks.length)
      return message.channel.send(`❌ Provide a position between **1** and **${queue.tracks.length}**.`);

    const removed = queue.removeAt(pos - 1);
    message.channel.send(`🗑️ Removed **${removed.info.title}** from the queue.`);
  },
};
