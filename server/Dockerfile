# check=skip=InvalidDefaultArgInFrom
# The base image is docker-compose.yaml's to choose (DOCKER_NODE_SERVER_IMAGE),
# and compose always passes one, so the argument has no default here.
ARG DOCKER_NODE_SERVER_IMAGE

# Compiles the server. Only dist/ leaves this stage: the compiler, the tests'
# tools and the linters are dev dependencies and stay behind with it.
FROM ${DOCKER_NODE_SERVER_IMAGE} AS build

# npm's audit and funding footers and its notice of a newer npm read the same
# on every build; CI's audit job checks what the runtime stage below installs.
ENV NPM_CONFIG_AUDIT=false NPM_CONFIG_FUND=false NPM_CONFIG_UPDATE_NOTIFIER=false

# The integration harness downloads a mongod binary on demand; nothing here
# runs it.
ENV MONGOMS_DISABLE_POSTINSTALL=1

WORKDIR /app/server
COPY shared-types /app/shared-types
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server/ .
RUN npm run build

# What runs: the production dependencies, the compiled server and nothing that
# builds or tests it. `npm audit --omit=dev` in server/ and shared-types/ reads
# exactly what this stage installs.
FROM ${DOCKER_NODE_SERVER_IMAGE}

# ttf-dejavu: the offline caption drawn into webcam stills needs a font that
# fontconfig can find, otherwise the text renders empty. It stays the fallback
# behind the app's own faces, which are installed further down.
RUN apk add --no-cache ffmpeg ttf-dejavu

ENV NPM_CONFIG_AUDIT=false NPM_CONFIG_FUND=false NPM_CONFIG_UPDATE_NOTIFIER=false

WORKDIR /app/server
COPY shared-types /app/shared-types
COPY server/package.json server/package-lock.json ./

# allowScripts in package.json decides which install scripts run; of the
# production dependencies that is bcrypt's, which finds its prebuilt binary.
#
# The shared package is linked with `file:`, and npm hoists a linked package's
# own dependencies into the consumer's node_modules - which node never looks in
# when it resolves an import from inside the linked package itself. The v1
# schemas the server validates against are zod objects, so they need zod
# resolvable from /app/shared-types.
#
# npm's cache goes in the same step, or the image carries it.
RUN npm ci --omit=dev && npm --prefix /app/shared-types ci --omit=dev && rm -rf /root/.npm

# The text drawn into films and a shared link's card is set in the app's own
# faces. librsvg reaches them through fontconfig, which reads no WOFF, so the
# @fontsource files are unpacked to .ttf here, with a fonts.conf that adds them
# to the system's fonts; scripts/install-fonts.mjs says the rest. The cache is
# built now, as root, so the server's user never has to write one.
COPY server/scripts/install-fonts.mjs ./scripts/
RUN node scripts/install-fonts.mjs /app/fonts && FONTCONFIG_FILE=/app/fonts/fonts.conf fc-cache -f
ENV FONTCONFIG_FILE=/app/fonts/fonts.conf

COPY --from=build /app/server/dist ./dist

EXPOSE 3000

ENV NODE_ENV=production

# Run as the non-root user shipped with the base image. It writes nothing but
# its logs - scratch files go to the system's temporary directory - so the app
# stays root's and read-only to it.
ENV LOG_DIR=/var/log/terpcontrol
RUN mkdir -p ${LOG_DIR} && chown node:node ${LOG_DIR}
USER node

# node itself rather than an npm script, so the stop signal goes straight to
# the server.
CMD ["node", "dist/main.js"]
