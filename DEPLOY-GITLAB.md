# Deploying FAIR File Namer at UNIGE — isolated, per‑lab repos

## 🔗 Live URLs (bookmark / share these)

Base = your gitlab.com **group** Pages host (example below uses a group called `facmed-filenamer`):

| Who | URL |
|-----|-----|
| **Everyone — Holtmaat** (one shared link) | `https://facmed-filenamer.gitlab.io/app/?cfg=/holtmaat/library.json` |
| **Other labs** | replace `holtmaat` with that lab's slug; add a row per lab |
| **Platform manager (e.g. bioimaging)** | `https://facmed-filenamer.gitlab.io/app/platform.html?platform=bioimaging` |

> **One link per lab.** Every lab member opens the same URL and can edit the library (operators, devices,
> templates). Saving/editing is local; **committing to GitLab is a master action** (gated by GitLab repo
> access, not by the app). A non‑master who makes changes uses **Publish…** to download `library.json` and
> sends it to a master with a note; the master commits it. A lab's library no longer needs an `&admin=1` link — every member sees **Manage**. (Platform *devices* are edited on their own page, `platform.html?platform=<slug>`; see **Part 2B**.)
>
> **Shared platform devices** (microscopy/genomics platforms etc.) appear as extra folders in **every**
> lab's *Manage devices* window. **Each platform has its own repo** so its manager edits only their own
> devices — they open the dedicated **`platform.html?platform=<slug>`** page (a device‑only editor, no lab UI).
> See **Part 2B**.

---

## Why this structure

- **UNIGE GitLab is Community Edition** → no Pages, no CI runners, **and no Code Owners / approval rules**
  ([eResearch docs](https://doc.eresearch.unige.ch/gitlab/start), [Code Owners = Premium](https://docs.gitlab.com/user/project/codeowners/)).
  So you can't grant "edit only this folder" inside one repo. The only way to let a lab change **only its
  library** and never the code is to put them in **separate repositories**.
- **gitlab.com** has Pages + runners. Putting all projects under **one gitlab.com group** (with "unique domain"
  turned off) makes them share one web host, so the app can read any lab's `library.json` with no CORS problem.

```
 gitlab.unige.ch (edit + permissions)                 gitlab.com group facmed-filenamer (serve)
   filenamer-app        ── mirror ─▶  app          →  https://facmed-filenamer.gitlab.io/app/
     (code; YOU only)
   filenamer-holtmaat   ── mirror ─▶  holtmaat     →  …/holtmaat/library.json
     (library.json; Holtmaat masters only)
   filenamer-lemaire    ── mirror ─▶  lemaire      →  …/lemaire/library.json
     (library.json; Lemaire masters only)
```

A lab master is a member of **only their `filenamer-<lab>` repo** → they edit/commit `library.json` and
**cannot see or touch the app code**. You alone own `filenamer-app`.

---

## Part 1 — One‑time setup (you only, ~30 min)

### 1A. gitlab.com — account, group, token

1. Sign up / sign in at <https://gitlab.com>. **Your username is `Ronan.Chereau`** — it's the part that goes
   before `@gitlab.com` in every mirror URL below.
2. **Create a group** (this becomes your Pages subdomain): top bar **＋ → New group → Create group**.
   - *Group name:* `facmed-filenamer`. **Check the Group URL field reads exactly `facmed-filenamer`** — that
     slug *is* your Pages address `https://facmed-filenamer.gitlab.io/`. (Plain `facmed` is already taken on
     gitlab.com, which is why it became `facmed1`.) If even `facmed-filenamer` shows a trailing number, it's taken
     too — pick another unique slug and then use **that exact slug** in every URL in this guide.
   - This is the **gitlab.com** group; in Part 1C you'll make a **gitlab.unige.ch** group with the **same name
     `facmed-filenamer`** — different servers, so no clash.
   - *Visibility level:* **Public** — required so the rigs can open the Pages site **with no login** (a project's
     Pages can be public only when the project is Public, and a project can't be more open than its group). The
     content isn't sensitive, so this is fine.
   - *Who will be using this group?* → My company or team. *What will you use this group for?* → pick anything (no effect).
   - **Invite members: leave EMPTY.** ⚠️ Group members get access to **every** project in the group — that would
     give a master the app code and all other labs. Add masters **per project** (Part 1D / Part 2), never here.
   - **Create group.**
3. **Create the access token** used by every mirror: avatar → **Edit profile** → left sidebar **Access →
   Access tokens** (`https://gitlab.com/-/user_settings/personal_access_tokens`) → **Generate token** dropdown →
   **Legacy token** → name `unige-mirror`, scope **`write_repository`** → **Generate token** → **copy it**.
4. First time a pipeline runs you may be asked to **validate your account with a credit/debit card** (identity
   only, no charge) so the shared runners build Pages. Do it when prompted.

### 1B. gitlab.com — create the empty target projects

These receive the mirrored content; **never edit them directly**. For **each** (`app` and your first lab,
e.g. `holtmaat`):

1. Go to <https://gitlab.com/projects/new> → **Create blank project**.
   - **Project name:** `app` (then later `holtmaat`, `lemaire`, …).
   - **Project URL:** set the **namespace** dropdown to your **group `facmed-filenamer`** (not your username).
   - **Visibility:** **Public** (so rigs read it with no login).
   - **Uncheck** "Initialize repository with a README".
   - **Create project.**
2. **Nothing else to configure here yet.** The project is empty, so there is **no `main` branch** (Protected
   branches shows "none" — correct) and **no Pages** (Deploy → Pages shows a "Get started" wizard — **ignore it**,
   don't pick a build image). Both `main` and the Pages settings appear only **after the first mirror push** (1C).

### 1C. gitlab.unige.ch — the app repo (code; only you)

> Everything on gitlab.unige.ch is **Private** — this side only stores/governs the source; gitlab.com serves
> the public site. (UNIGE projects are private by default.) As on gitlab.com, **don't add members at the group
> level** — add them per project, or a master would see every lab + the code.

1. Sign in at <https://gitlab.unige.ch/> (ISIs). **＋ → New group** → name `facmed-filenamer`,
   **Visibility = Private**, *Who will be using this group?* → My company/team, **Invite members: empty**.
2. Inside it, **New project → Create blank project** → name `filenamer-app`, **Visibility = Private**,
   **tick** "Initialize repository with a README".
3. Open the **Web IDE** (`.` key). Add:
   - `index.html`, `platform.html`, and `fair_file_namer_addon.js` — paste from this repo.
   - `_headers` — one-line cache-control file (see the **`_headers`** note just below).
   - `.gitlab-ci.yml` — the **app** job below.
   Commit to `main`.
4. **Settings → Repository → Mirroring repositories**: URL
   `https://Ronan.Chereau@gitlab.com/facmed-filenamer/app.git`, Direction **Push**,
   Authentication **Password** = the token from 1A. **Mirror repository** → **↻ Update now**.
   *(The "Username" box is greyed/locked — that's normal; the username goes in the URL as shown
   and the token goes in the Password field.)*
   This first sync **creates `main`** on the gitlab.com `app` project.
5. **(go to gitlab.com → `app`)** Now `main` exists and is auto‑protected. **Settings → Repository → Protected
   branches** → next to `main` set **Allowed to force push = On** (or **Unprotect**) so future syncs aren't
   rejected. *(If Update now already errored with "force push to a protected branch", do this and **↻ Update now** again.)*
6. **Members:** keep this UNIGE repo to **you/admins only**. (This is the code — nobody else gets in.)

`.gitlab-ci.yml` for **filenamer-app**:
```yaml
image: alpine:latest
pages:
  stage: deploy
  script:
    - mkdir -p public
    - cp index.html platform.html fair_file_namer_addon.js _headers public/
  artifacts:
    paths: [public]
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
```

> The `app` repo holds four files: `index.html` (the lab/user app), `platform.html` (the platform‑manager
> page), and `fair_file_namer_addon.js` (shared code), plus the one-line `_headers` cache file (below). All four are copied to `public/`.
>
> **The pipeline runs on gitlab.com, not on UNIGE.** gitlab.unige.ch (Community Edition) has **no CI
> runners**, so on the UNIGE side any repo carrying a `.gitlab-ci.yml` shows a **stuck/pending — or
> failed — `pages` job** ("you don't have any active runners"). That is expected and harmless: the push
> mirror copies the files to gitlab.com, where the runners actually build and publish Pages. This is why
> the live app works even though the UNIGE pipeline is red. To silence the noise, see **Troubleshooting**
> (turn CI/CD off on the UNIGE repo, or gate the job with `$CI_SERVER_HOST`).

**`_headers` — always serve the latest version.** Every repo also carries a one-line `_headers` file at its root:

```
/*
  Cache-Control: no-store
```

`/*` matches every path, and `Cache-Control: no-store` tells browsers and rig machines never to keep a cached
copy — so each visit fetches the current app code, library, and platform lists (it reinforces the app's own
cache-busting). GitLab Pages applies `_headers` **only from the published site root**, which is why every
`.gitlab-ci.yml` copies it into `public/` (the `cp … _headers public/` lines). Put the same `_headers` in
**every** repo — `app`, each lab, `platforms`, and each `plat-<slug>`.

### 1D. The first lab — a gitlab.com target + a gitlab.unige.ch repo (library only; lab masters)

1. **(go to gitlab.com)** Create the **mirror target**, exactly like the `app` one in 1B:
   **＋ → New project → Create blank project** → name **`holtmaat`**, namespace = group **`facmed-filenamer`**,
   **Public**, **uncheck** "Initialize with a README" → Create. Leave it empty.
2. **(go to gitlab.unige.ch)** In the `facmed-filenamer` group, **New project → Create blank project** → name
   `filenamer-holtmaat`, **Visibility = Private**, tick README.
3. **Web IDE** → add these files, commit to `main`:
   - `library.json` — paste a starting library (copy this repo's `library.json`). Set the lab's display
     `name` (e.g. `"Holtmaat Lab"`). *(No `publishUrl` needed — the app derives the master's one‑click edit
     link automatically from the lab slug in the page URL → `…/filenamer-<slug>/-/edit/main/library.json`.)*
   - `.gitlab-ci.yml` — the **lab** job below.
   - `_headers` — one-line cache-control file (copy this repo's; see the **`_headers`** note in 1C).
4. **Mirror** (same as 1C steps 4–5): Settings → Repository → Mirroring → push‑mirror to
   `https://Ronan.Chereau@gitlab.com/facmed-filenamer/holtmaat.git` → **↻ Update now**. Then on the gitlab.com
   `holtmaat` project set `main` to **Allowed to force push = On** (or Unprotect). *(Turning off "Use unique
   domain" happens in 1E, once the first Pages build has created that toggle.)*
5. **Members:** add the Holtmaat masters (2–3) as **Maintainer** (search by UNIGE email). They can now edit and
   commit their `library.json` — and nothing else.

`.gitlab-ci.yml` for **each lab repo** (publishes the file at the project root):
```yaml
image: alpine:latest
pages:
  stage: deploy
  script:
    - mkdir -p public
    - cp library.json _headers public/
  artifacts:
    paths: [public]
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
```

### 1E. Build, then turn off unique domains, then confirm

1. On gitlab.com, both `app` and `holtmaat` → **Build → Pipelines** show a green run (validate the card if asked, 1A‑4).
   This first build is what makes the Pages settings appear.
2. **Now turn off unique domains** (the toggle exists only after that first build): in **each** project →
   **Deploy → Pages** → turn **off "Use unique domain"** → Save. Both must then serve under the same host
   `facmed-filenamer.gitlab.io`. (A short re‑deploy follows.)
3. Open these directly — each must show its content, not 404:
   - `https://facmed-filenamer.gitlab.io/app/` (the tool)
   - `https://facmed-filenamer.gitlab.io/holtmaat/library.json` (the JSON)
4. Open the real app URL: `https://facmed-filenamer.gitlab.io/app/?cfg=/holtmaat/library.json` → it loads.

> **If a Pages URL redirects to a GitLab sign‑in page**, the Pages are private. Make them public:
> the **group** `facmed-filenamer` must be **Public** (a Private group forces Private projects), and each
> project (**Settings → General → Visibility, project features, permissions**) must have **Project visibility =
> Public** and **Pages = Everyone**. Set the group first, then the projects.

---

## Part 2 — Add a new lab (repeat per lab; ~5 min)

Everything is on **gitlab.unige.ch** plus two tiny **gitlab.com** clicks. Example: lab `lemaire`.

1. **(go to gitlab.com)** New project → Create blank project → name `lemaire`, namespace = group
   **`facmed-filenamer`**, **Visibility = Public** (required — rigs must read its Pages with no login),
   **uncheck** "Initialize repository with a README" → Create. Leave it empty — `main` and the Pages
   settings appear after the mirror push.
2. **(go to gitlab.unige.ch)** In `facmed-filenamer`, New project `filenamer-lemaire`, **Visibility = Private**
   (governance side — masters edit here), tick README → Web IDE → add
   `library.json` (copy Holtmaat's; change `name` to `"Lemaire Lab"` — the edit link is derived automatically,
   no `publishUrl` to set) and the same lab `.gitlab-ci.yml` → commit to `main`.
3. **(go to gitlab.unige.ch)** Settings → Repository → Mirroring → push‑mirror to
   `https://Ronan.Chereau@gitlab.com/facmed-filenamer/lemaire.git` (token as password) → **↻ Update now**.
4. **(go to gitlab.com → `lemaire`)** Now that the push created `main` and the first Pages build ran:
   **Settings → Repository → Protected branches** → `main` → **Allowed to force push = On** (or Unprotect);
   and **Deploy → Pages → turn off Use unique domain**.
5. **(go to gitlab.unige.ch)** **Manage → Members** → add the Lemaire **masters** as **Maintainer** (only they
   commit; regular members don't need GitLab accounts).
6. **(no GitLab)** Give the lab **one link** and add a row to the table at the top of this file:
   - `https://facmed-filenamer.gitlab.io/app/?cfg=/lemaire/library.json`

That's it — the lab is isolated to its own repo, the app is untouched.

---

## Part 2B — Shared platform devices (per‑manager isolation)

Core/shared platforms (imaging, genomics, …) own instruments that many labs use. They show up as extra tabs
("Imaging Platform", "Genomics Platform", …) in **every** lab's device picker, alongside that lab's own
devices, and behave identically (name → file name, info → metadata).

Because UNIGE GitLab can't restrict a person to part of one repo, **each platform gets its own repo** — exactly
like labs. That way a platform manager edits **only their own** devices, never another platform, any lab, or
the code. There are two pieces:

- **One list repo (you only):** `filenamer-platforms` → `platforms` → serves `/platforms/index.json`, a tiny
  manifest of which platforms exist. You add a line here when you add a platform.
- **One repo per platform (its manager):** `filenamer-plat-<slug>` → `plat-<slug>` → serves
  `/plat-<slug>/platform.json`, that platform's device list.

### 2B‑1. The list repo (one‑time, you only)

1. **(gitlab.com)** New project `platforms`, namespace = group **`facmed-filenamer`**, **Public**, no README → Create.
2. **(gitlab.unige.ch)** New project `filenamer-platforms`, **Private**, tick README → Web IDE → add:
   - `index.json` — copy this repo's starter `index.json` (a `{ slug, name }` per platform).
   - `_headers` — one-line cache-control file (copy this repo's; see the **`_headers`** note in 1C).
   - `.gitlab-ci.yml` — copies `index.json`:
     ```yaml
     image: alpine:latest
     pages:
       stage: deploy
       script:
         - mkdir -p public
         - cp index.json _headers public/
       artifacts:
         paths: [public]
       rules:
         - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
     ```
   Commit to `main`.
3. **(gitlab.unige.ch)** Mirror → push to `https://Ronan.Chereau@gitlab.com/facmed-filenamer/platforms.git` → **↻ Update now**.
4. **(gitlab.com → `platforms`)** `main` → **Allowed to force push = On**; **Deploy → Pages → turn off Use unique
   domain**. Confirm `https://facmed-filenamer.gitlab.io/platforms/index.json` serves the JSON. **Keep this repo to you only.**

### 2B‑2. Add a platform (repeat per platform; ~5 min). Example slug `imaging`

1. **(gitlab.unige.ch → `filenamer-platforms`)** edit `index.json` → add a line
   `{ "slug": "imaging", "name": "Imaging Platform" }` → commit → **↻ Update now** on its mirror.
   **Use a lowercase slug** (letters, digits, `-`/`_`): gitlab.com lowercases the project path and Pages
   URLs are case-sensitive, and the app builds the fetch URL from this slug — a capital letter makes the
   app request a path Pages never serves, so the platform loads with **no devices**.
2. **(gitlab.com)** New project `plat-imaging`, namespace = group **`facmed-filenamer`**, **Public**, no README → Create.
3. **(gitlab.unige.ch)** New project `filenamer-plat-imaging`, **Private**, tick README → Web IDE → add:
   - `platform.json` — copy this repo's starter `platform.json` (set `name` + a couple of devices; edit the rest in the app).
   - `_headers` — one-line cache-control file (copy this repo's; see the **`_headers`** note in 1C).
   - `.gitlab-ci.yml` — copies `platform.json` (same block as above, but `cp platform.json _headers public/`).
   Commit to `main`.
4. **(gitlab.unige.ch)** Mirror → push to `https://Ronan.Chereau@gitlab.com/facmed-filenamer/plat-imaging.git` → **↻ Update now**.
5. **(gitlab.com → `plat-imaging`)** `main` → **Allowed to force push = On**; **Deploy → Pages → turn off Use unique
   domain**. Confirm `https://facmed-filenamer.gitlab.io/plat-imaging/platform.json` serves the JSON.
   Open it in an **incognito** window to confirm it returns raw JSON with **no login**. If it redirects to a
   sign-in page, the project's Pages aren't public: Settings → General → **Visibility, project features,
   permissions** → **Project visibility = Public** and **Pages = Everyone** (match a working platform).
6. **(gitlab.unige.ch → `filenamer-plat-imaging`)** **Members** → add that platform's manager as **Maintainer**. They edit only this repo.
7. Give the manager their URL: `https://facmed-filenamer.gitlab.io/app/platform.html?platform=imaging`.

**Editing a platform's devices** (you, or its manager): open `…/app/platform.html?platform=<slug>` → this is a
**device‑only page** (no lab tabs) → add/rename/remove devices → **Publish…** → it downloads `platform.json`,
copies it, and gives a one‑click link to `filenamer-plat-<slug>` → **Edit/Replace** → **Commit to `main`**. Every
lab picks it up within minutes. *(The general app URL `…/app/?platform=<slug>&admin=1` opens the same editor if
you prefer.)*

> The app reads `/platforms/index.json` then each `/plat-<slug>/platform.json` automatically on the same Pages
> host — nothing to configure. (Override via `window.FNG_PLATFORMS_INDEX` in `index.html` only if hosted elsewhere.)

---

## Part 3 — Day‑to‑day

- **Any member:** opens the one bookmarked URL; loads instantly from cache, works offline, generates names, and
  can edit the library (operators, devices, templates) in **Manage**. No account needed to use or edit.
- **Editing → committing (one shared link, two roles by GitLab access):**
  1. Anyone edits in **Manage** (or in the **Manage devices** window), then clicks **Publish…** → it downloads
     `library.json` and copies it to the clipboard.
  2. **Not a master?** Send that `library.json` to a lab master with a note of what changed.
  3. **A master** (a Maintainer of the lab's GitLab repo) uses the dialog's one‑click **Open this lab's file in
     GitLab** link → **Edit** (or **Upload → Replace**) → paste → **Commit to `main`**.
  4. Push mirror → gitlab.com → Pages rebuild → every machine updates within minutes.
- **Platform manager:** opens `…/app/platform.html?platform=<slug>` (a device‑only page) → edits devices →
  **Publish…** → commits `platform.json` to their own `filenamer-plat-<slug>` repo. Their devices then appear
  as that platform's tab in every lab's picker. They never see another platform, any lab's library, or the code.

---

## Troubleshooting — problems we actually hit (and the fix)

Each row is a real symptom encountered during setup, with the cause and the exact fix.

| Symptom | Cause | Fix |
|---------|-------|-----|
| **Group URL became `facmed1`** instead of what you typed | The slug `facmed` was already taken on gitlab.com (a slug can't repeat globally) | Use a guaranteed‑unique slug — we settled on **`facmed-filenamer`**. Whatever the **Group URL field actually shows** is your real Pages host; use that exact slug in every URL. |
| **Can't find "Access tokens"; there's only "Personal access tokens"** and **no "Add new token" button** | gitlab.com renamed/relocated the control; Free has no project tokens | Use a **Personal Access Token**: avatar → Edit profile → **Access → Access tokens** → **Generate token** dropdown → **Legacy token**, scope `write_repository`. |
| **Mirror setup: "Username" box is greyed out**, can't pick "password only" | Push mirrors always take user + password; the user comes from the URL | Put the username in the URL (`https://Ronan.Chereau@gitlab.com/…`) and the **token in the Password** field. The locked Username box is normal. |
| **"Update now" → `not allowed to force push to a protected branch`** | After the first push, gitlab.com auto‑protects `main`; the next sync needs to overwrite it | On the **gitlab.com** target → Settings → Repository → **Protected branches** → `main` → **Allowed to force push = On** (or Unprotect), then **↻ Update now** again. You can't do this before the first push — an empty project has no `main` yet. |
| **There's no "Settings → Pages"** | Pages moved | It's under **Deploy → Pages**. |
| **No "Use unique domain" toggle** — only a "Get started with GitLab Pages" wizard | The toggle and real Pages settings appear **only after the first successful Pages build** | Let the first pipeline run (after the mirror push), then return to Deploy → Pages; the toggle is now there. Ignore the "Get started" wizard — don't pick a build image. |
| **Pages URL is `https://app-xxxx.facmed-filenamer.gitlab.io/`** (random subdomain) instead of `…/app/` | "Use unique domain" is **ON** for that project, so it doesn't share the group host | Deploy → Pages → turn **OFF** "Use unique domain" → Save. Must be off on **every** project so they share `facmed-filenamer.gitlab.io`. |
| **A Pages URL 404s or redirects to a GitLab sign‑in page** | The Pages (or project/group) are **Private** | Group `facmed-filenamer` = **Public**; each project Settings → General → **Project visibility = Public** and **Pages = Everyone**. Set the group first, then projects. |
| **`/app/` page is blank; `/app/fair_file_namer_addon.js` is empty — but the pipeline is green** | The **wrong content** is in the `filenamer-app` repo (e.g. a copy of a `library.json` instead of the code), so the build published the wrong files | The two repos hold different things: **`filenamer-app` = code** (`index.html` + `fair_file_namer_addon.js` + the **app** `.gitlab-ci.yml`, **no** `library.json`); **`filenamer-<lab>` = data** (`library.json` + the **lab** `.gitlab-ci.yml`, **no** code). Fix the repo's files, commit, **↻ Update now**. |
| **Edited the UNIGE repo but gitlab.com never changed** | A push mirror only syncs on a **new commit** or a **manual trigger** | After committing on gitlab.unige.ch, click **↻ Update now** on Settings → Repository → Mirroring. If the row shows red, hover it — usually the force‑push issue above. |
| **A multi‑parameter URL doesn't work** (e.g. `…/app/?cfg=…&platform=…`) | First query parameter must use `?`, the rest `&` | `?` first, `&` for each extra — e.g. `…/app/platform.html?platform=imaging`. The lab URL is just `…/app/?cfg=/<lab>/library.json` (no `&admin=1` anymore). |
| **`https://facmed-filenamer.gitlab.io/<lab>` (bare) is broken** | Lab repos are **data‑only** (no `index.html`), so the project root has no page — GitLab still auto‑generates that link | Expected, ignore it. Distribute `…/app/?cfg=/<lab>/library.json`. (Confirm data is live at `…/<lab>/library.json`.) |
| **"Everyone can edit — is that safe?"** | By design: the lab URL shows **Manage** to all members (no `&admin=1`). | Editing is local only; nothing reaches the rigs until a **master commits** to GitLab (gated by repo membership). Non‑masters **Publish → send the file to a master**. So edits are safe to make; only a master can publish them. |
| **`/app/…js` 404s and a pipeline named "Edit library.json" ran on the `app` project** | A lab repo had a **second, stray push mirror** pointing at `…/app.git`, so its `library.json` edits force‑overwrote the `app` project (deleting the code from the deploy) | A `library.json` edit must only ever build the matching **lab** project, never `app`. On the offending lab repo → Settings → Repository → Mirroring, **delete the row pointing to `…/app.git`** (keep only `…/<lab>.git`). Then **↻ Update now** on `filenamer-app` to restore the code. **Each UNIGE repo must have exactly ONE mirror, to its same‑named gitlab.com target.** |
| **A pipeline on gitlab.unige.ch is stuck/pending ("no active runners") or shows failed — yet the app works** | UNIGE GitLab (CE) has **no CI runners**, so it can never run the `pages` job. The real build runs on **gitlab.com** via the push mirror, which is why the live site is fine despite the red mark on UNIGE. | Harmless — you can ignore it. To silence it: **(A, simplest)** on the UNIGE repo → Settings → General → **Visibility, project features, permissions** → turn **CI/CD off** (this leaves the mirror and files untouched, so gitlab.com keeps building); or **(B)** append `&& $CI_SERVER_HOST == "gitlab.com"` to the job's `rules:` so the job is only created where a runner exists. Applies to **every** UNIGE repo with a `.gitlab-ci.yml` — app, labs, platforms, and companions like `safetransfer`. |
| **A platform appears in the picker but lists no devices** | The **slug's case doesn't match the Pages path.** gitlab.com **lowercases** project paths and Pages URLs are **case-sensitive**, but the app builds the fetch URL straight from the `index.json` slug. So slug `neuroimaging_Wyss` makes the app request `/plat-neuroimaging_Wyss/platform.json`, while Pages only serves the lowercase `/plat-neuroimaging_wyss/…` → 404 → empty list. | Make the slug **all-lowercase** in `platforms/index.json` so it matches the real path (e.g. `neuroimaging_wyss`); the display `name` can keep any capitalization. Use lowercase slugs from the start. |
| **A platform still lists no devices, and opening its `platform.json` redirects to a GitLab sign-in page** | That `plat-<slug>` project's **Pages aren't public**, so the app's anonymous fetch is bounced to login and gets HTML instead of JSON. (You may still see the JSON yourself, because *you* are logged in.) | On the gitlab.com `plat-<slug>` project → Settings → General → **Visibility, project features, permissions** → **Project visibility = Public** and **Pages = Everyone** (match a working platform). Confirm in an **incognito** window that `…/plat-<slug>/platform.json` returns raw JSON. |
| **A machine still shows an old version after a change went live** | Browser/CDN caching of the Pages files | Every repo ships a `_headers` file (`/*` → `Cache-Control: no-store`) that its `.gitlab-ci.yml` copies into `public/`, so Pages tells clients not to cache. Check the repo has `_headers` **and** that its CI copies it (`cp … _headers public/`). A single hard refresh clears a page that was cached before `_headers` existed. |

---

## Caveats & maintenance (you only)

- **Exactly one push mirror per repo, to its same‑named target** — `filenamer-app`→`app`, `filenamer-holtmaat`→`holtmaat`, `filenamer-platforms`→`platforms`, `filenamer-plat-imaging`→`plat-imaging`, … never cross‑wired. A stray second mirror to `…/app.git` on a lab repo will silently clobber the app (see Troubleshooting). ~2 min each; reuse the same gitlab.com token. The token expires
  (~1 year) — when it does, regenerate on gitlab.com and update every mirror's password (calendar reminder).
- **"Use unique domain" must stay OFF** on every gitlab.com project, or they stop sharing the host and the app
  can't read the libraries.
- Each gitlab.com target needs `main` **unprotected / force‑push allowed** (Part 1B‑3 / 2‑1).
- **gitlab.com Pages is public** → libraries are world‑readable by URL. Fine for naming conventions; not secrets.
- gitlab.com Free has a monthly CI‑minute quota; these "copy a file" builds use seconds.
- **Push mirroring must be enabled** on UNIGE (Free supports it; if an admin disabled outbound mirroring, ask DiSTIC).
- **UNIGE pipelines will look red — that's normal.** UNIGE CE has no runners, so its `pages` job can only sit pending or fail; the live site is built entirely by **gitlab.com**. Leave them, or turn **CI/CD off** on the UNIGE repos (see Troubleshooting). Never treat a green pipeline on UNIGE as the source of truth — check the **gitlab.com** pipeline instead.
- **Platform slugs must be lowercase.** gitlab.com lowercases project paths and Pages URLs are case-sensitive, so each `index.json` slug must equal the lowercased `plat-<slug>` path, or the platform loads with no devices. Set slugs lowercase when you create them (the display `name` can be anything).
- **`_headers` keeps machines current.** Every repo includes `_headers` (`/*` → `Cache-Control: no-store`), copied into `public/` by its CI, so GitLab Pages tells clients never to cache — a committed change reaches every machine on its next load. When you add a repo, include `_headers` and keep the `cp … _headers public/` step.

---

*Sources: [UNIGE eResearch GitLab](https://doc.eresearch.unige.ch/gitlab/start) (CE: no Pages/runners),
[GitLab Code Owners = Premium](https://docs.gitlab.com/user/project/codeowners/),
[Push mirroring (Free)](https://docs.gitlab.com/user/project/repository/mirror/push/).*
