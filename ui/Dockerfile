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
RUN apk add --no-cache curl bash \
  && curl -fsSL -o /usr/local/bin/kubectl "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')/kubectl" \
  && chmod +x /usr/local/bin/kubectl \
  && curl -fsSL "https://get.helm.sh/helm-${HELM_VERSION}-linux-$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/').tar.gz" \
     | tar -xz -C /tmp \
  && mv /tmp/linux-*/helm /usr/local/bin/helm \
  && rm -rf /tmp/linux-* \
  && apk del curl

WORKDIR /app
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
