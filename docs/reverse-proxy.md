# Reverse proxy guidance / 反向代理说明

Voice Relay listens on `127.0.0.1:3100` by default. The application does not request certificates or bind ports 80/443. Use one dedicated hostname at the URL root; arbitrary subpaths such as `/voice-relay/` are not supported.

Your proxy must preserve the original `Host` and forward WebSocket Upgrade headers. Public browser access must use valid HTTPS.

## Nginx example

Place the following routing inside the HTTPS virtual host you already manage:

```nginx
location / {
    proxy_pass http://127.0.0.1:3100;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 60s;
}
```

## Caddy example

Add this route to the hostname whose HTTPS lifecycle you already manage:

```caddyfile
relay.example.com {
    reverse_proxy 127.0.0.1:3100
}
```

## Required routes

- `/` for the PWA and SPA fallback.
- `/api/v1/*` for REST APIs.
- `/ws` for WebSocket traffic.
- `/health/live` and `/health/ready` for health checks.

The server dynamically checks that the browser Origin matches the proxy-preserved Host. It only trusts forwarded client addresses when the direct connection comes from a loopback or private address.

