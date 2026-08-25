#include "lanscan.h"

#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClient.h>
#include <esp_task_wdt.h>

#include <cctype>
#include <cstring>

namespace fg {

  namespace {

    // A socket on the same LAN completes its handshake in well under a
    // millisecond; anything slower is not the device we are looking for. The
    // whole sweep is a multiple of this, so it is what decides how long a /24
    // takes to walk.
    constexpr uint32_t CONNECT_TIMEOUT_MS = 200;
    constexpr uint32_t READ_TIMEOUT_MS = 700;
    constexpr uint8_t HOSTS_PER_TICK = 3;
    constexpr size_t MAX_AUTH_QUERIES = 4;

    // Asks one host for Tasmota's `Status 5` and reads the MAC out of the
    // answer. The connection is handed in already open so a probe pays for the
    // TCP handshake once.
    bool identify(WiFiClient& client, const std::string& ip, const std::string& auth, std::string& id) {
      client.printf("GET /cm?%scmnd=Status%%205 HTTP/1.1\r\nHost: %s\r\nConnection: close\r\n\r\n",
                    auth.c_str(), ip.c_str());

      char body[768];
      size_t len = 0;
      const uint32_t deadline = millis() + READ_TIMEOUT_MS;
      while(len + 1 < sizeof(body) && (int32_t)(deadline - millis()) > 0) {
        if(client.available() <= 0) {
          if(!client.connected()) {
            break;
          }
          delay(5);
          continue;
        }
        const int read = client.read((uint8_t*)body + len, sizeof(body) - 1 - len);
        if(read <= 0) {
          break;
        }
        len += (size_t)read;
        body[len] = '\0';
        if(strstr(body, "\"Mac\":\"") != nullptr) {
          break;
        }
      }
      body[len] = '\0';

      const char* mac = strstr(body, "\"Mac\":\"");
      if(mac == nullptr) {
        return false;
      }
      id = socketIdFromMac(mac + 7);
      return !id.empty();
    }

  }

  std::string socketIdFromMac(const char* mac) {
    std::string id;
    for(size_t i = 0; i < 17 && mac[i] != '\0'; ++i) {
      if(mac[i] == ':' || mac[i] == '-') {
        continue;
      }
      if(!std::isxdigit((unsigned char)mac[i])) {
        break;
      }
      id.push_back((char)std::toupper((unsigned char)mac[i]));
    }
    return id.size() == 12 ? id : std::string();
  }

  bool LanScan::start(const std::vector<std::string>& queries) {
    stop();

    if(!WiFi.isConnected()) {
      return false;
    }

    const IPAddress local = WiFi.localIP();
    if(local[0] == 0) {
      return false;
    }

    for(const auto& query : queries) {
      if(query.empty()) {
        continue;
      }
      bool duplicate = false;
      for(const auto& known : auth_queries) {
        duplicate = duplicate || known == query;
      }
      if(duplicate) {
        continue;
      }
      auth_queries.push_back(query);
      if(auth_queries.size() >= MAX_AUTH_QUERIES) {
        break;
      }
    }
    if(auth_queries.empty()) {
      return false;
    }

    // Only the device's own /24 is swept: a wider subnet takes too long to walk
    // on this hardware, and DHCP hands the sockets addresses out of the same
    // pool the controller itself sits in.
    prefix[0] = local[0];
    prefix[1] = local[1];
    prefix[2] = local[2];
    self_host = local[3];
    next_host = 1;
    return true;
  }

  void LanScan::stop() {
    auth_queries.clear();
    next_host = 0;
  }

  bool LanScan::tick(const std::function<void(const Host&)>& on_host) {
    if(next_host == 0) {
      return true;
    }

    for(uint8_t probed = 0; probed < HOSTS_PER_TICK && next_host != 0;) {
      const uint8_t host = next_host;
      next_host = host < 254 ? (uint8_t)(host + 1) : 0;
      if(host == self_host) {
        continue;
      }
      ++probed;

      const IPAddress address(prefix[0], prefix[1], prefix[2], host);
      WiFiClient client;
      if(client.connect(address, 80, CONNECT_TIMEOUT_MS) != 1) {
        esp_task_wdt_reset();
        continue;
      }

      Host found;
      found.ip = address.toString().c_str();
      bool identified = identify(client, found.ip, auth_queries[0], found.id);
      client.stop();

      // A socket with its own credentials answers the default ones with 401.
      // Retrying the remaining sets costs another handshake, but only for the
      // handful of hosts that answered at all.
      for(size_t i = 1; !identified && i < auth_queries.size(); ++i) {
        if(client.connect(address, 80, CONNECT_TIMEOUT_MS) != 1) {
          break;
        }
        identified = identify(client, found.ip, auth_queries[i], found.id);
        client.stop();
      }

      if(identified) {
        on_host(found);
      }
      esp_task_wdt_reset();
    }

    if(next_host == 0) {
      stop();
      return true;
    }
    return false;
  }

}
