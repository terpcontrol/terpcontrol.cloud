# Ten app designs

Ten different answers to "what should the Terp Control app be", drawn as real screens rather than
described. Each design is one artboard: a header naming what it bets on, six phone screens across the
same six situations, and a footer saying where it breaks.

The six situations are identical in every design, and so are the values behind them — one tent
("Zelt Keller", day 34, three plants in two stages, heater/dehumidifier/light/CO₂ on sockets, camera
paired, Biobizz All·Mix step 7) plus one tent with no device at all ("Schrank Flur"). Only the design
changes between sheets, never the story.

| File | Design | What the home screen is |
| --- | --- | --- |
| `Main.dc.html` | Übersicht | index: the ten, and what varies between them |
| `Difference.dc.html` | 01 Der Unterschied | a before/after pair with a global comparison slider |
| `DailyLetter.dc.html` | 02 Der Tagesbrief | a written page the app composes each day |
| `DayRing.dc.html` | 03 Der Tagesring | a 24-hour dial with yesterday behind it |
| `TwoQuestions.dc.html` | 04 Zwei Fragen | one answer and one button, no tab bar |
| `MovingImage.dc.html` | 05 Das Laufbild | the camera frame, full bleed, numbers under it |
| `Plants.dc.html` | 06 Die Pflanzen | one card per plant, each on its own day counter |
| `Timeline.dc.html` | 07 Die Zeitschiene | one shared time axis with switchable lanes |
| `TargetActual.dc.html` | 08 Soll & Ist | a target-vs-actual ledger, climate and feeding alike |
| `Week.dc.html` | 09 Die Woche | a week planner; the diary falls out of ticking things off |
| `Board.dc.html` | 10 Das Brett | a pinboard: notes, who was here, what changed since your last visit |

`canvas.json` places the sheets on the shared canvas. The screens are static mockups — nothing is
clickable.

Values, stage targets, socket roles and feeding steps come from the research in the parent directory
and from the code it cites; the German on screen is meant to ship, not to be re-translated.
