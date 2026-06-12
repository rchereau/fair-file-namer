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
1. Pick your **lab**, then a **template**.
2. Fill the fields — Department, Operator and Device are dropdowns, Project/Sample are text, Date is automatic.
3. The **Metadata & notes** panel renders live: an auto-built header (file name → table, device
   info) plus an editable notes area; use the toolbar to set font/size and format the text.
4. Then **Copy file name**, **Copy metadata (Markdown)**, **Download .md**, **Download .json**, or **Record in experiment**.

### Manage (master user only)
- Pick the lab, the template type (**File name** / **Folder path**) and the template.
- **Drag the tiles** to order the fields; click a field below to add it; ✕ to remove. Live example below.
- **Double-click a tile** (or its ✎) to open a popup and set how that field is abbreviated in the file
  name: Date gets format options including **time** (`_HHMM` minute, `_HHMMSS` second precision);
  Department/Operator/Condition can be **first initial**, **initials/acronym**, first-3, upper or lower.
  The **full value is always kept in the metadata** regardless of the abbreviation.
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
| **Date** | automatic (`YYYYMMDD` by default) | — |
| **Custom** | free text, a list, or a date | master user (Add field) |

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
| `index.html` | Standalone test harness — open in a browser (uses localStorage). |

---

## Try it / develop

- **Standalone:** open `index.html` in a browser. Full UI, saved to local storage; you are the master user.
- **Side-loading:** enable Developer Mode, side-load `fair_file_namer_addon.js` (uses the bundled default + localStorage).
- **Publish:** move the two JSON files to the Developer Platform uploads, set scope to **GROUP**, publish.

---

## Notes & next steps

- The fixed department list lives in code (`DEPARTMENTS`); change it once per faculty.
- The `Operator` dropdown is master-maintained; multi-word names are kept as cleaned text
  (e.g. `Marie Curie` → `MarieCurie`). Ask if you'd prefer automatic initials.
- **Machine default device** is stored per browser (`localStorage`), independent of the shared
  library — each acquisition computer keeps its own. The metadata **font and size** are remembered the same way.
- The notes editor uses the browser's rich-text editing (`contenteditable` + `execCommand`); notes are
  saved as both plain text and HTML in the sidecar, and converted to Markdown for the `.md` export.
- **ELN auto-fill** is wired through `resolveELNContext()`: the logged-in user → Operator works
  today; Department, Lab and Project have clearly-marked `TODO(ELN)` spots to connect to your
  instance's group/experiment data. When a value is present it is shown locked in the Use screen.
- Sidecar `.json` files carry the decoded fields + notes with the data — the part that actually helps FAIR reuse.

---

## License

MIT — see `LICENSE`.
