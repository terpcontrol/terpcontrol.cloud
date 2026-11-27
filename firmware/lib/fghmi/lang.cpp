#include "lang.h"

#include <stddef.h>

namespace fg {

  static Lang current_language = Lang::EN;

  Lang language() { return current_language; }

  void setLanguage(Lang lang) { current_language = lang; }

  // A language added to Lang needs its column here too, or every row of
  // texts.def still compiles with a null text for it.
  static_assert(static_cast<size_t>(Lang::COUNT) == 2, "TEXT() needs one column per language in fg::Lang");
  static const char* const TEXTS[][static_cast<size_t>(Lang::COUNT)] = {
#define TEXT(key, en, de) {en, de},
#include "texts.def"
#undef TEXT
  };

  const char* tr(Text text) {
    return TEXTS[static_cast<size_t>(text)][static_cast<size_t>(current_language)];
  }

}
