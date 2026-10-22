# The dashboard: a static Vite build served by unprivileged nginx (uid 101, port 8080). Build from the repo root:
#   docker build -f docker/dashboard.Dockerfile -t urumi/dashboard:dev .
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/dashboard/package.json apps/dashboard/package.json
# The dashboard does not depend on @urumi/shared, so only the root and the dashboard workspace are installed.
RUN npm ci --include-workspace-root --workspace @urumi/dashboard
COPY apps/dashboard apps/dashboard
RUN npm run build -w @urumi/dashboard

FROM nginxinc/nginx-unprivileged:1.30.6-alpine AS runtime
COPY --from=build /app/apps/dashboard/dist /usr/share/nginx/html
COPY apps/dashboard/nginx.conf /etc/nginx/conf.d/default.conf
USER 101
EXPOSE 8080
