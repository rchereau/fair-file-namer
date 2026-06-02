# LabFileNamer

**A lightweight, browser-based file-naming generator for experimental neuroscience labs.**

LabFileNamer turns ad-hoc, inconsistent filenames into a single shared, FAIR-friendly
convention. Instead of typing a filename by hand, you pick a few predefined fields and a
standardized, human-readable and machine-interpretable basename is generated live for you to
copy and use for newly acquired files.

It is designed to live at the **point of acquisition** (on the acquisition computer), where
naming habits form and where standardization has the strongest long-term impact on data
findability, traceability, and reuse.

---

## What it does

You fill in (or select) up to six fields; a seventh (the date) is added automatically. The tool
builds the basename in real time, colour-codes each segment, and copies the result to your
clipboard with one click.

**Pattern:** `INST_PI_SCI_PROJ_SAMP_DEV_YYYYMMDD`

Segments are joined with underscores (`_`). Empty fields are skipped, so the filename stays clean
even if you only fill in some of them.

---

## The fields

| Code | Field | Input | How it is encoded |
|------|-------|-------|-------------------|
| `INST` | Institution / unit | dropdown | the selected code (e.g. `NEUFO`, `PATIM`, `MIMOL`) |
| `PI`   | Lab PI last name | text | first 3 letters, letters only, UPPERCASE |
| `SCI`  | Scientist (first last) | text | initials, UPPERCASE (a single name → its first 2 letters) |
| `PROJ` | Project name | text | spaces and symbols removed, max 8 characters (case preserved) |
| `SAMP` | Sample / animal ID | text | letters, digits and hyphens only, UPPERCASE |
| `DEV`  | Acquisition device | text | letters, digits and hyphens only (case preserved) |
| `DATE` | *(automatic)* | — | today's date as `YYYYMMDD` |

### Example

Selecting institution `NEUFO`, PI `Holtmaat`, scientist `Marie Curie`, project
`VIPDisinhibition`, sample `M042`, device `2P-B` on 2 June 2026 produces:

```
NEUFO_HOL_MC_VIPDisin_M042_2P-B_20260602
```

---

## Usage

1. Open the live page (see **Run it** below), or simply double-click `index.html` to open it in
   any modern web browser.
2. Choose your institution and type the remaining fields. The generated basename updates as you type.
3. Click **Copy** and paste the basename when saving your acquisition file.

No installation, no account, and no internet connection are required to use it.

---

## Run it

### Locally
Download `index.html` and open it in a browser. That's it — the tool is a single, self-contained
file with no build step and no dependencies.

### As a public web page (GitHub Pages)
1. Put `index.html` in the root of a **public** GitHub repository.
2. Go to **Settings → Pages**, set *Source* to **Deploy from a branch**, choose
   branch **main** and folder **/ (root)**, and **Save**.
3. After a minute, your tool is live at `https://<your-username>.github.io/<repo-name>/`.

### On lab acquisition machines
Save `index.html` locally on each acquisition computer and set it as the browser homepage (or add
a desktop shortcut) so it is the default first step before saving files.

---

## Adapt it for your lab or institution

The convention is meant to be customized. Everything lives in the single `index.html` file.

- **Institution list:** edit the `<option>` entries under the `institution` dropdown to add your
  own unit codes.
- **Fields:** add, remove, or relabel fields by editing the corresponding `.field` block and its
  matching entry in the `encode()` function.
- **Encoding rules:** the helper functions near the bottom (`sanitize`, `toSlug`, `initials`,
  `today`) control how each field is shortened and cleaned — adjust the character limits or casing
  there.
- **Pattern / order:** change the order of segments in both `update()` and `copyName()` to alter
  the final pattern.
- **Standards compatibility:** the field structure can be mapped to community standards such as
  [BIDS](https://bids.neuroimaging.io) so the generated names slot into an existing ecosystem.

---

## Notes

- **Privacy:** everything runs in your browser. Nothing you type is uploaded, logged, or stored —
  the only action the tool takes is copying text to your clipboard.
- **Fonts:** the page requests the *IBM Plex* web fonts for its look. If they are unavailable
  (e.g. offline, or when only `index.html` is uploaded), the layout falls back to your system's
  monospace and sans-serif fonts and remains fully functional. To guarantee the intended fonts
  online, replace the local stylesheet link with the Google Fonts link for IBM Plex Mono and Sans.
- **Scope:** file naming alone does not make data fully FAIR, but it is a low-effort first step
  that builds consistency in from the moment data are created, rather than retrofitting it later.

---

## License

Suggested: released under the **MIT License** — add a `LICENSE` file to allow others to freely
reuse and adapt the tool. Adjust to your institution's preference.

---

*Prototype developed in the context of the CAS in Research Data Stewardship, with a neuroscience
data-management focus (UNIGE Faculty of Medicine).*
