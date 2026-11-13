"""Cut tabular digits for Albert Sans into faces of their own.

Albert Sans has no tabular figures: its "1" is half as wide as its "0", so a
column of readings does not line up and a live figure shifts its unit as it
changes. CSS cannot respace some characters only, but a face can be limited to
some characters. This writes, for each weight the app sets figures in, a face
that holds only 0-9, every digit centred on the width of that weight's "0";
the app lists it ahead of Albert Sans for its figures, so the digits line up
in a column and every other character keeps its own width.

The faces are static, one per weight, because recentring a digit moves its
outline by a different amount at every weight, which a variable face would
have to carry as deltas of its own.

Run it again after upgrading @fontsource-variable/albert-sans (needs fonttools
and brotli: `pip install fonttools brotli`):

    python3 scripts/tabular-digits.py
"""

from pathlib import Path

from fontTools import subset
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

HERE = Path(__file__).resolve().parent.parent
SOURCE = HERE / 'node_modules/@fontsource-variable/albert-sans/files/albert-sans-latin-wght-normal.woff2'
TARGET = HERE / 'src/theme'
DIGITS = range(0x30, 0x3A)
WEIGHTS = (300, 400, 500)

for weight in WEIGHTS:
    font = instancer.instantiateVariableFont(TTFont(SOURCE), {'wght': weight})
    options = subset.Options()
    options.layout_features = []
    options.name_IDs = ['*']
    options.notdef_outline = True
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=DIGITS)
    subsetter.subset(font)

    names = [font.getBestCmap()[code] for code in DIGITS]
    glyphs, metrics = font.getGlyphSet(), font['hmtx'].metrics
    width = metrics[names[0]][0]
    for name in names:
        advance, bearing = metrics[name]
        shift = round((width - advance) / 2)
        pen = TTGlyphPen(None)
        glyphs[name].draw(TransformPen(pen, (1, 0, 0, 1, shift, 0)))
        font['glyf'][name] = pen.glyph()
        metrics[name] = (width, bearing + shift)

    target = TARGET / f'albert-sans-tabular-digits-{weight}.woff2'
    font.flavor = 'woff2'
    font.save(target)
    print(f'{target.relative_to(HERE)}: {target.stat().st_size} bytes, every digit {width} wide')
