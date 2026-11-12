# ADR-0005 — License: AGPL-3.0-or-later

- Status: accepted (owner, 2026-11-12)

## Decision

Aurelia is licensed under the **GNU Affero General Public License v3.0 or later**
(`AGPL-3.0-or-later`). Full text: [`LICENSE`](../../LICENSE).

## Why

Anyone may use, study, change and share Aurelia. Anyone who ships a changed copy —
including as a hosted web service or a sync service — must share their source under
the same license. This stops a closed fork or a closed hosted copy built on this code.

## Consequences

- Every dependency must have an AGPL-compatible license (MIT, BSD, Apache-2.0, ISC,
  MPL-2.0, LGPL, GPL-3.0, OFL for fonts). CI checks this (M0).
- **Tiptap Pro (closed) extensions are banned.** Only open-source Tiptap packages.
- The licence of the Markdown converter chosen in ADR-0007 is verified before it is
  adopted.
- **No Claude or OpenAI logos.** The one exception is OpenAI's approved "Continue with
  ChatGPT" button (ADR-0008).
- **Desktop builds ship as direct, notarised downloads.** AGPL and the Mac App Store are
  widely held to conflict. That is unverified, so we avoid the store.
- Spellcheck dictionaries (Hunspell) are checked per language for their licence before
  they are bundled (M9).
- Source files carry the SPDX header `// SPDX-License-Identifier: AGPL-3.0-or-later`.
- Contributions are accepted under the same license (inbound = outbound), with a
  Developer Certificate of Origin sign-off (`git commit -s`). No CLA.
- **Your own writing is yours.** The license covers the software, never the stories,
  worlds or files an author makes with it. The README says this plainly.
