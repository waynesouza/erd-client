# ERD Client

This project is a web-based application developed using Angular, TypeScript, and JavaScript. It provides a user interface for creating and managing diagrams, specifically entity-relationship diagrams.

## Getting Started

These instructions will get you a copy of the project up and running on your local machine for development and testing purposes.

## Running with Docker

This is the recommended way to run the full stack locally. The `docker-compose.yml` in this repository orchestrates all services: PostgreSQL, MongoDB, the backend (erd-core), and the frontend (erd-client).

1. **Start all services** from the `erd-client/` directory:

```bash
docker compose up --build
```

> The first build takes several minutes as Maven downloads all dependencies. Subsequent runs are faster thanks to the cached Maven volume.

### Useful commands

```bash
# Run in background
docker compose up -d

# View logs for a specific service
docker compose logs -f erd-client

# Stop all services
docker compose down

# Stop and remove all volumes (resets database data)
docker compose down -v

# Rebuild a specific service
docker compose up --build erd-client
```

## Running Locally (without Docker)

### Prerequisites

- Node.js and npm installed on your machine
- Angular CLI installed globally
- Backend (erd-core) running on port 8080

### Installing

1. Clone the repository to your local machine.
2. Navigate to the project directory.
3. Run `npm install` to install all the dependencies.
4. Run `ng serve` to start the development server.
5. Open http://localhost:4200 in your browser.

## Deploy

The production image serves the Angular build with nginx and proxies `/api` and `/ws` to the
backend, so both run on a single origin. The upstream comes from the `BACKEND_URL` environment
variable, which defaults to `http://erd-core:8080` (the docker-compose service) and is set to
erd-core's public URL when deployed.

`render.yaml` in this repository is the Render Blueprint for this service; the backend has its own
in the erd-core repository, which is also where the database setup is documented. Create it with
**New → Blueprint** in Render, pointing at this repository.

Deploys use `autoDeployTrigger: checksPass`, so merging a pull request into `main` only deploys
after the merge commit's checks are green. Render skips the deploy when a commit carries no checks
at all, which is why `build.yml` also runs on pushes to `main`.

### Environment variables

No secret is needed here: the frontend holds no credentials.

| Variable | Value | Why |
| --- | --- | --- |
| `PORT` | `80` | Port nginx listens on and Render routes traffic to |
| `BACKEND_URL` | `https://erd-core.onrender.com` | Upstream of the `/api` and `/ws` proxies. It must be the backend's real URL — if Render suffixed that service's name, use the suffixed one. |

Both come from `render.yaml`, so there is nothing to type when creating the Blueprint.

#### Set by the Dockerfile

Part of how the image works; leave them alone.

| Variable | Value | Why |
| --- | --- | --- |
| `BACKEND_URL` | `http://erd-core:8080` | Default upstream, which is what keeps `docker-compose` working with no extra configuration. Render overrides it. |
| `NGINX_ENTRYPOINT_LOCAL_RESOLVERS` | `1` | Makes the entrypoint publish the container's DNS servers as `NGINX_LOCAL_RESOLVERS`, needed because the upstream lives in an nginx variable and is resolved per request |
| `NGINX_ENVSUBST_FILTER` | `^(BACKEND_URL\|NGINX_LOCAL_RESOLVERS)$` | Restricts `envsubst` to these two names, so nginx's own `$uri`, `$host` and friends survive the template rendering |

#### Local development (`.env`)

`docker-compose.yml` reads `.env`, which is gitignored; `.env.example` carries working values for
every key. The frontend itself only uses `CLIENT_LOCAL_PORT` and `CLIENT_DOCKER_PORT` — the
remaining keys (Postgres, MongoDB, JWT) belong to the other services the compose file starts.

#### Not environment variables

The API and WebSocket addresses are baked in at build time from
`src/environments/environment.prod.ts`, which points at the relative paths `/api` and `/ws` so the
nginx proxy can route them. Changing the backend URL is a matter of `BACKEND_URL`, not of
rebuilding the Angular bundle.

## Built With

- [Angular](https://angular.io/)
- [TypeScript](https://www.typescriptlang.org/)
- [JavaScript](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
- [GoJS](https://gojs.net/latest/index.html) - for creating and managing interactive diagrams
- [SockJS](https://github.com/sockjs/sockjs-client) and [StompJS](https://stomp-js.github.io/stomp-websocket/codo/extra/docs-src/Usage.md.html) - for communicating with the server
