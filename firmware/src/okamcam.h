#pragma once

#include "fridgecloud.h"

namespace fg {

  /**
   * Grab one JPEG still from the paired O-KAM/VStarcam camera on the local
   * network and stream it to the cloud.
   *
   * The camera speaks a proprietary P2P protocol (reverse-engineered; see
   * docs/okam-webcam-reverse-engineering.md). Running the client here rather
   * than in the cloud is what makes it reliable: the camera's sliding-window
   * retransmission needs low, predictable latency, which a LAN round-trip has
   * and a round-trip through the MQTT tunnel does not.
   *
   * This uses `snapshot.cgi`, which returns the 640x360 sub-stream as a paced
   * request/response — the camera sends a fragment, waits for its ack, then
   * sends the next. That pacing is why this path is reliable and the
   * full-resolution one is not (see the note below).
   *
   * Memory: the image buffer is malloc'd per capture and freed on every exit
   * path, so nothing is held between captures. If the largest free block cannot
   * spare it with a margin, the capture is skipped rather than risking an
   * allocation failure elsewhere — the image service simply retries on its own
   * schedule. Static use is a handful of file-static buffers (~2.5 KB).
   *
   * Returns true when a complete image was streamed. Safe to call when no
   * camera is paired (returns false immediately).
   */
  bool okamCamCapture(Fridgecloud* cloud);

  /**
   * Factory-reset the paired camera so it drops back to its `@IPC-<n>` setup AP
   * and can be paired again (by this module or any other). Sends
   * `restore_factory.cgi` over the same P2P session the capture path uses.
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
  bool okamCamFactoryReset(Fridgecloud* cloud);

  /*
   * ---------------------------------------------------------------------------
   * NOTE — the full-resolution (2304x1296) path, and why it is not used
   * ---------------------------------------------------------------------------
   *
   * It works, it is implemented in git history (`bcb257f`, and the measurement
   * builds after it), and it produces genuine 2304x1296 stills. It is not
   * shipped because its success rate tops out around 3 in 8. Everything below
   * is measured on this hardware — see docs §19 for the full write-up.
   *
   * HOW IT WORKS
   *   `snapshot.cgi` is hardwired to the 640x360 sub-stream; no parameter
   *   changes it. The only full-resolution source is the VIDEO stream:
   *   `livestream.cgi?streamid=10&substream=2` on DRW channel 1. Its payload is
   *   VStarcam media frames — a 32-byte header (magic 55 aa 15 a8, frame length
   *   at offset 16, little-endian) followed by H.264 Annex-B. Keep the first
   *   keyframe (SPS NAL 7 + IDR NAL 5), publish the raw H.264 with
   *   `"h264":true` in the image message, and the server decodes it to JPEG with
   *   ffmpeg (`okamCamService.decodeKeyframeToJpeg`). The controller decodes
   *   nothing.
   *
   * WHY IT IS UNRELIABLE — four findings, in the order they bite
   *   1. ONE KEYFRAME PER SESSION. The keyframe is the first frame the camera
   *      sends; everything after it is P-frames of 90 B - 5 KB, forever. Asking
   *      for the stream again on a live session is IGNORED. So a capture gets
   *      exactly one chance, and if fragments of that keyframe are lost the
   *      remaining budget is worthless. On-device this reads as `anch=1` then
   *      `drop=1` and nothing usable for the next 19 seconds.
   *   2. IT IS A BURST, NOT A CONVERSATION. The keyframe arrives as ~53
   *      back-to-back 1 KB fragments with no pacing and no unprompted
   *      retransmission. lwip's UDP mailbox is a few datagrams deep, so some are
   *      always lost. This is the core difference from snapshot.cgi.
   *   3. ACKING IS A RESEND REQUEST, NOT AN ACKNOWLEDGEMENT. Acking from the
   *      first fragment pulls 4000-9000 fragments into one capture with almost
   *      no frame headers among them — retransmitted data drowning new data.
   *      Acking nothing gives pristine reception (578 fragments, 510 headers)
   *      but no way to repair a gap. Only acking WHILE a keyframe is being
   *      assembled does both. This applies to the snapshot path too, and is why
   *      the code here re-acks the last good index instead of the newest one.
   *   4. THE KEYFRAME IS SCENE-DEPENDENT: 27-38 KB on a quiet scene, 52-67 KB on
   *      a busy one. A buffer that fits the average silently scores 0/10 when
   *      the scene brightens, because an oversized keyframe is refused outright.
   *      It must fit the big end — and on this chip the largest contiguous free
   *      block is ~94 KB, so 76 KB + an 8 KB margin was the practical ceiling.
   *
   * WHAT WAS TRIED AND DOES NOT WORK — do not spend time on these again
   *   - Shrinking the keyframe at the camera. `set_camera_params.cgi` does not
   *     exist on firmware EN120.8.53.11. No `camera_control.cgi?param=N&value=V`
   *     moves the encoder (verified live). `trans_cmd_string.cgi?cmd=2105&
   *     command=2&videoFormat=1` (H.264+/H.265, which the app advertises as
   *     "~50% less bitrate") is accepted and persists in readback, but the
   *     encoder ignores it — still H.264 at 56.7 KB after a full reboot.
   *   - Several sessions per capture. Since each session yields one keyframe,
   *     N sessions should give N chances. It measures 0/10: discovery never
   *     completes, and repeated udp.stop()/udp.begin() PERMANENTLY fragments the
   *     heap (largest free block 94,196 -> 77,812 bytes and it stays there), so
   *     later captures fail the allocation guard. Socket churn is not viable.
   *   - Re-issuing livestream.cgi mid-stream to force a new keyframe: ignored.
   *
   * WHAT WOULD ACTUALLY MAKE IT WORK
   *   A controller with PSRAM. It removes the buffer ceiling and, more
   *   importantly, the memory pressure that makes draining a 53-fragment burst
   *   marginal. Failing that, the camera would have to be talked into a lower
   *   bitrate, which this firmware provides no means to do.
   */

}
