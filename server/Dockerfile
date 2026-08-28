ARG DOCKER_NODE_SERVER_IMAGE

# Common build stage
FROM ${DOCKER_NODE_SERVER_IMAGE} as common-build-stage

# ttf-dejavu: the offline caption drawn into webcam stills needs a font that
# fontconfig can find, otherwise the text renders empty.
RUN apk add --no-cache ffmpeg imagemagick ttf-dejavu

WORKDIR /app

COPY shared-types ./shared-types
COPY server/package.json server/package-lock.json ./server/
WORKDIR /app/server

# The integration harness downloads a mongod binary on demand; the image is
# built with the dev dependencies but must not carry one.
ENV MONGOMS_DISABLE_POSTINSTALL=1

RUN npm ci

COPY server/ .
EXPOSE 3000

ENV NODE_ENV production

# Run as the non-root user shipped with the base image; ensure the app
# directory and log directory are writable by it.
ENV LOG_DIR=/var/log/terpcontrol
RUN mkdir -p ${LOG_DIR} && chown -R node:node /app ${LOG_DIR}
USER node

CMD ["npm", "run", "start"]
