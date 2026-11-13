---
summary: The app rewrite is complete (merged 2026-10-04) - where its decisions and knowledge live now, and what it left open; read before picking up one of those open items
updated: 2026-11-13
source: round 7 of the navigation redesign - Ich and Meldungen (the redesign session of 2026-11-13); round 6 of the navigation redesign - place and room (the redesign session of 2026-11-12); rewrite sessions 2026-09-16..10-04 with Chris's instructions in them (2026-09-17, 2026-09-22); PR #104 and the pull requests after it; verified against the code on 2026-10-08; Chris and a read of the web app on 2026-11-11 (navigation), its first round on 2026-11-12; round 4 of the navigation redesign, its two walks and fix passes (the redesign session of 2026-11-12); Verlauf as one page (the redesign session of 2026-11-12)
paths:
  - webapp/src/screens/me/appearance/**
  - webapp/src/api/plans.ts
  - server/src/modules/v1/diary/tasks.service.ts
  - webapp/src/screens/camera/add/**
  - firmware/src/wifi.cpp
  - firmware/src_hwtype/**
---
# The app rewrite

The rewrite replaced the Angular web app with the React app in `webapp/`, the server's app-facing routes with the
`/v1` API whose contract is `shared-types/src/v1/`, and the old database shapes with the model of ADR 0001; the
device-facing routes stayed as they were. It was merged on 2026-10-04 as #104 and is complete. Internal notes on its
product side exist outside this repository.

## Where its knowledge lives

- [ADR 0001](adr/0001-app-rewrite-data-model.md): the data model, the `/v1` API and the migration.
  [ADR 0002](adr/0002-app-rewrite-frontend-stack.md): the web app's libraries and its look.
- [device-protocol.md](device-protocol.md): the frozen contract with the firmware.
- [`server/src/migrations/README.md`](../server/src/migrations/README.md) and the runbook
  [Upgrading an install from before the app rewrite](runbooks/upgrade-a-pre-rewrite-install.md): upgrading an install
  from before the rewrite. The server migrates the database at boot and no command undoes a run, so the way back is a
  backup that has been restored once before the upgrade.
- The rules and traps this document used to collect are in the topic documents: [server](knowledge/server.md),
  [data](knowledge/data.md), [webapp](knowledge/webapp.md), [app-ux](knowledge/app-ux.md),
  [firmware](knowledge/firmware.md), [testing](knowledge/testing.md), [ci-and-release](knowledge/ci-and-release.md),
  [development-workflow](knowledge/development-workflow.md). How it was verified on copies of production data:
  [verification passes](knowledge/testing-real-devices-and-data.md#verification-passes).

## Left open

Checked against the code on 2026-10-08; the navigation item on 2026-11-12. Take an item out once it is done.

- **The navigation is to be reordered** (Chris, 2026-11-11: the diary is hard to find, places and rooms are
  inconsistent, the charts are less precise and less intuitive than the old app's). The direction is chosen (Chris,
  2026-11-11; internal notes exist) and a click prototype outside the app comes before any change to it. The new
  routes need no redirects from today's, and a change to the data model comes as a migration step (Chris,
  2026-11-11). It is built in rounds; the bar, the header's choice of place, the addresses, Start, the grow page
  with its diary by the day, the public page on the same day cards, Steuerung with a page per device and the
  camera page, Verlauf as the one page of curves, the pages of a place - editing it, ending it, adding a device
  to it - and Ich and Meldungen are in since 2026-11-13
  ([app-ux.md §2](knowledge/app-ux.md#2-navigation-and-the-place-page),
  [§7](knowledge/app-ux.md#7-verlauf-day-and-night)), the other pages follow. A read of the whole web app on 2026-11-11 found, as the things the redesign still has to
  settle:
  - Settled on 2026-11-12: Verlauf and Graphen were two screens over one engine, and a curve was a mean of at
    least a minute. Verlauf is one page now, with its view in the address, and a point is read from 5 s with its
    window's lowest and highest ([app-ux.md §7](knowledge/app-ux.md#7-verlauf-day-and-night),
    [server-engines.md](knowledge/server-engines.md#read-models)). Left of the page before it: the routes
    `GET /v1/spaces/{id}/series` and the climate half of `GET /v1/grows/{id}/series`, which the web app no longer
    asks - only a grow's own measurements are still read there - and `ChartView.definition.layout: 'day_of_grow'`,
    which nothing writes any more. They wait for the round that clears up.
  - Round 5 (Verlauf), state of 2026-11-12 (the redesign session; rules in
    [app-ux.md §7](knowledge/app-ux.md#7-verlauf-day-and-night)). Built, walked by the session's critic - one
    blocker, five larger points, nineteen smaller - and what the walk found is built: a figure of VPD is a VPD
    that occurred (the deficit of single samples, for a window of three days at the most; no envelope beyond);
    "jetzt" is the device's last reading and only while it reports; no chip hidden; a night begins where it
    begins; a failed window keeps the last picture; a grow's hand measurements have their curves on its page
    Messwerte; one figure for one thing; a marked way back to now; a place's own device and never a mean of two;
    an output's level drawn. The critic's second walk (2026-11-12) found VPD true up to three days and still
    wrong beyond; what it found is built as the redesign session decided it - decided by the redesign session,
    not Chris's word:
      - Beyond three days VPD is worked out from pushed-down means over five minutes, each judged day or night
        by its own time; a drawn point is the mean of those, its low and high their lowest and highest. Every
        range has line, envelope and "Tief · Hoch" again and "Mittel … bis …" is gone; the help says once what
        low and high are there. Five minutes hold for a four-month grow (182 ms on a tent of 120 days at 5 s),
        so fifteen was not needed ([data.md](knowledge/data.md#influxdb)).
      - A reading's VPD uses a leaf temperature only if that reading carries one, the live reading included;
        inside three days a point is the mean of its samples' VPD.
      - A silent device's "letzter Wert" is its last reading on every range, never the last window's mean; the
        "jetzt" card's outputs are the live levels.
      - Humidity on Verlauf is read to a tenth (cursor, Tief/Hoch, table), Start's tiles stay whole - against
        what the first fix pass did, until Chris says otherwise (question 2 below).
      - A place with two climates is about one device on every page: "Zum letzten Wert", a share link's tiles
        and Steuerung's pill are of the device whose curves are drawn.
      - A failed window's notice stays through a retry and goes when a read succeeds; what an address names in
        vain is told without a refused read; a rule made by one tap is named like a stage's.
    Not built of that walk: a place whose history is part sparse, part dense - fifteen-minute samples before a
    device that now reports every five seconds - still draws its band and night in stripes over the sparse
    part, because one rhythm is taken for the whole window (`silenceOf`, `timeline-series.ts`).
    The third walk (2026-11-13) checked VPD against the raw samples of a 120-day tent: no line outside its
    envelope on any range, the same climate reads the same from July to November, and the whole read costs what
    it did (about 0.9 s for 120 days). It left one major and eleven minors; what the redesign session decided
    about them - not Chris's word - is built (2026-11-13) and was checked on the session's stack by a fourth
    walk, against the samples:
      - No `at` in the address means the card rests on "jetzt"; a cursor is what the address says and nothing
        else remembers it. (Tapping "Verlauf" in the bar with a cursor set blanked a live tent's card.)
      - Beyond three days every step is a whole number of five minutes, so a point holds whole grains; no finer
        step is offered there, and VPD's head says its "Tief · Hoch" are "aus 5-Min-Mitteln". Temperature and
        humidity keep the samples' extremes on every range.
      - A grain uses a leaf temperature only where leaf readings cover it as the air readings do; the count
        costs 26 ms on the 120-day read (149 to 175 ms for the grains).
      - A night belongs to the device that stood there: the lamp is read from each device over its own stay.
      - The table is one row per drawn point with each output's mean level; "x % der Zeit an" is of the time
        the device reported; the answer carries the drawn device's last reading (`reading`), so at rest every
        reader, a share link's too, sees the same figures and output levels, and the page asks no `/live`.
      - The arrows are named as a person says it; two rules of one title are told apart whatever group each
        is in; an unknown grow is asked once; the device-change line of a grow's diary leads to Verlauf.
    Not built of that walk: a curve of few points as a line with its points, the help on the band at 320 and
    390, the English head at 390 and "last logged", and an unknown `space=` corrected in the address. The two
    older series routes (`/spaces/{id}/series`, a grow's) still bound a device by its stay without the
    hand-over cut Verlauf makes (`fromHandover`): they are assembled apart and nothing of the web app asks them.
    The fourth walk (2026-11-13) found those rules holding and the cost unchanged, and two majors and four
    minors in what no walk had computed before - the card at rest and the outputs' figures; decided by the
    redesign session, not built yet, and not Chris's word:
      - At rest the card says the last thing that was heard: the answer's last reading, as "jetzt" while the
        server calls it fresh and as "letzter Wert · …" once it is stale, on every range; in a past window the
        window's last drawn point. (A reading five to ten minutes old gave a blank card labelled "jetzt" at
        24 Std, with outputs that contradicted the reading.)
      - An output's figure is counted from its samples: per drawn point its mean level and the share of
        samples in which it was on. The card, the table, "x % der Zeit an" and the lane come from these, not
        from runs rounded out to the step (a valve open 3 % of the time read as 75 %); a point where nothing
        was heard says "—", never "aus".
      - A five-minute grain in which the lamp switched is computed as its lit and its dark part; within three
        days the lamp's switch times are the samples', to the minute.
    Open, for Chris:
      1. No free panning (the old Ctrl-drag, a two-finger pan), and the three things that went with "Graphen":
         a range typed as two dates, renaming a saved view, the four kinds a line was filtered by.
      2. Humidity to a tenth on Verlauf and whole on Start: two figures for one reading, on purpose.
      3. A rule made by one tap before this is stored under its translated name and stays so; no migration
         renames it.
  - Settled on 2026-11-12 (round 6): a claim no longer offers "ein neuer Ort" first to every device. A device asks
    once where it hangs, the place that exists first for a fan, a socket or a lamp
    ([app-ux.md §2](knowledge/app-ux.md#2-navigation-and-the-place-page)).
  - Round 7 (Ich and Meldungen), state of 2026-11-13 (the redesign session; rules in
    [app-ux.md §2](knowledge/app-ux.md#2-navigation-and-the-place-page)). Built:
    Ich as one card of rows with a page per subject - the zone moved to Konto, the diary's answers to a page of
    their own, the public grows into "Privatsphäre und Profil" -, every save of the account answered by a toast
    with the way back, the screens of whoever runs the install as tabs behind "Verwaltung"; Meldungen as "Offen",
    "Aufgaben" and "Erledigt", an alert as a sentence, its curves opened on its device, the bell counting what
    the page lists, an update that waits for somebody's word as a card; the once-only notice for an account from
    before the layout. No change to the server or the contract. Left for Chris: whether an alert that got better
    stays under "Offen" until somebody ticks it, as the prototype draws it - it needs a stored field -, and
    whether the rows Premium and Über keep the summary line they had (the prototype shows none; none is drawn).
    The critic's walk (2026-11-13) found no blocker, four majors and some twenty minors, and every function that
    belongs under Ich, Meldungen and Verwaltung reachable; decided by the redesign session, not built yet, and
    not Chris's word:
      - "Erledigt" stands in the order of its label - what ended last, first (it was sorted by when an alert
        began, so a night's long event sat behind "Früher"); a row says where and when, and flapping folds as
        Start's "Zuletzt" folds it.
      - A wrong current password says so at the field.
      - A card says about delivery only what is true: what will happen, with the account's quiet hours and mute,
        by the function `/control/alarms` uses; what did happen only from what the server recorded - never
        today's grid read backwards.
      - The units' choice stays stored and says in a line of its own that the views show °C, grams and litres
        for now. Left for Chris: whether the views should follow or the choice should go.
      - One silence per place on the page (the account's in the head, a rule's behind a card's ⋯); every write
        answers - quiet hours, the two ways to switch e-mail on (which become one), language, a changed
        reminder, a deleted account; the bell and the inbox count the tasks `/tasks` shows as mine, in every
        tab.
      Stays: maintenance is started from Start and a device's card, not from an alert's card.
  - Round 6 (place and room), state of 2026-11-12 (the redesign session; the data-model part is the amendment to
    [ADR 0001](adr/0001-app-rewrite-data-model.md#places-rooms-and-where-a-device-stood), **awaiting Chris's
    confirmation with the pull request**). Built: devices keep where they stood and the reads about the past use
    it, names are unique, a room is a field the server makes and ends, three migration steps (run on a restored
    copy, [data-operations.md](knowledge/data-operations.md#migrations-in-operation)); "Ort bearbeiten" and "Ort
    entfernen" as pages, the question where a device hangs, the claim outside the bar, "von @…" for a guest.
    The critic's walk (2026-11-12) found one blocker and seven majors. What the redesign session decided about
    them - not Chris's word - is built (2026-11-13) and was walked a second time on the session's stack:
      - A device stands only in a place of its owner: the server refuses a move or a claim into anybody else's
        place (409 `place_of_another_account`), and the app offers a move, and "+ Gerät hierher holen", only to
        the device's and the place's owner. (A guest who may manage could take the owner's fan into a place of
        his own, where neither of them reached it.)
      - A room exists only while a place stands in it. Taking the last place out of a room with members asks
        first and ends their access with the room; the amendment's "and its last member have left" went. A room
        option and the save toast say who sees the place through it.
      - A fan, socket or light that joins a place which already regulates is done after "Wo hängt …?", and a claim
        never writes targets to a device other than the one being claimed.
      - The claim puts the device where the place question's first answer says, so a flow left there leaves no
        stray place; a place the app names by itself is "Zelt", "Zelt 2", …. Its steps are worked out once and
        kept in the address, and Back goes one step.
      - "Ort entfernen" keeps a tent together by default, asks once with every line it will write, makes a new
        place only in the step that fills it, and says after a refusal what is done and what is still here. The
        move it writes into a grow's diary names from where to where.
      - "Wer … sieht" is one list of everybody who sees the place; every write there is answered; a guest who
        leaves lands on Start. "Ort bearbeiten" and "Ort entfernen" stand outside the bar as the claim does.
      - A change of the measuring device is a line in Verlauf and in the diary; a device's events, strips and
        samples count for a place only inside its stay; `climate.csv` is in time order;
        `/timeline?device=<id>` is about that device and the chosen place follows.
      - At 320 px nothing leaves its card, and what a finger is offered is 44 px high, on the pages the walk
        named.
      The second walk (2026-11-13) found no blocker, one major and a dozen minors. What the redesign session
      decided about them - its rules, not Chris's word - is built (2026-11-13), the server's part seen in tests
      only, the pages on the session's stack against a server that did not hold it yet; a third walk has not
      looked:
      - "Ort entfernen" names everybody who loses sight - a guest of the place, and the room with its members
        where the place is its room's last - in the one confirmation and in the toast, and the removal ends
        their access: the server ends a place's memberships, invitations and share links with it, as it does a
        room's (the amendment to ADR 0001 says so, still awaiting Chris). Guests no longer block a removal.
      - A joining device is claimed in one write that carries its place (`joinSpaceId`); the server makes no
        place for it. The step count is said once the place question is answered, and no step is ticked that
        was not asked. A place's ⋯ on Start offers its owner "Gerät hinzufügen", preset to that place.
      - The server refuses an ended room as a place's room and as an invitation's target, and keeps to the
        owner what the app already kept to the owner: taking a device out of every place, and a place's room.
      - Every write answers: undoing a device move, and "Zurückziehen" of an invitation link - which asks
        first, because the server cannot take a revocation back.
      - No sentence glues a preposition to a place's name ("Was wächst hier?"), no scrap of an id stands
        beside a kind (the last four of the id, and only where two of a kind without a name share a list), a
        camera is called by its own name.
      - After a refusal half-way the remove page reads its data again before it says what is still here.
    Left for Chris, each with what is built meanwhile:
      1. The amendment itself, point by point - in particular that `devices.spaceId` stays beside the placements,
         that a stay under five minutes leaves no trace, and that a device's first placement is read back past its
         beginning.
      2. The kinds of a place. The prototype's select reads Zelt, Kühlschrank, Trockenbox, Gewächshaus, Raum; the
         model has tent, fridge, balcony and other, and "room" is the grouping. The page offers the model's four.
      3. A room cannot be renamed in the app (the server allows it): it is a name typed on a place. Typing the name
         of a room that exists chooses that room.
      4. A place cannot be renamed or given a kind while a device is added; it is called "Zelt 2" and edited
         afterwards. The old step asked for both.
      5. Removing a place is not one write: a refusal half-way leaves what was done before it done, and the page
         says what is done and what is still here.
      6. A guest who may manage may rename the owner's place and change its kind (the server allows it); only the
         owner moves a device, sets the room and ends the place.
      7. The last place of an account cannot be removed, as before the round.
      8. Verlauf counts an alarm for the place it was raised in: one a device raised elsewhere and that is still
         open after the device came here stands on Start and the overview, which go by the device, not in
         Verlauf.
      9. A move's diary line keeps the names the two places had then; renaming a place later does not rewrite it.
      10. A stream camera at a place without a device: that a home-network address will not answer there is now
          only behind the help button, so it is learnt from the failed test.
      11. The archive routes (`PUT`/`DELETE /spaces/{id}/archive`) need only `manage`, keep people and links, and
          write the same `archivedAt` a removal writes; the app calls neither. A guest who manages could put a
          host's place away through the API, and with a room's last place that ends the room and its members.
          They are left as they are; asking `own`, or removing them, is a decision about what "put away" means.
      12. An ended place still takes an invitation, a member by handle and a share link from its owner through
          the API (only rooms refuse); it hinges on 11, because "ended" and "put away" are one state.
      13. The owner's ⋯ on Start is a list of two rows now and reads "Mehr" on a desktop; editing a place is
          two taps for the owner, adding a device to it three.
      14. The server copies a device's name onto the camera it pairs; the app treats such a name as none ("Terp
          Cam"), but cannot tell once the device is renamed. Naming a paired camera "Terp Cam" on the server
          would settle it.
  - The weight is live duplication, not dead code: 21 ideas (place chooser, rename sheet, maintenance, climate
    preset, light limit, ...) are each built in three to nine places, against one unused export.
  - Round 4 (Steuerung, devices, camera), state of 2026-11-12 (the redesign session; rules in
    [app-ux.md §2, §3, §5, §8](knowledge/app-ux.md)). Built and walked twice by the session's critics: the first
    walk found two blockers and ten larger points, the second - of the fixes - no blocker and four larger ones.
    What both found is built; checks green. The rules of both fix passes are the redesign session's, not Chris's.
    - *Steuerung with "Geräte in …"*: built (`screens/control/Control.tsx`, `PageRows.tsx`, `ByDevice.tsx`,
      `climate/`, `rows.ts`, `Mode.tsx`, `Outputs.tsx`, `DevicesHere.tsx`). Nothing is a draft, and a setting is
      changed one way: a sheet with "Speichern" for a figure, a write on the tap for a switch, each answered by a
      toast with undo (`climate/saved.ts`). The fix passes: a page behind a row leads with the place's own device
      and folds the others, and choosing another place keeps the page; a place led by a Plantalytix Socket, a
      LIGHT or an AIR fan is built from the controller's parts, and the draft bar with its leave question is
      gone; Keimung and Trocknung are chosen as a climate preset only
      ([ADR 0007](adr/0007-germination-in-the-dark.md): the stage decides the work mode); an output held by hand
      is said wherever its state is said, Start included; a paused plan is continued and stopped on the plan page
      alone; an hour of silence for a rule that has raised is back under Alarme; toasts are held to two, and
      none lies on an open sheet. A row that sums up a setting dates what the device reported and says what is
      stored and not yet taken as stored, in amber, by one rule (`rows.ts`); a fan's place offers a grow plan
      only where the fan can follow one, and no row to a page that repeats its card; a drying or a germination
      spell is ended in the preset sheet it was started in; a stage's alarm rule has one name in the reader's
      language wherever it is named (`ruleTitle`, `i18n/alarm-line.ts`); "Widerrufen" on a target writes back
      only the figures that save moved, into the device's document as it stands then; the three rows of a
      controller's place leave no hole in the grid beside the rail.
    - *The device's own page*: built (`/devices/:id` with `advanced`, `details`, and
      `/devices/:id/sockets/:socket`; `screens/devices/`). The fix pass: a socket is switched by saying which way
      (`HandHold.tsx`, the control Ausgänge has); the list of a device's sockets under its page went, since they
      stand under Steuerung and under Ausgänge; a device is moved by a button, after the sheet said what goes
      with it, and the move can be taken back; a second device's page leads to its own part of Steuerung's pages
      (the rows Steuerung draws, `PageRows`); the head's arrow steps back; every write is answered by a toast;
      regulation switched off for a device nobody heard is said as Steuerung says it; a build is named by one
      function on the page and on Steuerung's card (`madeOn`, `firmware-builds.ts`), with its hour where two
      builds share a day.
      The prototype's "meldet sich alle 5 s · WLAN gut" is not drawn: the app has no such data. "Update vom …" is
      offered only to a device whose automatic updates are off (a newer stable build than the one the cloud knows
      it runs); a device on a channel reads "kommt von selbst" - a "now" for those needs a server route. Picking
      a build by hand was shown on a stack with a registered build
      ([firmware.md](knowledge/firmware.md#ota-and-update-channels)).
    - *Offline does not lock*: built, and since the fix pass true of every panel that writes a setting -
      Plantalytix Socket, LIGHT, AIR fan, Erweitert, the work mode, regulation switched off. Proven with the
      simulator: a save is stored at once and published once on the device's `configuration` topic, which a
      silent device misses; on its next connect its `fetch` is answered with the stored document, and it
      acknowledges nothing. So the page says what the cloud stored since the device was last heard and what it
      had stored by then - `pending` of `GET /v1/devices/{id}/live`
      ([server-engines.md](knowledge/server-engines.md#read-models)), computed from the target record and the
      diary line of a person's save, no new stored field. Its limits: nothing is said in the first ten minutes of
      silence; a figure outside the target record that a plan or a preset moved meanwhile, and one past the twelve
      a long diary line names, are not known.
    - *The camera page*: built (`screens/camera/CameraPage.tsx`, `days.ts`, `Films.tsx`, `CameraSettings.tsx`).
      The slider runs over the days of the grow running in the camera's place and is not drawn without one, or
      for a second camera of one place: the diary names one still per day. The fix pass: the day stands in the
      address, "Im Tagebuch zeigen" opens the diary on it, a film asked for is followed until the button plays
      it, the settings are one sheet with one Save, and a stream camera's address notes stand behind its help.
      Scrubbing through one day's stills went with the
      prototype's design; the day's film and Verlauf's cursor are to show them (round 5).
    - *Several devices in one place*: built as far as the app goes - Steuerung's top is the device the server
      names as the place's climate (`screens/control/lead.ts`), its pages list the others folded, and every other
      device draws its own settings on its page with the way to its curves and its part of those pages. What
      becomes of a place with two climates stays the data model's question.
    - *The list `/devices`*: gone, with its panels, the second Erweitert under the targets, the maintenance
      sheet, `/control/targets` and the light limit's second slider; the address is the not-found page inside the
      shell. Erweitert lost the work mode, a fridge's fans, continuing a plan, the update channel, pairing a
      socket and giving a device up to places of their own, and its fields are lines that open the sheets
      Steuerung has.
    - *The freshness pill*: a device's and a camera's page date themselves in their head; the fleet screens say
      "Stand vor …" beside their title (`AdminHead`). What reports is "online" on every pill, card and row.
    - *Tests only*: the rows on the page of a second device of a place, as the shared part draws them - no place
      of the accounts the fix pass was walked with holds two devices.
    - *Not built, and why*: a held light on another browser - the device reports no hold of its own lamp and the
      server keeps none, so the hold is what this browser sent; since when a plan is paused - its state keeps no
      instant of the pause; a hold sent again the same way with another length - the firmware reports a hold only
      when its way changes; a pause reason in the reader's language beyond the three the app writes itself -
      the server stores words, not a code; a moment's camera picture in Verlauf's cursor,
      reached from the camera page (round 5). Three of
      Erweitert's fields did not fit the value sheet as it was: the Lux-to-PPFD factor took a finer step and the
      two known lamps as chips, the AIR fan a socket slows is a choice with a write of its own, and the CO₂
      cylinder is a report with a refill form and stayed as it was. Left for the wording pass:
      `climateControl.back` still says "ein Preset anwendest", `home.liveness.*` repeats `home.reading.*` for one
      fleet screen, English `alerts.action.unsilence` is "Unsilence", and the arrow's name "Zurück" lives under
      `device.back`. Ich's doors are `ui/Rows`; Start's are not - they are cards of a look of their own
      (`screens/start/AddPlace.tsx`).
    - *The line count*: `webapp/src` stands at 70,787 lines (`.ts`, `.tsx`, `.css`) against 74,461 when the run
      began - the first fix pass removed a second and a third way to save a setting, the second began at 70,822
      and ended under it: the Erweitert section no page drew and the fold its CO₂ report waited for went, Ich's
      doors and Steuerung's folded rows became `ui/Rows` -, and `webapp/test` at 34,800 against 33,865.
    - *Chris's to answer*, collected and not yet asked:
      1. Maintenance, a restart and an update stand on the card of the place's own device and on every device's
         page, one component - against "every setting has one place" read strictly; they are done to the
         hardware and are no settings.
      2. Regulation is switched off only on the device's page, and on wherever a page says that it is off.
      3. Scrubbing through one day's stills left the camera page for Verlauf's cursor (round 5).
      4. "Update vom …" is offered only to a device without automatic updates; a "now" for a device on a channel
         needs a server route.
      5. Keimung and Trocknung are chosen as a climate preset only, no longer under Betriebsart as well, and a
         spell that runs is ended in the same sheet. "Trocknung beenden" returns a fridge to the mode it ran
         before; "Keimung beenden" always to Standard.
      6. Moving a device is asked and can be taken back - except into a place made in the same sheet, which has
         no undo: taking it back would leave the new place behind empty.
      7. An output is held by choosing its length - An or Aus, then how long: two taps where one tap held for an
         hour.
      8. A light output's hold is known only to the browser that sent it. For every browser to say it, the live
         read has to carry the hold: either the server remembers the last light override it published, or the
         firmware reports it in the table it already sends (the session's recommendation). With it: may the
         firmware report its table on every override, so that a hold sent again with another length is seen?
      9. A paused plan keeps no instant it was paused at, so its row says why and not since when; a stored
         `pausedAt` on the plan's state would give the hour.
      10. A stand-alone LIGHT stops at 23.5 h of light: it holds two times of day, and two equal ones are no day.
      11. The day in the camera's address (`?day=`) is the grow's day number, not a date.
      12. "Manuell" is the off state of the switch "Automatisch aktualisieren", not an option of the channel
          select.
      13. Installing a build picked by hand waits for the device to be heard, as every update does.
      14. A Plantalytix Socket's and an AIR fan's mode are saved from a sheet with "Speichern" and not on the tap,
          and a stream camera's Erweitert with its sheet's Save.
      15. A pump's or a timer's cycle is set only in the socket's sheet ("Zeitschaltung, Adresse, Rolle").
      16. Whoever may not manage a device is not shown how many sockets it has: the count stands on the row that
          pairs one.
      17. The light limit's toast follows its last step by the 1.5 s a stepped figure rests before it is written
          ([app-ux.md §12](knowledge/app-ux.md#12-screen-readers)); the second critic read that as a late toast.
      18. A plan's pause reason is stored as words, in the language of whoever paused, so only the app's own
          three reasons read in the reader's language. A reason code needs the server.
      19. "Jetzt ein Bild" is answered by a toast; a picture that could not be taken is said under the button.
      20. The four names a stage's alarm rules are stored under are written in the server and in the web app,
          with no shared constant.
      21. A grow started with a stage writes that stage's climate to every device of the place that states
          targets, while the form reads the stage and asks germination's choices of the place's lead alone.
  - A line of the diary opens Verlauf on its moment however old; today one from more than 30 days back opens the
    grow's whole stretch, the only window that holds it, because Verlauf's windows all end now (round 5: Verlauf's
    address carries its window).
  - Where the run stands (2026-11-12). Built, walked by a critic and fixed: the frame, Start, the grow pages.
    Round 4 is built and walked twice, and what both walks found is built (above). The second walk of
    Start and the grow pages found one blocker - a device's alarms reached outside readers, closed - and eight
    larger points, built: their rules stand in [app-ux.md](knowledge/app-ux.md) and
    [server-engines.md](knowledge/server-engines.md#read-models), each marked as the redesign session's. Then, one round after another, each followed by its critic
    ([development-workflow.md](knowledge/development-workflow.md), Long runs and rounds):
    Verlauf as one page with the server's finer step, place and room with the data model's migration steps, Ich
    and Meldungen, and the clearing up (unused code, one wording pass, these documents, the line counts against
    74,461 in `webapp/src` and 33,865 in `webapp/test` when the run began). The briefs of the rounds, the list of
    every function with its new place and the decisions on each critic's findings are internal notes; the target
    pictures come from the click prototype.
  - Waiting for Chris's word (asked on 2026-11-12, no answer yet). The rules the redesign session set itself after
    its critics' walks - the calendar's day count, which lines a day card shows, the week cards' removal from the
    contract - are marked as such where they stand and are his to confirm with the redesign's pull request. And
    six things went with the grow page's tab "Wochen" that no page shows any more, against the rule that no old
    capability disappears silently ([app-ux.md](knowledge/app-ux.md)); each comes back or is decided away:
    - how many of a scheme week's feedings are logged ("n / m erledigt") - the week's feed lines and the rhythm
      behind "m" were reads of the removed week cards, the tab Düngung makes neither;
    - the day/night strip and the light hours per week (the report has them per phase);
    - a reading with its change from the week before (the Messwerte page has the curves);
    - the days of each stage in the head's bar;
    - strains and plant count in the head (the tab Pflanzen and the cards of "Alle Grows" have them);
    - the entry tiles' captions with the last value (the watering detail says when and how much the last was).
    And four things went with the second grow form, since "Was wächst hier?" is the one form a grow starts with:
    - several strains at creation (the tab Pflanzen names them afterwards);
    - a feeding scheme at creation (the tab Düngung chooses one);
    - making a new place in the form (a grow starts in a place that exists or without a fixed one);
    - the autoflower choice at creation - it moved to the grow's menu, "Name und Art".
    Germination's two humidity choices went with it too and are back in the form, asked where it writes
    germination's climate ([ADR 0007](adr/0007-germination-in-the-dark.md), G2: they travel with every way
    germination is set).
    And four things went with the page "Graphen" that Verlauf does not do (round 5):
    - a free range between two dates ("Zu einem Tag springen" with zoom and step reaches any window);
    - renaming a saved view (it is deleted and saved again);
    - the filter of message lines by four kinds (two ticks now: the diary, the devices' messages);
    - the curves of hand measurements for a grow without a place.
    Removing the routes Verlauf no longer asks (above, "Settled on 2026-11-12") changes the frozen contract of
    [ADR 0001](adr/0001-app-rewrite-data-model.md) and is his to say as well.
    Also open: whether a day's camera picture outlives the camera's retention - today only a still that a diary
    line or a grow's cover names is spared.

- **Unit preferences are saved, not applied.** Ich › Darstellung stores °C/°F, g/oz and l/gal
  (`preferences.units`), but every figure is still drawn in °C, g and l, as the help beside "Einheiten" tells the
  reader (`help.units`); only the row's line on Ich reads the choice (`webapp/src/screens/me/doors.ts`).
- **Plan templates cannot be renamed or deleted in the app.** `PATCH` and `DELETE /v1/plan-templates/{id}` exist;
  `webapp/src/api/plans.ts` only lists and creates.
- **Two task sources are not derived.** The contract's `taskSource` names `scheme` and `plan_suggestion`, but tasks
  come only from reminders and from plan steps waiting to be confirmed; `server/src/modules/v1/diary/tasks.service.ts`
  says why.
- **A standalone Terp Cam cannot be added.** The app does not offer it any more (Chris, 2026-10-08, for now) and
  `POST /v1/cameras` refuses `terpcam_standalone` with `not_yet`: a Terp Cam is reached over a relay its device
  opens, and one paired at no device has nothing to open it. The kind stays in the model in case it comes back.
- **The firmware since 2026-09-23 has not been checked on hardware.** #109, #110, #111 (fridge heat pulses,
  controller heater cut, fridge SCD4x fallback), #128 (Terp Cam relay on AIR and plug) and #141 (settings reported
  on connect) say in their descriptions that they were not tried on a device, and no `/firmware-check` is recorded
  for them or for the rewrite's own firmware changes: the smart-socket roles, overrides and protections
  (`firmware/src/wifi.cpp`, `firmware/src_hwtype/plug/plug.cpp`) and the controller's germination cooling with the
  exhaust (`firmware/src_hwtype/controller/controller.cpp`). A passing check comments "Skill check: ..." on its pull
  request. Two server behaviours also want a real device to confirm them: the 24-hour light encoding
  (`ALWAYS_LIT_FROM` in `shared-types/src/v1/day-night.ts`) and the schedule re-sent when the clocks change
  (`server/src/modules/device-protocol/schedule-clock.service.ts`).
