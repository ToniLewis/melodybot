const config = require('../config.json');

module.exports = {
  name: 'messageCreate',
  once: false,

  async execute(message, client) {
    if (message.author.bot || !message.guild) return;

    // Commands are typed as: !melody<command> [args...]
    // e.g. !melodyplay, !melodysearch, !melodyskip
    const prefix = config.prefix.toLowerCase(); // "!melody"
    if (!message.content.toLowerCase().startsWith(prefix)) return;

    const args        = message.content.slice(prefix.length).trim().split(/\s+/);
    const commandName = args.shift()?.toLowerCase();
    if (!commandName) return;

    const command = client.commands.get(commandName);
    if (!command) return;

    try {
      await command.run(args, message, client);
    } catch (err) {
      console.error(`[Error] "${commandName}":`, err);
      message.channel.send('❌ Something went wrong running that command.').catch(() => {});
    }
  },
};
