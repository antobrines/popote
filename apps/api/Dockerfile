# API Popote — image de production (contexte de build : racine du dépôt)
#   docker build -f apps/api/Dockerfile -t popote-api .

FROM node:24-slim AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace @bouffe/core --workspace @bouffe/api --include-workspace-root
COPY packages/core packages/core
COPY apps/api apps/api
RUN npm run build -w @bouffe/core && npm run build -w @bouffe/api
RUN npm prune --omit=dev --workspace @bouffe/core --workspace @bouffe/api --include-workspace-root

FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=build /repo/package.json ./
COPY --from=build /repo/node_modules node_modules
COPY --from=build /repo/packages/core/package.json packages/core/package.json
COPY --from=build /repo/packages/core/dist packages/core/dist
COPY --from=build /repo/apps/api/package.json apps/api/package.json
COPY --from=build /repo/apps/api/dist apps/api/dist
WORKDIR /repo/apps/api
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "dist/main.js"]
