#pragma once

#include "fridgecloud.h"

namespace fg {

  /** NVS slot holding this camera's password, empty until pairing sets one. */
  constexpr const char* TERP_CAM_PWD_NVS_KEY = "webcam_pwd";
  /** What the camera ships with, and what a factory reset puts back. */
  constexpr const char* TERP_CAM_DEFAULT_PASSWORD = "888888";
  /** NVS slot set to "1" when the camera is read off its own RTSP stream on the LAN. */
  constexpr const char* TERP_CAM_STREAM_NVS_KEY = "webcam_rtsp";
  /** NVS slot holding the camera's MAC (uppercase hex), which is how its stream is told from another camera's. */
  constexpr const char* TERP_CAM_MAC_NVS_KEY = "webcam_mac";
  /** Where the camera's RTSP stream answers on the LAN, and its full-resolution main stream. */
  constexpr uint16_t TERP_CAM_STREAM_PORT = 10554;
  constexpr const char* TERP_CAM_STREAM_PATH = "/tcp/av0_0";

  /** A fresh 12-character camera password, free of characters a CGI query would need escaped. */
  std::string terpCamGeneratePassword();

  /**
   * Whether the paired camera is read off its own RTSP stream on the LAN - the
   * cloud pulls it through the device's tunnel - rather than through the P2P
   * relay below. Decided at pairing, by the stream answering once it is switched on.
   */
  bool terpCamStreams();

  /** Whether `ip` serves the camera stream: an RTSP OPTIONS on the stream port answered with 200. */
  bool terpCamStreamAnswers(const IPAddress& ip, uint32_t connect_ms = 300);

  /** The MAC this device's ARP table holds for `ip`, uppercase hex, or "" when it has none. */
  std::string terpCamMacOf(const IPAddress& ip);

  /**
   * Looks for the streaming camera on this device's /24 and remembers (and
   * reports) where it answers. Only a stream whose MAC is the paired camera's
   * counts; without a stored MAC only a sweep with exactly one stream on the
   * network does. Blocking, watchdog-fed, for up to `budget_ms`.
   */
  bool terpCamFindStream(Fridgecloud* cloud, uint32_t budget_ms);

  /**
   * Idle-loop upkeep for a streaming camera: every few minutes checks that it
   * still answers where it last did and, when it does not, sweeps the subnet a
   * few addresses per call. Returns true while a sweep is under way, so the
   * caller leaves its other searches for later.
   */
  bool terpCamTickStream(Fridgecloud* cloud);


  /**
   * Bridge the camera's P2P UDP (on the LAN) to a connection to the cloud - an
   * HTTP upgrade on `url`, the API's relay path -
   * so the cloud can run the P2P client itself and pull a full-resolution
   * (2304x1296) keyframe without the manufacturer's rendezvous servers.
   *
   * The controller only shovels datagrams: it discovers the camera, opens the
   * TCP connection, sends a short header (token + the camera's P2P id) and then
   * relays bytes both ways, enciphered under `key` (64 hex digits, one AES-128
   * key per direction), until the cloud closes the connection or it falls idle.
   * It buffers no image, so the full-resolution burst is not its problem — that
   * is what makes the reliable full-resolution path (docs §26) reachable through
   * the controller. The only session it opens itself is one to learn the
   * camera's P2P id, when that is not known yet. This is the only way the cloud
   * gets a still: the controller takes none itself.
   *
   * Runs in its own task and returns at once, so the control loop keeps running
   * while the cloud holds a session. Returns false without starting anything when
   * a relay already runs, no camera is paired, or the URL or key is unusable. While a
   * relay is active the other camera paths (search, secure, reset) stand down or
   * end it, because they share buffers with it.
   */
  bool terpCamStartRelay(const std::string& url, const std::string& token, const std::string& key);

  /** Report what the last relay learned about the camera. Call from the loop task. */
  void terpCamReportPending(Fridgecloud* cloud);

  /**
   * Factory-reset the paired camera so it drops back to its `@IPC-<n>` setup AP
   * and can be paired again (by this module or any other). Sends
   * `restore_factory.cgi` over a P2P session of its own.
   *
   * Called when the user disconnects the camera from the module: without it the
   * camera stays joined to a Wi-Fi network it is no longer paired with, and the
   * only way back is the physical reset button.
   *
   * Best-effort: returns true if the camera acknowledged the command. A false
   * return should NOT block the disconnect — the module must forget the camera
   * either way, otherwise a camera that is already off or out of range would
   * make disconnecting impossible.
   */
  bool terpCamFactoryReset(Fridgecloud* cloud);

  /**
   * Whether the camera has been unreachable often enough that it is worth
   * looking for it on the network again — typically because DHCP moved it and
   * the address it last answered on is stale.
   */
  bool terpCamNeedsSearch();

  /**
   * Looks for the paired camera and remembers where it answered.
   *
   * The camera announces itself, so this is a longer LanSearch round rather
   * than a subnet sweep: it broadcasts for several seconds and caches the
   * address the camera answers from, which is what a later relay tries first.
   * Only a camera with the stored P2P id counts; without one nothing is searched,
   * since only a session can tell which camera answered.
   * Blocking (watchdog-fed) for up to a few seconds, so callers run it while
   * the display is idle.
   *
   * Returns true when the camera answered.
   */
  bool terpCamSearch(Fridgecloud* cloud);

  /**
   * Replace the camera's factory password with a generated one and report it, so
   * the cloud can authenticate too. Does nothing when a password is already
   * stored, so it is safe to call whenever — pairing calls it once the camera is
   * on the network, which is where the camera actually applies the change.
   *
   * Returns true when the camera answers to the new password afterwards.
   */
  bool terpCamSecure(Fridgecloud* cloud, uint32_t find_ms = 90000);

  /** Whether a camera is paired and still on the manufacturer's password. */
  bool terpCamNeedsSecuring();

  /**
   * A P2P id as the camera writes it (`VSTH-828707-TXVEW`) in the form discovery
   * reads it off the wire (`VSTH828707TXVEW`), or "" if it is not one.
   */
  std::string terpCamCanonicalUid(std::string uid);

  /*
   * The controller used to take stills itself: a 1280x720 `snapshot.cgi` JPEG,
   * and before that a full-resolution keyframe off the video stream that lost
   * its unpaced burst too often to ship. Why that failed, and what was tried,
   * is in git history (this header before the snapshot path was removed) and
   * docs §19; the relay leaves the burst to the cloud instead.
   */

}
