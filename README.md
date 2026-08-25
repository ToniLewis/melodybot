# MelodyBot — Fluxer Music Bot

A music-focused bot project for **Fluxer** that connects to music services and a Lavalink server to search for, play, queue, and manage audio tracks in Fluxer communities.

This project combines JavaScript bot development, music playback features, event-driven programming, API configuration, and server-side audio processing. It was created as a learning and portfolio project focused on building an interactive music experience for users.

## ✨ Features

- Music playback for Fluxer voice channels
- Song search and track selection
- Queue management for requested music
- Audio playback support through a Lavalink server
- YouTube search and playback support
- Music-source integration through Lavalink plugins
- Command-based bot interactions
- Event handling for bot and music-player activity
- Modular project organization for commands, events, utilities, and structures

## 🛠️ Built With

- **JavaScript / Node.js** — Bot logic, commands, events, and utility functions
- **Fluxer API / Bot Platform** — Bot communication and user interaction
- **Lavalink** — Audio node server used to process and stream music
- **LavaSrc Plugin** — Adds support for additional music sources
- **LavaSearch Plugin** — Supports music and track searching
- **YouTube Plugin** — Enables YouTube-related music playback support
- **yt-dlp** — Assists with media extraction and playback handling
- **YAML** — Server configuration through `application.yml`
- **JSON** — Bot configuration and package management

## 📂 Project Structure

```text
melodybot/
├── bot/
│   ├── _internal/               # Internal bot files and supporting logic
│   ├── commands/                # Bot commands, including music-related commands
│   ├── events/                  # Event handlers for bot and player events
│   ├── node_modules/            # Installed Node.js dependencies
│   ├── structures/              # Reusable classes, structures, or bot components
│   ├── .env                     # Environment variables and private credentials
│   ├── config.json              # Bot configuration settings
│   ├── credentials.json         # Private credentials or API configuration
│   ├── gitignore                # Files intended to be ignored by Git
│   ├── index.js                 # Main bot entry point
│   ├── inspect.mjs              # Module inspection or troubleshooting script
│   ├── package-lock.json        # Locked Node.js dependency versions
│   ├── package.json             # Project metadata, scripts, and dependencies
│   ├── utils.js                 # Shared helper and utility functions
│   ├── youtube-cookies.txt      # YouTube session/cookie configuration
│   └── yt-dlp_x86.exe           # yt-dlp executable for media extraction
│
├── server/
│   ├── logs/                    # Lavalink server logs
│   ├── plugins/                 # Lavalink plugins
│   │   ├── lavasearch-plugin-1.0.0.jar
│   │   ├── lavasrc-plugin-4.8.1.jar
│   │   └── youtube-plugin-1.18.0.jar
│   ├── application.yml          # Lavalink server configuration
│   └── start.bat                # Windows script for starting the audio server
│
├── start.sh                     # Shell script for starting the project
└── README.md                    # Project documentation
```

## 📄 Key Files

| File or Folder | Purpose |
|---|---|
| `bot/index.js` | Main entry point for starting the Fluxer music bot. |
| `bot/commands/` | Contains command files used for music playback, queue management, and other bot actions. |
| `bot/events/` | Contains event handlers for bot events, user interactions, and music-player activity. |
| `bot/structures/` | Holds reusable structures, classes, or organized bot components. |
| `bot/utils.js` | Shared utility functions used throughout the bot. |
| `bot/package.json` | Lists Node.js dependencies, metadata, and available project scripts. |
| `bot/.env` | Stores private environment variables, tokens, and connection values. Do not upload this file to GitHub. |
| `bot/config.json` | Stores bot configuration settings. Sensitive values should be excluded or replaced with placeholders. |
| `bot/credentials.json` | May contain private credentials. Do not upload this file to public repositories. |
| `bot/youtube-cookies.txt` | May contain private YouTube cookie data. Do not upload this file to public repositories. |
| `server/application.yml` | Configures the Lavalink server, audio sources, plugins, and connection settings. |
| `server/plugins/` | Contains Lavalink plugins for search, additional sources, and YouTube support. |
| `server/start.bat` | Starts the Lavalink server on Windows. |
| `start.sh` | Starts the project in a shell environment, such as Linux, macOS, or a compatible hosting environment. |

## 🚀 Getting Started

### Prerequisites

Before running the project, install:

- [Node.js](https://nodejs.org/)
- npm, which is included with Node.js
- Java, required to run Lavalink
- A Fluxer bot token and bot application configuration
- A configured Lavalink server
- Git, optional but recommended for cloning the repository

### Clone the Repository

```bash
git clone https://github.com/ToniLewis/melodybot.git
cd melodybot
```

### Install Bot Dependencies

Move into the bot folder and install dependencies:

```bash
cd bot
npm install
```

### Configure Environment Variables

Create a local `.env` file inside the `bot` folder. Do **not** use or upload real credentials in public repositories.

Example:

```env
BOT_TOKEN=your_fluxer_bot_token
LAVALINK_HOST=127.0.0.1
LAVALINK_PORT=2333
LAVALINK_PASSWORD=your_lavalink_password
```

Update `config.json` and any other configuration files with your own local values as needed.

### Start the Lavalink Server

From the project’s main directory, start the audio server.

On Windows:

```bat
server\start.bat
```

On Linux or macOS, use the available startup script if it is configured:

```bash
./start.sh
```

Keep the Lavalink server running while using the music bot.

### Start the Bot

From the `bot` directory, run:

```bash
node index.js
```

If the project includes an npm start script in `package.json`, you may also be able to use:

```bash
npm start
```

## 🎵 How It Works

1. A user sends a supported music command to the Fluxer bot.
2. The bot processes the command through its command and event handlers.
3. The bot searches for a requested track through configured music sources.
4. The selected track is sent to the Lavalink server.
5. Lavalink processes the audio and sends playback to the appropriate voice channel.
6. The bot manages the queue, playback state, and user interactions.

## 🔐 Security Notice

This repository includes files that commonly contain private information:

- `.env`
- `credentials.json`
- `config.json`
- `youtube-cookies.txt`

Before sharing the repository publicly, take these steps:

1. Rotate any bot tokens, API keys, passwords, cookies, or credentials that may have been uploaded.
2. Remove sensitive files from the repository and its Git history if they contain real secrets.
3. Add sensitive files to a root `.gitignore` file.
4. Create safe template files such as `.env.example` and `credentials.example.json`.
5. Never commit personal YouTube cookies, account sessions, passwords, or live production tokens.

Example `.gitignore` entries:

```gitignore
node_modules/
.env
credentials.json
youtube-cookies.txt
config.json
logs/
*.log
```

You can keep a safe configuration template in the repository:

```text
.env.example
credentials.example.json
config.example.json
```

## 🔮 Future Improvements

- Add a complete command list with usage examples
- Add slash-command support, if supported by Fluxer
- Add playlist support
- Add skip, pause, resume, stop, loop, shuffle, and volume commands
- Add a now-playing display with track title, duration, thumbnail, and requester
- Add queue embeds or rich music-player messages
- Add user permissions and DJ-role controls
- Improve error messages and connection recovery
- Add persistent queue support
- Add logging and monitoring for bot and Lavalink activity
- Add Docker support for simpler deployment
- Deploy the bot and Lavalink server to a cloud-hosting platform
- Remove private files and replace them with secure example configuration files

## 👤 Author

Created by **Toni Lewis**

- GitHub: [ToniLewis](https://github.com/ToniLewis)
- LinkedIn: [Ta-Bless L.](https://www.linkedin.com/in/ta-bless-l-a13783273/)
- Portfolio: [Toni's Project Portfolio](https://toniwebseme.netlify.app/projects)

## 📄 License

This project is intended for educational, portfolio, and personal-use purposes.
