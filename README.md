# FAIR File Namer

**A simple file- and folder-naming tool for fundamental-research labs.**
Templates are scoped to a **lab**, built by dragging field tiles into order, and
shared across the group through the eLabNext ELN.

Built in the context of the CAS in Research Data Stewardship, with a focus on
neuroscience data management at the UNIGE Faculty of Medicine.

---

## The idea

There is no single hard-coded nomenclature. Instead:

- A **master user** builds templates for each **lab**. Pick a lab and you see only its templates.
- Fields are not freely configurable — they come from managed lists:
  - **Department** — a fixed list, set once in code.
  - **Operator** — a list of names the master user maintains.
  - **Device** — a list of acquisition devices the master user maintains; each device also
    carries generic info (software, version, microscope, …) that is written into the metadata.
  - **Project / Sample / Condition** — free text the user types (Condition e.g. `baseline`, `drug`).
  - **Date** — automatic.
  - The master user can add a few **custom fields** (free text / list / date) via one button.
- **Per-machine default device:** on an acquisition computer, set the device once
  (★ *Set as this machine's default*) and it is prefilled on every use — no need to re-pick it.
- **ELN auto-fill:** once integrated, **Department, Lab, Operator and Project** come from the
  eLabNext context and are shown locked, so the user only fills what's specific to the file.
- Building a template is just **dragging small tiles** into the order you want, with a
  **live example** updating underneath. No per-field settings.
- The metadata shows as a **live rendered document**: an auto-built header (file name decoded into a
  table, the generation **date and time (HH:MM)**, plus the selected device's info) with an editable
  **rich-text notes** area below it. A small toolbar sets the **font and size** and applies
  **bold / italic / underline / lists**. Export as Markdown (copy or `.md`) or a `.json` sidecar.

---

## Two screens

### Use (everyone)
1. Pick your **lab**, then a **template**. Optionally override the **acquisition date**.
2. Fill the fields — Department/Operator/Device are dropdowns, Project/Sample/Condition are text, Date and Run are automatic.
   Required fields are marked with `*` and block committing until filled.
3. The file name shows on top with a **copy icon**. Below, the **Metadata & notes** panel renders live:
   an auto-built header (file name → table, device info, generation date + time) plus an editable
   notes area; use the toolbar to set font/size and format the text.
4. Then **Copy file name** / path / **Markdown**, **Download .md / .json**, **Record in experiment**,
   **Next run ▸** (advance the counter for the next file) or **Reset**.
5. Collapsibles: **Recent file names** on this machine, and a best-effort **Decode** of an existing name.

### Manage (master user only)
- Pick the lab, the template type (**File name** / **Folder path**) and the template.
- **Drag the tiles** to order the fields; click a field below to add it; ✕ to remove. Live example below.
- **Double-click a tile** (or its ✎) to open a popup and set how that field is abbreviated in the file
  name: Date gets format options including **time** (`_HHMM` minute, `_HHMMSS` second precision);
  Department/Operator/Condition can be **first initial**, **initials/acronym**, first-3, upper or lower;
  text/list fields can be marked **required**; **Run** (counter) gets padding + daily/global reset.
  The **full value is always kept in the metadata** regardless of the abbreviation.
- Reorder with drag **or** the ◀ ▶ buttons on each tile (touch / keyboard friendly).
- A collapsible **Manage lists & fields** panel holds: the **labs**, the **operator** name list,
  the fixed **departments** (read-only), and **custom fields** with an **Add field** button.
- **Export / Import** the whole library as JSON.

> On reordering: small draggable tiles with a live example are far simpler than an
> "available/selected + arrows" shuttle — the order you see is the result you get.

---

## Fields

| Field | How the value is obtained | Editable by |
|-------|---------------------------|-------------|
| **Department** | dropdown, fixed list | code only (`DEPARTMENTS` in the add-on) |
| **Operator** | dropdown, name list | master user |
| **Device** | dropdown, device list (each carries generic metadata) | master user |
| **Project / Sample** | free text typed by the user | — |
| **Condition** | free text (e.g. `baseline`, `drug`) | — |
| **Date** | automatic (date and/or time) | — |
| **Run** | automatic counter (per day or global), zero-padded | master user (padding/scope) |
| **Custom** | free text, a list, a date, or a counter | master user (Add field) |

Free-text values are cleaned for filenames; **accented characters are folded** (`Chéreau → Chereau`,
`Genève → Geneve`) rather than dropped. The **Run** counter prevents same-day name collisions — click
**Next run ▸** after each file (or it just shows the next number).

The master user maintains the **device list** in Manage → *Manage lists & fields → Acquisition
devices*. Each device has a name (used in the file name) and a free block of `Key: value` lines
(e.g. `Software: ScanImage`, `Version: 2023.1`). When a user picks that device, those lines are
added to the metadata header and the sidecar automatically.

Values are auto-cleaned for filenames (letters, digits and `-` kept; spaces and other
characters removed). Empty fields are dropped, so partial names stay tidy. Example:
`NEUFO_MarieCurie_VIPlearning_M042-f_20260612`.

> To change the fixed department list, edit the `DEPARTMENTS` array near the top of
> `fair_file_namer_addon.js`.

---

## Data model (the library)

One JSON document, stored as `templateLibrary` in the add-on configuration:

```jsonc
{
  "version": 3,
  "operators": ["Marie Curie", "Jean Dupont"],
  "devices": [ { "id", "name", "info": { "Software": "ScanImage", "Version": "2023.1" } } ],
  "fields": [ { "id", "name", "source", "options?", "format?", "builtin?" } ],
  "labs": [
    { "id", "name",
      "fileTemplates":   [ { "id", "name", "default", "separator", "fieldIds": [ … ] } ],
      "folderTemplates": [ { …same shape, separator "/"… } ] }
  ]
}
```

A template is just an ordered list of `fieldIds` pointing into the shared `fields` catalog.

---

## Storage & roles in eLabNext

See the [add-on configuration docs](https://developer.elabnext.com/docs/add-on-configuration).

- Install the add-on at **GROUP scope** → each lab/group gets its own configuration bucket.
- `init(configuration, addonContext)` reads the saved `templateLibrary` on load.
- **Master vs member:** keep `allowMemberEditing` **off** (default) so only the master user sees
  the **Manage** tab; everyone else only uses the templates. This keeps the convention from drifting.

### Publishing a library
1. In **Manage**, build the labs/templates and click **Export library JSON** (also copied to clipboard).
2. Paste it into the add-on's **Configure → templateLibrary** (GROUP scope) and save.
3. The whole group now sees the templates in **Use**.

> `saveLibrary()` also attempts a direct `eLabSDK.Plugin.setConfiguration` write if your instance
> exposes it (fails soft). The Export → Configure path is the reliable, documented route. Confirm the
> method against your [SDK Reference](https://developer.elabnext.com/docs/elabsdk-v2) before relying on it.

---

## Files

| File | Purpose |
|------|---------|
| `fair_file_namer_addon.js` | The add-on. Runs in eLabNext **and** standalone. |
| `configurationSchema.json` | Upload to Developer Platform → **Code → configurationSchema**. |
| `defaultConfiguration.json` | Upload as the **Default configuration** (ships a demo lab). |
| `index.html` | The app page — open in a browser; loads `library.json`. |
| `library.json` | The **shared library** (operators, devices, labs, templates) all machines read. |
| `configurationSchema.json` / `defaultConfiguration.json` | For the (later) eLabNext add-on uploads. |

---

## Deployment (HTML-only, shared library)

The intended first-stage rollout, without eLabNext:

1. **Host `index.html`, `fair_file_namer_addon.js` and `library.json` together** over HTTPS — e.g.
   institutional **GitLab/GitHub Pages** (recommended: access-controlled + version history), an
   internal static web server, or a NAS exposed over HTTP. Avoid opening the file via `file://` from
   a network drive: browsers then block reading `library.json` and writing it back.
2. **Each machine bookmarks the URL.** On open, the app loads the cached library **instantly** (works
   offline) and checks `library.json` in the background; a newer one is cached and applied on the next
   launch — so users never wait on the network before naming a file.
3. **The master uses `…/index.html?admin=1`**, edits in **Manage**, then **Publish** → downloads
   `library.json`. Commit/upload it to replace the hosted file. Every machine picks it up next launch.
4. **Lock down write access to `library.json`** (git permissions or server/NAS ACLs) — that, not the
   app, is what guarantees only the master changes the convention.

Per-machine and never shared: the **default device** (★), metadata font/size, the run counter, and
recent names — all in the browser's local storage. So the same `library.json` serves every machine
while each keeps its own default device.

### Many labs (multi-tenant)

Each lab gets **its own `library.json`**, edited only by that lab's masters and read only by that
lab's machines. The app code (`index.html` + the `.js`) is shared; only the data file differs:

- **Separate folder/repo per lab** (simplest): `…/holtmaat/` holds an `index.html` + `library.json`;
  machines bookmark that lab's URL and the default `./library.json` resolves to it.
- **One shared app, pick the lab by URL:** host the app once and point each lab's machines at their
  file with `…/index.html?cfg=https://…/holtmaat/library.json` (or `?lib=holtmaat` → `libs/holtmaat.json`).
  Caches are namespaced per lab, so one browser used for two labs never mixes them.

Access per lab is controlled by **who can write that lab's file** (next section) — Lab A's masters
can't see or change Lab B's config.

> A single shared `library.json` can also list several labs in its `labs[]` array, but then everyone
> sees every lab — use that only for a deliberately faculty-wide convention, not for per-lab privacy.

---

## Managing master-user access

The app's `?admin=1` only **reveals the editing UI** — it is not security. Real protection is
**who can write each lab's `library.json`**. Recommended for the Faculty of Medicine:

- Use the institution's **GitLab** (SSO with UNIGE accounts). One group for the tool; **one project
  per lab** (or one repo with a per-lab folder + `CODEOWNERS`).
- Add each lab's **2–3 masters as members with write access to their lab's project only**; everyone
  else is read-only. They publish by committing `library.json` (via the app's **Publish** download,
  or GitLab's web editor) — authenticated by their UNIGE login, with a full **audit history** and revert.
- Machines read their lab's file over HTTPS (GitLab Pages or the raw file URL).
- Strict *read* privacy (config hidden from other labs/outsiders) needs **authenticated reads** —
  private GitLab Pages behind SSO, or a small backend. Note: unattended acquisition machines then
  need a logged-in session, which is awkward; if read-within-faculty is acceptable, plain hosting is simpler.

> This per-group, per-role model is exactly what **eLabNext** provides natively — so the static
> multi-repo setup is the pragmatic stage-1, and the eLabNext add-on (already built here) is the
> clean stage-2 once you have the sandbox.

---

## Try it / develop

- **As a user:** open `index.html` — Use tab only; reads `library.json`, caches it, works offline.
- **As the master:** open `index.html?admin=1` — adds the Manage tab and the Publish button.
- **eLabNext (later):** side-load `fair_file_namer_addon.js`, then upload the two JSON files to the
  Developer Platform and publish at **GROUP** scope.

---

## Notes & next steps

- The fixed department list lives in code (`DEPARTMENTS`); change it once per faculty.
- Per-field abbreviation (full / initial / acronym / …) is set in the tile popup; the Operator dropdown
  is master-maintained. Accented characters are folded automatically.
- **Machine default device**, metadata **font/size**, the **Run counter**, and **recent file names** are
  all stored per browser (`localStorage`), independent of the shared library.
- The notes editor uses the browser's rich-text editing (`contenteditable` + `execCommand`); notes are
  saved as both plain text and HTML in the sidecar, and converted to Markdown for the `.md` export.
- Sidecar `.json` files carry the decoded fields, the **pattern**, and the notes with the data — the
  part that actually helps FAIR reuse.

### Deferred until the eLabNext sandbox is available
- **ELN auto-fill** (`resolveELNContext()`): logged-in user → Operator is wired; Department, Lab and
  Project have `TODO(ELN)` stubs to connect to your instance's group/experiment data (shown locked when present).
- **Role gating:** the Manage tab is currently visible to everyone (usable-by-default); the real
  master-user check needs the eLab group-permission source (`_isMaster` in `init()`).
- Confirming the programmatic `setConfiguration` save path against a live instance.

### Possible later work (needs a dependency or model change)
- Swap the `execCommand` notes editor for a small library (TipTap/Quill) for longevity.
- Per-template field-format overrides (today a field's format is shared across templates).
- Actual folder creation on acquisition machines (File System Access API) and BIDS mapping.

---

## License

MIT — see `LICENSE`.
