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

## Built With

- [Angular](https://angular.io/)
- [TypeScript](https://www.typescriptlang.org/)
- [JavaScript](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
- [GoJS](https://gojs.net/latest/index.html) - for creating and managing interactive diagrams
- [SockJS](https://github.com/sockjs/sockjs-client) and [StompJS](https://stomp-js.github.io/stomp-websocket/codo/extra/docs-src/Usage.md.html) - for communicating with the server
