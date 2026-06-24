# Build context must be the repo root (so the chart sources in deploy/charts
# are reachable), e.g.:
#   docker build -f ui/Dockerfile -t mariadb-operator-ui .

FROM node:20-alpine AS build
WORKDIR /app
COPY ui/package.json ui/package-lock.json ./
RUN npm ci
COPY ui/ .
RUN npm run build

FROM node:20-alpine
ARG KUBECTL_VERSION=v1.31.0
ARG HELM_VERSION=v3.16.2
ARG NPM_VERSION=11.17.0
RUN apk update \
  && apk add --no-cache --upgrade libssl3 libcrypto3 \
  && apk add --no-cache curl bash \
  && curl -fsSL -o /usr/local/bin/kubectl "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')/kubectl" \
  && chmod +x /usr/local/bin/kubectl \
  && curl -fsSL "https://get.helm.sh/helm-${HELM_VERSION}-linux-$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/').tar.gz" \
     | tar -xz -C /tmp \
  && mv /tmp/linux-*/helm /usr/local/bin/helm \
  && rm -rf /tmp/linux-* \
  && apk del curl

WORKDIR /app
# Bundled npm ships its own vendored tar/minimatch/brace-expansion; pin to a
# version with patched copies (CVE-2026-26960, CVE-2026-26996, CVE-2026-33750).
RUN npm install -g "npm@${NPM_VERSION}"
COPY ui/package.json ui/package-lock.json ./
RUN npm ci --omit=dev
COPY ui/server.js ./
COPY --from=build /app/dist ./dist
# Chart sources for the helm-self-upgrade feature (see HELM_CHART_PATH in server.js).
COPY deploy/charts/mariadb-operator ./charts/mariadb-operator

ENV PORT=3001
EXPOSE 3001
USER node
CMD ["node", "server.js"]
