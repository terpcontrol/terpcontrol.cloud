# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem. Write to **info@terpcontrol.com** with the subject
**"Sicherheitslücke"** (German or English is fine) and include:

- what is affected - the server, the web app, a firmware (`fridge`, `controller`, `plug`, `fan`, `light`) or the
  hosted cloud at terpcontrol.cloud - and which version or commit;
- what you observed and how to reproduce it;
- how we can reach you.

Do not access, keep or change other people's data, and do not degrade the service for others while you look.

## What happens next

- We acknowledge your report within **five working days**.
- We assess it, tell you how we rate it, and keep you posted until it is fixed.
- We publish a fix and a GitHub security advisory as soon as it is available, at the latest **90 days** after your
  report, and credit you if you wish.
- A vulnerability that is actively exploited is reported to the authorities as the EU Cyber Resilience Act requires.

We will not take legal action against anyone who follows this policy in good faith. There is no bug bounty.

## Supported versions

Security fixes go into `master` and reach the hosted cloud and the devices from there; firmware updates are delivered
over the air. Older releases and forks do not get backports. How long the Terp Control devices receive security
updates is published at <https://terpcontrol.com/sicherheit.html>; the same policy in German is there too.

If you run the software yourself, keep your install on a current `master` and your devices on current firmware.
