# check=skip=InvalidDefaultArgInFrom
# The base images are docker-compose.yaml's to choose, and compose always passes
# both, so the arguments have no default here.
ARG DOCKER_NODE_WEBAPP_IMAGE
ARG DOCKER_NGINX_IMAGE

### STAGE 1: Build ###
FROM ${DOCKER_NODE_WEBAPP_IMAGE} AS build
WORKDIR /usr/src
COPY shared-types ./shared-types
COPY webapp/package.json webapp/package-lock.json ./app/
WORKDIR /usr/src/app
# npm's audit and funding footers and its notice of a newer npm read the same
# on every build; CI's audit job checks what ships.
ENV NPM_CONFIG_AUDIT=false NPM_CONFIG_FUND=false NPM_CONFIG_UPDATE_NOTIFIER=false
RUN npm ci

# The build type-checks against the contract, which is linked with `file:`, and
# node resolves a linked package's own imports from the package rather than from
# whoever linked it. The app imports values from `/v1-schemas`, whose own
# dependencies must be installed for them to resolve (server/Dockerfile spells it
# out). The stage is thrown away, so this costs the served image nothing.
RUN npm --prefix /usr/src/shared-types ci --omit=dev

COPY webapp/ .
# There is no ../.env in the image, so `set-env` finds nothing and this is what
# names the API the bundle is compiled against.
ARG API_URL_EXTERNAL
ARG CUSTOM_LINKS_HTML
ARG PRIVACY_URL
ENV VITE_API_URL=${API_URL_EXTERNAL}
# An install's own links below the sign-in form (imprint, terms). Whoever builds
# the image writes it, which is why it may be markup.
ENV VITE_CUSTOM_LINKS_HTML=${CUSTOM_LINKS_HTML}
# The privacy statement a sign-up agrees to; without one the sign-up links the
# app's own page of what the software keeps.
ENV VITE_PRIVACY_URL=${PRIVACY_URL}
RUN npm run build

### STAGE 2: Run ###
FROM ${DOCKER_NGINX_IMAGE}

COPY webapp/nginx.conf /etc/nginx/conf.d/default.conf

COPY --from=build /usr/src/app/dist /app
