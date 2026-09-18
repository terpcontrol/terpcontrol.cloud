ARG DOCKER_NODE_SERVER_IMAGE

# Common build stage
FROM ${DOCKER_NODE_SERVER_IMAGE} as common-build-stage

# ttf-dejavu: the offline caption drawn into webcam stills needs a font that
# fontconfig can find, otherwise the text renders empty.
RUN apk add --no-cache ffmpeg ttf-dejavu

WORKDIR /app

COPY shared-types ./shared-types
COPY server/package.json server/package-lock.json ./server/
WORKDIR /app/server

# The integration harness downloads a mongod binary on demand; the image is
# built with the dev dependencies but must not carry one.
ENV MONGOMS_DISABLE_POSTINSTALL=1

RUN npm ci

# The shared package is linked with `file:`, and npm hoists a linked package's
# own dependencies into the consumer's node_modules - which node never looks in
# when it resolves an import from inside the linked package itself. The v1
# schemas the server validates against are zod objects, so they need zod
# resolvable from /app/shared-types.
RUN npm --prefix /app/shared-types ci --omit=dev

COPY server/ .
EXPOSE 3000

ENV NODE_ENV production

# Run as the non-root user shipped with the base image; ensure the app
# directory and log directory are writable by it.
ENV LOG_DIR=/var/log/terpcontrol
RUN mkdir -p ${LOG_DIR} && chown -R node:node /app ${LOG_DIR}
USER node

CMD ["npm", "run", "start"]
