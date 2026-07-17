module.exports = {
  name: 'ready',
  once: true,

  execute(client) {
    console.log(`[Bot] ✅ Logged in as ${client.user.tag}`);
    console.log(`[Bot] Serving ${client.guilds.cache.size} guild(s)`);

    client.user.setPresence({
      activities: [{ name: '!melodyhelp', type: 2 }], // 2 = Listening to
      status: 'online',
    });

    // Init Lavalink with the bot's real ID now that we're logged in
    client.lavalink.init({ id: client.user.id, username: client.user.username });
  },
};
