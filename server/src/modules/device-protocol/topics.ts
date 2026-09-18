/**
 * The topics a device speaks on.
 *
 * Every one of them is `/devices/<device_id>/<name>`, built by the firmware at
 * init, and the broker authorises a device by a literal prefix match on
 * `.devices.<device_id>.` - so a topic cannot be renamed or moved without
 * changing what every deployed device is allowed to publish.
 */

/** One subscription covers the whole fleet; a device names itself in the topic. */
export const DEVICE_TOPIC_FILTER = '/devices/#';

/**
 * What a device publishes on. `fwupdate` and `control/#` are subscribed by every
 * device and published by nobody: they stay reserved, so a later server can use
 * them without a firmware change.
 */
export type InboundTopic = 'status' | 'bulk' | 'fetch' | 'log' | 'configuration' | 'image' | 'tunnel_read';

/** What the server publishes on. The server sees its own messages echoed back and ignores them. */
export type OutboundTopic = 'command' | 'firmware' | 'configuration' | 'tunnel_write';

export const deviceTopic = (deviceId: string, name: OutboundTopic): string => `/devices/${deviceId}/${name}`;

export interface DeviceTopic {
  deviceId: string;
  name: string;
  /**
   * Whether the message arrived below the topic rather than on it. A device in
   * custom-MQTT mode publishes one bare value per sensor under `status`, and
   * only the depth tells those apart from a reading document.
   */
  isSubTopic: boolean;
}

/** The device and the topic a message came in on, or null for a topic that is none of ours. */
export const parseDeviceTopic = (topic: string): DeviceTopic | null => {
  // `/devices/<id>/<name>[/...]`, so the leading segment is empty.
  const segments = topic.split('/');
  if (segments.length < 4 || segments[1] !== 'devices') return null;

  const [, , deviceId, name] = segments;
  if (!deviceId || !name) return null;

  return { deviceId, name, isSubTopic: segments.length > 4 };
};
