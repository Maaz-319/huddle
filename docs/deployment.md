# Local and tunnel access

This guide covers localhost and exposing the local development app to another device through one Cloudflare Quick Tunnel. It does not cover public production hosting.

## Localhost only

Follow [setup.md](setup.md). Keep the web and API examples on localhost, use the GitHub callback `http://localhost:3000/auth/github/callback`, and open `http://localhost:5173`.

## Cloudflare Quick Tunnel

The tunnel points to the Vite web server on port `5173`. Vite proxies API routes and Socket.IO to the API on port `3000`, so remote browsers use the tunnel's page origin for both. Do not set `VITE_API_URL` to localhost for a remote browser, and do not expose a second tunnel for port 3000.

1. Start Postgres and Redis, then run the API and Vite as in [setup.md](setup.md).
2. Start a Quick Tunnel to Vite:

   ```sh
   cloudflared tunnel --url http://localhost:5173
   ```

3. Copy the generated `https://<host>.trycloudflare.com` address. In `apps/web/.env`, put only `<host>.trycloudflare.com` in `WEB_ALLOWED_HOSTS`. Keep `VITE_API_URL` empty and `API_PROXY_TARGET=http://localhost:3000`.
4. In `apps/api/.env`, set `WEB_ORIGIN` to the full tunnel origin and `GITHUB_CALLBACK_URL` to `<origin>/auth/github/callback`. Keep the API local and `TRUSTED_PROXY_HOPS=0`, since the browser's API calls pass through Vite.
5. Set the same callback URL in the GitHub OAuth App. Restart Vite after changing its env file, and restart the API after changing its env file.
6. Open the tunnel URL on the other device and sign in.

Quick Tunnel hostnames change when a new tunnel starts. Update `WEB_ALLOWED_HOSTS`, `WEB_ORIGIN`, and the GitHub callback URL each time the hostname changes. Do not commit either `.env` file or OAuth secrets.
