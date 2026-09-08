#!/usr/bin/env python3
"""LAN-direct probe for the O-KAM/VStarcam P2P snapshot path.

A straight port of firmware/src/okamcam.cpp: same table cipher, same CS2 PPPP
packets, same session handshake, same indexed reassembly with contiguous acks.
Buffers the whole reply (this machine has RAM), reports JPEG SOF dimensions.

Usage:
  okamprobe.py sweep                 # LanSearch broadcast, print who answers
  okamprobe.py res                   # request snapshot.cgi with '', res=0..3, report WxH + bytes
  okamprobe.py cgi '<cgi>?'          # send one CGI (auth appended), print the text reply
  okamprobe.py snap <out.jpg> [res]  # grab one still to a file
"""
import socket, struct, sys, time

SBOX = bytes([
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
])
DK = bytes([44, 212, 96, 6])
DISCOVERY_PORT = 32108
AUTH = "name=admin&loginuse=admin&loginpas=888888&user=admin&pwd=888888&"

def obfuscate(buf: bytes) -> bytes:
    out = bytearray(len(buf)); prev = 0
    for i, b in enumerate(buf):
        c = SBOX[(DK[prev & 3] + prev) & 0xff] ^ b
        out[i] = c; prev = c
    return bytes(out)

def deobfuscate(buf: bytes) -> bytes:
    out = bytearray(len(buf)); prev = 0
    for i, c in enumerate(buf):
        out[i] = SBOX[(DK[prev & 3] + prev) & 0xff] ^ c
        prev = c
    return bytes(out)

def build_packet(ptype: int, payload: bytes = b"") -> bytes:
    return obfuscate(bytes([0xf1, ptype]) + struct.pack(">H", len(payload)) + payload)

def build_cgi(channel: int, index: int, cgi: str) -> bytes:
    body = b"GET /" + cgi.encode()
    inner = (bytes([0xd1, channel]) + struct.pack(">H", index)
             + bytes([0x01, 0x0a, 0x00, 0x00]) + struct.pack("<I", len(body)))
    pkt = bytes([0xf1, 0xd0]) + struct.pack(">H", len(inner) + len(body)) + inner + body
    return obfuscate(pkt)

def build_ack(channel: int, index: int) -> bytes:
    return build_packet(0xd1, bytes([0xd1, channel, 0x00, 0x01]) + struct.pack(">H", index))

class Session:
    def __init__(self, verbose=True):
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        self.sock.bind(("", 0))
        self.peer = None
        self.did = None
        self.verbose = verbose

    def log(self, *a):
        if self.verbose: print(*a, file=sys.stderr)

    def _recv(self, timeout):
        self.sock.settimeout(timeout)
        try:
            data, addr = self.sock.recvfrom(2048)
        except socket.timeout:
            return None, None
        return deobfuscate(data), addr

    def discover(self, window_s=4.0, unicast=None):
        target = (unicast or "255.255.255.255", DISCOVERY_PORT)
        deadline = time.time() + window_s
        while time.time() < deadline:
            self.sock.sendto(build_packet(0x30), target)
            end = time.time() + 0.4
            while time.time() < end:
                data, addr = self._recv(max(0.05, end - time.time()))
                if data and len(data) >= 24 and data[0] == 0xf1 and data[1] == 0x41:
                    self.did = data[4:24]
                    self.peer = addr
                    return True
        return False

    def authenticate(self, window_s=6.0):
        assert self.peer and self.did
        trailer = bytes([0x00,0x02,0x12,0x64,0x10,0x02,0x00,0x0a] + [0]*8)
        devlgn = self.did + trailer
        deadline = time.time() + window_s
        while time.time() < deadline:
            for pkt in (build_packet(0x00), build_packet(0x05, self.did),
                        build_packet(0x20, devlgn), build_packet(0x41, self.did),
                        build_cgi(0, 0, f"get_status.cgi?{AUTH}")):
                self.sock.sendto(pkt, self.peer)
            end = time.time() + 0.5
            while time.time() < end:
                data, addr = self._recv(max(0.05, end - time.time()))
                if not data or len(data) < 4:
                    continue
                if data[1] in (0x42, 0x43):
                    self.sock.sendto(obfuscate(data), self.peer)
                elif data[1] == 0xd0 and len(data) >= 8 and data[5] == 0:
                    return True
        return False

    def open(self, unicast=None):
        if not self.discover(unicast=unicast):
            return False
        self.log(f"camera at {self.peer[0]}:{self.peer[1]} did={self.did.hex()}")
        if not self.authenticate():
            self.log("authentication failed")
            return False
        # Do NOT drain here: the channel-0 index stream is continuous across
        # CGIs in a session, and the un-acked get_status reply is still in the
        # camera's send window. The firmware treats the first fragment seen
        # after the next request as base and acks from there, which is also
        # what un-stalls the window; do the same (the SOI scan skips the
        # get_status remnant slots, which is why SOI lands in slot 2).
        return True

    def request(self, cgi: str, transfer_s=25.0, idle_s=8.0):
        """Send one CGI on channel 0 and reassemble the DRW reply.

        Returns (payload bytes in index order, frags_seen, slots_seen)."""
        self.sock.sendto(build_cgi(0, 1, cgi), self.peer)
        slots = {}          # slot -> payload
        base = None
        contiguous = 0      # slots 0..contiguous-1 all present
        acked = -1
        frags = 0
        started = time.time()
        last_data = started
        eoi_slot = soi_slot = None
        soi_off = 0
        while time.time() - started < transfer_s:
            if time.time() - last_data > idle_s:
                break
            data, addr = self._recv(0.2)
            if data is None:
                continue
            if len(data) < 8:
                continue
            if data[1] == 0xe0:
                self.sock.sendto(build_packet(0xe1), self.peer)
                continue
            if data[1] != 0xd0 or data[5] != 0:
                continue
            declared = struct.unpack(">H", data[2:4])[0]
            plen = declared - 4
            if plen <= 0 or plen > len(data) - 8:
                plen = len(data) - 8
            if plen <= 0 or plen > 1024:
                continue
            index = struct.unpack(">H", data[6:8])[0]
            frags += 1
            last_data = time.time()
            if base is None:
                base = index
            slot = (index - base) & 0xffff
            if slot > 0x8000:      # before base: stray resend of the auth reply
                continue
            if slot not in slots:
                slots[slot] = data[8:8+plen]
                if soi_slot is None:
                    p = slots[slot].find(b"\xff\xd8")
                    if p >= 0:
                        soi_slot, soi_off = slot, p
                if eoi_slot is None and soi_slot is not None and slot >= soi_slot:
                    p = slots[slot].find(b"\xff\xd9")
                    if p >= 0:
                        eoi_slot = slot
                        slots[slot] = slots[slot][:p+2]
            while contiguous in slots:
                contiguous += 1
            if eoi_slot is not None and contiguous > eoi_slot:
                break
            if contiguous - 1 > acked and contiguous > 0:
                acked = contiguous - 1
                self.sock.sendto(build_ack(0, (base + acked) & 0xffff), self.peer)
        # final ack so the camera stops resending
        if base is not None and contiguous > 0:
            self.sock.sendto(build_ack(0, (base + contiguous - 1) & 0xffff), self.peer)
        n_slots = (max(slots) + 1) if slots else 0
        body = b"".join(slots.get(i, b"") for i in range(contiguous))
        return body, frags, n_slots, contiguous

    def close(self):
        self.sock.close()

def jpeg_dims(jpg: bytes):
    """Width/height from the first SOF marker."""
    i = 2
    while i + 9 < len(jpg):
        if jpg[i] != 0xff:
            i += 1; continue
        marker = jpg[i+1]
        if marker in (0xd8, 0x01) or 0xd0 <= marker <= 0xd7:
            i += 2; continue
        seglen = struct.unpack(">H", jpg[i+2:i+4])[0]
        if 0xc0 <= marker <= 0xcf and marker not in (0xc4, 0xc8, 0xcc):
            h, w = struct.unpack(">HH", jpg[i+5:i+9])
            return w, h
        i += 2 + seglen
    return None

def extract_jpeg(body: bytes):
    soi = body.find(b"\xff\xd8")
    if soi < 0:
        return None
    eoi = body.find(b"\xff\xd9", soi)
    if eoi < 0:
        return None
    return body[soi:eoi+2]

def cmd_sweep():
    s = Session()
    found = s.discover(window_s=6.0)
    if found:
        print(f"PunchPkt from {s.peer[0]}:{s.peer[1]} did={s.did.hex()}")
        print(f"did (ascii-ish): {s.did}")
    else:
        print("no camera answered the LanSearch broadcast")
    s.close()
    return 0 if found else 1

def one_snapshot(query_prefix: str):
    """Open a fresh session (like the firmware does per capture) and fetch one still."""
    s = Session()
    try:
        if not s.open():
            return None
        cgi = f"snapshot.cgi?{query_prefix}{AUTH}"
        body, frags, n_slots, contiguous = s.request(cgi)
        return body, frags, n_slots, contiguous
    finally:
        s.close()

def cmd_res():
    variants = [("bare", ""), ("res=0", "res=0&"), ("res=1", "res=1&"),
                ("res=2", "res=2&"), ("res=3", "res=3&")]
    print(f"{'query':8} {'dims':>11} {'jpeg bytes':>10} {'frags':>6} {'slots':>6} {'contig':>6}")
    for name, prefix in variants:
        r = one_snapshot(prefix)
        if r is None:
            print(f"{name:8} session failed")
            continue
        body, frags, n_slots, contiguous = r
        jpg = extract_jpeg(body)
        if jpg is None:
            head = body[:80].decode("latin1", "replace")
            print(f"{name:8} no JPEG in {len(body)}B reply; head={head!r}")
            continue
        dims = jpeg_dims(jpg)
        dstr = f"{dims[0]}x{dims[1]}" if dims else "?"
        print(f"{name:8} {dstr:>11} {len(jpg):>10} {frags:>6} {n_slots:>6} {contiguous:>6}")
        time.sleep(2)
    return 0

def cmd_cgi(cgi_prefix: str):
    s = Session()
    try:
        if not s.open():
            return 1
        body, frags, n_slots, contiguous = s.request(cgi_prefix + AUTH, transfer_s=10.0, idle_s=3.0)
        sys.stdout.write(body.decode("latin1", "replace"))
        sys.stdout.write(f"\n--- {len(body)}B, frags={frags} slots={n_slots} contig={contiguous}\n")
        return 0
    finally:
        s.close()

def cmd_snap(path: str, res: str):
    prefix = f"res={res}&" if res is not None else ""
    r = one_snapshot(prefix)
    if r is None:
        print("session failed"); return 1
    body, frags, n_slots, contiguous = r
    jpg = extract_jpeg(body)
    if jpg is None:
        print(f"no JPEG ({len(body)}B reply)"); return 1
    open(path, "wb").write(jpg)
    dims = jpeg_dims(jpg)
    print(f"{path}: {len(jpg)}B {dims} frags={frags} slots={n_slots}")
    return 0

if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "res"
    if cmd == "sweep":
        sys.exit(cmd_sweep())
    elif cmd == "res":
        sys.exit(cmd_res())
    elif cmd == "cgi":
        sys.exit(cmd_cgi(sys.argv[2]))
    elif cmd == "snap":
        sys.exit(cmd_snap(sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else None))
    else:
        print(__doc__); sys.exit(2)
