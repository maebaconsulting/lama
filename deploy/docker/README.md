# lama public demo with Dokploy

This guide installs the lama public demo at `https://lama-demo.mowoapp.com`, through your Dokploy instance. Dokploy builds the image from the public repository `maebaconsulting/lama` and provides HTTPS through Traefik and Let's Encrypt. French version: [LISEZMOI.md](LISEZMOI.md).

## What you get

- lama in public demo mode: Institut Démo, fictitious data, visibly fictitious phone numbers, a "Demo" banner on every screen, documents marked "DEMO".
- Three public accounts shown on the sign-in screen: `gerante`, `reception`, `praticienne`. Their passwords and PINs cannot be changed, and they are never locked.
- A hidden administration account, `administration`, whose password is the `LAMA_DEMO_MDP_ADMIN` secret (created only if the secret has at least 10 characters).
- Nothing leaves the demo: no WhatsApp or SMS message, no backup, no file upload (logo, product photos).
- Reset every night at 3 a.m., Douala time.

## Create the application in Dokploy

1. In Dokploy, create a project (for example `lama`), then "Create Service", "Application", name `lama-demo`.
2. "General" tab, "Provider": "Git", URL `https://github.com/maebaconsulting/lama.git`, branch `main` (or "GitHub" if Dokploy is linked to GitHub: it then redeploys on every push).
3. "Build Type": "Dockerfile", Docker File `Dockerfile`, Docker Context Path `.`, Docker Build Stage empty.
4. Save. Do not deploy yet: first set the variables, the volume, the update order and the domain.

## Variables

"Environment" tab, "Environment Settings":

```
LAMA_DEMO_PUBLIQUE=1
LAMA_PROXY_HTTPS=1
LAMA_LANGUE=fr
LAMA_DEMO_MDP_ADMIN=<administration password, at least 10 characters>
```

- `LAMA_DEMO_MDP_ADMIN` never goes into the repository or a message: it is a Dokploy secret. To make one: `openssl rand -base64 18`.
- Missing, empty or too short (under 10 characters): the demo starts without an administration account, and the log says so, without ever writing the value.
- Nothing in "Build Time Arguments" or "Build-time Secrets". The `.env` file Dokploy writes during the build is kept out of the image by `.dockerignore`.

## Volume

"Advanced" tab, "Volumes", "Add Volume": "Volume Mount", name `lama-demo-donnees`, path `/data`. The demo's database, configuration and master key live there.

## Updates: stop before starting

By default, Dokploy starts the new version before stopping the old one. lama must never run twice on the same database: "Advanced" tab, "Cluster Settings", "Swarm Settings", set

- Update Config: `{"Parallelism": 1, "Order": "stop-first", "FailureAction": "rollback"}`
- Rollback Config: `{"Parallelism": 1, "Order": "stop-first"}`

Leave "Restart Policy" and "Health Check" empty: Docker then restarts lama after any stop (the nightly reset depends on it) and the `Dockerfile` health check applies. Never "on-failure" as "Restart Policy": the demo would stay stopped after the nightly reset.

## Domain and HTTPS

"Domains" tab, "Add Domain":

- Host: `lama-demo.mowoapp.com`
- Path: `/`
- Container Port: `8080`
- HTTPS: on, "Let's Encrypt" certificate

Then "Deploy". The first image build takes a few minutes, the certificate one or two more.

## DNS

The address must lead to the Dokploy server. At `mowoapp.com`, every subdomain already does, directly ("DNS only"): nothing to create. Otherwise, at Cloudflare: an `A` record `lama-demo` to the server's IP address, grey cloud first (Let's Encrypt must reach Traefik directly). Turn the Cloudflare proxy on only afterwards, with SSL "Full (strict)", never "Flexible".

## Security

- No published port: only Traefik reaches lama, through the `dokploy-network` network. Add nothing in "Advanced", "Ports": port 8080 would be reachable without HTTPS.
- `LAMA_PROXY_HTTPS=1` trusts the `X-Forwarded-Proto` header set by Traefik: this variable belongs behind a proxy only, never on an institute's mini-PC.
- The demo session cookies are `__Host-`, `Secure`, `HttpOnly` and `SameSite=Strict`.
- The demo has its own database in the `lama-demo-donnees` volume; the public passwords open nothing else.
- A visitor can temporarily lock the `administration` account by typing five wrong passwords in a row (5-minute lock, doubled with each new series, 24 hours at most). The public accounts never lock. To unlock it at once: "Restart" or "Deploy" in Dokploy; at startup, lama restores the administration account and unlocks it. The 3 a.m. reset unlocks it too.

## Another way: Compose application

The file `deploy/docker/compose.demo.yml` runs the same demo as a Dokploy "Compose" application (Compose Path `deploy/docker/compose.demo.yml`, only variable to set: `LAMA_DEMO_MDP_ADMIN`, domain on the `lama` service, port `8080`). It publishes no port and always restarts the container.

## Check

```bash
curl -sI https://lama-demo.mowoapp.com | head -1
curl -s https://lama-demo.mowoapp.com/api/auth/state
```

- The first command answers `HTTP/2 200`.
- The second shows `"formation":true` and the three public accounts in `"demo"`, never `administration`.
- In the browser: the padlock, the "Demo" banner, the three accounts below the form; tap "Manager" then "Sign in".

## Nightly reset

At 3 a.m., Douala time, lama files its reset request, announces maintenance and stops; Docker restarts it and the demo starts again fresh. If the administration account exists, it can also reset it by hand: Settings, Training, "Reset the training database".

## Redeploy

After a new push to the `main` branch of the public repository: "Deploy" in Dokploy (or automatically with the "GitHub" provider). The `lama-demo-donnees` volume is kept; the demo restarts with its accounts restored.

## Log

The application's "Logs" tab. Expected lines at startup:

```
Comptes de démonstration prêts : gerante, reception, praticienne.
Administration de la démonstration prête (administration).
lama à l'écoute sur le port 8080
```

With a password that is too short:

```
LAMA_DEMO_MDP_ADMIN trop courte (10 caractères au moins) : la démonstration démarre sans compte d'administration. Corrigez la variable du service.
```

After the nightly reset: "Remise à zéro de la nuit", then "Démonstration remise à zéro" (no device kept) at the next startup.
