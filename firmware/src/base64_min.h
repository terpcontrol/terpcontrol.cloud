#pragma once

// Minimal RFC 4648 base64 encoder/decoder used in place of cppcodec, which
// uses C++ exceptions to signal decode errors and therefore does not build
// under -fno-exceptions. Decode returns an empty vector on malformed input
// (callers already check !decoded.empty()).

#include <cstdint>
#include <cstddef>
#include <string>
#include <vector>

namespace fg_base64 {

inline std::string encode(const uint8_t* data, size_t len) {
  static const char tab[] =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  std::string out;
  out.reserve(((len + 2) / 3) * 4);
  size_t i = 0;
  while (i + 3 <= len) {
    uint32_t v = (uint32_t(data[i]) << 16) | (uint32_t(data[i + 1]) << 8) | data[i + 2];
    out.push_back(tab[(v >> 18) & 0x3F]);
    out.push_back(tab[(v >> 12) & 0x3F]);
    out.push_back(tab[(v >> 6) & 0x3F]);
    out.push_back(tab[v & 0x3F]);
    i += 3;
  }
  if (i < len) {
    uint32_t v = uint32_t(data[i]) << 16;
    if (i + 1 < len) v |= uint32_t(data[i + 1]) << 8;
    out.push_back(tab[(v >> 18) & 0x3F]);
    out.push_back(tab[(v >> 12) & 0x3F]);
    out.push_back(i + 1 < len ? tab[(v >> 6) & 0x3F] : '=');
    out.push_back('=');
  }
  return out;
}

inline std::vector<uint8_t> decode(const std::string& s) {
  static const char tab[] =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  static int8_t inv[256];
  static bool init = false;
  if (!init) {
    for (int i = 0; i < 256; ++i) inv[i] = -1;
    for (int i = 0; i < 64; ++i) inv[uint8_t(tab[i])] = int8_t(i);
    init = true;
  }
  std::vector<uint8_t> out;
  if (s.size() == 0 || (s.size() % 4) != 0) return out;
  out.reserve((s.size() / 4) * 3);
  for (size_t i = 0; i < s.size(); i += 4) {
    int8_t a = inv[uint8_t(s[i])];
    int8_t b = inv[uint8_t(s[i + 1])];
    bool pad2 = s[i + 2] == '=';
    bool pad3 = s[i + 3] == '=';
    int8_t c = pad2 ? 0 : inv[uint8_t(s[i + 2])];
    int8_t d = pad3 ? 0 : inv[uint8_t(s[i + 3])];
    if (a < 0 || b < 0 || (!pad2 && c < 0) || (!pad3 && d < 0)) {
      out.clear();
      return out;
    }
    uint32_t v = (uint32_t(a) << 18) | (uint32_t(b) << 12) | (uint32_t(c) << 6) | uint32_t(d);
    out.push_back(uint8_t((v >> 16) & 0xFF));
    if (!pad2) out.push_back(uint8_t((v >> 8) & 0xFF));
    if (!pad3) out.push_back(uint8_t(v & 0xFF));
  }
  return out;
}

} // namespace fg_base64
