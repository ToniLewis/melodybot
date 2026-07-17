const Queue = require('../structures/queue');
const { volumeBar } = require('../utils');

module.exports = {
  command: 'melodyvolume',

  run: async (args, message, client) => {
    if (!message.member?.voice?.channel)
      return message.channel.send('❌ You must be in a voice channel!');

    const rawPlayer = client.lavalink.getPlayer(message.guild.id);
    if (!rawPlayer) return message.channel.send('❌ Nothing is playing!');

    const queue = new Queue(rawPlayer, client);

    if (!args[0])
      return message.channel.send(`🔊 Current volume: **${queue.volume}%**\n\`[${volumeBar(queue.volume)}]\``);

    const vol = parseInt(args[0]);
    if (isNaN(vol) || vol < 1 || vol > 150)
      return message.channel.send('❌ Volume must be between **1** and **150**.');

    await queue.setVolume(vol);
    message.channel.send(`🔊 Volume set to **${vol}%**\n\`[${volumeBar(vol)}]\``);
  },
};
