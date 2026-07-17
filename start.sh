#!/bin/bash
# Start Lavalink, then the bot

echo "Starting Lavalink..."
java -jar lavalink.jar &
LAVALINK_PID=$!

echo "Waiting for Lavalink to be ready..."
sleep 8

echo "Starting bot..."
node index.js

# If bot exits, kill lavalink too
kill $LAVALINK_PID
