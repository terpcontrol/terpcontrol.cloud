ARG DOCKER_NODE_SERVER_IMAGE

# Common build stage
FROM ${DOCKER_NODE_SERVER_IMAGE} as common-build-stage

RUN apk add --no-cache ffmpeg imagemagick

WORKDIR /app

COPY shared-types ./shared-types
COPY server/package.json server/package-lock.json ./server/
WORKDIR /app/server


RUN npm ci

COPY server/ .
EXPOSE 3000

ENV NODE_ENV production

# Run as the non-root user shipped with the base image; ensure the app
# directory and log directory are writable by it.
ENV LOG_DIR=/var/log/plantalytix
RUN mkdir -p ${LOG_DIR} && chown -R node:node /app ${LOG_DIR}
USER node

CMD ["npm", "run", "start"]
