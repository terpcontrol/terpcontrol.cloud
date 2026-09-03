#!/bin/bash
set -e

DEVICE_TYPE="$1"
if [ -z "$DEVICE_TYPE" ]; then
    echo "Usage: $0 <device-type>"
    echo "Device types: plug, light, fan, fridge, controller, headless"
    exit 1
fi

. "$(dirname "${BASH_SOURCE[0]}")/scripts/load-env.sh"
terpcontrol_load_env

# The headless device runs on an Adafruit QT Py ESP32-S3: different esptool
# target, bootloader at 0x0 rather than 0x1000, a 4MB partition table that puts
# the provisioning NVS elsewhere, and it enumerates as ttyACM* (native USB)
# rather than ttyUSB*. All of it can be overridden from the environment.
if [ -z "$ESP_CHIP" ]; then
  case "$DEVICE_TYPE" in
    headless) ESP_CHIP=esp32s3 ;;
    *)        ESP_CHIP=esp32 ;;
  esac
fi

if [ -z "$NVS_RO_OFFSET" ]; then
  case "$DEVICE_TYPE" in
    headless) NVS_RO_OFFSET=0x3F0000 ;;
    *)        NVS_RO_OFFSET=0x610000 ;;
  esac
fi

docker build -t plantalytix-buildcontainer fw-buildcontainer

# copy firmware to docker volume (for mac os/windows compatibility)
docker rm -f fw-temp-container || true
docker run -d --name fw-temp-container -v fg2_firmware:/firmware -e API_URL_EXTERNAL=${API_URL_EXTERNAL} debian sleep 3600
docker cp ./firmware/. fw-temp-container:/firmware
docker exec -i fw-temp-container cp /firmware/src/wifi.cpp /firmware/src/wifi.cpp.tmpl
docker exec -i fw-temp-container sh -c 'perl -p -e '"'"'s/#API_URL_EXTERNAL#/$ENV{API_URL_EXTERNAL}/g'"'"' /firmware/src/wifi.cpp.tmpl > /firmware/src/wifi.cpp'
docker exec -i fw-temp-container rm /firmware/src/wifi.cpp.tmpl
docker rm -f fw-temp-container

# Mirror build-fw.sh: when MQTTS is configured in .env, provision the device
# with the TLS port and the CA cert so the freshly-flashed firmware connects
# over MQTTS from boot.
if [ -n "$MQTTS_CA_PEM_B64" ]; then
  PROV_MQTT_PORT=${MQTTS_PORT_EXTERNAL:-8883}
else
  PROV_MQTT_PORT=${MQTT_PORT_EXTERNAL}
fi

docker run -i --rm \
  --privileged \
  -v /dev/bus/usb:/dev/bus/usb \
  -v /dev:/dev \
  -v fg2_firmware:/firmware \
  -e SERIAL_DEVICE="${SERIAL_DEVICE}" \
  -e ESP_CHIP="${ESP_CHIP}" \
  -e NVS_RO_OFFSET="${NVS_RO_OFFSET}" \
  -e FG_AUTOMATION_TOKEN=${AUTOMATION_TOKEN} \
  -e FG_AUTOMATION_URL=${API_URL_EXTERNAL} \
  -e FG_API_URL=${API_URL_EXTERNAL} \
  -e FG_MQTT_HOST=${MQTT_HOST_EXTERNAL} \
  -e FG_MQTT_PORT=${PROV_MQTT_PORT} \
  -e FG_MQTT_CA_PEM_B64="${MQTTS_CA_PEM_B64}" \
  plantalytix-buildcontainer sh -c "cd /firmware; ./dev-provision.sh \"$DEVICE_TYPE\""

docker volume rm fg2_firmware