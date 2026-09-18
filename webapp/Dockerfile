ARG DOCKER_NODE_WEBAPP_IMAGE
ARG DOCKER_NGINX_IMAGE

### STAGE 1: Build ###
FROM ${DOCKER_NODE_WEBAPP_IMAGE} AS build
WORKDIR /usr/src
COPY shared-types ./shared-types
COPY webapp/package.json webapp/package-lock.json ./app/
WORKDIR /usr/src/app
RUN npm ci

# The build type-checks against the contract, which is linked with `file:`, and
# node resolves a linked package's own imports from the package rather than from
# whoever linked it. The app reads only the flat `/v1` types today and would
# compile without this; a value read out of `/v1-schemas` would otherwise arrive
# as `any` (server/Dockerfile spells it out). The stage is thrown away, so this
# costs the served image nothing.
RUN npm --prefix /usr/src/shared-types ci --omit=dev

COPY webapp/ .
# There is no ../.env in the image, so `set-env` finds nothing and this is what
# names the API the bundle is compiled against.
ARG API_URL_EXTERNAL
ARG CUSTOM_LINKS_HTML
ENV VITE_API_URL=${API_URL_EXTERNAL}
# An install's own links below the sign-in form (imprint, terms). Whoever builds
# the image writes it, which is why it may be markup.
ENV VITE_CUSTOM_LINKS_HTML=${CUSTOM_LINKS_HTML}
RUN npm run build

### STAGE 2: Run ###
FROM ${DOCKER_NGINX_IMAGE}

COPY webapp/nginx.conf /etc/nginx/conf.d/default.conf

COPY --from=build /usr/src/app/dist /app
