#include <Arduino.h>
#include <WiFi.h>
#include <WiFiUdp.h>
#include <WiFiClientSecure.h>
#include <esp_task_wdt.h>
#include <algorithm>
#include "mbedtls/aes.h"

#include "terpcam.h"
#include "settings.h"

// Terp Cam (a VStarcam OEM) client on the camera's LAN.
//
// Protocol (reverse-engineered, docs §15/§16): every UDP payload is obfuscated
// with a table cipher; underneath it is CS2 PPPP — `F1 <type> <len16> <payload>`.
// Flow: LanSearch -> the camera answers PunchPkt (which carries its DID) ->
// Hello/P2pReq/DevLgn/Punch to authenticate -> DRW CGIs on channel 0.
//
// The controller takes no stills itself: it pairs, secures, finds and resets
// the camera, and bridges its P2P to the cloud (terpCamStartRelay), which pulls
// the full-resolution keyframe itself.
//
// MEMORY: everything below is file-static or stack, apart from the relay's
// 2 KB buffer, which lives only as long as a relay does.

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
    constexpr size_t   MAX_DGRAM        = 1200;   // camera datagrams are <= 1032
    constexpr uint8_t  CMD_CHANNEL      = 0;      // CGIs and their replies
    constexpr uint32_t RESET_CONFIRM_MS = 4000;
    // A camera that has just been handed wifi credentials takes a while to show
    // up on the network, so securing it keeps looking rather than giving up on
    // the first miss and leaving it on the manufacturer's password.
    constexpr uint32_t SECURE_FIND_MS   = 90000;   // keep resending restore_factory until it answers

    // --- static working buffers (no heap) --------------------------------
    uint8_t  g_rx[MAX_DGRAM];        // one inbound datagram, decoded in place
    uint8_t  g_tx[256];              // outbound packet (handshake / CGI / ack)
    char     g_reply[MAX_DGRAM + 64];  // a get_status reply as text, see authenticate

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

    // Set while the relay task owns the camera (see terpCamStartRelay). The other
    // camera paths share g_rx/g_tx and the discovery state with it, so they stand
    // down while it is true.
    volatile bool g_relay_active = false;
    // Asks a running relay task to end, so a path that must own the camera (a
    // factory reset on disconnect) can take it over rather than be refused.
    volatile bool g_relay_stop = false;
    TaskHandle_t g_relay_task = nullptr;

    // Whether a camera is paired at all.
    bool camIsPaired() {
      const std::string stored(fg::settings().getStr("webcam_did").c_str());
      return !stored.empty() && stored != "none";
    }

    // Where the camera last answered. Only ever a shortcut: a stale address
    // simply fails the unicast round and the broadcast takes over.
    std::string cachedCamIp() {
      return std::string(fg::settings().getStr("webcam_ip").c_str());
    }

    // Set when the address changed, so the next call that holds a cloud handle
    // can report it. The cloud reaches the camera on this network itself, and
    // this is how it learns where to look — so a move has to be told, not just
    // remembered locally.
    std::string g_cam_ip_to_report;

    // The camera's own P2P id, taken from the PunchPkt it answers discovery
    // with. The cloud needs it to reach the camera from outside this network,
    // and reading it here means nobody has to look it up anywhere.
    std::string g_cam_uid_to_report;

    // 20 packed bytes -> the id as it is written down: 4 letters, a number, 5
    // letters (e.g. VSTH581824TJXUG).
    std::string formatCamUid(const uint8_t* did) {
      char prefix[5] = { (char)did[0], (char)did[1], (char)did[2], (char)did[3], 0 };
      uint64_t number = 0;
      for(int i = 4; i < 12; i++) number = (number << 8) | did[i];
      char suffix[6] = { (char)did[12], (char)did[13], (char)did[14], (char)did[15], (char)did[16], 0 };
      char out[40];
      snprintf(out, sizeof(out), "%s%llu%s", prefix, (unsigned long long)number, suffix);
      return std::string(out);
    }

    // Only called once a session has proven the camera is ours (see
    // authenticate): a uid or address read off a neighbour's camera would
    // otherwise steer every later session there.
    void rememberCamUid(const uint8_t* did) {
      const std::string uid = formatCamUid(did);
      if(uid.size() < 6 || uid == std::string(fg::settings().getStr("webcam_uid").c_str())) return;
      fg::settings().setStr("webcam_uid", uid.c_str());
      fg::settings().commit();
      g_cam_uid_to_report = uid;
    }

    // Who discovery accepts. A camera whose P2P id is known is the only one that
    // counts; before that, any camera does except those a session has already
    // found to be somebody else's. Every camera on the LAN answers a broadcast,
    // and a second one - the old camera, a neighbour's - used to be taken by
    // whichever answered first.
    constexpr uint8_t MAX_FOREIGN = 3;
    std::string g_want_uid;
    uint8_t g_foreign[MAX_FOREIGN][20];
    uint8_t g_foreign_n = 0;

    bool acceptable(const uint8_t* did) {
      for(uint8_t i = 0; i < g_foreign_n; i++) {
        if(memcmp(g_foreign[i], did, 20) == 0) return false;
      }
      return g_want_uid.empty() || formatCamUid(did) == g_want_uid;
    }

    // A camera that turned out to be somebody else's must not stay where the
    // controller looks first.
    void forgetForeign(const uint8_t* did, const IPAddress& ip) {
      bool changed = false;
      if(formatCamUid(did) == g_want_uid) {
        fg::settings().erase("webcam_uid");
        g_want_uid.clear();
        changed = true;
      }
      if(std::string(ip.toString().c_str()) == cachedCamIp()) {
        fg::settings().erase("webcam_ip");
        changed = true;
      }
      if(changed) fg::settings().commit();
      if(g_foreign_n < MAX_FOREIGN) memcpy(g_foreign[g_foreign_n++], did, 20);
    }

    void rememberCamIp(const IPAddress& ip) {
      const std::string address(ip.toString().c_str());
      if(address.empty() || address == cachedCamIp()) {
        return;
      }
      fg::settings().setStr("webcam_ip", address.c_str());
      fg::settings().commit();
      g_cam_ip_to_report = address;
    }

    void reportCamIp(Fridgecloud* cloud) {
      if(cloud == nullptr) return;
      if(!g_cam_ip_to_report.empty()) {
        cloud->log("hardware-info:webcam_ip=" + g_cam_ip_to_report, 0);
        g_cam_ip_to_report.clear();
      }
      if(!g_cam_uid_to_report.empty()) {
        cloud->log("hardware-info:webcam_uid=" + g_cam_uid_to_report, 0);
        g_cam_uid_to_report.clear();
      }
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

    // The camera ships with the manufacturer's published default password, which
    // every one of these cameras has until somebody changes it. Pairing replaces
    // it with a per-camera secret (see provisionTerpCam) and stores it here, so
    // this returns whatever that camera actually uses. The default remains the
    // fallback for cameras paired before that existed, and for one factory-reset
    // behind our back — a reset restores the default, and the query string is
    // the plain password rather than the captured hash, which is what survives.
    std::string camAuth() {
      std::string password(fg::settings().getStr(TERP_CAM_PWD_NVS_KEY).c_str());
      if(settingIsEmpty(password)) password = TERP_CAM_DEFAULT_PASSWORD;
      return "name=admin&loginuse=admin&loginpas=" + password + "&user=admin&pwd=" + password + "&";
    }

    // One LanSearch round against `target`, which is either the address the
    // camera last answered on or the broadcast address. Only a camera that
    // acceptable() lets through ends the round; others are ignored.
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
            if(g_rx[0] == 0xf1 && g_rx[1] == 0x41 && acceptable(g_rx + 4)) {
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

    // What a get_status reply says about the camera that sent it.
    enum : uint8_t { REPLY_PENDING, REPLY_OURS, REPLY_FOREIGN, REPLY_REFUSED };

    // Every get_status reply names the camera's `realdeviceid` - the id pairing
    // stored as webcam_did - as `vuid=<id>;` when it refused the password and as
    // `var realdeviceid="<id>";` when it accepted it. So a controller can tell its
    // own camera from a neighbour's without knowing the neighbour's password.
    // `vuid=` is only read off a refused reply: an accepted one also carries
    // `support_vuid=1`, which would otherwise be read as the id "1".
    uint8_t checkReply(const char* text, const std::string& ours, bool& refused) {
      if(strstr(text, "result=-1") != nullptr) refused = true;
      for(const char* key : { "realdeviceid=", "vuid=" }) {
        if(!refused && key[0] == 'v') continue;
        const char* p = strstr(text, key);
        if(p == nullptr) continue;
        p += strlen(key);
        if(*p == '"') p++;
        const size_t n = strcspn(p, "\";");
        if(p[n] == 0) continue;               // the id runs on into the next fragment
        if(n != ours.size() || memcmp(p, ours.data(), n) != 0) return REPLY_FOREIGN;
        return refused ? REPLY_REFUSED : REPLY_OURS;
      }
      return REPLY_PENDING;
    }

    // Handshake until get_status answers, then read the answer until it says
    // which camera this is and whether it took the password. The DevLgn is what
    // authenticates the session: without it the camera acks DRW at the transport
    // level but silently drops every command.
    //
    // Any channel-0 answer used to count as success, `result=-1` included, so a
    // session to the wrong camera looked open and failed later as a timeout.
    // The reply is scanned as text in g_reply.
    uint8_t authenticate(WiFiUDP& udp, const uint8_t* did, const IPAddress& peer_ip, uint16_t peer_port,
                         const std::string& ours) {
      constexpr size_t CARRY = 48;          // longer than `realdeviceid="<id>"`
      char cgi[192];
      bool answered = false;
      bool refused = false;
      size_t kept = 0;
      uint8_t verdict = REPLY_PENDING;
      const uint32_t started = millis();
      while(verdict == REPLY_PENDING && (millis() - started) < AUTH_MS) {
        if(!answered) {
          uint8_t devlgn[36];
          memcpy(devlgn, did, 20);
          static const uint8_t trailer[16] = {
            0x00,0x02,0x12,0x64,0x10,0x02,0x00,0x0a,0,0,0,0,0,0,0,0 };
          memcpy(devlgn + 20, trailer, sizeof(trailer));

          sendPacket(udp, peer_ip, peer_port, buildPacket(0x00, nullptr, 0));
          sendPacket(udp, peer_ip, peer_port, buildPacket(0x05, did, 20));
          sendPacket(udp, peer_ip, peer_port, buildPacket(0x20, devlgn, sizeof(devlgn)));
          sendPacket(udp, peer_ip, peer_port, buildPacket(0x41, did, 20));
          snprintf(cgi, sizeof(cgi), "get_status.cgi?%s", camAuth().c_str());
          sendPacket(udp, peer_ip, peer_port, buildCgi(0, 0, cgi));
        }

        const uint32_t wait_until = millis() + 500;
        while(verdict == REPLY_PENDING && (int32_t)(wait_until - millis()) > 0) {
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
              else if(g_rx[1] == 0xd0 && len > 8 && g_rx[5] == 0) {
                answered = true;
                sendPacket(udp, peer_ip, peer_port,
                           buildAck(0, (uint16_t)((g_rx[6] << 8) | g_rx[7])));
                // Append as text: NULs (the reply's binary header) become spaces,
                // and the tail of the previous fragment is kept in front so an
                // id split across two fragments is still found.
                const size_t n = (size_t)len - 8;
                for(size_t i = 0; i < n; i++) g_reply[kept + i] = g_rx[8 + i] ? (char)g_rx[8 + i] : ' ';
                const size_t total = kept + n;
                g_reply[total] = 0;
                verdict = checkReply(g_reply, ours, refused);
                kept = total < CARRY ? total : CARRY;
                memmove(g_reply, g_reply + total - kept, kept);
              }
            }
          }
          delay(5);
        }
        esp_task_wdt_reset();
      }
      if(verdict == REPLY_PENDING && refused) verdict = REPLY_REFUSED;
      return verdict;
    }

    // Set when the last openSession() reached our camera and it refused the
    // password.
    bool g_session_refused = false;

    // Discover the paired camera and authenticate a P2P session on `udp`.
    // Shared by the securing, factory-reset and relay paths, so none of them
    // ever acts on a camera that is not the one paired to this controller.
    // What a single discovery pass concluded. FOUND: the paired camera answered
    // and authenticated. NOT_OURS_PRESENT: our camera is on the network but gave
    // no usable session (refused the password, or never said who it is) - not a
    // reason to search. EXHAUSTED: nobody answered, or only other people's
    // cameras did.
    enum : uint8_t { PASS_FOUND, PASS_NOT_OURS_PRESENT, PASS_EXHAUSTED };

    uint8_t openSessionPass(WiFiUDP& udp, const std::string& ours, IPAddress& peer_ip, uint16_t& peer_port) {
      g_foreign_n = 0;
      uint8_t did[20];

      // Ask the address it answered on last first. That is both the fast path
      // and the only one that works where the access point keeps clients from
      // seeing each other's broadcasts. A stale address costs one short round
      // and the broadcast takes over.
      IPAddress cached_ip;
      bool ask_cached = cached_ip.fromString(cachedCamIp().c_str());
      const IPAddress broadcast(255, 255, 255, 255);
      const uint32_t started = millis();
      for(;;) {
        bool found = false;
        if(ask_cached) {
          found = lanSearch(udp, cached_ip, CACHED_PEER_MS, did, peer_ip, peer_port);
          ask_cached = false;
        }
        while(!found && (millis() - started) < DISCOVER_MS) {
          found = lanSearch(udp, broadcast, 400, did, peer_ip, peer_port);
        }
        if(!found) return PASS_EXHAUSTED;

        const uint8_t verdict = authenticate(udp, did, peer_ip, peer_port, ours);
        if(verdict == REPLY_OURS) {
          // Learn (or correct) the cached P2P id from the camera that actually
          // owns our realdeviceid, so a stale id from a camera swap heals itself.
          rememberCamUid(did);
          rememberCamIp(peer_ip);
          return PASS_FOUND;
        }
        if(verdict != REPLY_FOREIGN) {
          // Our camera, or one that never said who it is: either way it is on the
          // network, so this is no reason to go searching for it.
          g_session_refused = verdict == REPLY_REFUSED;
          return PASS_NOT_OURS_PRESENT;
        }
        // Somebody else's camera: leave it alone and keep looking. Closing the
        // session frees the slot it took on that camera.
        sendPacket(udp, peer_ip, peer_port, buildPacket(0xf0, nullptr, 0));
        Serial.printf("[cam] %s is not the paired camera\n", formatCamUid(did).c_str());
        forgetForeign(did, peer_ip);
        if(g_foreign_n >= MAX_FOREIGN) return PASS_EXHAUSTED;
      }
    }

    // Discover the paired camera and authenticate a P2P session on `udp`.
    // Shared by the securing, factory-reset and relay paths, so none of them
    // ever acts on a camera that is not the one paired to this controller.
    bool openSession(WiFiUDP& udp, IPAddress& peer_ip, uint16_t& peer_port) {
      const std::string ours(fg::settings().getStr("webcam_did").c_str());
      g_want_uid = std::string(fg::settings().getStr("webcam_uid").c_str());
      g_session_refused = false;

      // The stored P2P id is only a hint for which camera to accept off a
      // broadcast; the realdeviceid checked in authenticate() is what actually
      // identifies the camera. So when the hint turns up nothing - it was left
      // behind by a previous camera, or never learned - fall back to a pass that
      // accepts any camera and lets authenticate() find ours by its realdeviceid.
      // That pass re-learns the id (rememberCamUid), so the mismatch is permanent
      // only until the next successful session. Without a realdeviceid to check
      // against there is nothing to fall back to.
      uint8_t pass = openSessionPass(udp, ours, peer_ip, peer_port);
      if(pass == PASS_EXHAUSTED && !ours.empty() && !g_want_uid.empty()) {
        g_want_uid.clear();
        pass = openSessionPass(udp, ours, peer_ip, peer_port);
      }

      if(pass == PASS_FOUND) {
        g_camera_misses = 0;
        return true;
      }
      if(pass == PASS_NOT_OURS_PRESENT) {
        g_camera_misses = 0;
        return false;
      }
      if(g_camera_misses < 255) ++g_camera_misses;
      return false;
    }

  } // namespace

  bool terpCamNeedsSearch() {
    return g_camera_misses >= MISSES_BEFORE_SEARCH && camIsPaired();
  }

  bool terpCamSearch(Fridgecloud* cloud) {
    // A relay task owns the camera and the shared buffers; do not search under it.
    if(g_relay_active) return false;

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

    // Only a camera whose id is known can be recognised without opening a
    // session. Without one, whatever answers could be a neighbour's, and the
    // next relay's own session finds and checks the camera properly.
    g_want_uid = std::string(fg::settings().getStr("webcam_uid").c_str());
    g_foreign_n = 0;
    bool found = false;
    if(!g_want_uid.empty()) {
      uint8_t did[20];
      IPAddress peer_ip;
      uint16_t peer_port = 0;
      const IPAddress broadcast(255, 255, 255, 255);
      const uint32_t started = millis();
      while(!found && (millis() - started) < SEARCH_MS) {
        found = lanSearch(udp, broadcast, 500, did, peer_ip, peer_port);
      }
      if(found) {
        Serial.printf("[cam] found at %s\n", peer_ip.toString().c_str());
        rememberCamIp(peer_ip);
        reportCamIp(cloud);
      }
      else {
        // An id that nothing answers to may be wrong rather than the camera
        // off. Dropping it lets the next session find the camera by its
        // printed id instead, and store the P2P id it really has.
        fg::settings().erase("webcam_uid");
        fg::settings().commit();
      }
    }

    udp.stop();
    WiFi.setSleep(wifi_was_asleep);

    if(cloud != nullptr) {
      cloud->log(found ? "message-terp-cam-found" : "message-terp-cam-not-found", found ? 0 : 1);
    }
    return found;
  }

  std::string terpCamCanonicalUid(std::string uid) {
    uid.erase(std::remove(uid.begin(), uid.end(), '-'), uid.end());
    if(uid.size() < 10 || uid.size() > 28) return "";
    for(size_t i = 0; i < uid.size(); i++) {
      const unsigned char c = (unsigned char)uid[i];
      const bool ok = i < 4 ? isalpha(c) : i < uid.size() - 5 ? isdigit(c) : isalnum(c);
      if(!ok) return "";
    }
    char out[40];
    snprintf(out, sizeof(out), "%.4s%llu%s", uid.c_str(),
             strtoull(uid.substr(4, uid.size() - 9).c_str(), nullptr, 10), uid.c_str() + uid.size() - 5);
    return std::string(out);
  }

  // Alphanumeric, 12 characters: comfortably inside what the camera accepts, and
  // free of punctuation so it survives a CGI query string unescaped.
  std::string generatePassword() {
    static const char ALPHABET[] = "abcdefghijkmnpqrstuvwxyzACDEFGHJKLMNPQRSTUVWXYZ23456789";
    std::string password;
    for(int i = 0; i < 12; i++) {
      password += ALPHABET[esp_random() % (sizeof(ALPHABET) - 1)];
    }
    return password;
  }

  bool terpCamNeedsSecuring() {
    return camIsPaired() &&
           settingIsEmpty(std::string(fg::settings().getStr(TERP_CAM_PWD_NVS_KEY).c_str()));
  }

  bool terpCamSecure(Fridgecloud* cloud, uint32_t find_ms) {
    if(g_relay_active) return false;   // the relay task owns the camera/buffers
    if(!camIsPaired()) return false;
    // Already done: a stored password means this camera is not on the default.
    if(!settingIsEmpty(std::string(fg::settings().getStr(TERP_CAM_PWD_NVS_KEY).c_str()))) return true;

    const bool wifi_was_asleep = WiFi.getSleep();
    WiFi.setSleep(false);
    WiFiUDP udp;
    if(!udp.begin(0)) {
      WiFi.setSleep(wifi_was_asleep);
      return false;
    }

    IPAddress peer_ip;
    uint16_t peer_port = 0;
    bool secured = false;
    const std::string password = generatePassword();

    // Straight after pairing the camera is still joining the network, so the
    // first attempts find nothing. Keep trying for a while rather than giving up
    // and leaving it on the manufacturer's password.
    // Always at least one attempt, however small the budget: callers that pass
    // none still want the camera secured, they just cannot wait around for it.
    bool have_session = false;
    const uint32_t find_until = millis() + find_ms;
    do {
      have_session = openSession(udp, peer_ip, peer_port);
      if(!have_session && (int32_t)(find_until - millis()) > 0) {
        for(int i = 0; i < 20; i++) { delay(100); esp_task_wdt_reset(); }
      }
    } while(!have_session && (int32_t)(find_until - millis()) > 0);

    if(have_session) {
      char cgi[224];
      snprintf(cgi, sizeof(cgi),
               "set_users.cgi?pwd_change_realtime=1&user1=&user2=&user3=admin&pwd1=&pwd2=&pwd3=%s&%s",
               password.c_str(), camAuth().c_str());
      sendPacket(udp, peer_ip, peer_port, buildCgi(CMD_CHANNEL, 1, cgi));

      // Confirm by USING it rather than by reading the reply: the reply's shape
      // varies between CGIs, and the change can drop the session it arrived on.
      const std::string probe_auth =
        "name=admin&loginuse=admin&loginpas=" + password + "&user=admin&pwd=" + password + "&";
      const uint32_t deadline = millis() + 6000;
      while(!secured && (int32_t)(deadline - millis()) > 0) {
        delay(400);
        esp_task_wdt_reset();
        snprintf(cgi, sizeof(cgi), "get_status.cgi?%s", probe_auth.c_str());
        sendPacket(udp, peer_ip, peer_port, buildCgi(CMD_CHANNEL, 2, cgi));
        const uint32_t wait_until = millis() + 800;
        while((int32_t)(wait_until - millis()) > 0) {
          int sz = udp.parsePacket();
          if(sz > 0 && sz <= (int)sizeof(g_rx)) {
            int len = udp.read(g_rx, sizeof(g_rx));
            if(len >= 8) {
              deobfuscate(g_rx, len);
              if(g_rx[1] == 0xd0 && g_rx[5] == CMD_CHANNEL &&
                 memmem(g_rx + 8, len - 8, "deviceid", 8) != nullptr) {
                secured = true;
                break;
              }
            }
          }
          delay(5);
        }
      }
    }

    if(secured) {
      fg::settings().setStr(TERP_CAM_PWD_NVS_KEY, password.c_str());
      fg::settings().commit();
    }
    if(cloud != nullptr) {
      // The cloud fetches stills itself and so needs these credentials. This is
      // hardware-info, which is stored against the device rather than written
      // into the log the user reads.
      cloud->log(std::string("hardware-info:webcam_pwd=") + (secured ? password : std::string("")), 0);
    }

    udp.stop();
    WiFi.setSleep(wifi_was_asleep);
    return secured;
  }

  bool terpCamFactoryReset(Fridgecloud* cloud) {
    // Take the camera back from a running relay: ask its task to end and wait for
    // it, so the reset owns the shared buffers. The relay notices within one
    // discovery round or connect timeout; one that has still not ended is left
    // alone rather than raced.
    if(g_relay_active) {
      g_relay_stop = true;
      for(int i = 0; i < 100 && g_relay_active; i++) { delay(100); esp_task_wdt_reset(); }
      if(g_relay_active) return false;
    }

    const std::string did_str = fg::settings().getStr("webcam_did");
    if(settingIsEmpty(did_str) || did_str == "none" || cloud == nullptr) {
      return false;
    }

    // This only sends one command, so it costs nothing but the socket.
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
      snprintf(cgi, sizeof(cgi), "restore_factory.cgi?%s", camAuth().c_str());

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
              if(g_rx[1] == 0xd0 && g_rx[5] == CMD_CHANNEL) { ok = true; break; }
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

  namespace {
    // One direction of the relay's cipher: AES-128-CTR under a key the cloud sends
    // with each cam_relay and never uses twice. Every CGI the cloud sends carries
    // the camera's password under nothing but the vendor's fixed table cipher, so
    // unenciphered the relay would put it on the internet as good as readable;
    // this keeps the relay exactly as private as the MQTT link the key came over.
    class RelayCipher {
      mbedtls_aes_context aes;
      uint8_t counter[16] = {};
      uint8_t block[16] = {};
      size_t offset = 0;
    public:
      explicit RelayCipher(const uint8_t* key) {
        mbedtls_aes_init(&aes);
        mbedtls_aes_setkey_enc(&aes, key, 128);
      }
      ~RelayCipher() { mbedtls_aes_free(&aes); }
      void apply(uint8_t* p, size_t n) { mbedtls_aes_crypt_ctr(&aes, n, &offset, counter, block, p, p); }
    };

    struct RelayArgs {
      bool        tls;       // the relay URL, taken apart (parseRelayUrl)
      std::string host;
      uint16_t    port;
      std::string path;
      std::string token;
      std::string uid;       // the paired camera's P2P id, empty until learned
      uint8_t     key[32];   // controller->cloud, then cloud->controller
    };

    // A raw-socket bridge between the camera's P2P UDP on the LAN and an enciphered
    // connection to the cloud: an HTTP upgrade on the API, so it goes wherever the
    // API's requests go, reverse proxy included, and needs no port of its own. The
    // cloud runs the whole P2P client (discovery aside), so the controller neither
    // authenticates nor assembles anything — it only shovels datagrams. That is
    // the point: the full-resolution keyframe burst is the cloud's problem to
    // reassemble, where there is RAM and no radio sharing an antenna, and the
    // controller stays a few KB of scratch.
    //
    // Why a raw socket rather than the MQTT tunnel: the tunnel base64s every
    // datagram into a JSON envelope and publishes it as a blocking QoS-0 TLS
    // write, which starves the loop and loses the burst (measured, docs §16.1).
    // A length-framed TCP stream has none of that overhead and is reliable and
    // ordered on the cloud hop, so the only loss left is the camera's own LAN
    // burst, which the cloud repairs by re-asking — exactly as it does for a
    // camera it reaches directly.
    //
    // Runs on its own task, so it never logs: the cloud's log queue belongs to the
    // loop task (see terpCamReportPending).
    bool relay(const RelayArgs& args) {
      const bool wifi_was_asleep = WiFi.getSleep();
      // ESP32 WiFi defaults to modem power-save, which parks the radio between
      // beacons and silently drops inbound UDP - most of a burst (measured).
      WiFi.setSleep(false);

      WiFiUDP udp;
      WiFiClient plain;
      WiFiClientSecure secure;
      WiFiClient& tcp = args.tls ? secure : plain;
      uint8_t* buf = nullptr;
      auto finish = [&](bool ran) {
        free(buf);
        tcp.stop();
        udp.stop();
        WiFi.setSleep(wifi_was_asleep);
        esp_task_wdt_reset();
        return ran;
      };
      if(!udp.begin(0)) return finish(false);

      // Only a camera whose P2P id is known is relayed to: discovery alone cannot
      // tell a neighbour's camera from ours, and whichever answered first would be
      // handed the cloud's login, password included. Where the id is not known
      // yet (never learned, or dropped by a search that found nothing), a session
      // of our own proves which camera is ours - it checks the reply against the
      // paired id, see openSession - and stores the id. It is closed again at
      // once; the cloud opens its own.
      std::string uid = args.uid;
      if(uid.empty()) {
        IPAddress own_ip;
        uint16_t own_port = 0;
        if(g_relay_stop || !openSession(udp, own_ip, own_port)) return finish(false);
        for(int i = 0; i < 3; i++) {
          sendPacket(udp, own_ip, own_port, buildPacket(0xf0, nullptr, 0));
          delay(15);
        }
        uid = std::string(fg::settings().getStr("webcam_uid").c_str());
        if(settingIsEmpty(uid)) return finish(false);
      }

      g_want_uid = uid;
      g_foreign_n = 0;
      uint8_t did[20];
      IPAddress peer_ip;
      uint16_t peer_port = 0;
      IPAddress cached_ip;
      const IPAddress broadcast(255, 255, 255, 255);
      bool found = cached_ip.fromString(cachedCamIp().c_str()) &&
                   lanSearch(udp, cached_ip, CACHED_PEER_MS, did, peer_ip, peer_port);
      const uint32_t discover_start = millis();
      while(!found && !g_relay_stop && (millis() - discover_start) < DISCOVER_MS) {
        found = lanSearch(udp, broadcast, 400, did, peer_ip, peer_port);
      }
      if(!found) {
        // Counted as a miss, so an id or address that no longer answers leads to
        // a search (terpCamNeedsSearch).
        if(!g_relay_stop && g_camera_misses < 255) ++g_camera_misses;
        return finish(false);
      }
      g_camera_misses = 0;
      rememberCamIp(peer_ip);

      if(g_relay_stop) return finish(false);
      if(args.tls) {
        // The relay enciphers everything itself under a key that came over the
        // verified MQTT link, so TLS here only has to get through to the API.
        secure.setInsecure();
        secure.setTimeout(5);
        secure.setHandshakeTimeout(10);
      } else {
        plain.setTimeout(5);
      }
      if(!tcp.connect(args.host.c_str(), args.port)) return finish(false);
      if(!args.tls) plain.setNoDelay(true);

      // A frame goes out whole or the relay ends: after a short write the cloud
      // would read payload bytes as a length, and nothing on the stream can
      // resynchronise it.
      auto writeAll = [&](const uint8_t* p, size_t n) {
        const uint32_t until = millis() + 5000;
        while(n > 0) {
          const size_t w = tcp.write(p, n);
          if(w > 0) { p += w; n -= w; continue; }
          if(!tcp.connected() || (int32_t)(until - millis()) <= 0) return false;
          delay(2);
          esp_task_wdt_reset();
        }
        return true;
      };

      // Switch the connection over. The response head is read a byte at a time,
      // so nothing that follows it is taken from the relay.
      {
        std::string request = "GET " + args.path + " HTTP/1.1\r\nHost: " + args.host;
        if(args.port != (args.tls ? 443 : 80)) request += ":" + std::to_string(args.port);
        request += "\r\nUpgrade: terpcam-relay\r\nConnection: Upgrade\r\n\r\n";
        if(!writeAll((const uint8_t*)request.data(), request.size())) return finish(false);
        std::string head;
        const uint32_t until = millis() + 10000;
        while(head.size() < 1024 && (head.size() < 4 || head.compare(head.size() - 4, 4, "\r\n\r\n") != 0)) {
          const int c = tcp.available() > 0 ? tcp.read() : -1;
          if(c >= 0) { head += (char)c; continue; }
          if(g_relay_stop || !tcp.connected() || (int32_t)(until - millis()) <= 0) return finish(false);
          delay(2);
          esp_task_wdt_reset();
        }
        if(head.compare(0, 5, "HTTP/") != 0 || head.size() < 12 || head.compare(8, 4, " 101") != 0) return finish(false);
      }

      // malloc'd for the relay and freed on every exit path, so it costs no
      // resident RAM.
      constexpr size_t RELAY_BUF = 2048;
      buf = (uint8_t*)malloc(RELAY_BUF);
      if(buf == nullptr) return finish(false);

      RelayCipher up(args.key);
      RelayCipher down(args.key + 16);

      // Header the cloud correlates the connection by: the token in the clear (it
      // is what picks the key), a NUL, and the 20-byte P2P id the cloud needs for
      // its own DevLgn, which is the first thing enciphered.
      size_t hn = 2;
      for(char c : args.token) {
        if(hn < 2 + 64) buf[hn++] = (uint8_t)c;
      }
      buf[hn++] = 0;
      memcpy(buf + hn, did, 20);
      up.apply(buf + hn, 20);
      hn += 20;
      buf[0] = (uint8_t)(((hn - 2) >> 8) & 0xff);
      buf[1] = (uint8_t)((hn - 2) & 0xff);
      bool done = !writeAll(buf, hn);

      // Framed both ways: a 2-byte big-endian length, then the datagram, the two
      // enciphered together. The cloud opens a fresh session per still and hangs
      // up once it has it, which is what ends the relay; the cap only ends one the
      // cloud has lost track of, well above its own bound on a still.
      constexpr uint32_t RELAY_MAX_MS  = 2UL * 60UL * 1000UL;
      constexpr uint32_t RELAY_IDLE_MS = 30000;   // no traffic at all -> done
      size_t held = 0;                            // bytes of a partial inbound frame
      const uint32_t started = millis();
      uint32_t last_traffic = millis();
      uint32_t last_wdt = millis();

      while(!done && !g_relay_stop && tcp.connected() && (millis() - started) < RELAY_MAX_MS &&
            (millis() - last_traffic) < RELAY_IDLE_MS) {
        bool io = false;

        // Camera -> cloud. Drain hard: an undrained datagram is a lost one, and the
        // mailbox is only a few deep. The datagram is read in behind room for its
        // length in g_rx (idle here), so each frame is a single write.
        for(int i = 0; i < 64 && !done; i++) {
          if(udp.parsePacket() <= 0) break;
          const int n = udp.read(g_rx + 2, sizeof(g_rx) - 2);
          if(n <= 0) continue;
          g_rx[0] = (uint8_t)((n >> 8) & 0xff);
          g_rx[1] = (uint8_t)(n & 0xff);
          up.apply(g_rx, (size_t)n + 2);
          done = !writeAll(g_rx, (size_t)n + 2);
          io = true;
          last_traffic = millis();
        }

        // Cloud -> camera. Append to the partial frame, then forward every whole one.
        const int avail = tcp.available();
        if(avail > 0 && held < RELAY_BUF) {
          const int n = tcp.read(buf + held, std::min(RELAY_BUF - held, (size_t)avail));
          if(n > 0) {
            down.apply(buf + held, (size_t)n);
            held += (size_t)n;
            io = true;
            last_traffic = millis();
          }
        }
        size_t off = 0;
        while(held - off >= 2) {
          const size_t plen = ((size_t)buf[off] << 8) | buf[off + 1];
          if(plen == 0) { done = true; break; }   // the cloud is done
          // Too long to ever fit behind its length in the buffer: the stream is lost.
          if(plen > RELAY_BUF - 2) { done = true; break; }
          if(held - off - 2 < plen) break;
          udp.beginPacket(peer_ip, peer_port);
          udp.write(buf + off + 2, plen);
          udp.endPacket();
          off += 2 + plen;
        }
        if(off > 0) {
          memmove(buf, buf + off, held - off);
          held -= off;
        }

        if(!io) delay(2);
        if(millis() - last_wdt > 200) { last_wdt = millis(); esp_task_wdt_reset(); }
      }

      // Free the camera's session slot ourselves, here on the LAN, rather than
      // trusting the cloud's `f1 f0` to cross a TCP connection that is closing at the
      // same moment. The camera allows only four sessions and hands out no video on
      // a fifth, so a slot left occupied after every capture is what makes the next
      // one log in and receive nothing. Sending the close directly from the
      // controller frees it every time. Repeat it a few times: it is a single
      // unacked datagram, and the camera is about to stop hearing us.
      for(int i = 0; i < 3; i++) {
        sendPacket(udp, peer_ip, peer_port, buildPacket(0xf0, nullptr, 0));
        delay(15);
      }
      return finish(true);
    }

    void relayTaskEntry(void* param) {
      RelayArgs* args = (RelayArgs*)param;
      esp_task_wdt_add(nullptr);            // this task feeds the watchdog itself
      relay(*args);
      esp_task_wdt_delete(nullptr);
      delete args;
      g_relay_task = nullptr;
      g_relay_active = false;
      vTaskDelete(nullptr);
    }

    // http[s]://host[:port][/path]; anything else is not a relay URL.
    bool parseRelayUrl(const std::string& url, RelayArgs& args) {
      size_t at;
      if(url.rfind("https://", 0) == 0) { args.tls = true; args.port = 443; at = 8; }
      else if(url.rfind("http://", 0) == 0) { args.tls = false; args.port = 80; at = 7; }
      else return false;
      const size_t slash = url.find('/', at);
      std::string authority = url.substr(at, slash == std::string::npos ? std::string::npos : slash - at);
      args.path = slash == std::string::npos ? "/" : url.substr(slash);
      const size_t colon = authority.rfind(':');
      if(colon != std::string::npos) {
        args.port = (uint16_t)atoi(authority.c_str() + colon + 1);
        authority.resize(colon);
      }
      args.host = authority;
      return !args.host.empty() && args.port != 0;
    }

    bool parseHex(const std::string& hex, uint8_t* out, size_t n) {
      if(hex.size() != n * 2) return false;
      for(size_t i = 0; i < n; i++) {
        const char pair[3] = { hex[i * 2], hex[i * 2 + 1], 0 };
        if(!isxdigit((unsigned char)pair[0]) || !isxdigit((unsigned char)pair[1])) return false;
        out[i] = (uint8_t)strtoul(pair, nullptr, 16);
      }
      return true;
    }
  }

  bool terpCamStartRelay(const std::string& url, const std::string& token, const std::string& key) {
    if(g_relay_active || g_relay_task != nullptr) return false;   // one relay at a time
    // The camera's P2P id may still be unknown; the relay learns it first then.
    std::string uid(fg::settings().getStr("webcam_uid").c_str());
    if(settingIsEmpty(uid)) uid.clear();
    if(!camIsPaired() || token.empty()) return false;

    RelayArgs* args = new RelayArgs{ false, {}, 0, {}, token, uid, {} };
    if(!parseRelayUrl(url, *args) || !parseHex(key, args->key, sizeof(args->key))) {   // never bridge in the clear
      delete args;
      return false;
    }
    g_relay_stop = false;
    g_relay_active = true;   // before the task runs, so the other paths see it at once
    // 8 KB stack: the body keeps its datagram scratch in a file-static buffer and
    // one 2 KB heap allocation, so the stack itself only carries the socket
    // objects, the cipher state and small locals. A TLS handshake runs on this
    // stack too and needs about another 4 KB.
    const uint32_t stack = args->tls ? 12288 : 8192;
    if(xTaskCreate(relayTaskEntry, "terpcamrelay", stack, args, 1, &g_relay_task) != pdPASS) {
      delete args;
      g_relay_active = false;
      g_relay_task = nullptr;
      return false;
    }
    return true;
  }

  void terpCamReportPending(Fridgecloud* cloud) {
    if(!g_relay_active) reportCamIp(cloud);
  }

}
