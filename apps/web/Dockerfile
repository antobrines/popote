# PWA Popote — build Angular puis service par nginx (contexte de build : racine du dépôt)
#   docker build -f apps/web/Dockerfile -t popote-web .

FROM node:24-slim AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace @bouffe/web --include-workspace-root
# Le cœur métier est compilé avec la PWA à partir de ses sources (alias @bouffe/core).
COPY packages/core packages/core
COPY apps/web apps/web
RUN npm run build -w @bouffe/web

FROM nginx:1.29-alpine
# Adresse de l'API vue depuis le conteneur nginx (docker-compose la fixe selon le nom du service).
ENV API_UPSTREAM=http://api:3000
COPY apps/web/nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /repo/apps/web/dist/web/browser /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1/ > /dev/null || exit 1
