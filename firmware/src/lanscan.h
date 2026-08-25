#pragma once

#include <functional>
#include <string>
#include <vector>

#include <stdint.h>

namespace fg {

  /**
   * Normalises a MAC as Tasmota reports it ("A4:CF:12:AB:34:CD", terminated by
   * anything that is not a MAC character) into the hardware id sockets are
   * tracked by: uppercase hex without separators. Empty when the input is not
   * a MAC.
   */
  std::string socketIdFromMac(const char* mac);

  /**
   * Finds Tasmota smart sockets on the local network by their hardware id (the
   * MAC address Tasmota reports in `Status 5`).
   *
   * Sockets are commanded by IP address, and a DHCP lease change silently
   * breaks that address — the socket is still there, it just answers somewhere
   * else. The hardware id is what survives, so a socket that stopped responding
   * can be found again instead of forcing the user to pair it a second time.
   *
   * The sweep is incremental on purpose: tick() probes a couple of addresses
   * and returns, so the control loop keeps running while it is in progress. A
   * full subnet takes about a minute at the timeouts used here, which is why
   * callers only run it while the display is idle.
   */
  class LanScan {
  public:
    struct Host {
      std::string ip;
      std::string id;   // MAC as uppercase hex, no separators
    };

    /**
     * Starts a sweep of the device's own /24. `auth_queries` are the
     * "user=..&password=..&" fragments to try per host, first answer wins —
     * pass the credentials of every known socket so a single sweep can identify
     * all of them. Returns false when there is nothing to sweep (no uplink, no
     * credentials).
     */
    bool start(const std::vector<std::string>& auth_queries);
    void stop();
    bool running() const { return next_host != 0; }

    /**
     * Probes the next few addresses and reports every socket it identifies.
     * Returns true once the whole subnet has been covered (the sweep then stops
     * itself).
     */
    bool tick(const std::function<void(const Host&)>& on_host);

  private:
    std::vector<std::string> auth_queries;
    uint8_t prefix[3] = {0, 0, 0};
    uint8_t self_host = 0;
    uint8_t next_host = 0;   // 0 == no sweep in progress
  };

}
