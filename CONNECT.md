# Connect Leni MCP to Cursor (local + Railway)

## What you see when you click Connect

1. Cursor opens your browser.
2. **Not logged in** → Leni app login at `APP_URL` (local: `http://localhost:3000/login`).
3. After login → **Consent** (“Connect Leni to Claude”) on the API gateway (`http://127.0.0.1:8088/oauth/authorize`).
4. Click **Allow** → browser returns to Cursor (`cursor://…/oauth/callback`).
5. Done — MCP tools work in Cursor.

You only interact with the **frontend (3000)** and **consent (8088)**. Port **3050** is internal (connector); Cursor uses **8088**.

---

## Local setup (sr-services + app)

### 1. Start backend (Docker)

From `sr-services/`:

```bash
docker compose -f docker-compose.infra.yml -f docker-compose.services.yml -f docker-compose.gateway.yml up -d
```

This starts **api-gateway** (`:8088`), **leni-mcp-connector** (`:3050`), **auth-service**, **user-service**, etc.

Check:

```bash
curl http://127.0.0.1:3050/healthz
curl http://127.0.0.1:8088/.well-known/oauth-protected-resource/mcp
```

### 2. Start Leni frontend

Run your app so login works at `http://localhost:3000` (must match `APP_URL` in `sr-services/.env`).

### 3. Cursor MCP config

Project [`.cursor/mcp.json`](../.cursor/mcp.json) or user `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "leni": {
      "url": "http://127.0.0.1:8088/mcp"
    }
  }
}
```

No `Authorization` header — OAuth only.

### 4. Connect in Cursor

1. Fully quit and restart Cursor.
2. **Settings → MCP → leni** → enable / Connect.
3. Complete browser login + consent.

If stuck on “logout” with no login: disconnect **leni**, quit Cursor, reconnect.

### Connector on host instead of Docker

If you run `npm run start` in `leni-mcp-connector/` on the host:

```bash
# sr-services/.env
MCP_CONNECTOR_HOST=host.docker.internal
```

Then recreate api-gateway:  
`docker compose -f docker-compose.gateway.yml up -d api-gateway --force-recreate`

---

## Railway deploy (connector)

1. Deploy **`leni-mcp-connector/`** as its own Railway service.
2. Set env (see [`.env.example`](.env.example)):
   - `MCP_ISSUER` = public URL of your **API gateway** (e.g. `https://api.yourdomain.com`)
   - `MCP_RESOURCE_URL` = same host + `/mcp` (e.g. `https://api.yourdomain.com/mcp`)
   - `APP_URL` = Leni web app URL
   - `API_GATEWAY` = gateway URL (for `GET /users/me` from the connector)
   - `MCP_JWT_SECRET`, `JWT_ACCESS_SECRET`, `CUBE_API_TOKEN`, `CUBE_API_BASE_ENDPOINT`
3. Point **sr-services** gateway at the Railway connector host (`MCP_CONNECTOR_HOST` / port), or expose MCP/OAuth only via the gateway.

Cursor (production):

```json
{
  "mcpServers": {
    "leni": {
      "url": "https://YOUR_GATEWAY_HOST/mcp"
    }
  }
}
```

---

## MCP tools (all use Cube for data)

| Tool | Cube |
|------|------|
| `list_properties` | `runScopedQuery` |
| `list_kpis` | `meta()` + catalog filter |
| `get_kpi` | `runScopedQuery` |
| `get_rent_roll` | `runScopedQuery` |
| `list_cubes` | `meta()` |
| `query_cube` | `meta()` + `runScopedQuery` |

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| 502 on `8088` OAuth/MCP | Gateway cannot reach connector — check `MCP_CONNECTOR_HOST` (`leni-mcp-connector` in Docker, `host.docker.internal` if connector on host). |
| No login page | Start frontend on `APP_URL` (`:3000`). |
| Consent never shows | Log in first; check `JWT_ACCESS_SECRET` matches auth-service. |
| `fetch failed` in Cursor | Wrong MCP URL (old ngrok), or gateway/connector down. Use `127.0.0.1:8088/mcp`. |
