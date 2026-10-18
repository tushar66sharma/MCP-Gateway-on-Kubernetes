# One Dockerfile for all our Node apps. Build from the repo root:
#   docker build -f docker/node-app.Dockerfile --build-arg APP=mcp-woocommerce -t urumi/mcp-woocommerce:dev .
ARG APP

FROM node:24-alpine AS build
ARG APP
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/${APP}/package.json apps/${APP}/package.json
RUN npm ci --include-workspace-root --workspace @urumi/shared --workspace @urumi/${APP}
COPY packages/shared packages/shared
COPY apps/${APP} apps/${APP}
RUN npm run build -w @urumi/shared && npm run build -w @urumi/${APP}
RUN npm prune --omit=dev --workspace @urumi/shared --workspace @urumi/${APP}

FROM node:24-alpine AS runtime
ARG APP
ENV NODE_ENV=production \
    APP_ENTRY=apps/${APP}/dist/main.js
WORKDIR /app
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/packages/shared/package.json packages/shared/package.json
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/apps/${APP}/package.json apps/${APP}/package.json
COPY --from=build /app/apps/${APP}/dist apps/${APP}/dist
USER node
EXPOSE 3001
# ARG values are not visible to an exec-form CMD, so the entry path goes through ENV. `exec` keeps
# node as PID 1 so it receives SIGTERM directly.
CMD ["sh", "-c", "exec node \"$APP_ENTRY\""]
