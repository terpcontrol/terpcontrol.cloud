"""Cut Inter's tabular digits into a face of their own.

Inter's `tnum` feature widens far more than the digits: the hyphen, the full
stop, the comma, the colon, the brackets and even the space come out a digit
wide under it, so a caption set with `font-variant-numeric: tabular-nums`
reads "E - Mail". CSS cannot switch a feature on for some characters only, but
a face can be limited to some characters. This writes a face that holds only
0-9, each mapped straight to its tabular glyph, with both of Inter's axes
kept; the app lists it ahead of Inter for its figures, so the digits line up
in a column and every other character keeps its own width.

Run it again after upgrading @fontsource-variable/inter (needs fonttools and
brotli: `pip install fonttools brotli`):

    python3 scripts/tabular-digits.py
"""

from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont

HERE = Path(__file__).resolve().parent.parent
SOURCE = HERE / 'node_modules/@fontsource-variable/inter/files/inter-latin-opsz-normal.woff2'
TARGET = HERE / 'src/theme/inter-tabular-digits.woff2'
DIGITS = range(0x30, 0x3A)

font = TTFont(SOURCE)
tabular = {code: f'{font.getBestCmap()[code]}.tf' for code in DIGITS}
for table in font['cmap'].tables:
    if table.isUnicode():
        table.cmap.update(tabular)

options = subset.Options()
options.flavor = 'woff2'
options.layout_features = []
options.name_IDs = ['*']
options.notdef_outline = True
subsetter = subset.Subsetter(options)
subsetter.populate(unicodes=DIGITS)
subsetter.subset(font)
font.save(TARGET)
print(f'{TARGET.relative_to(HERE)}: {TARGET.stat().st_size} bytes')
