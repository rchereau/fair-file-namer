# FAIR File Namer

A single-file browser add-on for naming, organising and documenting research data
according to FAIR principles. It runs as an eLabNext add-on and as a standalone page
(`index.html`), with no build step and no framework — just `fair_file_namer_addon.js`.

## What it does

- Builds consistent, template-driven **file names** from lab-defined fields
  (operator, date, subject, device, and so on), with live validity feedback.
- Creates the matching **folder tree** on a local root folder and auto-saves a
  descriptive **metadata sidecar** (`<name>.json`) next to the data.
- **Rename existing files** from earlier sessions to the FAIR name in batch, writing a
  reversible rename manifest and a FAIR sidecar into each folder.
- **Link recordings**: give every file from one simultaneous acquisition (e.g. two-photon
  imaging plus a behavioural stream from other software) the same opaque `session` id,
  stored in each file's sidecar — grouped by a shared value, not by pointers, so renaming
  or moving a file never breaks the link. Includes a scan-and-confirm mode and a manual mode.
- Reads a shared `library.json` (operators, devices, labs, templates) and faculty-wide
  **platform devices**, cached for offline use.

Descriptive metadata lives in the sidecars, which are the source of truth; indexes and
catalogues built on top of them are rebuildable views.

## Deployment

Source is hosted on the UNIGE GitLab and push-mirrored to a public GitLab.com project that
serves the tool via GitLab Pages. See **DEPLOY-GITLAB.md** for the full deploy, mirroring
and caching setup.

## License

© 2026 Research Data Management Service (RDMS), Faculty of Medicine, University of Geneva (UNIGE).

This work is licensed under the
**Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International License (CC BY-NC-SA 4.0)**.

You are free to share and adapt the material under the following terms:

- **Attribution** — credit the Research Data Management Service (RDMS), Faculty of Medicine,
  University of Geneva, provide a link to the license, and indicate if changes were made.
- **NonCommercial** — you may not use the material for commercial purposes.
- **ShareAlike** — if you remix or build upon the material, you must distribute your
  contributions under the same license.

Full license: https://creativecommons.org/licenses/by-nc-sa/4.0/
Legal code: https://creativecommons.org/licenses/by-nc-sa/4.0/legalcode

## Contact

Research Data Management Service (RDMS), Faculty of Medicine — UNIGE
Ronan Chéreau · Ronan.Chereau@unige.ch
