#!/usr/bin/env python3
"""Pull a still from an O-KAM/VStarcam camera over the internet — no LAN, no
controller, no vendor binary.

The LAN client (okamprobe.py, and firmware/src/okamcam.cpp) finds the camera with
a LanSearch broadcast. That only works on its own network. This does the same job
through the vendor's CS2 rendezvous servers, which is the part the SDK's native
library was doing for us:

  -> supernode:32100   f1 00                      Hello
  <-                   f1 01  <our public addr>   HelloAck (STUN-like reflection)
  -> supernode:3210x   f1 20  <DID><port><lanip>  "where is this camera?"
  <-                   f1 40  <peer addr>         PunchTo, once per candidate
                                                  (its public AND its LAN address)

After that the peer address is punched and the session/DRW layer is identical to
the LAN one, so everything below reuses okamprobe.

Addresses on the wire are `u16 family, u16 port (big endian), u32 ip (little
endian)`.

Usage: okamwan.py <DID> [--public-only] [-o out.jpg] [--cgi '<cgi>']
"""
import argparse, socket, struct, sys, time

sys.path.insert(0, __file__.rsplit("/", 1)[0])
from okamprobe import (Session, build_packet, obfuscate, deobfuscate, AUTH,
                       extract_jpeg, jpeg_dims)

# CS2 rendezvous servers this camera family registers with, observed by tracing
# the vendor stack's own socket calls. The encoded init string in the SDK decodes
# to these; they are stable per prefix, not per device.
SUPERNODES = ["52.47.140.105", "18.130.74.40", "47.254.150.171"]
SUPERNODE_PORTS = [32100, 32101, 32102]

def pack_did(did: str) -> bytes:
    """'VSTH-581824-TJXUG' -> the 20-byte packed wire form."""
    parts = did.replace("-", " ").split()
    if len(parts) == 3:
        prefix, number, suffix = parts
    else:                                   # 'VSTH581824TJXUG'
        prefix, rest = did[:4], did[4:]
        number, suffix = rest[:-5], rest[-5:]
    return (prefix.encode().ljust(4, b"\0") + struct.pack(">Q", int(number))
            + suffix.encode().ljust(5, b"\0") + b"\0" * 3)

def parse_addr(body: bytes, off: int = 0):
    if len(body) < off + 8:
        return None
    port = struct.unpack_from(">H", body, off + 2)[0]
    ip = ".".join(str(b) for b in body[off + 4:off + 8][::-1])
    return (ip, port) if port and not ip.startswith("0.") else None

def is_private(ip: str) -> bool:
    return (ip.startswith("192.168.") or ip.startswith("10.")
            or any(ip.startswith(f"172.{n}.") for n in range(16, 32)))

def local_ip() -> str:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 53))
        return s.getsockname()[0]
    finally:
        s.close()

def rendezvous(sock, did: str, timeout=8.0, verbose=True):
    """Ask the supernodes where the camera is. Returns candidate endpoints."""
    packed = pack_did(did)
    # Only advertise a genuine private address here. Announcing a public one as
    # though it were a LAN address stops the camera punching at all — the field
    # exists so two peers on the same network can shortcut, and a server has no
    # such address to offer.
    ip = local_ip()
    my_lan = socket.inet_aton(ip)[::-1] if is_private(ip) else b"\0" * 4

    # 1. Hello -> our own public endpoint, reflected back.
    reflected = None
    deadline = time.time() + timeout
    while reflected is None and time.time() < deadline:
        for host in SUPERNODES:
            sock.sendto(build_packet(0x00), (host, 32100))
        sock.settimeout(1.0)
        try:
            data, addr = sock.recvfrom(2048)
        except socket.timeout:
            continue
        plain = deobfuscate(data)
        if len(plain) >= 12 and plain[1] == 0x01:
            reflected = parse_addr(plain[4:])
    if verbose:
        print(f"public endpoint (per supernode): {reflected}", file=sys.stderr)
    my_port = reflected[1] if reflected else 0

    # 2. Ask for the DID, on every server and port.
    body = packed + struct.pack(">HH", 0, my_port) + my_lan + b"\0" * 8
    peers, punched, deadline = [], None, time.time() + timeout
    while time.time() < deadline:
        for host in SUPERNODES:
            for port in SUPERNODE_PORTS:
                sock.sendto(build_packet(0x20, body), (host, port))
        inner = time.time() + 3.0
        while time.time() < inner:
            sock.settimeout(0.5)
            try:
                data, addr = sock.recvfrom(2048)
            except socket.timeout:
                continue
            plain = deobfuscate(data)
            if len(plain) >= 12 and plain[1] == 0x40:      # PunchTo
                ep = parse_addr(plain[4:])
                if ep and ep not in peers:
                    peers.append(ep)
                    if verbose:
                        kind = "LAN" if is_private(ep[0]) else "public"
                        print(f"  candidate ({kind}): {ep[0]}:{ep[1]}", file=sys.stderr)
            elif (len(plain) > 1 and plain[1] == 0x41
                  and addr[1] not in SUPERNODE_PORTS and punched is None):
                # The camera punches within a second or two of the lookup — i.e.
                # right here. Dropping these on the floor and only listening
                # afterwards misses the whole burst.
                punched = addr
                if verbose:
                    print(f"  camera punched us from {addr[0]}:{addr[1]}", file=sys.stderr)
        if punched:
            break
    return peers, punched

def punch(sock, did: str, peers, timeout=20.0, verbose=True):
    """Hole-punch the candidates and learn the peer's real address.

    The vendor client sends exactly one thing here — Punch (0x41) carrying the
    DID, nothing else — and the camera answers with the same packet from whatever
    address its NAT ended up using, which is NOT necessarily the one the supernode
    reported. That reply address is the session peer.
    """
    packed = pack_did(did)
    pkt = build_packet(0x41, packed)
    # The lookup already made the supernodes tell the camera to punch at us, so
    # the camera's own packet is on its way. Its source port is NOT the one the
    # supernode advertised (measured: advertised 24892, punched from 15457), so
    # the peer has to be learned from that packet rather than guessed. Punching
    # at the advertised endpoints too is still worth it: behind NAT it is what
    # opens the return path.
    # Do NOT punch outward first. Sending at the advertised endpoint measurably
    # stops the camera's own punch from arriving — those endpoints are a stale
    # mapping, and hammering them appears to poison the exchange. Waiting quietly
    # works every time.
    deadline = time.time() + timeout
    while time.time() < deadline:
        sock.settimeout(1.0)
        try:
            data, addr = sock.recvfrom(2048)
        except socket.timeout:
            continue
        plain = deobfuscate(data)
        if len(plain) > 1 and plain[1] == 0x41 and addr[1] not in SUPERNODE_PORTS:
            if verbose:
                print(f"camera punched us from {addr[0]}:{addr[1]}", file=sys.stderr)
            sock.sendto(pkt, addr)              # answer on the address it used
            return addr
    return None

def login(sock, did: str, peer, timeout=8.0, verbose=True):
    """Authenticate the punched session — same handshake as on the LAN."""
    packed = pack_did(did)
    trailer = bytes([0x00, 0x02, 0x12, 0x64, 0x10, 0x02, 0x00, 0x0a] + [0] * 8)
    devlgn = packed + trailer
    deadline = time.time() + timeout
    while time.time() < deadline:
        for pkt in (build_packet(0x00), build_packet(0x05, packed),
                    build_packet(0x20, devlgn), build_packet(0x41, packed)):
            sock.sendto(pkt, peer)
        sock.sendto(_cgi_packet(0, 0, f"get_status.cgi?{AUTH}"), peer)
        end = time.time() + 1.0
        while time.time() < end:
            sock.settimeout(0.3)
            try:
                data, addr = sock.recvfrom(2048)
            except socket.timeout:
                continue
            plain = deobfuscate(data)
            if len(plain) < 4:
                continue
            if plain[1] in (0x42, 0x43):
                sock.sendto(obfuscate(plain), addr)
            elif plain[1] == 0xd0 and len(plain) >= 8 and plain[5] == 0:
                if verbose:
                    print(f"session established with {addr[0]}:{addr[1]}", file=sys.stderr)
                return addr
    return None

def _cgi_packet(channel, index, cgi):
    from okamprobe import build_cgi
    return build_cgi(channel, index, cgi)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("did")
    ap.add_argument("--public-only", action="store_true",
                    help="ignore LAN candidates — forces the internet path")
    ap.add_argument("-o", "--out", default="wan-direct.jpg")
    ap.add_argument("--cgi", default=f"snapshot.cgi?{AUTH}")
    args = ap.parse_args()

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind(("", 0))
    peers, punched = rendezvous(sock, args.did)
    if not peers and not punched:
        print("no candidates: the supernodes did not answer for this DID", file=sys.stderr)
        return 2
    if args.public_only:
        peers = [p for p in peers if not is_private(p[0])]
        print(f"public candidates only: {peers}", file=sys.stderr)
        if not peers:
            print("no public candidate offered", file=sys.stderr)
            return 2

    peer = punched or punch(sock, args.did, peers)
    if peer is not None and punched is peer:
        sock.sendto(build_packet(0x41, pack_did(args.did)), peer)   # answer it
    if peer is None:
        print("hole punch failed: the camera never answered a Punch", file=sys.stderr)
        return 3
    peer = login(sock, args.did, peer)
    if peer is None:
        print("punched, but the session never authenticated", file=sys.stderr)
        return 3

    # Hand the punched socket to the LAN session logic — identical from here.
    s = Session.__new__(Session)
    s.sock, s.peer, s.did, s.verbose = sock, peer, pack_did(args.did), True
    body, frags, slots, contig = s.request(args.cgi)
    jpg = extract_jpeg(body)
    if not jpg:
        print(f"no JPEG in {len(body)}B reply", file=sys.stderr)
        return 4
    open(args.out, "wb").write(jpg)
    print(f"{args.out}: {len(jpg)} bytes {jpeg_dims(jpg)} "
          f"(frags={frags} slots={slots} contiguous={contig})")
    return 0

if __name__ == "__main__":
    sys.exit(main())
