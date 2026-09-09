
FROM debian:11.7-slim

ENV DEBIAN_FRONTEND=noninteractive
ENV ESP_IDF_VERSION="v4.4"

RUN mkdir /app
WORKDIR /app

# Debian 11 is end-of-life. deb.debian.org has dropped its packages (they 404
# mid-install) and its bullseye-security Release file has expired, so an
# unmodified image no longer builds. Everything we install is in main, which
# archive.debian.org still serves; the archive's Release files are frozen and
# therefore always "expired", hence the Check-Valid-Until override.
#
# bullseye-security is omitted because it exists in neither place right now -
# deb.debian.org has expired it and archive.debian.org has not received it yet
# (it currently stops at buster). Add it back once the archive carries it.
RUN printf '%s\n' \
      'deb http://archive.debian.org/debian bullseye main' \
      'deb http://archive.debian.org/debian bullseye-updates main' \
    > /etc/apt/sources.list \
 && echo 'Acquire::Check-Valid-Until "false";' > /etc/apt/apt.conf.d/99no-check-valid-until

RUN apt update -qq && \
apt install -y -qq --no-install-recommends software-properties-common gpgv2 && \
apt install -qq -y --no-install-recommends \
bc \
bison \
build-essential \
curl \
flex \
gcc \
git \
gperf \
jq \
libncurses-dev \
make \
python3-dev \
python3-pip \
srecord \
unzip \
wget \
xz-utils \
&& apt-get clean && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

RUN python3 -m pip install --upgrade pip setuptools
RUN python3 -m pip install -U platformio
RUN python3 -V

# ESP32 & ESP8266 Arduino Frameworks for Platformio

# https://docs.platformio.org/en/latest/core/installation.html#piocore-install-shell-commands

RUN  pio platform install espressif32 \
 && cat /root/.platformio/platforms/espressif32/platform.py \
 && chmod 777 /root/.platformio/platforms/espressif32/platform.py \
 && sed -i 's/~2/>=1/g' /root/.platformio/platforms/espressif32/platform.py \
 && cat /root/.platformio/platforms/espressif32/platform.py

# ESP-IDF for projects containing `sdkconfig` or `*platform*espidf*` in platformio.ini

# https://docs.espressif.com/projects/esp-idf/en/latest/esp32/get-started-legacy/linux-setup.html

RUN cd /root \
 && git clone -b ${ESP_IDF_VERSION} --recursive https://github.com/espressif/esp-idf.git \
 && cd ./esp-idf \
 && ./install.sh esp32

ADD platformio.ini /app
RUN pio pkg install

RUN python3 -m pip install -U typer requests future cryptography
ADD cli.py /usr/bin/fgcli.py
ADD plantalytix.zpl /usr/share/plantalytix.zpl
RUN chmod +x /usr/bin/fgcli.py