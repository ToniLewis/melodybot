const Queue = require('../structures/queue');
const { msToTime } = require('../utils');

module.exports = {
  command: 'melodyseek',

  run: async (args, message, client) => {
    if (!message.member?.voice?.channel)
      return message.channel.send('❌ You must be in a voice channel!');

    const rawPlayer = client.lavalink.getPlayer(message.guild.id);
    if (!rawPlayer?.queue?.current)
      return message.channel.send('❌ Nothing is playing!');

    if (!args[0])
      return message.channel.send('❌ Provide a time. **Examples:** `!melodyseek 1:30` or `!melodyseek 90`');

    let ms;
    if (args[0].includes(':')) {
      const [min, sec] = args[0].split(':').map(Number);
      ms = (min * 60 + sec) * 1000;
    } else {
      ms = parseInt(args[0]) * 1000;
    }

    try {
      await new Queue(rawPlayer, client).seek(ms);
      message.channel.send(`⏩ Seeked to **${msToTime(ms)}**.`);
    } catch (err) {
      message.channel.send(`❌ ${err.message}`);
    }
  },
};
