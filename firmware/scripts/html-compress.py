###############################################################
# Minifies and gzips every page in ../html and writes it as a C
# byte array to ../src/html_compressed.
#
# Run from anywhere:
#   python3 scripts/html-compress.py
#
# Both the readable source and the generated header are committed,
# so the firmware build stays a plain `pio run`. Re-run this script
# whenever a file in ../html changes.
#
# The pages are served straight from flash with `Content-Encoding:
# gzip`, so the device never has to decompress anything itself.
###############################################################

import zlib
from os import listdir, path

here = path.dirname(path.abspath(__file__))
path_uncompressed = path.join(here, '..', 'html')
path_compressed = path.join(here, '..', 'src', 'html_compressed')


def minify(source):
  """Drop indentation, blank lines and comments. Line breaks are kept so that
  JavaScript relying on automatic semicolon insertion stays intact.

  Only lines that are entirely a comment are dropped, so nothing has to be
  parsed to tell code from prose: a trailing comment after code stays, and a
  `//` inside a string is never at the start of a line. Comments are what the
  pages are documented with, and dropping them here is what keeps that
  documentation from costing flash on every device."""
  kept = []
  in_block = False
  for line in source.splitlines():
    line = line.strip()
    if not line:
      continue
    if in_block:
      in_block = '*/' not in line
      continue
    if line.startswith('/*'):
      in_block = '*/' not in line
      continue
    if line.startswith('//'):
      continue
    if line.startswith('<!--') and line.endswith('-->'):
      continue
    kept.append(line)
  return "\n".join(kept)


def gzip_bytes(data):
  # wbits=31 selects a gzip container without the timestamp that
  # gzip.compress() embeds, so unchanged pages produce no diff.
  compressor = zlib.compressobj(9, zlib.DEFLATED, 31)
  return compressor.compress(data) + compressor.flush()


for file in sorted(listdir(path_uncompressed)):
  with open(path.join(path_uncompressed, file), 'r') as f:
    source = f.read()

  const_name = file.upper().replace('.', '_')
  raw = minify(source).encode('utf-8')
  gz = gzip_bytes(raw)

  rows = [gz[i:i + 16] for i in range(0, len(gz), 16)]
  body = ",\n  ".join(", ".join("0x%02x" % b for b in row) for row in rows)

  header = (
    "/////////////////////////////////////////////////////////////////////\n"
    "// gzipped by scripts/html-compress.py - do not edit, edit html/%s\n"
    "/////////////////////////////////////////////////////////////////////\n"
    "#pragma once\n"
    "\n"
    "const size_t %s_GZ_SIZE = %d;\n"
    "const uint8_t %s_GZ[] PROGMEM = {\n  %s\n};\n"
  ) % (file, const_name, len(gz), const_name, body)

  with open(path.join(path_compressed, file + '.h'), 'w') as f:
    f.write(header)

  print("%s: %d bytes source -> %d bytes minified -> %d bytes gzipped"
        % (file, len(source.encode('utf-8')), len(raw), len(gz)))
