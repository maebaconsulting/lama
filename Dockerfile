# Image de lama pour la démonstration publique (démo publique DP-08), fabriquée par Dokploy depuis le dépôt.
# Étape de fabrication : Node 24, pnpm, installation d'après le fichier de verrouillage, écran et serveur fabriqués.
FROM node:24-alpine AS fabrication
WORKDIR /lama
RUN npm install --global pnpm@10.23.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

# Étape d'exécution : Node 24 léger, seul le résultat fabriqué, utilisateur sans droits d'administration.
FROM node:24-alpine
ENV NODE_ENV=production \
    TZ=Africa/Douala \
    LAMA_DATA_DIR=/data \
    LAMA_PORT=8080 \
    LAMA_STATIC_DIR=/lama/dist
WORKDIR /lama
COPY --from=fabrication /lama/dist ./dist
COPY --from=fabrication /lama/dist-server ./dist-server
# Données, configuration et clé maîtresse dans le volume /data, au compte node (uid 1000).
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8080/api/auth/state').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "dist-server/main.mjs"]
