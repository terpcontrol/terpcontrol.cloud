#!/usr/bin/env python3
"""Grab a FULL-RESOLUTION still by taking one H.264 keyframe off the camera's
main video stream, over the direct cloud path.

`snapshot.cgi` renders from the MJPEG encoder and is pinned at 640x360 on this
firmware, so the only source of a 2304x1296 image is the video stream:

    livestream.cgi?streamid=10&substream=2      -> DRW channel 1

Channel 1 carries VStarcam media frames: a 32-byte header (magic 55 aa 15 a8,
frame length at offset 16, little endian) followed by H.264 Annex-B. The FIRST
frame of a session is the keyframe; everything after it is small P-frames, and
re-requesting the stream on a live session is ignored. So each session gets
exactly one chance, and the whole job is to receive that one burst intact.

On the ESP32 that burst was the problem (~53 unpaced 1 KB fragments into a
mailbox a few datagrams deep, 3/8 success). A server has none of those limits.

Usage: terpcam-hd.py <DID> [--substream N] [-o out.h264] [--lan]
"""
import argparse, socket, struct, sys, time

sys.path.insert(0, __file__.rsplit("/", 1)[0])
from importlib import import_module

_lan = import_module('terpcam-lan')          # hyphenated module names
_remote = import_module('terpcam-remote')
build_packet, build_cgi, build_ack = _lan.build_packet, _lan.build_cgi, _lan.build_ack
deobfuscate, obfuscate, AUTH, Session = _lan.deobfuscate, _lan.obfuscate, _lan.AUTH, _lan.Session
rendezvous, punch, login, pack_did = _remote.rendezvous, _remote.punch, _remote.login, _remote.pack_did

VIDEO_CHANNEL = 1
FRAME_MAGIC = b"\x55\xaa\x15\xa8"

def is_keyframe(payload: bytes) -> bool:
    """True when the frame carries both SPS (NAL 7) and an IDR slice (NAL 5)."""
    sps = idr = False
    for i in range(len(payload) - 4):
        if payload[i:i + 4] == b"\x00\x00\x00\x01":
            nal = payload[i + 4] & 0x1f
            sps = sps or nal == 7
            idr = idr or nal == 5
            if sps and idr:
                return True
    return False

def capture_keyframe(sock, peer, did, substream=2, budget=25.0, verbose=True):
    """Request the stream and reassemble the first keyframe off channel 1."""
    cgi = f"livestream.cgi?streamid=10&substream={substream}&{AUTH}"
    sock.sendto(build_cgi(0, 1, cgi), peer)

    slots, base, contiguous = {}, None, 0
    frags = 0
    started = last_data = time.time()
    while time.time() - started < budget and time.time() - last_data < 8:
        sock.settimeout(0.4)
        try:
            data, addr = sock.recvfrom(2048)
        except socket.timeout:
            continue
        plain = deobfuscate(data)
        if len(plain) < 8:
            continue
        if plain[1] == 0xe0:                       # keepalive
            sock.sendto(build_packet(0xe1), peer)
            continue
        if plain[1] != 0xd0 or plain[5] != VIDEO_CHANNEL:
            continue
        index = struct.unpack_from(">H", plain, 6)[0]
        declared = struct.unpack_from(">H", plain, 2)[0]
        plen = declared - 4
        if plen <= 0 or plen > len(plain) - 8:
            plen = len(plain) - 8
        if plen <= 0:
            continue
        frags += 1
        last_data = time.time()
        if base is None:
            base = index
        slot = (index - base) & 0xffff
        if slot > 0x8000:
            continue
        slots.setdefault(slot, plain[8:8 + plen])
        while contiguous in slots:
            contiguous += 1

        # Ack while assembling — that is what repairs a gap. Acking from the very
        # first fragment instead drags thousands of retransmits in and drowns the
        # new data (measured on the controller).
        if contiguous:
            sock.sendto(build_ack(VIDEO_CHANNEL, (base + contiguous - 1) & 0xffff), peer)

        # Do we have a whole frame yet?
        buf = b"".join(slots[i] for i in range(contiguous))
        start = buf.find(FRAME_MAGIC)
        if start >= 0 and len(buf) >= start + 32:
            frame_len = struct.unpack_from("<I", buf, start + 16)[0]
            if 0 < frame_len < 4_000_000 and len(buf) >= start + 32 + frame_len:
                payload = buf[start + 32:start + 32 + frame_len]
                if is_keyframe(payload):
                    if verbose:
                        print(f"keyframe: {frame_len} bytes, {frags} fragments, "
                              f"{contiguous} slots", file=sys.stderr)
                    return payload, frags
                # Not a keyframe: drop it and keep looking in the same session.
                consumed = start + 32 + frame_len
                eaten = 0
                new = {}
                for i in range(contiguous):
                    if eaten + len(slots[i]) <= consumed:
                        eaten += len(slots[i])
                        continue
                    new[len(new)] = slots[i]
                for i in range(contiguous, max(slots) + 1 if slots else 0):
                    if i in slots:
                        new[len(new)] = slots[i]
                base = (base + contiguous) & 0xffff
                slots, contiguous = new, 0
                while contiguous in slots:
                    contiguous += 1
    return None, frags

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("did")
    ap.add_argument("--substream", type=int, default=2)
    ap.add_argument("-o", "--out", default="hd.h264")
    ap.add_argument("--lan", action="store_true", help="use LAN discovery instead of the cloud path")
    args = ap.parse_args()

    if args.lan:
        s = Session(verbose=True)
        if not s.open():
            print("no camera on the LAN", file=sys.stderr)
            return 2
        sock, peer = s.sock, s.peer
    else:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.bind(("", 0))
        peers, punched = rendezvous(sock, args.did)
        peer = punched or punch(sock, args.did, peers)
        if peer is None:
            print("no session", file=sys.stderr)
            return 3
        sock.sendto(build_packet(0x41, pack_did(args.did)), peer)
        peer = login(sock, args.did, peer)
        if peer is None:
            print("login failed", file=sys.stderr)
            return 3

    frame, frags = capture_keyframe(sock, peer, args.did, args.substream)
    if frame is None:
        print(f"no keyframe (got {frags} fragments)", file=sys.stderr)
        return 4
    open(args.out, "wb").write(frame)
    print(f"{args.out}: {len(frame)} bytes of H.264 ({frags} fragments)")
    return 0

if __name__ == "__main__":
    sys.exit(main())
