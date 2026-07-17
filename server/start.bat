@echo off
title Melody Bot

echo [1/2] Starting Lavalink...
start "Lavalink" cmd /k "cd /d "C:\Users\TaBle\Downloads\Fluxer music bot\server" && java -jar Lavalink.jar"

echo Waiting for Lavalink to initialize (60 seconds)...
timeout /t 60 /nobreak >nul

echo [2/2] Starting bot...
cd /d "C:\Users\TaBle\Downloads\Fluxer music bot\bot"
node --env-file=.env index.js

pause
