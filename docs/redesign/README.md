# Redesign research

Background research for the controller-era redesign of the diary, the charts and the multi-user story.

Start with [`00-dossier.md`](00-dossier.md) — it consolidates everything else and is the only file most
readers need. [`00-verified-notes.md`](00-verified-notes.md) holds facts established by reading this repo
directly, and is the tie-breaker where a report and the code disagree.

The numbered reports are the raw material behind the dossier. `01`–`06` look outward (grow-diary
platforms, nutrient feed charts, social posting, competitor apps, club regulation, charting practice);
`10`–`14` look inward at what this repo does today (diary, charts, controller UI, data model, design
system).

Two conventions worth knowing before relying on any of it:

- Claims are tagged for provenance. `[VERIFIED]` was checked against a primary source, `[CODE]` against
  this repo, `[INFERRED]` and `[UNVERIFIED]` were not — the dossier's own §9 lists what still needs
  checking, and its Appendix A records where two reports contradict each other.
- Several findings have a shelf life. Pricing, API tiers and platform policies were accurate when
  gathered and will drift; re-check before acting on a number rather than quoting it forward.

Two findings outgrew the redesign and are ordinary security bugs that want fixing on their own schedule:
unauthenticated device claiming (`device.route.ts` / `device.service.ts`) and unsanitised Flux
interpolation in `/data/series` (`data.service.ts`). Both are described in the dossier's §8 P0 list.
