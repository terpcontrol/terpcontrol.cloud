#!/bin/bash
set -e

export BUILD_TYPE=${1}

if [ -z "$FW_VERSION_ID" ]; then
  export FW_VERSION_ID=$(fgcli.py "create-fw" "${BUILD_TYPE}" "${FW_UPLOAD_VERSION:-0.0.0}")
fi

export PLATFORMIO_BUILD_FLAGS="-DDEVELOPMENT_BUILD"

export MQTT_HOST=${FG_MQTT_HOST}
export MQTT_PORT=${FG_MQTT_PORT}
export API_URL=${FG_API_URL}

# Generate src/mqtt_ca.gen.h. Always writing the file (even when MQTTS is not
# configured) keeps fridgecloud.cpp's #include unconditional and avoids stale
# state on rebuilds. The CA PEM is embedded as a C++ raw string literal so the
# newlines in the cert don't need escaping.
CA_GEN_HEADER="src/mqtt_ca.gen.h"
if [ -n "$FG_MQTT_CA_PEM_B64" ]; then
  CA_PEM=$(printf '%s' "$FG_MQTT_CA_PEM_B64" | base64 -d)
  # A raw string literal in a normal declaration can span multiple physical
  # lines; the same payload inside a #define is harder to make portable across
  # preprocessors, so we use a plain `static const char[]` here. Only
  # fridgecloud.cpp includes this header so the per-TU copy is irrelevant.
  cat > "$CA_GEN_HEADER" <<EOF
#pragma once
#define MQTT_TLS_DEFAULT 1
static const char MQTT_CA_CERT_PEM[] = R"PEM(
${CA_PEM}
)PEM";
EOF
else
  cat > "$CA_GEN_HEADER" <<'EOF'
#pragma once
#define MQTT_TLS_DEFAULT 0
static const char MQTT_CA_CERT_PEM[] = "";
EOF
fi

if [ -z "$FW_VERSION_ID" ]
then
  echo "failed to get version id";
  exit 1;
fi

pio run -e ${BUILD_TYPE}

FIRMWARE_BIN=".pio/build/${BUILD_TYPE}/firmware.bin"
MAX_OTA_FIRMWARE_BINARY_BYTES=$((2 * 1024 * 1024))

if [ ! -f "$FIRMWARE_BIN" ]; then
  echo "firmware binary not found: ${FIRMWARE_BIN}" >&2
  exit 1
fi

FIRMWARE_SIZE=$(wc -c < "$FIRMWARE_BIN" | tr -d ' ')
if [ "$FIRMWARE_SIZE" -gt "$MAX_OTA_FIRMWARE_BINARY_BYTES" ]; then
  echo "firmware binary is ${FIRMWARE_SIZE} bytes, exceeding the ${MAX_OTA_FIRMWARE_BINARY_BYTES} byte OTA partition limit" >&2
  exit 1
fi

if ! grep -a -F -q "$FW_VERSION_ID" "$FIRMWARE_BIN"; then
  echo "firmware id ${FW_VERSION_ID} was not found in ${FIRMWARE_BIN}" >&2
  exit 1
fi

echo "${FW_VERSION_ID}"

if [ -z "$FW_NO_UPLOAD" ]; then
  fgcli.py upload-fw "${FW_VERSION_ID}" firmware.bin .pio/build/${BUILD_TYPE}/firmware.bin
  fgcli.py upload-fw "${FW_VERSION_ID}" bootloader.bin .pio/build/${BUILD_TYPE}/bootloader.bin
  fgcli.py upload-fw "${FW_VERSION_ID}" partitions.bin .pio/build/${BUILD_TYPE}/partitions.bin
  fgcli.py upload-fw "${FW_VERSION_ID}" boot_app0.bin ~/.platformio/packages/framework-arduinoespressif32/tools/partitions/boot_app0.bin

  if [ -z "$FW_UPLOAD_VERSION" ]; then
    fgcli.py rollout-id ${FW_VERSION_ID} ${BUILD_TYPE}
  fi
fi
