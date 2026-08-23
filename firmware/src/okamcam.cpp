#include <Arduino.h>
#include <WiFi.h>
#include <WiFiUdp.h>
#include <esp_task_wdt.h>

#include "okamcam.h"
#include "settings.h"

// O-KAM / VStarcam snapshot client.
//
// Protocol (reverse-engineered, docs §15/§16): every UDP payload is obfuscated
// with a table cipher; underneath it is CS2 PPPP — `F1 <type> <len16> <payload>`.
// Flow: LanSearch -> the camera answers PunchPkt (which carries its DID) ->
// Hello/P2pReq/DevLgn/Punch to authenticate -> DRW `GET /snapshot.cgi?…` on
// channel 0 -> the camera streams the JPEG back as DRW fragments, each of which
// must be ACKed cumulatively or its send window stalls.
//
// MEMORY: everything below is file-static or stack; nothing is allocated. The
// image is never buffered — fragments are published as they arrive.

namespace fg {
  namespace {

    // 256-byte substitution table. `const` so it lives in flash, not RAM.
    const uint8_t SBOX[256] = {
      0x7c,0x9c,0xe8,0x4a,0x13,0xde,0xdc,0xb2,0x2f,0x21,0x23,0xe4,0x30,0x7b,0x3d,0x8c,
      0xbc,0x0b,0x27,0x0c,0x3c,0xf7,0x9a,0xe7,0x08,0x71,0x96,0x00,0x97,0x85,0xef,0xc1,
      0x1f,0xc4,0xdb,0xa1,0xc2,0xeb,0xd9,0x01,0xfa,0xba,0x3b,0x05,0xb8,0x15,0x87,0x83,
      0x28,0x72,0xd1,0x8b,0x5a,0xd6,0xda,0x93,0x58,0xfe,0xaa,0xcc,0x6e,0x1b,0xf0,0xa3,
      0x88,0xab,0x43,0xc0,0x0d,0xb5,0x45,0x38,0x4f,0x50,0x22,0x66,0x20,0x7f,0x07,0x5b,
      0x14,0x98,0x1d,0x9b,0xa7,0x2a,0xb9,0xa8,0xcb,0xf1,0xfc,0x49,0x47,0x06,0x3e,0xb1,
      0x0e,0x04,0x3a,0x94,0x5e,0xee,0x54,0x11,0x34,0xdd,0x4d,0xf9,0xec,0xc7,0xc9,0xe3,
      0x78,0x1a,0x6f,0x70,0x6b,0xa4,0xbd,0xa9,0x5d,0xd5,0xf8,0xe5,0xbb,0x26,0xaf,0x42,
      0x37,0xd8,0xe1,0x02,0x0a,0xae,0x5f,0x1c,0xc5,0x73,0x09,0x4e,0x69,0x24,0x90,0x6d,
      0x12,0xb3,0x19,0xad,0x74,0x8a,0x29,0x40,0xf5,0x2d,0xbe,0xa5,0x59,0xe0,0xf4,0x79,
      0xd2,0x4b,0xce,0x89,0x82,0x48,0x84,0x25,0xc6,0x91,0x2b,0xa2,0xfb,0x8f,0xe9,0xa6,
      0xb0,0x9e,0x3f,0x65,0xf6,0x03,0x31,0x2e,0xac,0x0f,0x95,0x2c,0x5c,0xed,0x39,0xb7,
      0x33,0x6c,0x56,0x7e,0xb4,0xa0,0xfd,0x7a,0x81,0x53,0x51,0x86,0x8d,0x9f,0x77,0xff,
      0x6a,0x80,0xdf,0xe2,0xbf,0x10,0xd7,0x75,0x64,0x57,0x76,0xf3,0x55,0xcd,0xd0,0xc8,
      0x18,0xe6,0x36,0x41,0x62,0xcf,0x99,0xf2,0x32,0x4c,0x67,0x60,0x61,0x92,0xca,0xd3,
      0xea,0x63,0x7d,0x16,0xb6,0x8e,0xd4,0x68,0x35,0xc3,0x52,0x9d,0x46,0x44,0x1e,0x17,
    };
    // Global derived key (constant for this SDK build).
    const uint8_t DK[4] = { 44, 212, 96, 6 };

    constexpr uint16_t DISCOVERY_PORT   = 32108;
    constexpr uint32_t DISCOVER_MS      = 4000;   // wait for the camera to answer
    constexpr uint32_t CACHED_PEER_MS   = 800;    // ask the last known address first
    constexpr uint32_t SEARCH_MS        = 12000;  // stand-alone search after repeated misses
    // Repeated failures to reach the camera at all. The address it answers on
    // is a DHCP lease, so after this many misses it is worth searching for it
    // again rather than retrying the same place forever.
    constexpr uint8_t  MISSES_BEFORE_SEARCH = 10;
    constexpr uint32_t AUTH_MS          = 6000;   // handshake until a CGI replies
    constexpr uint32_t TRANSFER_MS      = 20000;  // stay inside the cloud's 30s wait
    constexpr uint32_t IDLE_ABORT_MS    = 8000;   // no fragment for this long -> give up
    constexpr size_t   MAX_DGRAM        = 1200;   // camera datagrams are <= 1032
    constexpr uint32_t ACK_INTERVAL_MS  = 15;     // coalesce acks: never one per packet
    constexpr uint16_t ACK_EVERY_N      = 4;
    constexpr uint8_t  IMAGE_CHANNEL    = 0;      // snapshot.cgi answers on channel 0
    constexpr size_t   HEAP_MARGIN_BYTES = 16 * 1024; // never squeeze the rest of the firmware
    constexpr int      MAX_ATTEMPTS     = 1;      // one try per request; the cloud paces retries
    constexpr uint32_t RESET_CONFIRM_MS = 4000;   // keep resending restore_factory until it answers
    // 640x360 stills measure ~31-33 KB; 56 KB leaves room for a busy scene and
    // anything beyond it is refused rather than allowed to grow.
    //
    // Nothing is held between captures: the buffer is malloc'd per capture and
    // freed on every exit path, and the capture is skipped outright when the
    // largest free block cannot spare it with HEAP_MARGIN_BYTES to spare (the
    // image service just retries on its own schedule). Sizing is measured, not
    // guessed -- the skipped-low-heap diagnostic reports free=158 KB but only
    // ~94 KB CONTIGUOUS, and it is that number the buffer has to fit under.
    constexpr size_t   MAX_IMAGE_BYTES  = 56 * 1024;

    // --- static working buffers (no heap) --------------------------------
    uint8_t  g_rx[MAX_DGRAM];        // one inbound datagram, decoded in place
    uint8_t  g_tx[256];              // outbound packet (handshake / CGI / ack)
    char     g_b64[((MAX_DGRAM + 2) / 3) * 4 + 8];  // base64 of one fragment
    char     g_msg[sizeof(g_b64) + 160];            // JSON image message
    constexpr size_t   SLOT_BYTES = 1024;                    // camera fragment size
    constexpr uint16_t MAX_SLOTS  = MAX_IMAGE_BYTES / SLOT_BYTES;
    // The image buffer is NOT static: tens of KB permanently resident would eat
    // most of this device's spare heap. It is taken for the couple of seconds a
    // capture lasts and released again on every exit path (see okamCamCapture).
    uint8_t* g_img = nullptr;                       // fragments, stored by index
    bool     g_received[MAX_SLOTS];                 // which fragments arrived
    uint16_t g_slot_len[MAX_SLOTS];                 // their individual lengths

    // Base64 straight into a caller-supplied buffer. The shared helper returns a
    // std::string, i.e. a heap allocation per fragment; on this device that churn
    // is exactly what we must avoid, so the image path uses this instead.
    size_t b64encode(const uint8_t* src, size_t len, char* dst, size_t dst_size) {
      static const char* T = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
      const size_t needed = ((len + 2) / 3) * 4;
      if(needed + 1 > dst_size) return 0;
      size_t o = 0;
      size_t i = 0;
      while(i + 2 < len) {
        const uint32_t v = ((uint32_t)src[i] << 16) | ((uint32_t)src[i + 1] << 8) | src[i + 2];
        dst[o++] = T[(v >> 18) & 0x3f]; dst[o++] = T[(v >> 12) & 0x3f];
        dst[o++] = T[(v >> 6) & 0x3f];  dst[o++] = T[v & 0x3f];
        i += 3;
      }
      if(i < len) {
        const size_t rem = len - i;
        const uint32_t v = ((uint32_t)src[i] << 16) | ((rem > 1 ? (uint32_t)src[i + 1] : 0) << 8);
        dst[o++] = T[(v >> 18) & 0x3f];
        dst[o++] = T[(v >> 12) & 0x3f];
        dst[o++] = rem > 1 ? T[(v >> 6) & 0x3f] : '=';
        dst[o++] = '=';
      }
      dst[o] = '\0';
      return o;
    }

    // Trim whitespace/control characters the way stored settings are read
    // elsewhere, without pulling in wifi.cpp's file-local helper.
    bool settingIsEmpty(const std::string& value) {
      for(char c : value) {
        if((unsigned char)c > 0x20) return false;
      }
      return true;
    }

    // Consecutive sessions that never found the camera. Reset as soon as one
    // does: a session that opens proves the stored address still reaches it.
    uint8_t g_camera_misses = 0;

    // Whether a camera is paired at all. Note that the stored id cannot be used
    // to tell responders apart: it is the camera's `realdeviceid`
    // (e.g. AAC2852199TWVA), while the id inside a PunchPkt is the CS2 P2P id
    // in its packed wire form ("VSTH" + a binary number + five characters).
    // They are different identifiers, so discovery takes the first camera that
    // answers, exactly as it always has.
    bool camIsPaired() {
      const std::string stored(fg::settings().getStr("webcam_did").c_str());
      return !stored.empty() && stored != "none";
    }

    // Where the camera last answered. Only ever a shortcut: a stale address
    // simply fails the unicast round and the broadcast takes over.
    std::string cachedCamIp() {
      return std::string(fg::settings().getStr("webcam_ip").c_str());
    }

    void rememberCamIp(const IPAddress& ip) {
      const std::string address(ip.toString().c_str());
      if(address.empty() || address == cachedCamIp()) {
        return;
      }
      fg::settings().setStr("webcam_ip", address.c_str());
      fg::settings().commit();
    }

    // Symmetric table cipher. `prev` is always the ciphertext byte, so encrypt
    // and decrypt differ only in which side that is.
    void obfuscate(uint8_t* buf, size_t len) {
      uint8_t prev = 0;
      for(size_t i = 0; i < len; i++) {
        uint8_t c = SBOX[(uint8_t)(DK[prev & 3] + prev)] ^ buf[i];
        buf[i] = c;
        prev = c;
      }
    }
    void deobfuscate(uint8_t* buf, size_t len) {
      uint8_t prev = 0;
      for(size_t i = 0; i < len; i++) {
        uint8_t c = buf[i];
        buf[i] = SBOX[(uint8_t)(DK[prev & 3] + prev)] ^ c;
        prev = c;
      }
    }

    void releaseBuffer() {
      if(g_img != nullptr) {
        free(g_img);
        g_img = nullptr;
      }
    }

    // Build `F1 <type> <len16> <payload>` into g_tx and obfuscate it.
    size_t buildPacket(uint8_t type, const uint8_t* payload, size_t len) {
      if(len + 4 > sizeof(g_tx)) return 0;
      g_tx[0] = 0xf1;
      g_tx[1] = type;
      g_tx[2] = (uint8_t)((len >> 8) & 0xff);
      g_tx[3] = (uint8_t)(len & 0xff);
      if(payload && len) memcpy(g_tx + 4, payload, len);
      obfuscate(g_tx, len + 4);
      return len + 4;
    }

    bool sendPacket(WiFiUDP& udp, const IPAddress& ip, uint16_t port, size_t len) {
      if(len == 0) return false;
      if(!udp.beginPacket(ip, port)) return false;
      udp.write(g_tx, len);
      return udp.endPacket() == 1;
    }

    // DRW data packet carrying an HTTP-style CGI request on `channel`.
    size_t buildCgi(uint8_t channel, uint16_t index, const char* cgi) {
      const size_t cgiLen = strlen(cgi);
      // f1 d0 <len16> | d1 <ch> <idx16> | 01 0a 00 00 <len32le> | GET /<cgi>
      const size_t inner = 4 + 8 + 5 + cgiLen;
      if(inner + 4 > sizeof(g_tx)) return 0;
      uint8_t* p = g_tx;
      *p++ = 0xf1; *p++ = 0xd0;
      *p++ = (uint8_t)((inner >> 8) & 0xff); *p++ = (uint8_t)(inner & 0xff);
      *p++ = 0xd1; *p++ = channel;
      *p++ = (uint8_t)((index >> 8) & 0xff); *p++ = (uint8_t)(index & 0xff);
      *p++ = 0x01; *p++ = 0x0a; *p++ = 0x00; *p++ = 0x00;
      const uint32_t bodyLen = (uint32_t)(cgiLen + 5);
      *p++ = (uint8_t)(bodyLen & 0xff);
      *p++ = (uint8_t)((bodyLen >> 8) & 0xff);
      *p++ = (uint8_t)((bodyLen >> 16) & 0xff);
      *p++ = (uint8_t)((bodyLen >> 24) & 0xff);
      memcpy(p, "GET /", 5); p += 5;
      memcpy(p, cgi, cgiLen); p += cgiLen;
      const size_t total = (size_t)(p - g_tx);
      obfuscate(g_tx, total);
      return total;
    }

    // DrwAck body: d1 <channel> <count16> <index16>.
    size_t buildAck(uint8_t channel, uint16_t index) {
      uint8_t body[6] = { 0xd1, channel, 0x00, 0x01,
                          (uint8_t)((index >> 8) & 0xff), (uint8_t)(index & 0xff) };
      return buildPacket(0xd1, body, sizeof(body));
    }

    // Credentials: VStarcam factory default (the camera is provisioned by us and
    // never has its password changed). The captured `loginpas` hash goes stale
    // after a factory reset; the plain password does not.
    const char* const AUTH =
      "name=admin&loginuse=admin&loginpas=888888&user=admin&pwd=888888&";

    // Discover the camera and authenticate a P2P session on `udp`. Shared by the
    // capture and factory-reset paths. The DevLgn is what authenticates the
    // session: without it the camera acks DRW at the transport level but
    // silently drops every command.
    // One LanSearch round against `target`, which is either the address the
    // camera last answered on or the broadcast address.
    bool lanSearch(WiFiUDP& udp, const IPAddress& target, uint32_t window_ms,
                   uint8_t* did, IPAddress& peer_ip, uint16_t& peer_port) {
      sendPacket(udp, target, DISCOVERY_PORT, buildPacket(0x30, nullptr, 0));

      const uint32_t wait_until = millis() + window_ms;
      while((int32_t)(wait_until - millis()) > 0) {
        int sz = udp.parsePacket();
        if(sz > 0 && sz <= (int)sizeof(g_rx)) {
          int len = udp.read(g_rx, sizeof(g_rx));
          if(len >= 24) {
            deobfuscate(g_rx, len);
            if(g_rx[0] == 0xf1 && g_rx[1] == 0x41) {
              memcpy(did, g_rx + 4, 20);
              peer_ip = udp.remoteIP();
              peer_port = udp.remotePort();
              esp_task_wdt_reset();
              return true;
            }
          }
        }
        delay(5);
      }
      esp_task_wdt_reset();
      return false;
    }

    bool openSession(WiFiUDP& udp, IPAddress& peer_ip, uint16_t& peer_port) {
      uint8_t did[20];
      bool have_did = false;

    // --- 1. discover: LanSearch until the camera answers with its DID -----
    // Ask the address it answered on last first. That is both the fast path and
    // the only one that works where the access point keeps clients from seeing
    // each other's broadcasts. A stale address costs one short round and the
    // broadcast below takes over.
    IPAddress cached_ip;
    if(cached_ip.fromString(cachedCamIp().c_str())) {
      have_did = lanSearch(udp, cached_ip, CACHED_PEER_MS, did, peer_ip, peer_port);
    }

    uint32_t started = millis();
    const IPAddress broadcast(255, 255, 255, 255);
    while(!have_did && (millis() - started) < DISCOVER_MS) {
      have_did = lanSearch(udp, broadcast, 400, did, peer_ip, peer_port);
    }

    if(!have_did) {
      if(g_camera_misses < 255) ++g_camera_misses;
      return false;
    }
    g_camera_misses = 0;
    rememberCamIp(peer_ip);

    char cgi[192];

    // --- 2. authenticate: handshake until a CGI actually answers ----------
    bool authed = false;
    started = millis();
    while(!authed && (millis() - started) < AUTH_MS) {
      uint8_t devlgn[36];
      memcpy(devlgn, did, sizeof(did));
      static const uint8_t trailer[16] = {
        0x00,0x02,0x12,0x64,0x10,0x02,0x00,0x0a,0,0,0,0,0,0,0,0 };
      memcpy(devlgn + sizeof(did), trailer, sizeof(trailer));

      sendPacket(udp, peer_ip, peer_port, buildPacket(0x00, nullptr, 0));
      sendPacket(udp, peer_ip, peer_port, buildPacket(0x05, did, sizeof(did)));
      sendPacket(udp, peer_ip, peer_port, buildPacket(0x20, devlgn, sizeof(devlgn)));
      sendPacket(udp, peer_ip, peer_port, buildPacket(0x41, did, sizeof(did)));
      snprintf(cgi, sizeof(cgi), "get_status.cgi?%s", AUTH);
      sendPacket(udp, peer_ip, peer_port, buildCgi(0, 0, cgi));

      const uint32_t wait_until = millis() + 500;
      while((int32_t)(wait_until - millis()) > 0) {
        int sz = udp.parsePacket();
        if(sz > 0 && sz <= (int)sizeof(g_rx)) {
          int len = udp.read(g_rx, sizeof(g_rx));
          if(len >= 4) {
            deobfuscate(g_rx, len);
            if(g_rx[1] == 0x42 || g_rx[1] == 0x43) {
              // echo the readiness packet back
              memcpy(g_tx, g_rx, len);
              obfuscate(g_tx, len);
              sendPacket(udp, peer_ip, peer_port, len);
            }
            else if(g_rx[1] == 0xd0 && len >= 8 && g_rx[5] == 0) {
              authed = true;
              break;
            }
          }
        }
        delay(5);
      }
      esp_task_wdt_reset();
    }

    return authed;

  }

  } // namespace

  bool okamCamNeedsSearch() {
    return g_camera_misses >= MISSES_BEFORE_SEARCH && camIsPaired();
  }

  bool okamCamSearch(Fridgecloud* cloud) {
    // Reset up front: the point of a search is to stop retrying, and a search
    // that finds nothing must not keep re-triggering itself.
    g_camera_misses = 0;

    if(!camIsPaired()) {
      return false;
    }

    // Nothing is buffered here, so this runs regardless of how tight the heap
    // is; it costs one socket and the time it listens.
    const bool wifi_was_asleep = WiFi.getSleep();
    WiFi.setSleep(false);

    WiFiUDP udp;
    if(!udp.begin(0)) {
      WiFi.setSleep(wifi_was_asleep);
      return false;
    }

    uint8_t did[20];
    IPAddress peer_ip;
    uint16_t peer_port = 0;
    bool found = false;
    const IPAddress broadcast(255, 255, 255, 255);
    const uint32_t started = millis();
    while(!found && (millis() - started) < SEARCH_MS) {
      found = lanSearch(udp, broadcast, 500, did, peer_ip, peer_port);
    }

    udp.stop();
    WiFi.setSleep(wifi_was_asleep);

    if(found) {
      Serial.printf("[cam] found at %s\n", peer_ip.toString().c_str());
      rememberCamIp(peer_ip);
    }
    if(cloud != nullptr) {
      cloud->log(found ? "message-terp-cam-found" : "message-terp-cam-not-found", found ? 0 : 1);
    }
    return found;
  }

  bool okamCamFactoryReset(Fridgecloud* cloud) {
    const std::string did_str = fg::settings().getStr("webcam_did");
    if(settingIsEmpty(did_str) || did_str == "none" || cloud == nullptr) {
      return false;
    }

    // No image buffer here — this only sends one command, so it costs nothing
    // but the socket and can run even when the heap is too tight to capture.
    const bool wifi_was_asleep = WiFi.getSleep();
    WiFi.setSleep(false);

    WiFiUDP udp;
    if(!udp.begin(0)) {
      WiFi.setSleep(wifi_was_asleep);
      return false;
    }

    IPAddress peer_ip;
    uint16_t peer_port = 0;
    bool ok = false;

    if(openSession(udp, peer_ip, peer_port)) {
      char cgi[192];
      snprintf(cgi, sizeof(cgi), "restore_factory.cgi?%s", AUTH);

      // The camera reboots into its setup AP as soon as it acts on this, so the
      // reply may never arrive. Send it a few times and treat any channel-0
      // answer as confirmation; the resends are harmless because the command is
      // idempotent and the camera is gone after the first one it acts on.
      const uint32_t started = millis();
      uint16_t index = 1;
      while(!ok && (millis() - started) < RESET_CONFIRM_MS) {
        sendPacket(udp, peer_ip, peer_port, buildCgi(0, index++, cgi));
        const uint32_t wait_until = millis() + 600;
        while((int32_t)(wait_until - millis()) > 0) {
          int sz = udp.parsePacket();
          if(sz > 0 && sz <= (int)sizeof(g_rx)) {
            int len = udp.read(g_rx, sizeof(g_rx));
            if(len >= 8) {
              deobfuscate(g_rx, len);
              if(g_rx[1] == 0xd0 && g_rx[5] == IMAGE_CHANNEL) { ok = true; break; }
            }
          }
          delay(5);
        }
        esp_task_wdt_reset();
      }
    }

    cloud->log(ok ? "message-cam-reset:ok" : "message-cam-reset:no-response", ok ? 0 : 1);

    udp.stop();
    WiFi.setSleep(wifi_was_asleep);
    return ok;
  }

  bool okamCamCapture(Fridgecloud* cloud) {
    const std::string did_str = fg::settings().getStr("webcam_did");
    if(settingIsEmpty(did_str) || did_str == "none" || cloud == nullptr) {
      return false;   // no camera paired
    }

    // Take the frame buffer for the duration of this capture only. If the heap
    // cannot spare it (largest free block must leave a healthy margin), skip the
    // capture rather than push the device towards an allocation failure
    // elsewhere — the cloud simply retries on its own schedule.
    if(ESP.getMaxAllocHeap() < MAX_IMAGE_BYTES + HEAP_MARGIN_BYTES) {
      char hm[104];
      snprintf(hm, sizeof(hm), "message-cam-capture:skipped-low-heap free=%lu max=%lu need=%lu",
               (unsigned long)ESP.getFreeHeap(), (unsigned long)ESP.getMaxAllocHeap(),
               (unsigned long)(MAX_IMAGE_BYTES + HEAP_MARGIN_BYTES));
      cloud->log(hm, 1);
      return false;
    }
    g_img = (uint8_t*)malloc(MAX_IMAGE_BYTES);
    if(g_img == nullptr) {
      cloud->log("message-cam-capture:skipped-low-heap", 1);
      return false;
    }

    // ESP32 WiFi defaults to modem power-save, which parks the radio between
    // beacons and silently drops inbound UDP. The camera bursts the image at
    // line rate, so with power-save on ~75% of the fragments never arrive
    // (measured: 8 of 40). Disable it for the capture and restore it after.
    const bool wifi_was_asleep = WiFi.getSleep();
    WiFi.setSleep(false);

    WiFiUDP udp;
    if(!udp.begin(0)) {
      WiFi.setSleep(wifi_was_asleep);
      releaseBuffer();
      return false;
    }

    // Everything below must go through `finish` so the socket is always closed.
    bool ok = false;
    IPAddress peer_ip;
    uint16_t peer_port = 0;
    uint32_t started = millis();

    if(!openSession(udp, peer_ip, peer_port)) {
      udp.stop();
      WiFi.setSleep(wifi_was_asleep);
      releaseBuffer();
      return false;
    }
    char cgi[192];

    // --- 3. request the JPEG, receive it, then publish --------------------
    // snapshot.cgi answers on channel 0 as a paced request/response: the camera
    // sends a fragment, waits for its ack, then sends the next. That pacing is
    // the whole reason this path is used instead of the full-resolution one --
    // see okamcam.h for why the 2304x1296 keyframe path was abandoned.
    //
    // Fragments are stored BY INDEX, not in arrival order, and the highest
    // CONTIGUOUS index is acked. Taking them strictly in order and re-acking the
    // last good one instead was measured far worse (resend=343..553 out of ~400
    // fragments, 0/10): the 0xd1 packet is a resend request rather than a pure
    // acknowledgement, so naming an old index makes the camera go-back-N the
    // whole window and the flood drowns the fragment actually wanted.
    const uint32_t capture_id = millis();
    uint32_t frags_seen = 0;          // channel-0 datagrams accepted (diagnostic)
    uint16_t base_index = 0;          // channel-0 index of the first fragment
    bool first_index_known = false;
    uint16_t slots_seen = 0;          // highest slot index seen, + 1
    uint16_t contiguous = 0;          // slots 0..contiguous-1 have all arrived
    int32_t  eoi_slot = -1;           // slot holding the JPEG EOI marker
    int32_t  soi_slot = -1;           // slot holding the JPEG SOI marker
    uint16_t soi_offset = 0;          // where the JPEG starts inside that slot
    bool soi_found = false;
    bool complete = false;
    uint32_t sent_bytes = 0;
    uint32_t seq = 0;
    uint32_t last_ack = 0;
    uint16_t acked_upto = 0;
    uint32_t last_wdt = millis();
    uint32_t last_data = millis();
    int attempt = 0;

    for(attempt = 1; attempt <= MAX_ATTEMPTS && !complete; attempt++) {
    frags_seen = 0; base_index = 0; first_index_known = false;
    slots_seen = 0; contiguous = 0; eoi_slot = -1; soi_slot = -1;
    soi_offset = 0; soi_found = false; sent_bytes = 0;
    acked_upto = 0; last_ack = 0;
    memset(g_received, 0, sizeof(g_received));
    memset(g_slot_len, 0, sizeof(g_slot_len));

    snprintf(cgi, sizeof(cgi), "snapshot.cgi?%s", AUTH);
    sendPacket(udp, peer_ip, peer_port, buildCgi(0, 1, cgi));
    last_data = millis();
    started = millis();

    while(!complete && (millis() - started) < TRANSFER_MS) {
      if(millis() - last_data > IDLE_ABORT_MS) {
        break;
      }

      int sz = udp.parsePacket();
      if(sz <= 0) {
        delay(2);
        esp_task_wdt_reset();
        continue;
      }
      int len = udp.read(g_rx, sizeof(g_rx));
      if(len < 8) continue;
      deobfuscate(g_rx, len);

      if(g_rx[1] == 0xe0) {                       // keepalive
        sendPacket(udp, peer_ip, peer_port, buildPacket(0xe1, nullptr, 0));
        continue;
      }
      if(g_rx[1] != 0xd0 || g_rx[5] != IMAGE_CHANNEL) {   // only channel-0 data
        continue;
      }

      const uint16_t index = (uint16_t)((g_rx[6] << 8) | g_rx[7]);
      const uint16_t declared = (uint16_t)((g_rx[2] << 8) | g_rx[3]);
      int payload_len = (int)declared - 4;         // minus the d1/ch/idx16 header
      if(payload_len <= 0 || payload_len > len - 8) {
        payload_len = len - 8;
      }
      if(payload_len <= 0 || payload_len > (int)SLOT_BYTES) continue;

      frags_seen++;
      last_data = millis();

      if(!first_index_known) {
        base_index = index;
        first_index_known = true;
      }
      if((int16_t)(index - base_index) < 0) continue;
      const uint16_t slot = (uint16_t)(index - base_index);
      if(slot >= MAX_SLOTS) continue;

      if(!g_received[slot]) {
        g_received[slot] = true;
        g_slot_len[slot] = (uint16_t)payload_len;
        memcpy(g_img + (size_t)slot * SLOT_BYTES, g_rx + 8, (size_t)payload_len);
        if(slot >= slots_seen) slots_seen = (uint16_t)(slot + 1);

        // The image starts at the JPEG SOI, after the `result= 0;var ...`
        // preamble, and ends at the EOI — trailing text must not be forwarded.
        const uint8_t* q = g_img + (size_t)slot * SLOT_BYTES;
        // The `result= 0;var ...` preamble is not guaranteed to fit in the
        // first fragment, so remember WHICH slot the SOI landed in as well as
        // where. Assuming slot 0 left the preamble in the image and every
        // capture failed its final SOI check.
        if(!soi_found) {
          for(int i = 0; i + 1 < payload_len; i++) {
            if(q[i] == 0xff && q[i + 1] == 0xd8) {
              soi_found = true;
              soi_slot = (int32_t)slot;
              soi_offset = (uint16_t)i;
              break;
            }
          }
        }
        if(eoi_slot < 0 && soi_found && (int32_t)slot >= soi_slot) {
          for(int i = 0; i + 1 < payload_len; i++) {
            if(q[i] == 0xff && q[i + 1] == 0xd9) {
              eoi_slot = (int32_t)slot;
              g_slot_len[slot] = (uint16_t)(i + 2);   // drop anything after EOI
              break;
            }
          }
        }
      }

      while(contiguous < MAX_SLOTS && g_received[contiguous]) contiguous++;

      // Ack the highest CONTIGUOUS index: that is what advances the camera's
      // window and asks for anything missing before it. Coalesced, because each
      // ack is an lwip syscall and while we are inside it the camera keeps
      // sending into a mailbox only a few datagrams deep.
      const uint32_t now = millis();
      if(contiguous > 0 &&
         (contiguous >= (uint16_t)(acked_upto + ACK_EVERY_N) || now - last_ack > ACK_INTERVAL_MS)) {
        last_ack = now;
        acked_upto = contiguous;
        sendPacket(udp, peer_ip, peer_port,
                   buildAck(IMAGE_CHANNEL, (uint16_t)(base_index + contiguous - 1)));
      }

      // Done once every fragment up to and including the one holding EOI is in.
      if(eoi_slot >= 0 && contiguous > (uint16_t)eoi_slot) complete = true;

      // The watchdog is fed on a timer rather than per packet: in the drain loop
      // every avoidable syscall costs fragments.
      if(now - last_wdt > 200) { last_wdt = now; esp_task_wdt_reset(); }
    }
    esp_task_wdt_reset();
    }   // retry loop

    // Fragments were stored at fixed slot offsets so they could arrive in any
    // order; squeeze out the padding (only the final fragment is ever short) and
    // drop the preamble ahead of the SOI.
    if(complete && soi_found && soi_slot >= 0 && eoi_slot >= soi_slot) {
      size_t out = 0;
      for(uint16_t i = (uint16_t)soi_slot; i <= (uint16_t)eoi_slot; i++) {
        const size_t skip = (i == (uint16_t)soi_slot) ? (size_t)soi_offset : 0;
        if(g_slot_len[i] <= skip) continue;
        const size_t n = (size_t)g_slot_len[i] - skip;
        memmove(g_img + out, g_img + (size_t)i * SLOT_BYTES + skip, n);
        out += n;
      }
      sent_bytes = (uint32_t)out;
    }
    else {
      complete = false;
    }

    // A JPEG that never reached its EOI marker is a partial image, and a partial
    // image decodes to the grey-striped picture that looks like a working camera
    // with a broken lens. Refuse it instead.
    if(complete && (sent_bytes < 4 || g_img[0] != 0xff || g_img[1] != 0xd8)) {
      complete = false;
    }

    // Transfer finished (the camera is no longer sending): now it is safe to
    // spend time on blocking MQTT publishes. Stream the buffer out in fragments
    // so no large message is ever built.
    ok = complete && sent_bytes > 0;
    if(ok) {
      const size_t STEP = 1024;   // -> ~1.4 KB of base64 per message
      for(size_t off = 0; off < sent_bytes; off += STEP) {
        const size_t n = (sent_bytes - off) < STEP ? (sent_bytes - off) : STEP;
        const bool last = (off + n) >= sent_bytes;
        if(b64encode(g_img + off, n, g_b64, sizeof(g_b64)) == 0) { ok = false; break; }
        snprintf(g_msg, sizeof(g_msg),
                 "{\"capture\":%lu,\"seq\":%lu,\"last\":%s,\"payload\":\"%s\"}",
                 (unsigned long)capture_id, (unsigned long)seq++,
                 last ? "true" : "false", g_b64);
        if(!cloud->publishImageMessage(g_msg)) { ok = false; break; }
        esp_task_wdt_reset();
      }
    }

    {
      // One concise line so a failure in the field is diagnosable without a
      // serial console (severity 1 only when it actually failed).
      char note[128];
      snprintf(note, sizeof(note),
               "message-cam-capture:%s bytes=%lu got=%u/%u soi=%d eoi=%d frags=%lu msgs=%lu try=%d",
               ok ? "ok" : "incomplete", (unsigned long)sent_bytes,
               (unsigned)contiguous, (unsigned)slots_seen, (int)soi_slot, (int)eoi_slot,
               (unsigned long)frags_seen, (unsigned long)seq, attempt);
      cloud->log(note, ok ? 0 : 1);
    }
    if(!ok && seq > 0) {
      // Tell the cloud to discard the partial image rather than store a broken one.
      snprintf(g_msg, sizeof(g_msg), "{\"capture\":%lu,\"abort\":true}", (unsigned long)capture_id);
      cloud->publishImageMessage(g_msg);
    }

    udp.stop();                          // always released, on every path
    WiFi.setSleep(wifi_was_asleep);      // and power-save always restored
    releaseBuffer();                     // and the frame buffer always freed
    return ok;
  }

}
