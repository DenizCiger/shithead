# Shithead

Online multiplayer Shithead (2-6 players) with custom rules.

    npm install
    npm start   # http://localhost:3000 (PORT env var supported)
    npm test    # rule tests + random-playout fuzz

Share the 4-letter room code or invite link. Rooms live in server memory; players reconnect via a token in localStorage.
Rules are in src/engine.ts (pure); src/server.ts is the authoritative WebSocket server.

## Deploy (Docker + Caddy)

    docker compose up -d --build

Caddyfile (WebSockets are proxied automatically):

    shithead.example.com {
        reverse_proxy 127.0.0.1:3000
    }

If Caddy itself runs in Docker, replace `127.0.0.1:3000` with the container name (e.g. `shithead:3000`) and put both on the same Docker network.
