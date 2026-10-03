import pLimit from 'p-limit';

/**
 * How many stills ffmpeg makes at once on this server, whatever camera they are
 * of: a stream read over RTSP and a Terp Cam keyframe decoded into a JPEG take
 * their turn from the same ten. ffmpeg is expensive, and a camera that hangs
 * holds its run for 90 s; ten at a time is what the box takes.
 *
 * A Terp Cam's relay is not counted, only its decode: the relay is the device
 * dialling in and the camera sending a keyframe, which can take minutes of
 * waiting and next to no work, and holding a slot through it would leave the
 * streams queued behind cameras that are only slow to answer.
 */
export const ffmpegSlot = pLimit(10);
