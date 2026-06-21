# CLAUDE.md — FAIR File Namer

Context file so work can continue in a normal chat (not Cowork). Read this first.

## What this is
A single-file, vanilla-JS web app that generates standardized file names + rich metadata for
fundamental-research labs at UNIGE Faculty of Medicine. No build step, no framework. It runs:
- **Standalone** (the real deployment): `index.html` loads `fair_file_namer_addon.js`, which renders
  its whole UI into `<div id="fng-host">`.
- (Future) as an **eLabNext** custom section — the eLab wiring is stubbed (`resolveELNContext`, etc.)
  and not active yet.

## Files in this repo (each maps to a different GitLab repo on deploy)
- `fair_file_namer_addon.js` — the entire app (engine + UI). ~2000 lines, IIFE, closes with `})();`.
- `index.html` — host page for the **lab app**. Sets `window.FNG_PUBLISH_BASE` (UNIGE group root) and
  loads the JS with a cache-buster.
- `platform.html` — dedicated **platform-manager** page (device-only editor). Sets
  `window.FNG_PLATFORM_ADMIN = true` and opens with `?platform=<slug>`.
- `library.json` — starter **lab library** (operators, devices, fields, labs, templates). One per lab repo.
- `index.json` — **platform manifest** (`{version,platforms:[{slug,name}]}`). Served at `/platforms/index.json`.
- `platform.json` — starter **per-platform** device file (`{version,name,devices:[{id,name,info}]}`).
- `DEPLOY-GITLAB.md` — full deployment + governance guide (gitlab.unige.ch ↔ gitlab.com mirroring).
- `configurationSchema.json` / `defaultConfiguration.json` — for the future eLabNext add-on.
- `README.md`, `LICENSE`.

## Deployment architecture (see DEPLOY-GITLAB.md for steps)
- **Edit/govern** on `gitlab.unige.ch` (Private, CE: no Pages/runners/Code-Owners). **Serve** on
  `gitlab.com` Pages, linked by **push mirroring**. Group on both servers: `facmed-filenamer`.
- One **repo per lab** for isolation: UNIGE `filenamer-<lab>` → gitlab.com `<lab>` → serves `/<lab>/library.json`.
- App code: UNIGE `filenamer-app` → gitlab.com `app` → serves `/app/` (`index.html`, `platform.html`, JS).
- Platforms: UNIGE `filenamer-platforms` → `platforms` (the manifest `index.json`); plus one repo per
  platform `filenamer-plat-<slug>` → `plat-<slug>` → serves `/plat-<slug>/platform.json`.
- Each gitlab.com project: **Public**, **Pages = Everyone**, **"Use unique domain" OFF**, `main` allows
  force-push (mirror target). UNIGE side is Private. **Exactly one mirror per repo, same-named target.**
- URLs (example group `facmed-filenamer`):
  - Lab (one shared link): `https://facmed-filenamer.gitlab.io/app/?cfg=/<lab>/library.json`
  - Platform manager: `https://facmed-filenamer.gitlab.io/app/platform.html?platform=<slug>`
- Ronan's gitlab.com username for mirror URLs: `Ronan.Chereau` (verify exact slug on gitlab.com profile).

## Governance model (current)
- **Everyone can edit** the library through the one lab link (Manage tab always visible; no `&admin=1`).
- Edits **auto-save locally** (localStorage) — there is no Save button.
- **Publishing to GitLab is a master action** (gated by repo membership): "Publish changes" downloads
  `library.json` + copies it; non-masters send it to a master, a master commits it.
- Platform device descriptions are editable **only** by that platform's manager (their own repo);
  lab users see them read-only.

## Data model
- `library = { version:3, operators:[{name,initials?,first3?}], devices:[{id,name,info:{k:v}}],
  fields:[{id,name,source,format?,builtin?,...}], labs:[{id,name,dept?,initials?,first3?,
  fileTemplates:[tpl],folderTemplates:[tpl]}], publishUrl? }`
- `tpl = { id,name,default?,separator,basePath?,fieldIds:[...] }`
- field `source`: `department|operator|device|freetext|date|counter|lab`.
- **Departments** are fixed in code (`DEPARTMENTS` array): NEUFO=Basic Neurosciences, PATIM=Pathology &
  Immunology, MIMOL=Microbiology and Molecular Medicine, PHYM=Cell Physiology & Metabolism,
  GEDEV=Genetic Medicine and Development.
- **Each lab has `dept`** (a department code). In Use it auto-fills + locks the Department field, and is
  **always written to metadata** even if not in the naming template.
- Platforms: `index.json` lists `{slug,name}`; each `plat-<slug>/platform.json` = `{version,name,devices}`.

## localStorage keys (per machine / per browser)
- `fng.library.v3::<libUrl>` — cached lab library (autosaved on every edit).
- `fng.platforms.cache` — merged platform devices for the picker.
- `fng.platform.<slug>` — the platform editor's working copy.
- `fng.machine.defaultDevice` / `fng.machine.lastDept` / `fng.machine.lastOperator` — remembered selections.
- `fng.configs` = `{ "<operator> :: <device>": [{id,name,text}] }` — per-(operator+device) experiment
  configs. `fng.configActive` = active config id per key. Active config (of the in-use device) is folded
  into metadata.
- `fng.doc.font` / `fng.doc.size` / `fng.recentNames` / `fng.hist.<fieldId>`.

## Key UI pieces (all in fair_file_namer_addon.js)
- `renderUse()` — the Use screen: lab/template/date selectors, "Fill in" fields (with `<placeholders>`
  shown for empty ones), live file-name preview with copy icon, metadata+notes doc with a top-right copy
  button. Copy/export is gated by `missingInputs()` (popup lists unfilled fields).
- **Device field** = a "Manage devices" button that opens `renderDevManager()` — a 3-column modal
  (`fng-dmcard` = 96vw): left tree (Lab devices / Platform devices→platforms→devices), middle = editable
  (lab) / read-only (platform) **description**, right = **My Configurations** (operator+device, local).
  Opening preselects the in-use device; "Set as default device for this machine" sets it.
- `renderManage()` — warning banner + lab/template tile builder + Publish + `manageLists()` (Labs table
  WITH a Department dropdown column, Operators table, Manage-devices button, Departments list, Custom fields).
- `renderPlatformAdmin()` — the `platform.html` editor (autosave, "Publish changes").
- Engine: `buildName`, `encodeField`, `sanitizeVal`, `fmtDate`, `applyFmt`, `deviceGroups`,
  `findDeviceByName`, `headerObject/headerMarkdown/headerHtml`, `sidecar`.

## IMPORTANT: verifying changes
The Cowork workspace mount frequently serves a **stale/truncated snapshot** of this large JS file, so
`node --check fair_file_namer_addon.js` on the whole file often falsely fails ("Unexpected end of input").
Workaround used throughout: extract the edited function span(s) with `awk` by content anchors, wrap in
`(function(){ ...stubs... <span> })();`, and `node --check` that. In a normal local chat with a real
filesystem this isn't an issue — just run `node --check` directly. The runtime boot has a try/catch that
shows an error instead of a blank page (but it does NOT catch parse errors).

## After editing, to deploy
Paste/upload the changed file(s) into the matching UNIGE repo (`filenamer-app` for `index.html` /
`platform.html` / the JS), commit `main`, then **↻ Update now** on that repo's push mirror. Upload large
files via the Web IDE's Upload (paste can truncate).

## Open/optional items (not done)
- Starter `library.json` Demo Lab has no `dept` set (shows "— none —" until assigned).
- Responsive "stack on very narrow screens" for the device modal (currently fixed 3-column row).
- Cross-platform duplicate-device-name hard-block (only a soft `!` flag within a platform now).
- Renaming a lab device starts a fresh config bucket (configs key by device name; no rename migration).
- eLabNext integration still stubbed.
