Deployment using Docker Compose

Overview
- nginx serves the static frontend files (the project root contains index.html and per-role folders).
- The Python API runs under Gunicorn (model.api:app) in a separate container and is proxied by nginx.

Quick start (on a Linux server with Docker & Docker Compose installed):

1. Copy the repository to the server (git clone or rsync/upload).

2. From the `deploy/` directory run:

```bash
docker compose up --build -d
```

3. Optional: Mount or copy `firebase/serviceAccountKey.json` into the container if the server should write to Firestore.
   For example, when running the compose command you can set an extra bind mount in `docker-compose.yml` under the `api` service:

```yaml
    volumes:
      - ..:/app:ro
      - ../firebase/serviceAccountKey.json:/app/firebase/serviceAccountKey.json:ro
```

4. Visit http://<server-ip>/ to access the frontend. API requests at endpoints like `/predict` will be proxied to the API container.

Notes
- Ensure you configure any production firewall and add HTTPS (use Certbot or put a TLS-terminating proxy in front).
- For production scale or advanced monitoring, prefer a managed container service (Cloud Run, Render, Railway) or orchestrate with Kubernetes.
