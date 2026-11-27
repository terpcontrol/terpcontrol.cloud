#pragma once

#include <stdint.h>

// The display font is code page 437 (cp437(true) in UserInterface::init), so
// German letters are its bytes, not UTF-8. They are separate literals because
// a hex escape swallows every hex digit after it: "zur" L_ue "ck", not "zur\x81ck".
#define L_ae "\x84"
#define L_oe "\x94"
#define L_ue "\x81"
#define L_AE "\x8E"
#define L_OE "\x99"
#define L_UE "\x9A"
#define L_ss "\xE1"

namespace fg {

  enum class Lang : uint8_t { EN = 0, DE = 1, COUNT };

  enum class Text : uint16_t {
#define TEXT(key, ...) key,
#include "texts.def"
#undef TEXT
  };

  Lang language();
  void setLanguage(Lang lang);

  const char* tr(Text text);

}
