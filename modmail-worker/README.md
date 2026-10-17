# Modmail listener (DMs to the bot)

Discord only delivers direct messages over a permanent "gateway" connection, which the Vercel relay cannot keep open.
This small program keeps that connection and forwards every DM sent to the bot to the relay (`/api/dm`). The relay posts it in
your staff channel with **Reply** and **Close** buttons; **Reply** sends your answer back to the person by DM.

## Run it (any always-on computer or host, Node 18+)

```
cd modmail-worker
npm install
DISCORD_BOT_TOKEN=<the bot token> RELAY_SECRET=<same value as DM_RELAY_SECRET in Vercel> node index.js
```

Keep it running with `pm2 start index.js --name modmail`, a systemd service, or a host such as Railway, Render (background worker),
Fly.io or a small VPS. Run **one** copy only.

## Notes
- No privileged intent is needed (bots always get the content of DMs sent to them).
- People can DM the bot when they share a server with it (for example the Kite support server).
- The interactions endpoint (Reply / Close buttons) is separate and already handled by the relay.
- Only DMs from people are forwarded; server messages and other bots are ignored.
