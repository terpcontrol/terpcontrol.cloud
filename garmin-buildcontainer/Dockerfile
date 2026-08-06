# Build container for the Garmin Connect IQ viewer app (garmin/).
#
# The Connect IQ compiler is a Java program, so only the JRE and the SDK's
# compiler bits are kept. Simulator, docs, samples and the language server make
# up ~85% of the SDK download and are dropped to keep the image small.

FROM golang:1.24-bookworm AS sdkmanager

# Garmin only ships the SDK manager as a GUI app, so the community CLI is used
# to log in and fetch the per-device compiler definitions.
ARG SDK_MANAGER_VERSION=v0.8.4
ENV CGO_ENABLED=0
RUN go install "github.com/lindell/connect-iq-sdk-manager-cli@${SDK_MANAGER_VERSION}"


FROM eclipse-temurin:21-jre-noble

# Pinned so a Garmin SDK release cannot change the build under us. The file name
# is listed in https://developer.garmin.com/downloads/connect-iq/sdks/sdks.json
ARG CONNECTIQ_SDK=connectiq-sdk-lin-9.2.0-2026-06-09-92a1605b2

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update -qq && \
    apt-get install -y -qq --no-install-recommends \
      ca-certificates \
      curl \
      openssl \
      unzip \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

COPY --from=sdkmanager /go/bin/connect-iq-sdk-manager-cli /usr/local/bin/connect-iq-sdk-manager

RUN curl -fsSL -o /tmp/sdk.zip \
      "https://developer.garmin.com/downloads/connect-iq/sdks/${CONNECTIQ_SDK}.zip" \
 && mkdir -p /opt/connectiq \
 && unzip -q /tmp/sdk.zip -d /opt/connectiq \
 && rm /tmp/sdk.zip \
 && cd /opt/connectiq \
 && rm -rf doc resources samples ./*.html \
           share/simulator \
           bin/simulator bin/era bin/era.bat bin/era.jar \
           bin/LanguageServer.jar bin/monkeymotion bin/fit-graph.jar \
 && chmod +x bin/monkeyc bin/barrelbuild

ENV PATH="/opt/connectiq/bin:${PATH}"

COPY build-app.sh /usr/local/bin/build-app.sh
RUN chmod +x /usr/local/bin/build-app.sh

ENTRYPOINT ["/usr/local/bin/build-app.sh"]
