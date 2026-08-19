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
   * Memory: allocates nothing on the heap. It uses a handful of file-static
   * buffers (~2.5 KB total, see okamcam.cpp) and never holds the whole image —
   * each ~1 KB fragment is published as it arrives, so RAM use is independent
   * of the image size. The UDP socket is always closed before returning.
   *
   * Returns true when a complete image was streamed. Safe to call when no
   * camera is paired (returns false immediately).
   */
  bool okamCamCapture(Fridgecloud* cloud);

}
