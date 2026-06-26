/* ============================================================================
 * FAIR File Namer  —  eLabNext add-on (v3: simple, list-driven, lab-scoped)
 * ----------------------------------------------------------------------------
 * Design goals for this version (per lab feedback):
 *   - DEAD SIMPLE screens. Building a template = drag small field tiles around;
 *     a live example updates underneath. No per-field configuration panels.
 *   - Fields are NOT freely configurable. They come from managed lists:
 *       * Department  -> fixed list, set once in code (DEPARTMENTS below).
 *       * Operator    -> list of names maintained by the master user.
 *       * Project / Sample -> free text typed by the user.
 *       * Date        -> automatic.
 *     The master user can add EXTRA custom fields via one button.
 *   - Templates are scoped to a LAB. Pick a lab -> only its templates show.
 *   - Metadata is just a free-text notes box the user fills in.
 *
 * Roles:
 *   - Master user (can manage): sees the "Manage" tab — labs, operators,
 *     custom fields and templates.
 *   - Everyone else: sees only "Use".
 *
 * Storage: the whole library is one JSON string in the GROUP-scoped add-on
 * configuration field `templateLibrary`
 * (https://developer.elabnext.com/docs/add-on-configuration). Master edits it
 * here and Export → pastes into Configure; the group then shares it.
 * Degrades to localStorage when no eLabSDK is present (standalone / side-load).
 * ========================================================================== */

(function () {
  'use strict';

  var ADDON = {
    rootVar: 'FNG_SIDELOAD', name: 'FAIR File Namer', version: '3.0.0',
    category: 'Data', type: 'fairFileNamer', label: 'FAIR File Namer'
  };
  var LS_KEY = 'fng.library.v3';
  var LS_DEVICE = 'fng.machine.defaultDevice';   // per-machine (per-browser) default device
  var LS_FAV = 'fng.machine.favDevices';         // per-machine list of favorite device names
  var LS_DEPT = 'fng.machine.lastDept';          // per-machine last-selected department
  var LS_OPER = 'fng.machine.lastOperator';      // per-machine last-selected operator
  var LS_DOCFONT = 'fng.doc.font';               // per-machine metadata display font
  var LS_DOCSIZE = 'fng.doc.size';               // per-machine metadata display size
  var LS_HIST = 'fng.recentNames';               // per-machine recent file names
  var LS_PLATFORMS = 'fng.platforms.cache';      // shared faculty-wide platform devices (cached)
  var LS_STORAGE = 'fng.machine.storageStatus';  // per-machine raw-data storage status
  var LS_STORAGE_DATE = 'fng.machine.storageDate';
  var LS_SHOWPATH = 'fng.machine.showLiteralPath'; // opt-in: record unverified absolute path
  var LS_ANALYTICS = 'fng.analytics.queue';      // buffered usage-event pings (flushed to endpoint)
  var LS_FSROOT = 'fng.machine.dataFolder';      // per-machine label of the chosen File System Access data folder
  var LS_FSPATH = 'fng.machine.dataFolderPath';  // per-machine absolute path of that folder (the browser cannot read it from the picker)

  // Display options for the rendered metadata document.
  var FONTS = { sans: 'IBM Plex Sans, system-ui, -apple-system, Segoe UI, sans-serif', serif: 'Georgia, "Times New Roman", serif', mono: 'ui-monospace, Menlo, Consolas, monospace' };
  var SIZES = { s: '12px', m: '14px', l: '16px', xl: '18px' };

  /* ----- FIXED department list (edit here once for your faculty). ---------- */
  var DEPARTMENTS = [
    { code: 'NEUFO', label: 'Basic Neurosciences' },
    { code: 'PATIM', label: 'Pathology & Immunology' },
    { code: 'MIMOL', label: 'Microbiology and Molecular Medicine' },
    { code: 'PHYM',  label: 'Cell Physiology & Metabolism' },
    { code: 'GEDEV', label: 'Genetic Medicine and Development' }
  ];

  var SEG = ['#7eb8f7', '#b57bff', '#f7c948', '#f09860', '#4af0a0', '#f07080', '#72d0e8', '#c8a0ff'];

  /* ==========================================================================
   * DATA MODEL
   *   library = {
   *     version:3,
   *     operators:[ "Marie Curie", ... ],          // master-maintained
   *     fields:[ field, ... ],                       // catalog (builtin+custom)
   *     labs:[ { id, name, fileTemplates:[tpl], folderTemplates:[tpl] } ]
   *   }
   *   field = { id, name, source:'department'|'operator'|'freetext'|'date'|'list',
   *             options?:[..], format?, builtin? }
   *   tpl   = { id, name, default, separator, fieldIds:[ id, ... ] }
   * ======================================================================== */
  function builtinFields() {
    return [
      { id: 'f-lab',  name: 'Lab',        source: 'lab',        builtin: true },
      { id: 'f-dept', name: 'Department', source: 'department', builtin: true },
      { id: 'f-oper', name: 'Operator',   source: 'operator',   builtin: true },
      { id: 'f-dev',  name: 'Device',     source: 'device',     builtin: true },
      { id: 'f-proj', name: 'Project',    source: 'freetext',   builtin: true },
      { id: 'f-samp', name: 'Sample',     source: 'freetext',   builtin: true },
      { id: 'f-cond', name: 'Condition',  source: 'freetext',   builtin: true },
      { id: 'f-run',  name: 'Run',        source: 'counter', pad: 2, scope: 'daily', builtin: true },
      { id: 'f-date', name: 'Date',       source: 'date', format: 'YYYYMMDD', builtin: true }
    ];
  }
  function defaultLibrary() {
    return {
      version: 3,
      operators: ['Marie Curie', 'Jean Dupont'],
      devices: [
        { id: 'dev1', name: '2P-B',      info: { Microscope: 'Two-photon', Software: 'ScanImage', Version: '2023.1', Laser: 'MaiTai DeepSee' } },
        { id: 'dev2', name: 'Confocal1', info: { Microscope: 'Confocal', Software: 'ZEN', Version: '3.5' } }
      ],
      fields: builtinFields(),
      labs: [{
        id: 'lab-demo', name: 'Demo Lab',
        fileTemplates: [{
          id: 'tpl1', name: 'Acquisition', default: true, separator: '_',
          fieldIds: ['f-lab', 'f-dept', 'f-oper', 'f-dev', 'f-proj', 'f-samp', 'f-cond', 'f-date']
        }],
        folderTemplates: [{
          id: 'fld1', name: 'Project tree', default: true, separator: '/',
          fieldIds: ['f-proj', 'f-samp']
        }]
      }]
    };
  }

  /* ==========================================================================
   * ENCODING ENGINE (pure)
   * ======================================================================== */
  function pad(n, w) { var s = String(n); while (s.length < w) s = '0' + s; return s; }
  // fold diacritics so accented names survive (é→e, ü→u, ç→c) instead of being dropped
  function foldAccents(s) { try { return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, ''); } catch (e) { return String(s == null ? '' : s); } }
  function sanitizeVal(s) { return foldAccents(s).replace(/[^A-Za-z0-9\-]/g, ''); }
  function fmtDate(d, f) {
    var Y = d.getFullYear(), M = pad(d.getMonth() + 1, 2), D = pad(d.getDate(), 2),
        h = pad(d.getHours(), 2), m = pad(d.getMinutes(), 2), s = pad(d.getSeconds(), 2);
    switch (f) {
      case 'YYYY-MM-DD':       return Y + '-' + M + '-' + D;
      case 'YYMMDD':           return String(Y).slice(2) + M + D;
      case 'YYYYMM':           return '' + Y + M;
      case 'YYYY':             return '' + Y;
      case 'HHMM':             return h + m;
      case 'HHMMSS':           return h + m + s;
      case 'HH:MM':            return h + ':' + m;
      case 'YYYYMMDD_HHMM':    return '' + Y + M + D + '_' + h + m;
      case 'YYYYMMDD_HHMMSS':  return '' + Y + M + D + '_' + h + m + s;
      case 'YYYY-MM-DD_HH-MM': return Y + '-' + M + '-' + D + '_' + h + '-' + m;
      case 'YYYYMMDD':
      default:                 return '' + Y + M + D;
    }
  }
  // How a value-bearing field is abbreviated INTO the file name. The full value
  // is always kept in the metadata header regardless of this choice.
  function applyFmt(s, fmt) {
    s = foldAccents(s);
    switch (fmt) {
      case 'initial': { var c = s.replace(/[^A-Za-z0-9]/g, '').charAt(0); return c ? c.toUpperCase() : ''; }
      case 'acronym':
      case 'initials': {
        var p = s.trim().split(/\s+/).filter(Boolean);
        if (!p.length) return '';
        return p.map(function (w) { return (w.match(/[A-Za-z0-9]/) || [''])[0]; }).join('').toUpperCase();
      }
      case 'first3': return sanitizeVal(s).slice(0, 3).toUpperCase();
      case 'lastlower': { var w = s.trim().split(/\s+/).filter(Boolean); return w.length ? sanitizeVal(w[w.length - 1]).toLowerCase() : ''; }
      case 'upper':  return sanitizeVal(s).toUpperCase();
      case 'lower':  return sanitizeVal(s).toLowerCase();
      case 'full':
      default:       return sanitizeVal(s);
    }
  }
  // normalise a path to forward slashes (readable on any OS); keep a leading // (UNC), trim trailing /
  function normPath(p) { return String(p == null ? '' : p).trim().replace(/\\/g, '/').replace(/\/+$/, ''); }
  // ---- auto-incrementing counter (per machine, in localStorage) ----------
  function counterKey(field, ctx) {
    var k = 'fng.counter.' + field.id + '.' + ((ctx && ctx.tplId) || '');
    if ((field.scope || 'daily') === 'daily') k += '.' + fmtDate((ctx && ctx.now) || new Date(), 'YYYYMMDD');
    return k;
  }
  function counterRead(field, ctx) { try { return parseInt(localStorage.getItem(counterKey(field, ctx)) || '0', 10) || 0; } catch (e) { return 0; } }
  function counterNext(field, ctx) { return counterRead(field, ctx) + 1; }   // the value shown / used
  function counterBump(field, ctx) { try { localStorage.setItem(counterKey(field, ctx), String(counterRead(field, ctx) + 1)); } catch (e) {} }

  function opName(o) { return typeof o === 'string' ? o : ((o && o.name) || ''); }
  // entity = operator or lab { name, initials?, first3? }; the manager may edit
  // the initials / first-3 directly to disambiguate, otherwise they're computed.
  function abbrIni(e) { return (e && e.initials != null && String(e.initials) !== '') ? sanitizeVal(e.initials) : applyFmt(opName(e), 'acronym'); }
  function abbrF3(e)  { return (e && e.first3   != null && String(e.first3)   !== '') ? sanitizeVal(e.first3)   : applyFmt(opName(e), 'first3'); }
  function encodeField(field, values, ctx) {
    if (!field) return '';
    if (field.source === 'date') return fmtDate((ctx && ctx.now) || new Date(), field.format || 'YYYYMMDD');
    if (field.source === 'counter') return pad(counterNext(field, ctx), field.pad || 2);
    if (field.source === 'operator') {
      var nm = values[field.id] || '', fmt = field.format || 'full', op = operatorByName(nm);
      if (fmt === 'acronym' || fmt === 'initials') return op ? abbrIni(op) : applyFmt(nm, 'acronym');
      if (fmt === 'first3') return op ? abbrF3(op) : applyFmt(nm, 'first3');
      return applyFmt(nm, fmt);
    }
    if (field.source === 'lab') {
      var lab = ctx && ctx.lab; if (!lab) return '';
      var lf = field.format || 'full';
      if (lf === 'acronym' || lf === 'initials') return abbrIni(lab);
      if (lf === 'first3') return abbrF3(lab);
      return applyFmt(lab.name, lf);
    }
    return applyFmt(values[field.id], field.format);
  }
  function fieldById(lib, id) { return (lib.fields || []).filter(function (f) { return f.id === id; })[0]; }
  // Case-insensitive, natural (numeric-aware) name compare for alphabetical display
  // ordering of operators and devices, e.g. "Rig2" before "Rig10".
  function cmpName(a, b) { return String(a == null ? '' : a).localeCompare(String(b == null ? '' : b), undefined, { sensitivity: 'base', numeric: true }); }
  function operatorByName(name) { var ops = (ROOT.library && ROOT.library.operators) || []; for (var i = 0; i < ops.length; i++) { if (opName(ops[i]) === name) return ops[i]; } return null; }
  function countMap(arr) { var m = {}; (arr || []).forEach(function (v) { v = String(v == null ? '' : v); if (v) m[v] = (m[v] || 0) + 1; }); return m; }
  function anyDup(arr) { var m = countMap(arr); for (var k in m) { if (m[k] > 1) return true; } return false; }
  // duplicate full name / initials / first-3 among operators OR labs, or duplicate device name
  function hasCollisions() {
    var L = ROOT.library; if (!L) return false;
    var groups = [L.operators || [], L.labs || []];
    for (var g = 0; g < groups.length; g++) {
      var arr = groups[g];
      if (anyDup(arr.map(function (e) { return applyFmt(opName(e), 'full'); }))) return true;
      if (anyDup(arr.map(abbrIni)) || anyDup(arr.map(abbrF3))) return true;
    }
    if (anyDup((L.devices || []).map(function (d) { return d.name; }))) return true;
    return false;
  }
  function buildName(tpl, lib, values, ctx) {
    if (!tpl) return '';
    var sep = tpl.separator || '_';
    return (tpl.fieldIds || [])
      .map(function (id) { return encodeField(fieldById(lib, id), values || {}, ctx); })
      .filter(function (s) { return s !== '' && s != null; })
      .join(sep);
  }
  // fields in a template that the USER must fill (everything except auto date/counter)
  function inputFields(tpl, lib) {
    return (tpl ? tpl.fieldIds : []).map(function (id) { return fieldById(lib, id); })
      .filter(function (f) { return f && f.source !== 'date' && f.source !== 'counter' && f.source !== 'lab'; });
  }
  function isAuto(f) { return f && (f.source === 'date' || f.source === 'counter' || f.source === 'lab'); }

  /* ==========================================================================
   * STORE
   * ======================================================================== */
  var ROOT = window.FNG_SIDELOAD || {};
  window.FNG_SIDELOAD = ROOT;

  function parseLib(s) { if (!s) return null; if (typeof s === 'object') return s; try { return JSON.parse(s); } catch (e) { return null; } }
  function normalize(lib) {
    lib = lib || {};
    lib.version = 3;
    // operators are objects { name, initials?, first3? } — convert legacy strings / id
    lib.operators = (lib.operators || []).map(function (o) {
      if (typeof o === 'string') return { name: o };
      o = o || { name: '' };
      if (o.id && o.initials == null) { o.initials = o.id; delete o.id; }   // migrate old single override
      return o;
    });
    lib.devices = lib.devices || [];
    lib.fields = (lib.fields && lib.fields.length) ? lib.fields : builtinFields();
    // make sure the builtin fields always exist
    builtinFields().forEach(function (b) { if (!fieldById(lib, b.id)) lib.fields.unshift(b); });
    lib.labs = lib.labs || [];
    lib.labs.forEach(function (l) {
      l.fileTemplates = l.fileTemplates || [];
      l.folderTemplates = l.folderTemplates || [];
    });
    return lib;
  }
  // Which shared library this machine reads — lets ONE hosted app serve many labs:
  //   ?cfg=<url>      explicit path/URL to a lab's library.json
  //   ?lib=<key>      shorthand for ./libs/<key>.json
  //   window.FNG_LIBRARY_URL  set in the page; else ./library.json (per-lab folder)
  function resolveLibUrl() {
    try {
      var q = (typeof location !== 'undefined' && location.search) || '';
      var c = q.match(/[?&]cfg=([^&]+)/); if (c) return decodeURIComponent(c[1]);
      var l = q.match(/[?&]lib=([^&]+)/); if (l) return 'libs/' + decodeURIComponent(l[1]) + '.json';
    } catch (e) {}
    return (typeof window !== 'undefined' && window.FNG_LIBRARY_URL) || './library.json';
  }
  // cache per lab URL so one browser used for different labs never mixes their configs
  function libCacheKey() {
    if (typeof window !== 'undefined' && window.eLabSDK) return LS_KEY;
    return LS_KEY + '::' + resolveLibUrl();
  }
  function loadLibrary(cfg) {
    var lib = (cfg && cfg.templateLibrary) ? parseLib(cfg.templateLibrary) : null;
    if (!lib) { try { lib = parseLib(localStorage.getItem(libCacheKey())); } catch (e) {} }
    if (!lib) lib = defaultLibrary();
    return normalize(lib);
  }
  /* Background sync for the HTML-only (hosted) deployment: the page loads
   * instantly from the cached copy, then quietly checks the shared library.json.
   * It never blocks startup and works offline. A newer library is cached for the
   * next launch, and applied immediately only if it won't disrupt the user. */
  function syncSharedLibrary() {
    if (typeof fetch !== 'function') return;
    var base = resolveLibUrl();
    var url = base + (base.indexOf('?') >= 0 ? '&' : '?') + 't=' + Date.now();
    fetch(url, { cache: 'no-store' })
      .then(function (r) { return r && r.ok ? r.text() : null; })
      .then(function (txt) {
        var lib = txt && parseLib(txt); if (!lib) return;
        lib = normalize(lib);
        var fresh = JSON.stringify(lib);
        if (fresh === JSON.stringify(ROOT.library)) return;          // already up to date
        try { localStorage.setItem(libCacheKey(), fresh); } catch (e) {}    // cache for next launch
        // "Busy" = the user is actually working (editing in Manage, or has touched a field).
        // Auto-filled defaults (machine device, last operator) do NOT count, so a freshly
        // opened or re-shown page always takes the newest library without a second reload.
        var busy = (ROOT.ui.mode === 'manage') || !!ROOT.ui.touched;
        if (!busy) { ROOT.library = lib; ROOT._savedSnapshot = fresh; rerender(); toast('Lab templates updated.'); }
        else { toast('Updated lab templates downloaded — they apply next time you reload.'); }
      })
      .catch(function () { /* offline / file:// — keep the cached copy */ });
  }
  function saveLibrary() {
    var json = JSON.stringify(ROOT.library);
    try { localStorage.setItem(libCacheKey(), json); } catch (e) {}
    // optional direct config write (fails soft; Export→Configure is the reliable path)
    try {
      if (window.eLabSDK && eLabSDK.Plugin && typeof eLabSDK.Plugin.setConfiguration === 'function') {
        eLabSDK.Plugin.setConfiguration({ scope: 'GROUP', configuration: { templateLibrary: json } });
      }
    } catch (e) {}
    return json;
  }

  /* ==========================================================================
   * SHARED PLATFORM DEVICES — one repo per platform, for true per-manager isolation
   *   index : /platforms/index.json     = { version:1, platforms:[ { slug, name } ] }   (you maintain)
   *   each  : /plat-<slug>/platform.json = { version:1, name, devices:[ {id,name,info} ] }
   *   Every lab MERGES all platform files into its device picker (extra tabs). A platform
   *   manager edits ONLY their own plat-<slug> repo, opened via ?platform=<slug>&admin=1.
   *   Served from the same Pages host as the app (app at /app/), so paths are origin-relative.
   * ======================================================================== */
  function plOrigin() {
    return (typeof location !== 'undefined' && location.origin && /^https?:/.test(location.protocol)) ? location.origin : '';
  }
  function platformsIndexUrl() {
    if (typeof window !== 'undefined' && window.FNG_PLATFORMS_INDEX) return window.FNG_PLATFORMS_INDEX;
    var o = plOrigin(); return o ? o + '/platforms/index.json' : '';
  }
  function platformFileUrl(slug) {
    if (typeof window !== 'undefined' && window.FNG_PLATFORM_BASE) return window.FNG_PLATFORM_BASE.replace(/\/+$/, '') + '/plat-' + slug + '/platform.json';
    var o = plOrigin(); return o ? o + '/plat-' + slug + '/platform.json' : '';
  }
  function normalizeIndex(o) {
    var arr = (o && o.platforms) ? o.platforms : (Array.isArray(o) ? o : []);
    return (arr || []).map(function (p) {
      if (typeof p === 'string') return { slug: p, name: p };
      p = p || {}; return { slug: p.slug || p.id || '', name: p.name || p.slug || p.id || 'Platform' };
    }).filter(function (p) { return p.slug; });
  }
  function normalizePlatformFile(o, slug, name) {
    o = o || {};
    return { id: slug, name: o.name || name || slug,
      devices: (o.devices || []).map(function (d) { d = d || {}; return { id: d.id || uid('dev'), name: d.name || '', info: d.info || {} }; }) };
  }
  function loadPlatformsCache() {
    try { var s = localStorage.getItem(LS_PLATFORMS); if (s) { var a = JSON.parse(s); if (Array.isArray(a)) return a; if (a && a.platforms) return a.platforms; } } catch (e) {}
    return [];
  }
  // CONSUMPTION: fetch the index, then every platform file, and merge into ROOT.platforms.
  function syncSharedPlatforms() {
    if (typeof fetch !== 'function') return;
    var idx = platformsIndexUrl(); if (!idx) return;
    fetch(idx + (idx.indexOf('?') >= 0 ? '&' : '?') + 't=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r && r.ok ? r.text() : null; })
      .then(function (txt) {
        if (!txt) return null; var list; try { list = normalizeIndex(JSON.parse(txt)); } catch (e) { return null; }
        return Promise.all(list.map(function (p) {
          var u = platformFileUrl(p.slug); if (!u) return normalizePlatformFile({}, p.slug, p.name);
          return fetch(u + (u.indexOf('?') >= 0 ? '&' : '?') + 't=' + Date.now(), { cache: 'no-store' })
            .then(function (r) { return r && r.ok ? r.text() : null; })
            .then(function (t) { var o = null; if (t) { try { o = JSON.parse(t); } catch (e) {} } return normalizePlatformFile(o || {}, p.slug, p.name); })
            .catch(function () { return normalizePlatformFile({}, p.slug, p.name); });
        }));
      })
      .then(function (arr) {
        if (!arr) return; arr = arr.filter(Boolean);
        var fresh = JSON.stringify(arr);
        if (fresh === JSON.stringify(ROOT.platforms || [])) return;
        try { localStorage.setItem(LS_PLATFORMS, fresh); } catch (e) {}
        ROOT.platforms = arr; rerender();
      })
      .catch(function () { /* offline / not deployed — keep cache */ });
  }
  // Device groups for the picker: lab devices first, then each platform that has devices.
  function deviceGroups() {
    var groups = [{ id: '__lab', name: 'Lab devices', devices: (ROOT.library && ROOT.library.devices) || [] }];
    (ROOT.platforms || []).forEach(function (p) { if (p.devices && p.devices.length) groups.push({ id: p.id, name: p.name, devices: p.devices }); });
    return groups;
  }
  function findDeviceByName(name) {
    if (!name) return null;
    var found = null;
    deviceGroups().forEach(function (g) { (g.devices || []).forEach(function (d) { if (!found && d.name === name) found = d; }); });
    return found;
  }
  function groupOfDevice(name) {
    var gid = '__lab';
    deviceGroups().forEach(function (g) { (g.devices || []).forEach(function (d) { if (d.name === name) gid = g.id; }); });
    return gid;
  }

  /* ==========================================================================
   * UI HELPERS
   * ======================================================================== */
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function uid(p) { return (p || 'x') + Math.random().toString(36).slice(2, 7); }
  function R() { return ADDON.rootVar; }

  function css() {
    return '<style>'
      + '.fng{font-family:inherit;color:#cdd5e3;--ac:#4af0a0;--bd:#222838;--pn:#171b26;--sf:#10131b;--dim:#79839c;line-height:1.5;}'
      + '.fng *{box-sizing:border-box;}'
      + '.fng h3{font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--dim);margin:18px 0 8px;font-weight:600;}'
      + '.fng .lead{font-size:12px;color:var(--dim);margin:2px 0 10px;}'
      + '.fng-tabs{display:flex;gap:4px;border-bottom:1px solid var(--bd);margin-bottom:16px;}'
      + '.fng-tab{background:none;border:none;color:var(--dim);font-size:12px;padding:8px 12px;cursor:pointer;border-bottom:2px solid transparent;}'
      + '.fng-tab.on{color:var(--ac);border-bottom-color:var(--ac);}'
      + '.fng-row{display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;}'
      + '.fng-f{display:flex;flex-direction:column;gap:4px;}'
      + '.fng-l{font-size:10px;letter-spacing:.05em;text-transform:uppercase;color:var(--dim);}'
      + '.fng-l.req:after{content:" *";color:var(--ac);}'
      + '.fng-in,.fng-sel,.fng-ta{background:var(--pn);border:1px solid var(--bd);border-radius:6px;color:#eaf0fa;font-size:13px;padding:7px 9px;outline:none;font-family:inherit;}'
      + '.fng-in:focus,.fng-sel:focus,.fng-ta:focus{border-color:var(--ac);}'
      + '.fng-ta{width:100%;min-height:58px;resize:vertical;}'
      + '.fng-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;}'
      + '.fng-fillrow{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;}'
      + '.fng-fillrow>.fng-f{flex:1 1 110px;min-width:0;}'
      + '.fng-fillrow>.fng-f.fng-narrow{flex:0 1 130px;}'
      + '.fng-fillrow .fng-sel,.fng-fillrow .fng-in,.fng-fillrow .fng-f>div{width:100%;}'
      + '.fng-devwrap{display:flex;gap:6px;align-items:center;}'
      + '.fng-devwrap .fng-sel{flex:1;width:auto;}'
      + '.fng-star{flex:none;background:transparent;border:1px solid var(--bd);border-radius:6px;color:var(--dim);cursor:pointer;font-size:18px;line-height:1;padding:5px 10px;}'
      + '.fng-star:hover{border-color:var(--ac);color:var(--ac);}'
      + '.fng-star.on{color:var(--ac);border-color:var(--ac);}'
      + '.fng-devwrap .fng-star{font-size:22px;padding:3px 11px;}'
      + '.fng-mtiles{display:flex;gap:14px;margin-top:16px;align-items:stretch;}'
      + '@media (max-width:640px){.fng-mtiles{flex-direction:column;}}'
      + '.fng-mtile{flex:1 1 0;min-width:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:10px;border:1px solid transparent;border-radius:16px;padding:26px 16px;cursor:pointer;transition:background .15s,border-color .15s,transform .1s,box-shadow .15s;}'
      + '.fng-mtile:hover{transform:translateY(-2px);}'
      + '.fng-mtile-i{font-size:34px;line-height:1;filter:drop-shadow(0 2px 6px rgba(0,0,0,.35));}'
      + '.fng-mtile-t{font-size:15px;font-weight:600;color:#eef3fb;}'
      + '.fng-mtile.t-build{background:linear-gradient(140deg,rgba(74,240,160,.22),rgba(74,240,160,.04));border-color:rgba(74,240,160,.35);}'
      + '.fng-mtile.t-build:hover{background:linear-gradient(140deg,rgba(74,240,160,.34),rgba(74,240,160,.08));border-color:rgba(74,240,160,.7);box-shadow:0 8px 22px rgba(74,240,160,.12);}'
      + '.fng-mtile.t-dev{background:linear-gradient(140deg,rgba(126,184,247,.22),rgba(126,184,247,.04));border-color:rgba(126,184,247,.35);}'
      + '.fng-mtile.t-dev:hover{background:linear-gradient(140deg,rgba(126,184,247,.34),rgba(126,184,247,.08));border-color:rgba(126,184,247,.7);box-shadow:0 8px 22px rgba(126,184,247,.12);}'
      + '.fng-mtile.t-labs{background:linear-gradient(140deg,rgba(199,146,234,.22),rgba(199,146,234,.04));border-color:rgba(199,146,234,.35);}'
      + '.fng-mtile.t-labs:hover{background:linear-gradient(140deg,rgba(199,146,234,.34),rgba(199,146,234,.08));border-color:rgba(199,146,234,.7);box-shadow:0 8px 22px rgba(199,146,234,.12);}'
      + '.fng-modal-card.fng-bigcard{width:92vw;max-width:900px;}'
      + '.fng-modal-card.fng-rvcard{width:94vw;max-width:1000px;}'
      + '.fng-save{margin-top:12px;padding:10px 12px;border:1px solid var(--bd);border-radius:10px;background:rgba(255,255,255,.02);}'
      + '.fng-save-cur{font-size:12.5px;color:#dbe3f0;}'
      + '.fng-fslist{margin:4px 0 0;padding-left:18px;font-size:12.5px;color:#dbe3f0;}'
      + '.fng-fslist li{margin:2px 0;}'
      + '.fng-rv{display:flex;gap:14px;align-items:flex-start;}'
      + '.fng-rv-nav{flex:none;width:172px;display:flex;flex-direction:column;gap:6px;}'
      + '.fng-rv-navb{display:flex;justify-content:space-between;align-items:center;gap:8px;background:var(--pn);border:1px solid var(--bd);border-radius:8px;color:#cdd6e6;padding:9px 11px;cursor:pointer;font-size:13px;text-align:left;}'
      + '.fng-rv-navb.on{border-color:var(--ac);color:#fff;background:rgba(74,240,160,.08);}'
      + '.fng-rv-count{flex:none;background:rgba(255,255,255,.1);border-radius:10px;padding:1px 8px;font-size:11px;}'
      + '.fng-rv-body{flex:1;min-width:0;max-height:60vh;overflow:auto;display:flex;flex-direction:column;gap:10px;}'
      + '.fng-rv-bar{display:flex;gap:8px;}'
      + '.fng-rv-card{border:1px solid var(--bd);border-radius:10px;padding:10px 12px;border-left:3px solid var(--bd);}'
      + '.fng-rv-card.s-added{border-left-color:#4af0a0;}'
      + '.fng-rv-card.s-removed{border-left-color:#f0604a;}'
      + '.fng-rv-card.s-changed{border-left-color:#e0b341;}'
      + '.fng-rv-card.rej{opacity:.45;}'
      + '.fng-rv-top{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}'
      + '.fng-rv-badge{flex:none;font-size:11px;font-weight:700;border-radius:5px;padding:2px 7px;}'
      + '.fng-rv-badge.b-added{background:rgba(74,240,160,.16);color:#4af0a0;}'
      + '.fng-rv-badge.b-removed{background:rgba(240,96,74,.16);color:#f0815a;}'
      + '.fng-rv-badge.b-changed{background:rgba(224,179,65,.16);color:#e0b341;}'
      + '.fng-rv-label{flex:1;min-width:120px;font-weight:600;color:#eaf0fa;}'
      + '.fng-rv-dec{flex:none;display:flex;gap:6px;}'
      + '.fng-rv-sides{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px;}'
      + '.fng-rv-card.s-added .fng-rv-sides,.fng-rv-card.s-removed .fng-rv-sides{grid-template-columns:1fr;}'
      + '.fng-rv-side{background:rgba(255,255,255,.02);border:1px solid var(--bd);border-radius:8px;padding:8px 10px;}'
      + '.fng-rv-sh{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--dim);margin-bottom:6px;}'
      + '.fng-rv-prop{display:flex;gap:8px;padding:3px 0;font-size:12.5px;align-items:baseline;}'
      + '.fng-rv-prop.chg{background:rgba(224,179,65,.1);border-radius:4px;}'
      + '.fng-rv-k{flex:none;width:92px;color:var(--dim);}'
      + '.fng-rv-v{color:#dbe3f0;word-break:break-word;}'
      + '.fng-rv-prop .fng-in,.fng-rv-prop .fng-sel,.fng-rv-prop .fng-ta{flex:1;min-width:0;}'
      + '.fng-rv-empty{color:var(--dim);font-style:italic;font-size:12.5px;}'
      + '@media (max-width:640px){.fng-rv{flex-direction:column;}.fng-rv-nav{width:100%;flex-direction:row;flex-wrap:wrap;}.fng-rv-sides{grid-template-columns:1fr;}}'
      + '.fng-devpick{display:flex;flex-direction:column;gap:6px;}'
      + '.fng-devtabs{display:flex;flex-wrap:wrap;gap:4px;}'
      + '.fng-devtab{background:var(--pn);border:1px solid var(--bd);border-radius:6px;color:var(--dim);font-size:11px;padding:5px 10px;cursor:pointer;}'
      + '.fng-devtab:hover{border-color:var(--ac);color:var(--ac);}'
      + '.fng-devtab.on{color:var(--ac);border-color:var(--ac);background:rgba(74,240,160,.08);}'
      + '.fng-devrow{display:flex;gap:6px;align-items:flex-start;}'
      + '.fng-devlist{flex:1;display:flex;flex-wrap:wrap;gap:6px;align-items:center;min-height:34px;}'
      + '.fng-devopt{background:var(--pn);border:1px solid var(--bd);border-radius:6px;color:#eaf0fa;font-size:12px;padding:6px 11px;cursor:pointer;}'
      + '.fng-devopt:hover{border-color:var(--ac);}'
      + '.fng-devopt.on{border-color:var(--ac);color:var(--ac);background:rgba(74,240,160,.12);}'
      + '.fng-devbtn{width:100%;text-align:left;padding:7px 9px;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}'
      + '.fng-ph{color:#5b647d;font-style:italic;}'
      + '.fng-doccopy{position:absolute;top:8px;right:8px;z-index:2;}'
      + '.fng-elab{position:absolute;top:42px;right:8px;z-index:2;display:inline-flex;align-items:center;gap:6px;background:#007782;border:1px solid rgba(255,255,255,.18);border-radius:7px;padding:4px 8px 4px 6px;text-decoration:none;box-shadow:0 2px 8px rgba(0,0,0,.32);transition:transform .1s,box-shadow .15s,filter .15s;}'
      + '.fng-elab:hover{transform:translateY(-1px);box-shadow:0 5px 14px rgba(0,0,0,.42);filter:brightness(1.08);}'
      + '.fng-elab img{height:22px;display:block;}'
      + '.fng-elab-go{color:#fff;font-size:15px;line-height:1;font-weight:700;}'
      + '.fng-modal-card.fng-dmcard{width:92vw;max-width:880px;height:min(80vh,640px);display:flex;flex-direction:column;overflow:hidden;}'
      + '.fng-dmcard .fng-dmbody{flex:1 1 auto;min-height:0;align-items:stretch;overflow:hidden;}'
      + '.fng-dmcard .fng-dmleft{max-height:none;min-height:0;}'
      + '.fng-dmcard .fng-dmmid{max-height:none;min-height:0;}'
      + '.fng-warn{background:rgba(247,201,72,.08);border:1px solid #6b5a1f;border-left:3px solid #f7c948;border-radius:6px;color:#e7d9a8;font-size:12.5px;line-height:1.55;padding:9px 12px;margin:0 0 16px;}'
      + '.fng-warn b{color:#f7c948;}'
      + '.fng-dmbody{display:flex;gap:12px;align-items:flex-start;flex-wrap:nowrap;}'
      + '.fng-dmleft{flex:0 0 180px;border:1px solid var(--bd);border-radius:8px;padding:8px;max-height:62vh;overflow:auto;}'
      + '.fng-dmmid{flex:1 1 0;min-width:0;max-height:62vh;overflow:auto;}'
      + '.fng-dmright{flex:1 1 0;min-width:0;max-height:62vh;overflow:auto;}'
      + '.fng-tree{display:flex;flex-direction:column;gap:2px;}'
      + '.fng-treefolder{text-align:left;background:transparent;border:none;color:#cdd5e3;font-size:13px;font-weight:600;padding:6px 8px;cursor:pointer;border-radius:6px;}'
      + '.fng-treefolder.sub{font-weight:500;font-size:12px;color:#aab4cc;}'
      + '.fng-treefolder:hover{background:var(--pn);}'
      + '.fng-treekids{display:flex;flex-direction:column;gap:2px;margin-left:10px;border-left:1px solid var(--bd);padding-left:6px;}'
      + '.fng-treeitem{text-align:left;background:transparent;border:none;color:#aab4cc;font-size:12px;padding:5px 8px;cursor:pointer;border-radius:6px;}'
      + '.fng-treeitem:hover{background:var(--pn);color:#eaf0fa;}'
      + '.fng-treeitem.on{background:rgba(74,240,160,.12);color:var(--ac);}'
      + '.fng-treeadd{text-align:left;background:transparent;border:none;color:var(--dim);font-size:11px;padding:5px 8px;cursor:pointer;}'
      + '.fng-treeadd:hover{color:var(--ac);}'
      + '.fng-favrow{display:flex;align-items:center;gap:2px;border-radius:6px;}'
      + '.fng-favrow.on{background:rgba(74,240,160,.12);}'
      + '.fng-favname{flex:1;text-align:left;background:transparent;border:none;color:#aab4cc;font-size:12px;padding:5px 8px;cursor:pointer;border-radius:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}'
      + '.fng-favname:hover{color:#eaf0fa;}'
      + '.fng-favrow.on .fng-favname{color:var(--ac);}'
      + '.fng-favstar{background:transparent;border:none;color:#f0c419;font-size:13px;line-height:1;cursor:pointer;padding:4px 7px;border-radius:6px;}'
      + '.fng-favstar:hover{background:var(--pn);}'
      + '.fng-devpickgrid{display:flex;gap:10px;flex-wrap:wrap;}'
      + '.fng-pickcard{flex:1 1 200px;display:flex;flex-direction:column;gap:4px;align-items:flex-start;background:var(--pn);border:1px solid var(--bd);border-radius:8px;color:#eaf0fa;font-size:14px;padding:14px;cursor:pointer;text-align:left;}'
      + '.fng-pickcard:hover{border-color:var(--ac);}'
      + '.fng-pickcard .fng-muted{font-size:11px;}'
      + '.fng-devpicklist{display:flex;flex-direction:column;gap:6px;max-height:340px;overflow:auto;margin-top:4px;}'
      + '.fng-pickrow{text-align:left;background:var(--pn);border:1px solid var(--bd);border-radius:6px;color:#eaf0fa;font-size:13px;padding:9px 12px;cursor:pointer;}'
      + '.fng-pickrow:hover{border-color:var(--ac);}'
      + '.fng-pickrow.on{border-color:var(--ac);color:var(--ac);background:rgba(74,240,160,.12);}'
      + '.fng-btn{background:transparent;border:1px solid var(--bd);border-radius:6px;color:#aab4cc;font-size:12px;padding:7px 12px;cursor:pointer;}'
      + '.fng-btn:hover{border-color:var(--ac);color:var(--ac);}'
      + '.fng-btn.pri{border-color:var(--ac);color:var(--ac);}'
      + '.fng-btn.sm{padding:4px 9px;font-size:11px;}'
      + '.fng-btn:disabled,.fng-btn.saved{opacity:.45;cursor:default;border-color:var(--bd);color:var(--dim);}'
      + '.fng-acts{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px;}'
      // example/preview box
      + '.fng-ex{background:var(--sf);border:1px solid var(--ac);border-radius:8px;padding:12px 14px;margin-top:12px;}'
      + '.fng-ex .h{font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--ac);margin-bottom:6px;}'
      + '.fng-name{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:16px;color:#fff;word-break:break-all;min-height:20px;}'
      + '.fng-name .sep{color:#465}'
      + '.fng-namerow{display:flex;align-items:flex-start;gap:10px;}'
      + '.fng-namerow .fng-name{flex:1;min-width:0;}'
      + '.fng-copy{flex:none;background:transparent;border:1px solid var(--bd);border-radius:6px;color:var(--dim);cursor:pointer;padding:5px 7px;line-height:0;}'
      + '.fng-copy:hover{border-color:var(--ac);color:var(--ac);}'
      + '.fng-path{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;color:#9fb0cf;margin-top:7px;word-break:break-all;}'
      + '.fng-pathrow{display:flex;align-items:center;gap:8px;margin-top:7px;}'
      + '.fng-pathrow .fng-path{flex:1;min-width:0;margin-top:0;}'
      // tiles
      + '.fng-tiles{display:flex;flex-wrap:wrap;gap:7px;min-height:38px;padding:8px;border:1px dashed var(--bd);border-radius:8px;background:rgba(255,255,255,.012);}'
      + '.fng-tile{display:inline-flex;align-items:center;gap:7px;background:var(--pn);border:1px solid var(--bd);border-radius:7px;padding:6px 9px;font-size:12px;color:#eaf0fa;cursor:grab;user-select:none;}'
      + '.fng-tile .dot{width:7px;height:7px;border-radius:2px;flex:none;}'
      + '.fng-tile{transition:background .1s ease,border-color .1s ease;}'
      + '.fng-tile.dragging{opacity:.4;border-style:dashed;border-color:var(--ac);}'
      + '.fng-tile .rm{border:none;background:none;color:var(--dim);cursor:pointer;font-size:13px;padding:0;line-height:1;}'
      + '.fng-tile .rm:hover{color:#f07080;}'
      + '.fng-avail .fng-tile{cursor:pointer;border-style:dashed;color:#aab4cc;}'
      + '.fng-avail .fng-tile:hover{border-color:var(--ac);color:var(--ac);}'
      + '.fng-mini{display:flex;flex-wrap:wrap;gap:6px;align-items:center;}'
      + '.fng-chiprm{display:inline-flex;align-items:center;gap:6px;background:var(--pn);border:1px solid var(--bd);border-radius:14px;padding:4px 6px 4px 11px;font-size:12px;}'
      + '.fng-chiprm button{border:none;background:none;color:var(--dim);cursor:pointer;}'
      + '.fng-chiprm button:hover{color:#f07080;}'
      + '.fng-card{border:1px solid var(--bd);border-radius:8px;padding:12px;margin-top:8px;background:rgba(255,255,255,.012);}'
      + '.fng-adv summary{cursor:pointer;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--dim);margin-top:18px;}'
      + '.fng-adv[open] summary{color:var(--ac);}'
      + '.fng-muted{color:var(--dim);font-size:12px;}'
      + '.fng-sep{width:46px;text-align:center;}'
      + '.fng-auto{font-size:9px;letter-spacing:.05em;color:#0d0f12;background:var(--ac);border-radius:3px;padding:1px 5px;text-transform:none;}'
      + '.fng-ro{background:var(--sf);border:1px dashed var(--bd);border-radius:6px;color:#9fb0cf;font-size:13px;padding:7px 9px;}'
      + '.fng-hint{margin-top:5px;font-size:11px;}'
      + '.fng-x2{color:var(--dim);cursor:pointer;text-decoration:underline;}'
      + '.fng-x2:hover{color:#f07080;}'
      // rendered metadata document + toolbar
      + '.fng-toolbar{display:flex;align-items:center;gap:6px;flex-wrap:wrap;background:var(--pn);border:1px solid var(--bd);border-bottom:none;border-radius:8px 8px 0 0;padding:6px 8px;}'
      + '.fng-tsel{background:var(--sf);border:1px solid var(--bd);border-radius:5px;color:#eaf0fa;font-size:12px;padding:3px 6px;}'
      + '.fng-tb{background:var(--sf);border:1px solid var(--bd);border-radius:5px;color:#cdd5e3;font-size:12px;min-width:28px;padding:3px 7px;cursor:pointer;}'
      + '.fng-tb:hover{border-color:var(--ac);color:var(--ac);}'
      + '.fng-tdiv{width:1px;align-self:stretch;background:var(--bd);margin:0 3px;}'
      + '.fng-doc{background:var(--sf);border:1px solid var(--bd);border-radius:0 0 8px 8px;padding:14px 16px;line-height:1.6;}'
      + '.fng-doc-h{font-size:1.15em;color:var(--ac);margin:0 0 8px;letter-spacing:0;text-transform:none;}'
      + '.fng-doc code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.92em;color:#ffd9a0;word-break:break-all;}'
      + '.fng-doc-t{border-collapse:collapse;width:100%;margin:4px 0;}'
      + '.fng-doc-t th,.fng-doc-t td{border:1px solid var(--bd);padding:4px 9px;text-align:left;}'
      + '.fng-doc-t th{color:var(--dim);font-weight:600;font-size:.85em;text-transform:uppercase;letter-spacing:.04em;}'
      + '.fng-doc-hr{border:none;border-top:1px solid var(--bd);margin:14px 0;}'
      + '.fng-notes-edit{min-height:90px;outline:none;}'
      + '.fng-notes-edit:focus{box-shadow:inset 0 0 0 1px var(--ac);border-radius:5px;}'
      + '.fng-notes-edit:empty:before{content:attr(data-ph);color:var(--dim);}'
      + '.fng-notes-edit ul{margin:4px 0 4px 18px;}'
      // field-attribute popup
      + '.fng-modal{position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:9999;}'
      + '.fng-modal-card{background:var(--pn);border:1px solid var(--bd);border-radius:10px;padding:18px;width:min(440px,92vw);max-height:85vh;overflow:auto;box-shadow:0 12px 40px rgba(0,0,0,.5);}'
      + '.fng-modal-h{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;}'
      + '.fng-modal-x{background:none;border:none;color:var(--dim);font-size:16px;cursor:pointer;}'
      + '.fng-modal-x:hover{color:#f07080;}'
      // required / validation / copy feedback / recent
      + '.fng-l.req:after{content:" *";color:var(--ac);}'
      + '.fng-fillrow input:invalid,.fng-fillrow select:invalid{border-color:#e0533a;background:rgba(224,83,58,.07);}'
      + '.fng-devempty{border-color:#e0533a !important;}'
      + '.fng-copy.ok{border-color:var(--ac);color:var(--ac);}'
      + '.fng-recent{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:3px 0;}'
      + '.fng-recent code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;color:#ffd9a0;word-break:break-all;}'
      + '.fng-bang{color:#f0604a;font-weight:700;}'
      + '.fng-dupcell{color:#f0604a;}'
      + '.fng-dupin{border-color:#f0604a !important;}'
      + '</style>';
  }
  function dot(i) { return '<span class="dot" style="background:' + SEG[i % SEG.length] + '"></span>'; }

  /* ==========================================================================
   * STATE
   * ======================================================================== */
  ROOT.ui = { mode: 'use', labId: null, tplId: null, values: {}, notesHtml: '', dateOverride: '',
    docFont: (function () { try { return localStorage.getItem(LS_DOCFONT) || 'sans'; } catch (e) { return 'sans'; } })(),
    docSize: (function () { try { return localStorage.getItem(LS_DOCSIZE) || 'm'; } catch (e) { return 'm'; } })() };
  ROOT.build = { labId: null, kind: 'file', tplId: null };
  ROOT.newField = { name: '', type: 'freetext', optionsCsv: '', format: 'YYYYMMDD' };
  ROOT.fieldDlg = { fieldId: null };   // which field's attribute popup is open

  /* Values resolved from the ELN context once integrated (operator, department,
   * lab, project). Populated in getContent(); empty when running standalone.
   * These prefill — and lock — the matching fields so the user doesn't retype them. */
  ROOT.elnAutofill = {};

  function machineDevice() { try { return localStorage.getItem(LS_DEVICE) || ''; } catch (e) { return ''; } }
  // Favorite devices: a per-machine list of device names, shown at the top of the
  // device browser for quick switching on PCs that drive several instruments.
  function favDevices() { try { var a = JSON.parse(localStorage.getItem(LS_FAV) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
  function favSet(a) { try { localStorage.setItem(LS_FAV, JSON.stringify(a)); } catch (e) {} }
  function isFav(name) { return favDevices().indexOf(name) !== -1; }
  function addFav(name) { if (!name) return; var a = favDevices(); if (a.indexOf(name) === -1) { a.push(name); favSet(a); } }
  function removeFav(name) { favSet(favDevices().filter(function (n) { return n !== name; })); }
  function machineDept() { try { return localStorage.getItem(LS_DEPT) || ''; } catch (e) { return ''; } }
  function machineOperator() { try { return localStorage.getItem(LS_OPER) || ''; } catch (e) { return ''; } }

  // The value the ELN context provides for a field (null = user fills it manually).
  function elnAutoValueFor(f) {
    var a = ROOT.elnAutofill || {};
    if (f.source === 'operator')   return a.operator   || null;
    if (f.source === 'department') return a.department || null;
    if (f.id === 'f-proj')         return a.project    || null;
    return null;
  }

  // Prefill empty fields from the machine default device + the ELN context.
  // Only fills values that are still undefined, so it never overrides the user.
  function applyDefaults(lab, tpl) {
    inputFields(tpl, ROOT.library).forEach(function (f) {
      if (ROOT.ui.values[f.id] !== undefined) return;
      var av = elnAutoValueFor(f);
      if (av) { ROOT.ui.values[f.id] = av; return; }   // ELN context wins when present
      if (f.source === 'device') {
        var md = machineDevice();
        if (md && findDeviceByName(md)) { ROOT.ui.values[f.id] = md; if (ROOT.ui.devGroup == null) ROOT.ui.devGroup = groupOfDevice(md); }
      } else if (f.source === 'department') {
        if (lab && lab.dept) ROOT.ui.values[f.id] = lab.dept;   // bound to the selected lab
        else { var dd = machineDept(); if (dd && DEPARTMENTS.some(function (x) { return x.code === dd; })) ROOT.ui.values[f.id] = dd; }
      } else if (f.source === 'operator') {
        var oo = machineOperator();
        if (oo && (ROOT.library.operators || []).some(function (op) { return opName(op) === oo; })) ROOT.ui.values[f.id] = oo;
      }
    });
  }

  // date used for the Date field — current time, or an overridden acquisition date (keeping time)
  function nowDate() {
    if (!ROOT.ui.dateOverride) return new Date();
    var p = String(ROOT.ui.dateOverride).split('-'), d = new Date();
    if (p.length === 3) return new Date(+p[0], +p[1] - 1, +p[2], d.getHours(), d.getMinutes(), d.getSeconds());
    return new Date();
  }
  ROOT.setDateOverride = function (v) { ROOT.ui.touched = true; ROOT.ui.dateOverride = v || ''; refreshUsePreview(); refreshHeader(); };

  function labs() { return ROOT.library.labs; }
  function labById(id) { return labs().filter(function (l) { return l.id === id; })[0]; }
  function tplsOf(lab, kind) { return kind === 'folder' ? lab.folderTemplates : lab.fileTemplates; }
  function defaultTpl(list) { return list.filter(function (t) { return t.default; })[0] || list[0] || null; }

  /* ==========================================================================
   * USE MODE
   * ======================================================================== */
  function useLab() { return labById(ROOT.ui.labId) || labs()[0] || null; }
  function useFileTpl(lab) {
    var list = lab.fileTemplates;
    return list.filter(function (t) { return t.id === ROOT.ui.tplId; })[0] || defaultTpl(list);
  }

  function renderUse() {
    var L = ROOT.library;
    if (!labs().length) return '<p class="fng-muted">No labs configured yet. Ask your ELN master user to set up the templates.</p>';
    var lab = useLab(); ROOT.ui.labId = lab.id;
    var tpl = useFileTpl(lab); if (tpl) ROOT.ui.tplId = tpl.id;

    var labSel = '<div class="fng-f"><span class="fng-l">Lab</span><select class="fng-sel" onchange="' + R() + '.useLab(this.value)">'
      + labs().map(function (l) { return '<option value="' + esc(l.id) + '"' + (l.id === lab.id ? ' selected' : '') + '>' + esc(l.name) + '</option>'; }).join('')
      + '</select></div>';

    if (!tpl) return '<div class="fng-row">' + labSel + '</div><p class="fng-muted" style="margin-top:12px">This lab has no templates yet.</p>';

    var tplSel = '<div class="fng-f"><span class="fng-l">Template</span><select class="fng-sel" onchange="' + R() + '.useTpl(this.value)">'
      + lab.fileTemplates.map(function (t) { return '<option value="' + esc(t.id) + '"' + (t.id === tpl.id ? ' selected' : '') + '>' + esc(t.name) + '</option>'; }).join('')
      + '</select></div>';

    applyDefaults(lab, tpl);
    var inputs = inputFields(tpl, L).map(function (f) {
      var v = ROOT.ui.values[f.id] || '';
      // fields the ELN fills automatically are shown locked
      var autoVal = elnAutoValueFor(f);
      if (autoVal) {
        return '<div class="fng-f"><span class="fng-l">' + esc(f.name) + ' <span class="fng-auto">auto · ELN</span></span>'
          + '<div class="fng-ro">' + esc(autoVal) + '</div></div>';
      }
      var ctrl, extra = '';
      if (f.source === 'department') {
        if (lab && lab.dept) {   // bound to the lab → shown locked
          var dlab = DEPARTMENTS.filter(function (d) { return d.code === lab.dept; })[0];
          return '<div class="fng-f fng-narrow"><span class="fng-l">' + esc(f.name) + ' <span class="fng-auto">auto · lab</span></span>'
            + '<div class="fng-ro">' + esc(lab.dept) + (dlab ? ' — ' + esc(dlab.label) : '') + '</div></div>';
        }
        ctrl = '<select class="fng-sel" required onchange="' + R() + '.setVal(\'' + f.id + '\',this.value)"><option value="">— select —</option>'
          + DEPARTMENTS.map(function (d) { return '<option value="' + esc(d.code) + '"' + (d.code === v ? ' selected' : '') + '>' + esc(d.code) + ' — ' + esc(d.label) + '</option>'; }).join('') + '</select>';
      } else if (f.source === 'operator') {
        ctrl = '<select class="fng-sel" required onchange="' + R() + '.setVal(\'' + f.id + '\',this.value)"><option value="">— select —</option>'
          + (L.operators || []).slice().sort(function (a, b) { return cmpName(opName(a), opName(b)); }).map(function (o) { var n = opName(o); return '<option value="' + esc(n) + '"' + (n === v ? ' selected' : '') + '>' + esc(n) + '</option>'; }).join('') + '</select>';
      } else if (f.source === 'device') {
        // Opens a read-only device browser to choose a device; the gear opens the
        // user's own configurations for the chosen operator + device.
        ctrl = '<div class="fng-devwrap">'
          + '<button type="button" class="fng-btn fng-devbtn' + (v ? ' pri' : ' fng-devempty') + '" style="flex:1" title="Browse and choose a device" onclick="' + R() + '.openDevManager()">'
          + (v ? esc(v) : 'Choose device ▾') + '</button>'
          + '<button type="button" class="fng-btn fng-star" title="User configurations for this operator + device" onclick="' + R() + '.openConfigMgr()">⚙</button>'
          + '</div>';
      } else if (f.source === 'list') {
        ctrl = '<select class="fng-sel" required onchange="' + R() + '.setVal(\'' + f.id + '\',this.value)"><option value="">— select —</option>'
          + (f.options || []).map(function (o) { return '<option value="' + esc(o) + '"' + (o === v ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') + '</select>';
      } else {
        var dl = 'fng-dl-' + f.id, hist = fieldHistory(f.id).slice(0, 5);
        ctrl = '<input class="fng-in" required list="' + dl + '" value="' + esc(v) + '" spellcheck="false" oninput="' + R() + '.setVal(\'' + f.id + '\',this.value)">'
          + '<datalist id="' + dl + '">' + hist.map(function (x) { return '<option value="' + esc(x) + '"></option>'; }).join('') + '</datalist>';
      }
      var lblcls = 'fng-l' + (f.required ? ' req' : '');
      var fcls = 'fng-f' + (f.source === 'department' ? ' fng-narrow' : '');
      return '<div class="' + fcls + '"><span class="' + lblcls + '">' + esc(f.name) + '</span>'
        + '<div>' + ctrl + '</div>' + extra + '</div>';
    }).join('') || '<p class="fng-muted">This template is fully automatic — nothing to fill in.</p>';

    var hasDate = (tpl.fieldIds || []).some(function (id) { var f = fieldById(L, id); return f && f.source === 'date'; });
    var hasCounter = (tpl.fieldIds || []).some(function (id) { var f = fieldById(L, id); return f && f.source === 'counter'; });
    var dateCtl = hasDate ? '<div class="fng-f"><span class="fng-l">Acquisition date</span>'
      + '<input class="fng-in" type="date" value="' + esc(ROOT.ui.dateOverride || fmtDate(new Date(), 'YYYY-MM-DD')) + '" title="Defaults to today — pick another if needed" onchange="' + R() + '.setDateOverride(this.value)"></div>' : '';

    return '<div class="fng-row">' + labSel + tplSel + dateCtl + '</div>'
      + '<h3>Fill in</h3><div class="fng-fillrow">' + inputs + '</div>'
      + usePreview()
      + '<h3>Metadata &amp; notes</h3>'
      + '<p class="lead">The header is built automatically from the file name and updates live. Type your notes below it; use the toolbar to format.</p>'
      + renderMetaDoc()
      + '<div class="fng-acts">'
      + (hasCounter ? '<button class="fng-btn pri" onclick="' + R() + '.nextRun()">Next run ▸</button>' : '')
      + '<button class="fng-btn" onclick="' + R() + '.copyPath()">Copy path</button>'
      + '<button class="fng-btn" onclick="' + R() + '.copyMarkdown()">Copy metadata (Markdown)</button>'
      + '<button class="fng-btn" onclick="' + R() + '.downloadMarkdown()">Download .md</button>'
      + '<button class="fng-btn" onclick="' + R() + '.downloadSidecar()">Download .json</button>'
      + '<button class="fng-btn" onclick="' + R() + '.recordToSection()">Record in experiment</button>'
      + '<button class="fng-btn" onclick="' + R() + '.resetForm()">Reset</button>'
      + '</div>'
      + recentBlock() + decodeBlock() + missModal();
  }

  /* --- Manage devices window (file-explorer) -----------------------------
   * Left: a tree with two folders — Lab devices and Platform devices (→ each
   * platform → its devices). Right: the selected device's description (editable
   * for lab devices, read-only for platform devices), a "Use for file name"
   * action, and the user's local configs for that (operator + device). */
  function labDeviceById(id) { return ((ROOT.library && ROOT.library.devices) || []).filter(function (x) { return x.id === id; })[0]; }
  function persistLib() { try { saveLibrary(); } catch (e) {} dirty(); }

  function devmgrConfigPanel() {
    var dev = pickedDeviceName(); if (!dev) return '';
    var op = currentOperator();
    if (!op) return '<div class="fng-card" style="margin-top:10px"><h3 style="margin-top:0">My configurations</h3>'
      + '<p class="fng-muted">Select your <b>operator</b> on the main screen to create configurations for this device (saved on this machine).</p></div>';
    var list = odConfigs(op, dev), actId = activeConfigId(op, dev);
    var active = list.filter(function (c) { return c.id === actId; })[0];
    var sel = '<select class="fng-sel" onchange="' + R() + '.selectConfig(this.value)"><option value="">— none —</option>'
      + list.map(function (c) { return '<option value="' + esc(c.id) + '"' + (c.id === actId ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('') + '</select>';
    var editor = active
      ? '<div class="fng-f" style="margin-top:8px"><span class="fng-l">Settings — one "Key: value" per line (saved on this machine; added to the metadata when this device is in use)</span>'
        + '<textarea class="fng-ta" style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px" oninput="' + R() + '.editConfig(this.value)">' + esc(active.text || '') + '</textarea></div>'
      : '<p class="fng-muted" style="margin-top:6px">No configuration selected — create one with <b>New</b>.</p>';
    return '<div class="fng-card" style="margin-top:10px"><h3 style="margin-top:0">My configurations <span class="fng-muted" style="text-transform:none;letter-spacing:0">· ' + esc(op) + ' · this machine</span></h3>'
      + '<div class="fng-row" style="align-items:flex-end"><div class="fng-f" style="flex:1;max-width:280px"><span class="fng-l">Saved configurations</span>' + sel + '</div>'
      + '<button class="fng-btn sm" onclick="' + R() + '.newConfig()">+ New</button>'
      + (active ? '<button class="fng-btn sm" onclick="' + R() + '.renameConfig()">Rename</button><button class="fng-btn sm" onclick="' + R() + '.deleteConfig()">Delete</button>' : '')
      + '</div>' + editor + '</div>';
  }
  // MIDDLE panel: the device description (editable for lab, read-only for platform).
  function devmgrMiddle() {
    var dm = ROOT.ui.devmgr, p = dm && dm.pick;
    if (!p) return '<div class="fng-dmmid"><p class="fng-muted">Select a device on the left to view or edit it.</p></div>';
    var inUse = (p.name === currentDeviceName());
    var useBtn = inUse
      ? '<button class="fng-btn saved" disabled title="This is the default device for this machine">Default device ✓</button>'
      : '<button class="fng-btn" onclick="' + R() + '.devmgrUse()">Set as default device for this machine</button>';
    var fav = isFav(p.name);
    var favBtn = '<button class="fng-btn' + (fav ? ' saved' : '') + '" title="' + (fav ? 'Click to remove from favorites' : 'Add to your favorite devices on this machine') + '" onclick="' + R() + '.devmgrFav()">' + (fav ? '★ Favorite' : '☆ Set as favorite') + '</button>';
    var selectBtn = dm.edit ? '' : '<button class="fng-btn pri" title="Use this device for the current file name (does not change the machine default)" onclick="' + R() + '.devmgrSelect()">Select</button>';
    var head = '<div class="fng-row" style="justify-content:space-between;align-items:center;gap:8px"><h3 style="margin:0">' + esc(p.name) + '</h3><div class="fng-row" style="gap:6px;align-items:center">' + selectBtn + useBtn + favBtn + '</div></div>';
    var desc;
    if (p.scope === 'lab') {
      var d = labDeviceById(p.id) || { name: p.name, info: {} };
      if (!dm.edit) {
        var roRows = Object.keys(d.info || {}).map(function (k) { return '<tr><td>' + esc(k) + '</td><td>' + esc(d.info[k]) + '</td></tr>'; }).join('');
        desc = '<div class="fng-card" style="margin-top:10px"><h3 style="margin-top:0">Description <span class="fng-muted" style="text-transform:none;letter-spacing:0">· lab device · read-only</span></h3>'
          + (roRows ? '<table class="fng-doc-t"><tbody>' + roRows + '</tbody></table>' : '<p class="fng-muted">No details provided.</p>')
          + '<p class="fng-muted" style="margin-top:6px">Lab devices are maintained by a master in the <b>Manage</b> tab.</p></div>';
      } else {
        var infoText = Object.keys(d.info || {}).map(function (k) { return k + ': ' + d.info[k]; }).join('\n');
        desc = '<div class="fng-card" style="margin-top:10px"><h3 style="margin-top:0">Description <span class="fng-muted" style="text-transform:none;letter-spacing:0">· shared library · editable</span></h3>'
          + '<div class="fng-f"><span class="fng-l">Device name (used in the file name)</span><input class="fng-in" value="' + esc(d.name) + '" onchange="' + R() + '.devmgrSetLabName(\'' + p.id + '\',this.value)"></div>'
          + '<div class="fng-f" style="margin-top:6px"><span class="fng-l">Generic info — one "Key: value" per line (added to metadata)</span>'
          + '<textarea class="fng-ta" style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;min-height:240px" oninput="' + R() + '.devmgrSetLabInfo(\'' + p.id + '\',this.value)">' + esc(infoText) + '</textarea></div>'
          + '<div class="fng-row" style="margin-top:8px;align-items:center"><button class="fng-btn sm" onclick="' + R() + '.devmgrDelLabDevice(\'' + p.id + '\')">Remove device</button>'
          + '<span class="fng-muted">Edits are kept on this machine; use <b>Publish changes</b> in Manage to send them to a master.</span></div></div>';
      }
    } else {
      var pl = (ROOT.platforms || []).filter(function (x) { return x.id === p.platId; })[0];
      var pd = pl && (pl.devices || []).filter(function (x) { return x.id === p.id; })[0];
      var rows = (pd && pd.info) ? Object.keys(pd.info).map(function (k) { return '<tr><td>' + esc(k) + '</td><td>' + esc(pd.info[k]) + '</td></tr>'; }).join('') : '';
      desc = '<div class="fng-card" style="margin-top:10px"><h3 style="margin-top:0">Description <span class="fng-muted" style="text-transform:none;letter-spacing:0">· ' + esc(pl ? pl.name : '') + ' · read-only</span></h3>'
        + (rows ? '<table class="fng-doc-t"><tbody>' + rows + '</tbody></table>' : '<p class="fng-muted">No details provided.</p>')
        + '<p class="fng-muted" style="margin-top:6px">Platform devices are maintained by the platform manager and can\'t be edited here.</p></div>';
    }
    return '<div class="fng-dmmid">' + head + desc + '</div>';
  }
  // RIGHT panel: the user's local configs for the selected device.
  function devmgrRight() {
    var p = ROOT.ui.devmgr && ROOT.ui.devmgr.pick;
    return '<div class="fng-dmright">' + (p ? devmgrConfigPanel() : '') + '</div>';
  }
  function devmgrTree() {
    var dm = ROOT.ui.devmgr, pick = dm.pick || {};
    var labDevs = ((ROOT.library && ROOT.library.devices) || []).slice().sort(function (a, b) { return cmpName(a.name, b.name); });
    var labKids = dm.openLab ? '<div class="fng-treekids">' + (labDevs.length ? labDevs.map(function (d) {
      return '<button type="button" class="fng-treeitem' + (pick.scope === 'lab' && pick.id === d.id ? ' on' : '') + '" onclick="' + R() + '.devmgrPickLab(\'' + d.id + '\')"' + (dm.edit ? '' : ' ondblclick="' + R() + '.devmgrSelect()"') + '>' + esc(d.name) + '</button>';
    }).join('') : '<span class="fng-muted" style="padding:4px 8px">no devices yet</span>')
      + (dm.edit ? '<button type="button" class="fng-treeadd" onclick="' + R() + '.devmgrAddLab()">+ add device</button>' : '') + '</div>' : '';
    var plats = (ROOT.platforms || []);
    var platKids = dm.openPlat ? '<div class="fng-treekids">' + (plats.length ? plats.map(function (p) {
      var devKids = dm.openPlatId === p.id ? '<div class="fng-treekids">' + ((p.devices || []).length ? (p.devices || []).slice().sort(function (a, b) { return cmpName(a.name, b.name); }).map(function (d) {
        return '<button type="button" class="fng-treeitem' + (pick.scope === 'plat' && pick.platId === p.id && pick.id === d.id ? ' on' : '') + '" onclick="' + R() + '.devmgrPickPlat(\'' + p.id + '\',\'' + d.id + '\')"' + (dm.edit ? '' : ' ondblclick="' + R() + '.devmgrSelect()"') + '>' + esc(d.name) + '</button>';
      }).join('') : '<span class="fng-muted" style="padding:4px 8px">no devices</span>') + '</div>' : '';
      return '<button type="button" class="fng-treefolder sub' + (dm.openPlatId === p.id ? ' open' : '') + '" onclick="' + R() + '.devmgrTogglePlat(\'' + p.id + '\')">' + (dm.openPlatId === p.id ? '▾ ' : '▸ ') + esc(p.name) + '</button>' + devKids;
    }).join('') : '<span class="fng-muted" style="padding:4px 8px">no platforms yet</span>') + '</div>' : '';
    var favs = favDevices();
    var favRows = favs.length ? favs.map(function (name, i) {
      return '<div class="fng-favrow' + (pick.name === name ? ' on' : '') + '">'
        + '<button type="button" class="fng-favname" onclick="' + R() + '.devmgrPickFav(' + i + ')"' + (dm.edit ? '' : ' ondblclick="' + R() + '.devmgrSelect()"') + '>' + esc(name) + '</button>'
        + '<button type="button" class="fng-favstar" title="Remove from favorites" onclick="' + R() + '.removeFavByIndex(' + i + ')">★</button>'
        + '</div>';
    }).join('') : '';
    return '<div class="fng-tree">'
      + favRows
      + '<button type="button" class="fng-treefolder' + (dm.openLab ? ' open' : '') + '" onclick="' + R() + '.devmgrToggleLab()">' + (dm.openLab ? '▾ ' : '▸ ') + 'Lab devices</button>' + labKids
      + '<button type="button" class="fng-treefolder' + (dm.openPlat ? ' open' : '') + '" onclick="' + R() + '.devmgrTogglePlatRoot()">' + (dm.openPlat ? '▾ ' : '▸ ') + 'Platform devices</button>' + platKids
      + '</div>';
  }
  function renderDevManager() {
    var dm = ROOT.ui.devmgr; if (!dm || !dm.open) return '';
    return '<div class="fng-modal" onclick="if(event.target===this)' + R() + '.closeDevManager()">'
      + '<div class="fng-modal-card fng-dmcard"><div class="fng-modal-h"><h3 style="margin:0">' + (dm.edit ? 'Manage devices' : 'Select devices') + '</h3>'
      + '<button class="fng-modal-x" title="Close" onclick="' + R() + '.closeDevManager()">✕</button></div>'
      + '<div class="fng-dmbody"><div class="fng-dmleft">' + devmgrTree() + '</div>' + devmgrMiddle() + '</div>'
      + '<div class="fng-acts" style="margin-top:12px"><button class="fng-btn pri" onclick="' + R() + '.closeDevManager()">Close</button></div></div></div>';
  }
  ROOT.openDevManager = function (edit) {
    var dm = ROOT.ui.devmgr = ROOT.ui.devmgr || {};
    dm.open = true;
    dm.edit = !!edit;   // Use tab = read-only browser; Manage tab = full editor
    // Default view: show the device currently in use (and its configs); if nothing is
    // selected in Use, collapse everything.
    var cur = currentDeviceName();
    dm.openLab = false; dm.openPlat = false; dm.openPlatId = null; dm.pick = null;
    if (cur) {
      var ld = (ROOT.library.devices || []).filter(function (x) { return x.name === cur; })[0];
      if (ld) { dm.openLab = true; dm.pick = { scope: 'lab', id: ld.id, name: ld.name }; }
      else {
        (ROOT.platforms || []).forEach(function (p) { (p.devices || []).forEach(function (d) {
          if (!dm.pick && d.name === cur) { dm.openPlat = true; dm.openPlatId = p.id; dm.pick = { scope: 'plat', platId: p.id, id: d.id, name: d.name }; }
        }); });
      }
    }
    rerender();
  };
  ROOT.closeDevManager = function () { if (ROOT.ui.devmgr) ROOT.ui.devmgr.open = false; rerender(); };

  /* --- User configuration window (#3) -------------------------------------
   * Shows ONLY the configurations for the current operator + the device chosen
   * for the file name. Configs are created/edited here and stay on this machine. */
  ROOT.openConfigMgr = function () { ROOT.ui.cfgOpen = true; rerender(); };
  ROOT.closeConfigMgr = function () { ROOT.ui.cfgOpen = false; rerender(); };
  function renderConfigManager() {
    if (!ROOT.ui.cfgOpen) return '';
    var op = currentOperator(), dev = currentDeviceName(), body;
    if (!dev) {
      body = '<p class="fng-muted">Choose a <b>device</b> first (the device button), then add configurations for it here.</p>';
    } else if (!op) {
      body = '<p class="fng-muted">Select your <b>operator</b> on the main screen first — configurations are saved per operator + device, on this machine.</p>';
    } else {
      var list = odConfigs(op, dev), actId = activeConfigId(op, dev);
      var active = list.filter(function (c) { return c.id === actId; })[0];
      var sel = '<select class="fng-sel" onchange="' + R() + '.selectConfig(this.value)"><option value="">— none —</option>'
        + list.map(function (c) { return '<option value="' + esc(c.id) + '"' + (c.id === actId ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('') + '</select>';
      var editor = active
        ? '<div class="fng-f" style="margin-top:8px"><span class="fng-l">Settings — one "Key: value" per line (saved on this machine; added to the metadata when this device is in use)</span>'
          + '<textarea class="fng-ta" style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;min-height:120px" oninput="' + R() + '.editConfig(this.value)">' + esc(active.text || '') + '</textarea></div>'
        : '<p class="fng-muted" style="margin-top:6px">No configuration selected — create one with <b>New</b>.</p>';
      body = '<p class="fng-muted" style="margin-top:0">Operator <b>' + esc(op) + '</b> · device <b>' + esc(dev) + '</b> · this machine.</p>'
        + '<div class="fng-row" style="align-items:flex-end"><div class="fng-f" style="flex:1;max-width:280px"><span class="fng-l">Saved configurations</span>' + sel + '</div>'
        + '<button class="fng-btn sm" onclick="' + R() + '.newConfig()">+ New</button>'
        + (active ? '<button class="fng-btn sm" onclick="' + R() + '.renameConfig()">Rename</button><button class="fng-btn sm" onclick="' + R() + '.deleteConfig()">Delete</button>' : '')
        + '</div>' + editor;
    }
    return '<div class="fng-modal" onclick="if(event.target===this)' + R() + '.closeConfigMgr()">'
      + '<div class="fng-modal-card"><div class="fng-modal-h"><h3 style="margin:0">User configuration</h3>'
      + '<button class="fng-modal-x" title="Close" onclick="' + R() + '.closeConfigMgr()">✕</button></div>'
      + body
      + '<div class="fng-acts"><button class="fng-btn pri" onclick="' + R() + '.closeConfigMgr()">Done</button></div></div></div>';
  }
  ROOT.devmgrToggleLab = function () { ROOT.ui.devmgr.openLab = !ROOT.ui.devmgr.openLab; rerender(); };
  ROOT.devmgrTogglePlatRoot = function () { ROOT.ui.devmgr.openPlat = !ROOT.ui.devmgr.openPlat; rerender(); };
  ROOT.devmgrTogglePlat = function (pid) { ROOT.ui.devmgr.openPlatId = (ROOT.ui.devmgr.openPlatId === pid ? null : pid); rerender(); };
  ROOT.devmgrSelect = function () {
    var p = ROOT.ui.devmgr && ROOT.ui.devmgr.pick; if (!p) return;
    ROOT.ui.touched = true;
    var lab = useLab(), tpl = lab && useFileTpl(lab), fid = tpl && deviceFieldId(tpl);
    if (fid) ROOT.ui.values[fid] = p.name;
    if (ROOT.ui.devmgr) ROOT.ui.devmgr.open = false;   // selecting closes the picker
    rerender();
  };
  ROOT.devmgrPickLab = function (id) { var d = labDeviceById(id); if (!d) return; ROOT.ui.devmgr.pick = { scope: 'lab', id: id, name: d.name }; rerender(); };
  ROOT.devmgrPickPlat = function (pid, id) { var p = (ROOT.platforms || []).filter(function (x) { return x.id === pid; })[0]; var d = p && (p.devices || []).filter(function (x) { return x.id === id; })[0]; if (!d) return; ROOT.ui.devmgr.pick = { scope: 'plat', platId: pid, id: id, name: d.name }; rerender(); };
  ROOT.devmgrUse = function () {
    var p = ROOT.ui.devmgr && ROOT.ui.devmgr.pick; if (!p) return;
    ROOT.ui.touched = true;
    var lab = useLab(), tpl = lab && useFileTpl(lab), fid = tpl && deviceFieldId(tpl);
    if (fid) ROOT.ui.values[fid] = p.name;
    try { localStorage.setItem(LS_DEVICE, p.name); } catch (e) {}
    addFav(p.name);   // a default device is also a favorite
    rerender();
  };

  ROOT.devmgrFav = function () {
    var p = ROOT.ui.devmgr && ROOT.ui.devmgr.pick; if (!p) return;
    if (isFav(p.name)) removeFav(p.name); else addFav(p.name);
    rerender();
  };
  ROOT.removeFavByIndex = function (i) { var a = favDevices(); if (i >= 0 && i < a.length) { a.splice(i, 1); favSet(a); rerender(); } };
  ROOT.devmgrPickFav = function (i) {
    var name = favDevices()[i]; if (!name) return; var dm = ROOT.ui.devmgr;
    var ld = (ROOT.library.devices || []).filter(function (x) { return x.name === name; })[0];
    if (ld) { dm.openLab = true; dm.pick = { scope: 'lab', id: ld.id, name: ld.name }; rerender(); return; }
    var hit = null;
    (ROOT.platforms || []).forEach(function (pf) { (pf.devices || []).forEach(function (d) { if (!hit && d.name === name) hit = { platId: pf.id, id: d.id, name: d.name }; }); });
    if (hit) { dm.openPlat = true; dm.openPlatId = hit.platId; dm.pick = { scope: 'plat', platId: hit.platId, id: hit.id, name: hit.name }; }
    else { dm.pick = { scope: 'lab', id: '', name: name }; }   // device no longer exists; still selectable so it can be unfavorited
    rerender();
  };
  ROOT.devmgrAddLab = function () {
    var name = (typeof window !== 'undefined' && window.prompt) ? window.prompt('New lab device name:', '') : '';
    if (name === null) return; name = (name || '').trim(); if (!name) return;
    // New device starts from the setting template so the description has a clear shape.
    var d = { id: uid('dev'), name: name, info: parseSettings(CONFIG_TEMPLATE) };
    (ROOT.library.devices = ROOT.library.devices || []).push(d);
    ROOT.ui.devmgr.openLab = true; ROOT.ui.devmgr.pick = { scope: 'lab', id: d.id, name: name };
    persistLib(); rerender();
  };
  ROOT.devmgrSetLabName = function (id, v) { var d = labDeviceById(id); if (!d) return; d.name = v; if (ROOT.ui.devmgr.pick && ROOT.ui.devmgr.pick.id === id) ROOT.ui.devmgr.pick.name = v; persistLib(); rerender(); };
  ROOT.devmgrSetLabInfo = function (id, text) { var d = labDeviceById(id); if (!d) return; d.info = parseSettings(text); persistLib(); };   // no rerender — keep cursor
  ROOT.devmgrDelLabDevice = function (id) {
    if (typeof window !== 'undefined' && window.confirm && !window.confirm('Remove this device from the lab library?')) return;
    ROOT.library.devices = (ROOT.library.devices || []).filter(function (x) { return x.id !== id; });
    if (ROOT.ui.devmgr.pick && ROOT.ui.devmgr.pick.id === id) ROOT.ui.devmgr.pick = null;
    persistLib(); rerender();
  };

  // recent file names generated on this machine
  function recentBlock() {
    var h = recentNames(); if (!h.length) return '';
    return '<details class="fng-adv"' + (ROOT.ui.recentOpen ? ' open' : '') + ' ontoggle="' + R() + '.setRecentOpen(this.open)"><summary>Recent file names (this machine)</summary><div class="fng-card">'
      + h.map(function (n, i) { return '<div class="fng-recent"><code>' + esc(n) + '</code><button class="fng-btn sm" onclick="' + R() + '.copyRecent(' + i + ')">Copy</button></div>'; }).join('')
      + '</div></details>';
  }

  // best-effort decode: split a file name by the template separator and map to fields in order
  function decodeOut() {
    if (!ROOT.ui.decodeResult) return '';
    return '<table class="fng-doc-t" style="margin-top:8px"><thead><tr><th>Field</th><th>Segment</th></tr></thead><tbody>'
      + ROOT.ui.decodeResult.map(function (r) { return '<tr><td>' + esc(r.field) + '</td><td>' + esc(r.seg) + '</td></tr>'; }).join('') + '</tbody></table>';
  }
  function decodeBlock() {
    var lab = useLab(), tpl = lab && useFileTpl(lab); if (!tpl) return '';
    return '<details class="fng-adv"' + (ROOT.ui.decodeOpen ? ' open' : '') + ' ontoggle="' + R() + '.setDecodeOpen(this.open)"><summary>Decode an existing file name</summary><div class="fng-card">'
      + '<p class="fng-muted">Splits a name by this template\'s separator (<code>' + esc(tpl.separator || '_') + '</code>) and maps each part to a field, in order. Abbreviated/auto parts can\'t be reversed to their full value.</p>'
      + '<div class="fng-row"><input class="fng-in" id="fng-decin" placeholder="paste a file name…" style="flex:1;min-width:0"><button class="fng-btn sm" onclick="' + R() + '.decodeName()">Decode</button></div>'
      + '<div id="fng-decout">' + decodeOut() + '</div></div></details>';
  }
  ROOT.setDecodeOpen = function (b) { ROOT.ui.decodeOpen = b; };
  ROOT.setRecentOpen = function (b) { ROOT.ui.recentOpen = b; };
  ROOT.setManageOpen = function (b) { ROOT.ui.manageOpen = b; };
  ROOT.decodeName = function () {
    var el = document.getElementById('fng-decin'); var s = el ? el.value.trim() : '';
    var lab = useLab(), tpl = lab && useFileTpl(lab); if (!tpl || !s) return;
    var parts = s.split(tpl.separator || '_');
    var names = (tpl.fieldIds || []).map(function (id) { var f = fieldById(ROOT.library, id); return f ? f.name : id; });
    ROOT.ui.decodeResult = names.map(function (n, i) { return { field: n, seg: parts[i] == null ? '—' : parts[i] }; });
    var o = document.getElementById('fng-decout'); if (o) o.innerHTML = decodeOut();   // update only the result, keep panel open
  };

  function usePreview() {
    var L = ROOT.library, lab = useLab(), tpl = useFileTpl(lab); if (!tpl) return '';
    var ctx = { now: nowDate(), tplId: tpl.id, lab: lab };
    // Show every field in order. Filled fields show their value; empty ones show a
    // ‹Field name› placeholder so the user sees exactly what's still missing.
    var segs = (tpl.fieldIds || []).map(function (id, i) {
      var f = fieldById(L, id);
      var v = encodeField(f, ROOT.ui.values, ctx);
      if (v) return '<span style="color:' + SEG[i % SEG.length] + '">' + esc(v) + '</span>';
      return '<span class="fng-ph">&lt;' + esc(f ? f.name : '?') + '&gt;</span>';
    });
    var sepc = '<span class="sep">' + esc(tpl.separator || '_') + '</span>';
    var nameHtml = segs.length ? segs.join(sepc) : '<span class="fng-muted">add fields to this template…</span>';
    var folder = defaultTpl(lab.folderTemplates);
    var fileCard = '<div class="fng-ex"><div class="h">File name</div>'
      + '<div class="fng-namerow"><div class="fng-name">' + nameHtml + '</div>'
      + '<button class="fng-copy" id="fng-copybtn" title="Copy file name" onclick="' + R() + '.copyName()">'
      + '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"></path></svg>'
      + '</button></div></div>';
    var folderCard = '<div class="fng-ex"><div class="h">Folder</div>' + locationBlock(folder) + '</div>';
    return '<div id="fng-ex">' + fileCard + folderCard + '</div>';
  }

  ROOT.useLab = function (id) { ROOT.ui.labId = id; ROOT.ui.tplId = null; ROOT.ui.values = {}; rerender(); };
  ROOT.useTpl = function (id) { ROOT.ui.tplId = id; ROOT.ui.values = {}; rerender(); };

  function deviceFieldId(tpl) {
    var r = null; (tpl ? tpl.fieldIds : []).forEach(function (id) { var f = fieldById(ROOT.library, id); if (f && f.source === 'device') r = id; });
    return r;
  }
  ROOT.setMachineDevice = function () {
    var lab = useLab(), tpl = useFileTpl(lab), id = deviceFieldId(tpl);
    var v = id ? (ROOT.ui.values[id] || '') : '';
    if (!v) { toast('Pick a device first, then set it as the machine default.'); return; }
    var md = machineDevice();
    if (v === md) {   // already the default → offer to remove it
      if (!window.confirm || window.confirm('Remove “' + v + '” as the default device on this machine?')) {
        try { localStorage.removeItem(LS_DEVICE); } catch (e) {} rerender();
      }
      return;
    }
    if (!window.confirm || window.confirm('“' + v + '” will be the default name for the device on this machine.')) {
      try { localStorage.setItem(LS_DEVICE, v); } catch (e) {}
      addFav(v);   // a default device is also a favorite
      toast('“' + v + '” is now the default device on this machine.'); rerender();
    }
  };
  ROOT.clearMachineDevice = function () { try { localStorage.removeItem(LS_DEVICE); } catch (e) {} rerender(); };
  // hierarchical device picker: switch group (tab) / pick a device (chip)
  ROOT.setDevGroup = function (gid) { ROOT.ui.devGroup = gid; rerender(); };
  ROOT.pickDevice = function (fid, name) {
    var cur = ROOT.ui.values[fid] || '';
    ROOT.ui.values[fid] = (cur === name) ? '' : name;   // click again to deselect
    ROOT.ui.devGroup = groupOfDevice(name); rerender();
  };
  ROOT.setVal = function (k, v) {
    ROOT.ui.touched = true;   // a real user edit — don't let a background sync overwrite mid-task
    ROOT.ui.values[k] = v;
    var f = fieldById(ROOT.library, k);
    // remember the last department / operator chosen on this machine (only non-empty)
    if (v && f) { try {
      if (f.source === 'department') localStorage.setItem(LS_DEPT, v);
      else if (f.source === 'operator') localStorage.setItem(LS_OPER, v);
    } catch (e) {} }
    if (f && f.source === 'operator') { rerender(); return; }   // reload that operator's configs
    refreshUsePreview(); refreshHeader();
  };
  function refreshUsePreview() { var el = document.getElementById('fng-ex'); if (el) el.outerHTML = usePreview(); }
  // refresh only the rendered header — never the notes editor (keeps the cursor)
  function refreshHeader() { var el = document.getElementById('fng-md-header'); if (el) el.innerHTML = headerHtml(); }

  /* --- experiment configurations, scoped to (operator + device), local -----
   * Each (operator, device) pair can hold several named configs (presets) of
   * free "Key: value" settings, stored in localStorage. They're edited in the
   * Manage devices window for the OPENED device; the active config of the
   * currently SELECTED (file-name) device is folded into the metadata + sidecar. */
  var CONFIG_TEMPLATE = 'Setting1 : XXX\nSetting2 : XXX';
  function parseSettings(text) {
    var o = {};
    (text || '').split(/\n/).forEach(function (line) { var i = line.indexOf(':'); if (i > 0) { var k = line.slice(0, i).trim(); if (k) o[k] = line.slice(i + 1).trim(); } });
    return o;
  }
  function loadAllConfigs() { try { return JSON.parse(localStorage.getItem('fng.configs') || '{}') || {}; } catch (e) { return {}; } }
  function saveAllConfigs(m) { try { localStorage.setItem('fng.configs', JSON.stringify(m)); } catch (e) {} }
  function cfgKey(op, dev) { return (op || '').trim() + ' :: ' + (dev || '').trim(); }
  function odConfigs(op, dev) { var m = loadAllConfigs(); return (op && dev && m[cfgKey(op, dev)]) ? m[cfgKey(op, dev)] : []; }
  function activeConfigId(op, dev) { try { var a = JSON.parse(localStorage.getItem('fng.configActive') || '{}'); return (op && dev) ? (a[cfgKey(op, dev)] || '') : ''; } catch (e) { return ''; } }
  function setActiveConfigId(op, dev, id) { try { var a = JSON.parse(localStorage.getItem('fng.configActive') || '{}'); a[cfgKey(op, dev)] = id; localStorage.setItem('fng.configActive', JSON.stringify(a)); } catch (e) {} }
  function currentOperator() {
    var lab = useLab(), tpl = lab && useFileTpl(lab); if (!tpl) return '';
    var id = null; (tpl.fieldIds || []).forEach(function (fid) { var f = fieldById(ROOT.library, fid); if (f && f.source === 'operator') id = fid; });
    return id ? (ROOT.ui.values[id] || '') : '';
  }
  function currentDeviceName() {
    var lab = useLab(), tpl = lab && useFileTpl(lab); if (!tpl) return '';
    var id = deviceFieldId(tpl); return id ? (ROOT.ui.values[id] || '') : '';
  }
  function pickedDeviceName() { var p = ROOT.ui.devmgr && ROOT.ui.devmgr.pick; return p ? p.name : ''; }
  // active config used in the metadata = for the OPERATOR + the SELECTED file-name device
  function activeConfig() {
    var op = currentOperator(), dev = currentDeviceName(); if (!op || !dev) return null;
    return odConfigs(op, dev).filter(function (c) { return c.id === activeConfigId(op, dev); })[0] || null;
  }
  // config handlers act on (current operator + the device chosen for the file name)
  ROOT.selectConfig = function (id) { var op = currentOperator(), dev = currentDeviceName(); if (!op || !dev) return; setActiveConfigId(op, dev, id); rerender(); };
  ROOT.newConfig = function () {
    var op = currentOperator(); if (!op) { toast('Select your operator on the main screen first.'); return; }
    var dev = currentDeviceName(); if (!dev) { toast('Choose a device first.'); return; }
    var def = 'Config ' + (odConfigs(op, dev).length + 1);
    var name = (typeof window !== 'undefined' && window.prompt) ? window.prompt('Name this configuration:', def) : def;
    if (name === null) return; name = (name || '').trim() || def;
    var m = loadAllConfigs(), k = cfgKey(op, dev); m[k] = m[k] || [];
    var c = { id: uid('cfg'), name: name, text: CONFIG_TEMPLATE };
    m[k].push(c); saveAllConfigs(m); setActiveConfigId(op, dev, c.id); rerender();
  };
  ROOT.editConfig = function (text) {   // no rerender — keep the textarea cursor
    var op = currentOperator(), dev = currentDeviceName(); if (!op || !dev) return;
    var m = loadAllConfigs(), k = cfgKey(op, dev), c = (m[k] || []).filter(function (x) { return x.id === activeConfigId(op, dev); })[0];
    if (!c) return; c.text = text; saveAllConfigs(m); refreshHeader();
  };
  ROOT.renameConfig = function () {
    var op = currentOperator(), dev = currentDeviceName(); if (!op || !dev) return;
    var m = loadAllConfigs(), k = cfgKey(op, dev), c = (m[k] || []).filter(function (x) { return x.id === activeConfigId(op, dev); })[0]; if (!c) return;
    var n = (typeof window !== 'undefined' && window.prompt) ? window.prompt('Rename configuration:', c.name) : c.name;
    if (n === null) return; c.name = (n || '').trim() || c.name; saveAllConfigs(m); rerender();
  };
  ROOT.deleteConfig = function () {
    var op = currentOperator(), dev = currentDeviceName(); if (!op || !dev) return;
    if (typeof window !== 'undefined' && window.confirm && !window.confirm('Delete this configuration?')) return;
    var m = loadAllConfigs(), k = cfgKey(op, dev); m[k] = (m[k] || []).filter(function (x) { return x.id !== activeConfigId(op, dev); });
    saveAllConfigs(m); setActiveConfigId(op, dev, ''); rerender();
  };

  /* --- live metadata header shown inside the notes window --------------- */
  var NOTE_MARK = '## Notes';   // the Markdown heading that divides header from user notes

  // Explicit, organised breakdown of the file name. No volatile timestamp here
  // (so it does not jitter on every keystroke); the precise time is added to
  // the downloaded/recorded sidecar instead.
  function headerObject() {
    var L = ROOT.library, lab = useLab(); if (!lab) return null;
    var tpl = useFileTpl(lab); if (!tpl) return null;
    var ctx = { now: nowDate(), tplId: tpl.id, lab: lab }, fields = {};
    (tpl.fieldIds || []).forEach(function (id) {
      var f = fieldById(L, id); if (!f) return;
      // metadata keeps the FULL value (lab/operator names), the file name abbreviates
      fields[f.name] = f.source === 'lab' ? lab.name : (isAuto(f) ? encodeField(f, {}, ctx) : (ROOT.ui.values[id] || ''));
    });
    var folder = defaultTpl(lab.folderTemplates);
    var sepc = tpl.separator || '_';
    var pattern = (tpl.fieldIds || []).map(function (id) { var ff = fieldById(L, id); return ff ? ff.name : id; }).join(sepc);
    var h = { fileName: curName(), lab: lab.name, template: tpl.name, separator: sepc, pattern: pattern, fields: fields };
    // location & storage: the name is the durable identifier; paths are mutable
    var _subtree = folder ? buildName(folder, L, ROOT.ui.values, ctx) : '';
    if (_subtree) h.relPath = _subtree + '/' + (h.fileName || '');          // relative, location-independent
    var _fp = fullLocalPath(); if (_fp) h.fullPath = _fp;   // relative -> full once the data folder's absolute path is set
    var _root = (folder && folder.basePath) ? normPath(folder.basePath) : '';
    if (showLiteralPath()) { var _lit = [_root, _subtree].filter(Boolean).join('/'); h.literalPath = (_lit ? _lit + '/' : '') + (h.fileName || ''); }
    // Department is bound to the lab — always recorded in the metadata, even if it
    // isn't part of the naming template.
    var depCode = (lab && lab.dept) ? lab.dept : '';
    if (!depCode) (tpl.fieldIds || []).forEach(function (id) { var ff = fieldById(L, id); if (ff && ff.source === 'department') depCode = ROOT.ui.values[id] || depCode; });
    if (depCode) { var dlh = DEPARTMENTS.filter(function (d) { return d.code === depCode; })[0]; h.department = dlh ? (depCode + ' — ' + dlh.label) : depCode; }
    // operator's email — kept in the metadata for contact, never put in the file name
    (tpl.fieldIds || []).forEach(function (id) {
      var ef = fieldById(L, id);
      if (ef && ef.source === 'operator') { var op = operatorByName(ROOT.ui.values[id] || ''); if (op && op.email) h.operatorEmail = op.email; }
    });
    // attach the selected device's generic info (software, version, …)
    (tpl.fieldIds || []).forEach(function (id) {
      var f = fieldById(L, id);
      if (f && f.source === 'device') {
        var sel = ROOT.ui.values[id] || '';
        var d = findDeviceByName(sel);
        if (d && d.info && Object.keys(d.info).length) h.device = { name: d.name, info: d.info };
      }
    });
    // operator email (from the managed operator list) — always recorded in metadata
    (tpl.fieldIds || []).forEach(function (id) {
      var f = fieldById(L, id);
      if (f && f.source === 'operator') { var op = operatorByName(ROOT.ui.values[id] || ''); if (op && op.email) h.operatorEmail = op.email; }
    });
    // attach the operator's active experiment configuration (local to this machine)
    var cfg = activeConfig();
    if (cfg) { var cs = parseSettings(cfg.text); if (Object.keys(cs).length) h.config = { name: cfg.name, settings: cs }; }
    return h;
  }
  // The metadata header as Markdown — renders nicely in any Markdown viewer / ELN.
  function headerMarkdown() {
    var h = headerObject(); if (!h) return '';
    var md = [];
    md.push('## File metadata', '');
    md.push('**File name:** `' + (h.fileName || '(empty)') + '`  ');
    if (h.fullPath) md.push('**Full path:** `' + h.fullPath + '`  '); else if (h.relPath && h.relPath !== h.fileName) md.push('**Relative path:** `' + h.relPath + '`  ');
    if (h.literalPath) md.push('**Recommended transfer path (NASAC):** `' + h.literalPath + '`  ');
    md.push('**Lab:** ' + h.lab + '  ');
    if (h.department) md.push('**Department:** ' + h.department + '  ');
    if (h.operatorEmail) md.push('**Operator email:** ' + h.operatorEmail + '  ');
    md.push('**Template:** ' + h.template + '  ');
    md.push('**Generated:** ' + fmtDate(new Date(), 'YYYY-MM-DD') + ' ' + fmtDate(new Date(), 'HH:MM'));
    md.push('', '| Field | Value |', '| --- | --- |');
    Object.keys(h.fields).forEach(function (k) { md.push('| ' + k + ' | ' + (h.fields[k] || '—') + ' |'); });
    if (h.device) {
      md.push('', '**Device — ' + h.device.name + '**', '', '| Property | Value |', '| --- | --- |');
      Object.keys(h.device.info).forEach(function (k) { md.push('| ' + k + ' | ' + h.device.info[k] + ' |'); });
    }
    if (h.config) {
      md.push('', '**Configuration — ' + h.config.name + '** (this machine)', '', '| Setting | Value |', '| --- | --- |');
      Object.keys(h.config.settings).forEach(function (k) { md.push('| ' + k + ' | ' + h.config.settings[k] + ' |'); });
    }
    return md.join('\n');
  }
  // ---- rendered (WYSIWYG) metadata document ------------------------------
  // The header is rendered HTML (read-only, live); the notes are an editable
  // rich-text region. Both share a font/size the user picks from the toolbar.
  function headerHtml() {
    var h = headerObject(); if (!h) return '';
    var html = '<h3 class="fng-doc-h">File metadata</h3>'
      + '<p><b>File name:</b> <code>' + esc(h.fileName || '(empty)') + '</code><br>';
    if (h.fullPath) html += '<b>Full path:</b> <code>' + esc(h.fullPath) + '</code><br>'; else if (h.relPath && h.relPath !== h.fileName) html += '<b>Relative path:</b> <code>' + esc(h.relPath) + '</code><br>';
    if (h.literalPath) html += '<b>Recommended transfer path (NASAC):</b> <code>' + esc(h.literalPath) + '</code><br>';
    html += '<b>Lab:</b> ' + esc(h.lab) + (h.department ? '<br><b>Department:</b> ' + esc(h.department) : '') + (h.operatorEmail ? '<br><b>Operator email:</b> ' + esc(h.operatorEmail) : '') + '<br><b>Template:</b> ' + esc(h.template)
      + '<br><b>Generated:</b> ' + fmtDate(new Date(), 'YYYY-MM-DD') + ' ' + fmtDate(new Date(), 'HH:MM') + '</p>'
      + '<table class="fng-doc-t"><thead><tr><th>Field</th><th>Value</th></tr></thead><tbody>';
    Object.keys(h.fields).forEach(function (k) { html += '<tr><td>' + esc(k) + '</td><td>' + esc(h.fields[k] || '—') + '</td></tr>'; });
    html += '</tbody></table>';
    if (h.device) {
      html += '<p style="margin-top:10px"><b>Device — ' + esc(h.device.name) + '</b></p><table class="fng-doc-t"><tbody>';
      Object.keys(h.device.info).forEach(function (k) { html += '<tr><td>' + esc(k) + '</td><td>' + esc(h.device.info[k]) + '</td></tr>'; });
      html += '</tbody></table>';
    }
    if (h.config) {
      html += '<p style="margin-top:10px"><b>Configuration — ' + esc(h.config.name) + '</b> <span style="color:#6b7592">(this machine)</span></p><table class="fng-doc-t"><tbody>';
      Object.keys(h.config.settings).forEach(function (k) { html += '<tr><td>' + esc(k) + '</td><td>' + esc(h.config.settings[k]) + '</td></tr>'; });
      html += '</tbody></table>';
    }
    return html;
  }

  function renderMetaDoc() {
    var fonts = [['sans', 'Sans'], ['serif', 'Serif'], ['mono', 'Mono']];
    var sizes = [['s', 'Small'], ['m', 'Normal'], ['l', 'Large'], ['xl', 'X-Large']];
    var fSel = '<select class="fng-tsel" onchange="' + R() + '.setDocFont(this.value)">'
      + fonts.map(function (f) { return '<option value="' + f[0] + '"' + (ROOT.ui.docFont === f[0] ? ' selected' : '') + '>' + f[1] + '</option>'; }).join('') + '</select>';
    var sSel = '<select class="fng-tsel" onchange="' + R() + '.setDocSize(this.value)">'
      + sizes.map(function (s) { return '<option value="' + s[0] + '"' + (ROOT.ui.docSize === s[0] ? ' selected' : '') + '>' + s[1] + '</option>'; }).join('') + '</select>';
    var tbtn = function (cmd, label, t) { return '<button class="fng-tb" title="' + t + '" onmousedown="return ' + R() + '.fmt(event,\'' + cmd + '\')">' + label + '</button>'; };
    var toolbar = '<div class="fng-toolbar"><span class="fng-l" style="margin:0">Font</span>' + fSel
      + '<span class="fng-l" style="margin:0">Size</span>' + sSel + '<span class="fng-tdiv"></span>'
      + tbtn('bold', '<b>B</b>', 'Bold') + tbtn('italic', '<i>I</i>', 'Italic') + tbtn('underline', '<u>U</u>', 'Underline')
      + tbtn('insertUnorderedList', '&bull; List', 'Bulleted list') + '</div>';
    var fam = FONTS[ROOT.ui.docFont] || FONTS.sans, sz = SIZES[ROOT.ui.docSize] || SIZES.m;
    var copyBtn = '<button class="fng-copy fng-doccopy" id="fng-md-copybtn" title="Copy metadata &amp; notes" onclick="' + R() + '.copyDoc()">'
      + '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"></path></svg></button>';
    var elab = '<a class="fng-elab" href="https://smartlab.unige.ch" target="_blank" rel="noopener" title="Copy the metadata and open eLabNext — reuses the eLabNext tab if this button already opened one" onclick="return ' + R() + '.openEln(event)">'
      + '<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAI8AAAAwCAIAAACnnb5kAAAWVUlEQVR42u1bd3xV1ZZea+9zzm25SW46nRhISEgo0psEpIhIEUTUJ7b3FLGXnzPqc+Y9fTOWefrsiIM+wPrE8kCQIoL0Xg0tJBBIICGk59ZT9l7zx0lCqOqTGZmZnN/955577i7rW3utb317H4R/fg5arv8lF2sxQQtaLVcLWv/vL+WStIKICAAAkqjFppcvWojIEIRpkRCADFSFIbZgdjmihYgkhDCMxPi4jr7YukjkUHmFFII5HC2AXV5o2VBFO7RXp0z4zZU5lpAeTd1dWn7vV4u3HDnKnA4pWwC7fNCSkgMuu3taRmLC7Z98te1EWStv1JNXX7Xx/rv6vvXejqIS7tBEywq7HDihwpiMRO4b0q9/uzY9Xp312ZYdR6pqNhQWjXv7/RUFRX+dMgERW4C6XNAiIkCckpP15d6DJaUntdgYVLjmdqHCX1i9vltKUvukBGmarIEqtly/LloAgKhyVhUKM8aIiIiElIzz+oguiNyqAi1h8NfNWwzRJuicMSnEvvKK0Z2vkAqXhsFVFQGsQGh8VrpuWseqapiiIABnDIDEpWYcHBEQAUD+o2QGm3veBR5gjNmB5CyKy9CuMC/9vC7d2kKUhmEFQ9I0TcNgDuezK9a0jvHOm3aji3Oh61Y4csPgvn8cMfTp5atCoZAEEIYpQmER1i95QBS6LsJhEQ7TP7qCSUr7c5EH7C6kYeKZIV0ahgiHRThyaeMHIjJEfuH0gT9Rg0dEsqze7dvc3CPnyjat/uXb79fnFwLjV2ekzb91CiBsLCruGB+XnZz40uqNT37zLVgirXXyO9ePPVpd89UPB5YdKkTGCS7N3DhjQ1M7uFWFANYdLa4PhZEx+snhQVpWa1/s4jtuUhg7Vls36YP5phDNaRECkJQ+j3tgh3YMsaSufnfxcVRVIrLrlt7t27byRllSrisqDkR0ZJeIUgkBUgIRaNovioRIBAD/OXlcz9YpALDwtqlj3v94R8mJlQVHOr30xq29ur8x/pov8g7c/MH8veUVnGFaq+QVd09rHxsDkHpjt6y2z78eiOjI8Rf6IgIQkVPhn90yKcHjBoDeb763o74YHfxnLDIih6LYE4l1OfEcX2aIwrKykhMX33ETANTres4r75RU1zJVQURhmP82Ond05zQAyH511r7jZchV+sWLjCEmRHtTvFE+l3Pd0ZLzygvsp/qjaaUlJ/ZonaJbVtAw49yuzJQkEdFBypra+o9259WEI3/fl7/3+AmQQkT0BG9U25joiGWFTTPG6Ryc2h4MgyH7WWFBYYwzxhA5Q4Wx5mYNGqYkkudklOa4KowpjHGGDJEzxhnDZpxWt4QkChomsztq6qUp3BFJIkOIaIfjxbEjybKaBhAxLUkUsazmvfPGdhq6azZaeyTNG7dnd3p4QmQlJ+5//L49j0yfNWksb/z1560tzhqyOSq81h/YXHx8QPu2DgAAKKsPAOeP5A66u1+vrKQEAPj4pokzJ475/Id9z65Yc6S6xpLSqSgAcKS69lhlNVMVhmiHLEl0cWdERJLS0nUABIZABJLAoXHO7Yrb5jsXrzGsYAgQABkggE0HnI6mf7FGs0ZME8IRUDgQgJTgdGCjmRiiyrkl5c3du76fk7ky74DmcYvGBNN8AAxR6AYIAczuTgJj6HAQERBZwWADrXE6ABEQSQhLN+ypMpdThMJhw4x3uwCgPmKYwZD9Ezg0aI76xdYTkQhHQEhAAIejMhQe/d5HsyZdVxkMpni9824cX3XdyPTE+Pe37nx80fJ6w3Ai69Y6+eEhA27qkV1a799dVr712PF2vpgnlnxXUHYSHQ4zGARJgAiaxlVFXCDDIyKZZpTLNaVPzzEZndyqYkm5ouDIRzt+qAuFQeFwUTpnR0uXqk7smTPsig4p3iiOrDIUWrAv/+/7Dgohms/fsKwuiQnTenXr3irZkrTkYMHc7btM+xk6vUYB4PXrRvUqLBJSAp47YBBhve8V7ad0z05PjOeIxbV1H+/K21BYhJzHe713DB1oCCGJ5u7YE4roUog2vtgbcjIBIGJZ723dNbl/rz7t21pSKoy1jo56YPgQQAib5se79kZMs2nAyoXsJU0TEIdnZWSnJNVH9KUHC8qra/268ZsP50NET2qVXP7MYycDwfQX3zhadhK4AgyBYNX+/NfXbvrTtSN/P3zwXV8smvPt9xDtBcaAcSAa17NbWrzvVCC4LL+wuqaOuZznxjGGSKbZMd634I6bu7dKbro/ISvj/gF9xs/5tPBUBXNoF+cgVjA0vkf2Jzdd3/z+bVd2W3bo8JQP5wdCYYQGC7SJ8W576HdRjVl9Qlb6+Kz0yfM+04maUKnXDZfCuyYnPjJ0wEvLVgHnZxlL6MZTo4f9+zXDm+M4o3/vZ79b88clK/2BwNWdUq9JTwOA9IT4h+YvAEWZPXncmIw0APjnZSsVxr6YdmOD5gDQNib6zQnXAEDIND/cmdfgfxdCiyFKw0xPTvzbrTd0b5V8vLbe53ap11/72OJv31m72eF26gRvTxxTUlc/6K33QuGIGh0tSTZ4IqKQ8pkvF3k07bVxoxbvz68OhYUlslslfXnb1M6J8cU1dfEeFwI+smj5e+u3MOc5aj0RQ/zr1IndWyUT0N/35a88WHh1l84Ts9IzkxJenXDNuFnzfkLlDkke95ojx/JOlptCZiYl5KZ15IjXpKc9NKT/8wuX8cZYF+t0hkzzq7wDPo8rN7WjJcXYLp2nXpnzwaoNvDHLLssv1IWY1jPnqdzBn/+wv6j4RFMM5MhAj4zq2e35a4YDQHkg+NaGrZLovoF9Wkd7/zBi6KrDx9buOzj1oy+2P3R3alzs/QN6v79tV5ekBBuqz37Y/x+LV6S0Sl6492B8lGdQx3YAUBfR1xQdY4gFFVWGaTanu8p5lfU4j3vVvbcX19Z1efH1I3V+B2fTB/aZOfHaet34dP2WrLQON2RnTv7oi5A/qHqjTCHOsjWL8jy5ZMXv+vaY3r/3C4uWpyQlfD/jzh/KykfNmnc8GHQrygND+s+efJ1fNz7bupO7XU0hkSFK3chq13poagdJtKesfPK7H0A4MnPNxt1PPZyTkpSb2iEh3lcXiVwkZwkpwemctWXHmyvWgG4AAggxdfhVf7tlkiSa1LXL80tWCpK2w0opx8/7bOXuvcD5zJuvn9G/tyS6NqPzB99vaAq0kuipJd9Nzu4S43S8PHbUpLfew+bRkODOXt1tcv/gwmWfr1wDBHvLKxbePpWIxnbptPbgofpA8J6vFq+6+zZE+PLWKS5VAYDi2rr7v/qGuV0VweDEmXOyO1+R9+h0ADh4qmrCrHmACAxB0+ginJAjUkSfMbhftEMbNmtewalKCRAS4tVF376xcetr40bJSGRAu7Yh01y4/yC6nFZzqBrnhpzr/sDf9uz7Tc8cUVf/8FUDAGjku/OO1dQIAL9pvrBgyZztu18dN0p1aFLK5kwJpMhMjLfFgpK6+n6dUkf079W/8xX1EZ2INIUnRXksSXhxBZLI1I1BWRkPjRv1xykTbhsxdP+pyspgiCG6VAU4s1kLApT5A+uKipVoLzL21d6Dtsek+mJAO72BEO10nCg+8Zd1WwDg+q4ZA7t1rQqFGjyDJKhqWrwPEYnIrSlDevcc0qdnYpTHFFIQ2cRBcztX78t/YfV6AEiL97WO9oZN87dfLqqqrUNFIQLudnkbw7vCkLtd3O1SHI4f4YS2XDsmo9PS/MO6P6BFew0hOOMQ5Zm1eceDA/qufvrRjr6YrSWlUjdBu2CdgZztPHHy9iu7LX360dxOHf+ybrOM6Jo3yhBCUTg5nR/uyruzd48UX2xJZRVTG9pBACBI8HhsSWl8Zvr4zPQznOkn1RtAQs6eOvG3fXo2vx8yTQCgM0lC2LQYoikE4eljChpXTucKACElupwvrlo7JSczPSH+lbEj/YYOAA0rjGG0w2FH4LlTJpw1mCiHBkRExJ2OP6xYc2fvHokeN0NcfujId7v3KdFeSwiGKKRs6p3s8HA+f1TOK58RyYaHEbCBZQFHRISDpyodnCmMEQD+SPYAXYiDJ0/1btda4QyITrcGZJcj562WJEkCQMSDFZVrCo86NJUhqpypjOdXVB2prHYqvEkd5IwpjDHG7KY4Y0YoPCwr/bd9ehJRQVXNO5u2mYY5pmvG2C6d4ZwxMwSGgIiI2KT5nWUnIiDOgqHwE0u++/r2qf3at6GGvrA5NUWAL/IOnAoEOUMCQEBJ9HnefuAKIIqI/vDIoYket80wR3RKzc3OXH3gEHe7zvJ4IrLrJgQ4a4PwnLwFCEQLDxx6bkSu1xfjr/OD02lZFgSDDw3qWx4I3jtr7i2jh71/wzjVoVlnCjZniWy927Yqrq1/dPYHtcJ6bHC/PyxbFQmEwOEwTQsi+u/69iyqri2rrkVFoWZuBYgn6vwIgIgVwdC9cz8FTQPGAAgkgSXA6/E4T4eI6lDYCgTBNG3JzmIMDLNnq2RJxBAf/+bbxeu3gMMxe+eek8887nM5zzKNRRSy655wpF2s13ag0jo/mFazWhZAkup2Ldq9d0GfHhOzMiSRDSkCgpDVobCdt97etH31pm0Q4wUhAQAsC5wO5nabwXDPtI4vjblaYSy/sirB7Y53u/564/her71bF44wRZEAwvZRALemSssC+wvnzX3n7LwliNDlnLV+a6nfv3bGnT07tI1SeYLL9eyU8Xf3vfL+BUvUaO/WklKnokzOyaRwWOH8PJRSCGd01M3dsz/ZvVdNiJu5YWvAMNfed1d221ZRCk/2uP9886Sp3brev2CJtEzWjPNIIlCU3aXlYdMSkga2b/fs1IntU5ISE+KSE+IzOrYb2C2zEVeypfG7eveYfvWQe3MHTR826J7cQTNyB7VPSfTrBiJKojEZnXwpSZ5o75ScLM+ZcVsQCSKf0zm0U2qKx903M/2pYYNNKRniN/mFIAQDtHeCGv9DyNlji74NGEaT0sEYgmFsLjmBiKYQb04YPbTvlclxvqTkxDatkgfkZMX7YskwPC7n3BsnaJwbQoyb8+lzq9YBQKov9q1J10nDQADgrNQfiJiWkJSeED9jcP/WsdHpKckuTQUivEjeQsYCupH7zpwPb5q047EZdeGIS1N1y7rz86+/3JmHblfhibJ3t+x8+dqRyw8U1AQCqsvVwOAREFAIQYHQn2+dXK/rszZuNTWtwh/IfWfuJ7dM2v34ff5wxOXQakLh6+d9tjTvAHM6m9fIRMQ1tbSy8pV1m54ZPgQA/nX4kEcH9QuZhsYVn8v59qbtG/cfUtwuTeGIyAF+P3zwWVO4urJqRcFhe3Xe17/3+MwMIUUHX6z9q9roXk6FA0BSlGf1Pbf5I7q3cb1uLSn9YNsucDolNXAZlTEbHq5pRaVlL63e+KdRubZf2grsG+s2T+uZk+hxZycnrZ5xR0UgiIjRTofGeaeX366qqHzr5kndUpIA4MXVGwpKSo9WVU/NyRrYoe0t3buuzx38zuoNisdVWlmzpujYNelpHHDmxDGvjx9dGw5nvvJOWDeAMTtycBg87HwcgdeHwvO27lxaeGRP2alPd+99YMHSLYVHgbMYt0sPR46Hwk8MHTAxJ2vxgYLqqiqSkoQk05J6RFXVP0+67uFBfWdu2v711p0xvhjdtKqDwdmbdy4vLNpVVj53x54HFi7dV3LivNUxEDFF+b7giEnQITYmyqG5VTVK0xSGJ+r9z3+/4WhVtebQbsjJUhjz63q9rtfrhr/xUx8x3t60rbCk9Hgo1KN1SrTDGeN0OBTluZVrg4aRFOUprKqetysvbJil9X6f2x3l0Fyq4lAUQVRa75+ft//O+QtrIxEASI6OntA1Q7fEnrLyBXn7GVckEVOULcXHc9NSPZpWE4q8v313dThSFwytKCxKjfMluN1OVfFomltTw5ZYfKBg1ppNY3rk/H7YYL9hbD9eOv2LRaCplmluLysf26VTxBL92rVZdOhwTSCICOuPlmQmJ7aJ9tqS5q7S8pmbtjWvty64Y2K7Fek6CAGA4HSAZY3IzJgzZdyB8or0pISDpyo1zgd2bD9n684F+w/W6YZHUQZ1aDd9YB+Pqi7NLxyTkbap+ER2cuIr6za/9t1a5nbJSATsY4e24nfhvSUAAF13uN0ZSQltor0B3Sj1+0vr/OFGGcajaRzxvFswAd0AANKNKG9U1+RERDxcVV1RVaNFud2qaggRMkwggogODi0+ypMa54tzOU8GgkeqagL+ACgKKpyIOEO3qjJEQ4iwaZ1mYZIUzj2aKohChmknSGmYgJDii81MSlAYqwqFi2vrKgNBIIpxu+w059cNKSSyBp3Q7XBwxjhDQ4iQbiBjZFoAkJoYn+yNqgqFTtT5Q4bRPG/9yP4WR7QVTCui972i/ap7brcrO90S7V54raKm7u5BfR4c1C8nJakh54cjX/6w/7nv1hyvqsl/+pH0hDj7/k2ffDV/2y7V7ZJE9NM2fDljQgiwLBASEIGzM1LuRZBmzCZswpJgWQAEnHNVEUICUYNMDMAZk1KSkCAEkATGgHPOuWxUgE730rhP3cQYSVLDPmQz/ZcAyLLAEgAEyBoHDA2MAwAYs8uyJtkaiIDAZqWnV4hp2qLwWRTjxzV4QQREHFESWQQuVTGFsKR0qWrf9m2+qaqZvXHb7LWb4+J9hU88cP+CpZ9u3AKqCgTtkhNTfbGGEJaUblX1uZwkpSSyLr6ezpQkEBE1zd5TJ5tXNJmMMUA8r65rPyQkIUfGNQCQ9ldEOwFQk+QBgApHhdtGJKCzGDNyBoBwJo8kgoammsNqY6AoTFXApicNg24aKkAzymJzSGBoP3y62AVgqmpP7Nx9ip+04SSIUFV2nyg7cKpS5dylqkvyCzcfPqq6HIDoi42+pUe2z+WclN0lu0M7YExxOipq6+fu2K1xbgefJfkFoCo/9wCvvbcipBSS5Fkma5z7uZ/mZrWJn/3X887fJpZ2cXq+HArn3dqhMyx/RmtCNrVGZz58TteN7Z8rBgk6e74/c6cfgKRsExsz9IoOmUkJz3+/PhzRQciru3T6fNqNBLSpqLh9nC8nJeml1RufXLwcGAcpnxpxVci0Vh0uyjt5quXE0iU4uPHz3o0UAkwTCMDlRCHbxsUU/tODn+7Zd+9nCyKWBZKm9Oo+/9YbHln07esr1yhutxUKAxEoHFS1xdaX4EDKeRn8BfM350zTuKYyhjIUevn6axPdnmFvzrYY45rGVWVvfiFzOX8/bPCrm7aZQigOjWkqcN5ysvB//IRaYxaxpJSSgPNuKcnLCw4zIVVVFVISEfd4vt5/yK2pHePjyLJsWtHyvsmvg9YZ2i+RKWScyyVt8obIGZNSeB0aQwybFrQcq75c0EIEovl5+6fkZLZtnWLU1pEljHCYhHhm+JA9ZeXFpyqZqrasql8zbzUPiUxRdhw7MTKj0zMjrjpW7w9ZZufEhHdvmjQ6PW3snE/LauuY0pKufl1OeNbyEsLr0F4dP2Zar26mEG5V3VNWPv3LlrftLj+0oPEQBxhG66SEDrGx9bq+r/QktLzJ+t92/aL3jokIOWduV2l1XWllNSCCqjJVaVlVlyNaDVoLAVMVuylJ1ALV5YtWE+loMeXly+Bbrha0Wq4WtP4PXf8Ftme5zj3AuxUAAAAASUVORK5CYII=" alt="eLabNext">'
      + '<span class="fng-elab-go">→</span></a>';
    var doc = '<div class="fng-doc" id="fng-doc" style="position:relative;font-family:' + fam + ';font-size:' + sz + '">'
      + copyBtn + elab
      + '<div id="fng-md-header">' + headerHtml() + '</div>'
      + '<hr class="fng-doc-hr">'
      + '<div class="fng-notes-edit" id="fng-md-notes" contenteditable="true" data-ph="Type your notes here…" '
      + 'oninput="' + R() + '.onNotesHtml(this.innerHTML)">' + (ROOT.ui.notesHtml || '') + '</div></div>';
    var note = '<p class="lead" style="margin:8px 0 0">Recommended: use the copy button (top-right) to copy this block, then paste it into your ELN entry (e.g. eLabNext) so the file name, parameters and notes stay with the experiment.</p>';
    return toolbar + doc + note;
  }

  ROOT.onNotesHtml = function (html) { ROOT.ui.notesHtml = html; };
  ROOT.fmt = function (ev, cmd) {
    ev.preventDefault();   // keep the current text selection in the editor
    try { document.execCommand('styleWithCSS', false, true); } catch (e) {}
    try { document.execCommand(cmd, false, null); } catch (e) {}
    var el = document.getElementById('fng-md-notes'); if (el) { el.focus(); ROOT.ui.notesHtml = el.innerHTML; }
    return false;
  };
  ROOT.setDocFont = function (v) { ROOT.ui.docFont = v; try { localStorage.setItem(LS_DOCFONT, v); } catch (e) {} var d = document.getElementById('fng-doc'); if (d) d.style.fontFamily = FONTS[v] || FONTS.sans; };
  ROOT.setDocSize = function (v) { ROOT.ui.docSize = v; try { localStorage.setItem(LS_DOCSIZE, v); } catch (e) {} var d = document.getElementById('fng-doc'); if (d) d.style.fontSize = SIZES[v] || SIZES.m; };

  // light HTML → text / Markdown converters for the notes region
  function decodeEntities(s) { try { var t = document.createElement('textarea'); t.innerHTML = s; return t.value; } catch (e) { return s; } }
  function htmlToText(html) {
    if (!html) return '';
    var s = html.replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n').replace(/<br\s*\/?>/gi, '\n')
      .replace(/<li[^>]*>/gi, '- ').replace(/<[^>]+>/g, '');
    return decodeEntities(s).replace(/\n{3,}/g, '\n\n').trim();
  }
  function htmlToMd(html) {
    if (!html) return '';
    var s = html.replace(/<(b|strong)>/gi, '**').replace(/<\/(b|strong)>/gi, '**')
      .replace(/<(i|em)>/gi, '*').replace(/<\/(i|em)>/gi, '*')
      .replace(/<li[^>]*>/gi, '- ').replace(/<\/li>/gi, '\n')
      .replace(/<\/(p|div|h[1-6])>/gi, '\n').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '');
    return decodeEntities(s).replace(/\n{3,}/g, '\n\n').trim();
  }
  // full metadata as Markdown (header + the user's notes)
  // true only when the notes box has real content (ignores contenteditable
  // leftovers like <br>, empty tags, whitespace and &nbsp;)
  function notesNonEmpty() { return htmlToText(ROOT.ui.notesHtml || '').replace(/\u00a0/g, '').trim().length > 0; }
  function notesMarkdown() {
    var md = headerMarkdown();
    if (notesNonEmpty()) md += '\n\n---\n\n' + NOTE_MARK + '\n\n' + htmlToMd(ROOT.ui.notesHtml || '');
    return md;
  }

  function curName() { var lab = useLab(); var tpl = lab && useFileTpl(lab); return tpl ? buildName(tpl, ROOT.library, ROOT.ui.values, { now: nowDate(), tplId: tpl.id, lab: lab }) : ''; }

  /* --- location & storage helpers -----------------------------------------
   * The file NAME is the durable identifier (intrinsic, travels with the file).
   * A folder PATH is mutable and environment-specific, so we split it into a
   * location-independent convention subtree (recorded) and an absolute root /
   * intended NAS target (recorded only as a planned, unverified destination).
   * The full literal path is opt-in and always labelled "not verified". */
  function folderSubtree() {
    var lab = useLab(); if (!lab) return '';
    var folder = defaultTpl(lab.folderTemplates); if (!folder) return '';
    var tpl = useFileTpl(lab);
    return buildName(folder, ROOT.library, ROOT.ui.values, { now: nowDate(), tplId: tpl ? tpl.id : '', lab: lab });
  }
  function archiveRoot() { var lab = useLab(); if (!lab) return ''; var folder = defaultTpl(lab.folderTemplates); return (folder && folder.basePath) ? normPath(folder.basePath) : ''; }
  function relPath() { var sub = folderSubtree(), n = curName(); return sub ? (sub + '/' + n) : n; }
  function localBase() { try { return localStorage.getItem(LS_FSPATH) || ''; } catch (e) { return ''; } }
  // Join a user-entered absolute base with the relative subtree, honouring the base's
  // own separator style (Windows backslashes vs forward slashes) so the result is a path
  // the OS will actually accept. The browser hides the picked folder's absolute path, so
  // the base must be supplied by the user once per machine.
  function joinPath(base, rest) {
    if (!base) return rest || '';
    var BS = String.fromCharCode(92);
    var win = base.indexOf(BS) !== -1 || /^[A-Za-z]:/.test(base), sep = win ? BS : '/';
    while (base.length && (base.charAt(base.length - 1) === '/' || base.charAt(base.length - 1) === BS)) base = base.slice(0, -1);
    rest = String(rest || '');
    while (rest.length && (rest.charAt(0) === '/' || rest.charAt(0) === BS)) rest = rest.slice(1);
    rest = win ? rest.split('/').join(BS) : rest.split(BS).join('/');
    return rest ? (base + sep + rest) : base;
  }
  function fullLocalPath() { var b = localBase(); return b ? joinPath(b, relPath()) : ''; }

  var STORAGE_OPTS = ['Local (acquisition PC)', 'Transferred to NASAC', 'Both (local + NASAC)'];
  function storageStatusVal() { try { return localStorage.getItem(LS_STORAGE) || STORAGE_OPTS[0]; } catch (e) { return STORAGE_OPTS[0]; } }
  function storageStatusDate() { try { return localStorage.getItem(LS_STORAGE_DATE) || ''; } catch (e) { return ''; } }
  function storageStatus() { return { status: storageStatusVal(), date: storageStatusDate() || fmtDate(new Date(), 'YYYY-MM-DD') }; }
  function showLiteralPath() { try { var v = localStorage.getItem(LS_SHOWPATH); return v === null ? true : v === '1'; } catch (e) { return true; } }
  // a root that looks like a local disk rather than a NAS share (//server/share)
  function looksLocalRoot(p) { p = normPath(p); return /^[A-Za-z]:\//.test(p) || /^\/(Users|home|mnt|media|tmp|var|Desktop|Documents)\b/i.test(p); }

  ROOT.setStorageStatus = function (v) { try { localStorage.setItem(LS_STORAGE, v); } catch (e) {} refreshUsePreview(); refreshHeader(); };
  ROOT.setStorageDate = function (v) { try { if (v) localStorage.setItem(LS_STORAGE_DATE, v); else localStorage.removeItem(LS_STORAGE_DATE); } catch (e) {} refreshHeader(); };
  ROOT.toggleLiteralPath = function (on) { try { localStorage.setItem(LS_SHOWPATH, on ? '1' : '0'); } catch (e) {} refreshUsePreview(); refreshHeader(); };

  // The block shown under the file name in the Use tab: relative path, intended
  // archive (with a local-vs-NAS nudge), the controlled storage status, and the
  // opt-in (unverified) absolute path.
  function locationBlock(folder) {
    var html = '';
    if (folder) {
      var b = localBase();
      var rel = relPath();
      var cs = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"></path></svg>';
      var fp = fullLocalPath();
      if (fp) {
        html += '<div class="fng-pathrow"><div class="fng-path" title="Full path on this machine">' + esc(fp) + '</div>'
          + '<button class="fng-copy" id="fng-localcopy" title="Copy full path" onclick="' + R() + '.copyLocalPath()">' + cs + '</button></div>';
      } else {
        html += '<div class="fng-pathrow"><div class="fng-path" title="Relative path">' + esc(rel) + '</div>'
          + '<button class="fng-copy" id="fng-localcopy" title="Copy relative path" onclick="' + R() + '.copyLocalPath()">' + cs + '</button></div>';
        html += '<div class="fng-muted" style="font-size:11px;margin-top:3px">Set your local root folder below to show the full path.</div>';
      }
      html += '<div class="fng-f" style="margin-top:8px"><span class="fng-l">Local root folder <span class="fng-muted" style="font-weight:400">(the base folder where you save data on this machine — the browser can&rsquo;t read it, so set it once)</span></span>'
        + '<div class="fng-row" style="margin-top:4px;gap:8px;align-items:center;flex-wrap:wrap">'
        + '<input class="fng-in" id="fng-rootin" style="flex:1;min-width:170px" value="' + esc(b) + '" placeholder="C:/Users/ronch/Documents/" oninput="' + R() + '.rootDirty()">'
        + '<button class="fng-btn sm" id="fng-rootset" disabled onclick="' + R() + '.setRootFromInput()">Set as default root for this machine</button>'
        + '</div></div>';
    }
    html += fsSaveSection(folder);
    var root = archiveRoot();
    if (folder && root) {
      html += '<div class="fng-muted" style="font-size:11px;margin-top:8px">Recommended transfer destination (NASAC): <code>' + esc(root) + '</code> — move the raw data here after acquisition (edit this path in Manage › Build templates).</div>';
      if (looksLocalRoot(root)) html += '<div style="font-size:11px;margin-top:2px;color:#f0a860">⚠ This looks like a local drive. Raw data should be archived on NASAC (a //server/share path).</div>';
      html += '<label style="display:flex;gap:6px;align-items:center;font-size:11px;color:#8b95a9;margin-top:6px;cursor:pointer">'
        + '<input type="checkbox"' + (showLiteralPath() ? ' checked' : '') + ' onchange="' + R() + '.toggleLiteralPath(this.checked)"> '
        + 'Also record the full transfer path (NASAC) in the metadata</label>';
      if (showLiteralPath()) html += '<div class="fng-path" style="opacity:.85;margin-top:4px" title="Full path after transferring to NASAC — recommended target, not verified">' + esc(curPath()) + '</div>';
    }
    return html;
  }
  function curPath() {
    var lab = useLab(); if (!lab) return '';
    var tpl = useFileTpl(lab), folder = defaultTpl(lab.folderTemplates);
    var segs = folder ? buildName(folder, ROOT.library, ROOT.ui.values, { now: nowDate(), tplId: tpl ? tpl.id : '', lab: lab }) : '';
    var base = (folder && folder.basePath) ? normPath(folder.basePath) : '';
    var dir = [base, segs].filter(Boolean).join('/');
    return (dir ? dir + '/' : '') + curName();
  }
  function sidecar() {
    var h = headerObject() || {};
    h.generatedAt = new Date().toISOString();   // precise time only in the saved file
    return { header: h, notes: htmlToText(ROOT.ui.notesHtml || ''), notesHtml: ROOT.ui.notesHtml || '' };
  }
  function copyText(t) { if (t && navigator.clipboard) navigator.clipboard.writeText(t); }

  /* ==========================================================================
   * SAVE TO A FOLDER (File System Access API; Chromium desktop, HTTPS only).
   * Per machine the user picks a "data folder" once (a folder handle kept in
   * IndexedDB — like setting the default device). The folder template renders a
   * subtree under it (editable). One button confirms which folders are MISSING,
   * creates only those, and writes the metadata file into the leaf. The browser
   * cannot open the OS file explorer, so we don't pretend to. Elsewhere
   * (Firefox/Safari) it degrades to the existing Download .json.
   * ======================================================================== */
  function fsSupported() { return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function'; }
  function idbOpen() { return new Promise(function (res, rej) { var r = indexedDB.open('fng-fs', 1); r.onupgradeneeded = function () { r.result.createObjectStore('h'); }; r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); }; }); }
  function idbGet(k) { return idbOpen().then(function (db) { return new Promise(function (res, rej) { var t = db.transaction('h', 'readonly').objectStore('h').get(k); t.onsuccess = function () { res(t.result); }; t.onerror = function () { rej(t.error); }; }); }); }
  function idbSet(k, v) { return idbOpen().then(function (db) { return new Promise(function (res, rej) { var tx = db.transaction('h', 'readwrite'); tx.objectStore('h').put(v, k); tx.oncomplete = function () { res(); }; tx.onerror = function () { rej(tx.error); }; }); }); }
  function idbDel(k) { return idbOpen().then(function (db) { return new Promise(function (res, rej) { var tx = db.transaction('h', 'readwrite'); tx.objectStore('h').delete(k); tx.oncomplete = function () { res(); }; tx.onerror = function () { rej(tx.error); }; }); }); }
  function fsEnsurePerm(h) { if (!h || !h.queryPermission) return Promise.resolve(true); return h.queryPermission({ mode: 'readwrite' }).then(function (st) { if (st === 'granted') return true; return h.requestPermission({ mode: 'readwrite' }).then(function (s2) { return s2 === 'granted'; }); }); }
  function fsProbe(root, segs) { var i = 0, cur = root, missing = []; function step() { if (i >= segs.length) return Promise.resolve(missing); return cur.getDirectoryHandle(segs[i]).then(function (h) { cur = h; i++; return step(); }).catch(function () { for (var j = i; j < segs.length; j++) missing.push(segs.slice(0, j + 1).join('/')); return missing; }); } return step(); }
  function fsMkdirp(root, segs) { var cur = Promise.resolve(root); segs.forEach(function (sg) { cur = cur.then(function (h) { return h.getDirectoryHandle(sg, { create: true }); }); }); return cur; }
  function fsWrite(dir, name, text) { return dir.getFileHandle(name, { create: true }).then(function (fh) { return fh.createWritable(); }).then(function (w) { return Promise.resolve(w.write(text)).then(function () { return w.close(); }); }); }
  function fsSubSegs() { return (folderSubtree() || '').split('/').map(function (x) { return x.trim(); }).filter(Boolean); }
  function fsNavigate(root, segs) { var i = 0, cur = root; function step() { if (i >= segs.length) return Promise.resolve(cur); return cur.getDirectoryHandle(segs[i]).then(function (h) { cur = h; i++; return step(); }).catch(function () { return null; }); } return step(); }
  // Best-effort: write the LATEST metadata into the already-created leaf folder. Called
  // from copy / eLabNext so the saved file is always current. Never creates folders.
  function fsSaveMetadataQuietly() {
    if (!fsSupported() || !ROOT._fsRoot) return;
    var segs = fsSubSegs(), name = curName(); if (!name || !segs.length) return;
    fsEnsurePerm(ROOT._fsRoot).then(function (ok) {
      if (!ok) return;
      return fsNavigate(ROOT._fsRoot, segs).then(function (leaf) {
        if (!leaf) return;
        return fsWrite(leaf, name + '.json', JSON.stringify(sidecar(), null, 2)).then(function () { toast('Latest metadata saved to the data folder.'); });
      });
    }).catch(function () {});
  }

  ROOT.pickDataFolder = function () {
    if (!fsSupported()) { toast('Saving to a folder needs Chrome or Edge.'); return; }
    window.showDirectoryPicker({ mode: 'readwrite' }).then(function (h) {
      ROOT._fsRoot = h; try { localStorage.setItem(LS_FSROOT, h.name); } catch (e) {}
      return idbSet('root', h);
    }).then(function () { rerender(); toast('Data folder set: ' + (ROOT._fsRoot && ROOT._fsRoot.name)); })
    .catch(function (e) { if (e && e.name !== 'AbortError') toast('Could not set the data folder.'); });
  };
  ROOT.clearDataFolder = function () { ROOT._fsRoot = null; try { localStorage.removeItem(LS_FSROOT); } catch (e) {} idbDel('root').then(function () { rerender(); toast('Data folder cleared.'); }).catch(function () { rerender(); }); };
  ROOT.setFolderBase = function (v) { try { if (v) localStorage.setItem(LS_FSPATH, v); else localStorage.removeItem(LS_FSPATH); } catch (e) {} refreshUsePreview(); refreshHeader(); };
  ROOT.setRootFromInput = function () { var el = document.getElementById('fng-rootin'); var v = el ? el.value.trim() : ''; ROOT.setFolderBase(v); toast(v ? 'Local root folder set for this machine.' : 'Local root folder cleared.'); };
  ROOT.rootDirty = function () { var el = document.getElementById('fng-rootin'), btn = document.getElementById('fng-rootset'); if (el && btn) btn.disabled = ((el.value || '').trim() === localBase()); };
  ROOT.createTree = function () {
    if (!guard()) return;
    if (!fsSupported()) { toast('Creating folders needs Chrome or Edge.'); return; }
    var proceed = function () {
      var root = ROOT._fsRoot, segs = fsSubSegs();
      if (!segs.length) { toast('This template has no folder path to create.'); return; }
      fsEnsurePerm(root).then(function (ok) {
        if (!ok) { toast('Write permission was not granted.'); return; }
        return fsProbe(root, segs).then(function (missing) { ROOT._fsPending = { segs: segs, missing: missing }; ROOT.ui.fsConfirm = true; rerender(); });
      }).catch(function () { toast('Could not read the data folder — try setting it again.'); });
    };
    if (!ROOT._fsRoot) {
      window.showDirectoryPicker({ mode: 'readwrite' }).then(function (h) { ROOT._fsRoot = h; try { localStorage.setItem(LS_FSROOT, h.name); } catch (e) {} return idbSet('root', h); }).then(proceed).catch(function (e) { if (e && e.name !== 'AbortError') toast('Could not set the data folder.'); });
    } else proceed();
  };
  ROOT.fsConfirmNo = function () { ROOT.ui.fsConfirm = false; ROOT._fsPending = null; rerender(); };
  ROOT.fsConfirmYes = function () {
    var pend = ROOT._fsPending, root = ROOT._fsRoot;
    if (!pend || !root) { ROOT.ui.fsConfirm = false; rerender(); return; }
    fsEnsurePerm(root).then(function (ok) { if (!ok) throw new Error('perm'); return fsMkdirp(root, pend.segs); })
      .then(function () { ROOT.ui.createdSubtree = pend.segs.join('/'); ROOT.ui.fsConfirm = false; ROOT._fsPending = null; rerender(); toast('Folder tree ready. Metadata is saved when you copy it or open eLabNext.'); })
      .catch(function () { ROOT.ui.fsConfirm = false; rerender(); toast('Could not create the folder tree.'); });
  };

  function fsSaveSection(folder) {
    if (!folder) return '';
    if (!fsSupported()) {
      return '<div class="fng-save"><div class="fng-l">Folder tree (this machine)</div>'
        + '<p class="fng-muted" style="font-size:11px;margin:4px 0 0">Creating the folder tree needs Chrome or Edge. In this browser, use <b>Download .json</b> above and file it under the path shown.</p></div>';
    }
    var label = ''; try { label = localStorage.getItem(LS_FSROOT) || ''; } catch (e) {}
    var rootRow = label
      ? '<span class="fng-save-cur">Data folder: <b>' + esc(label) + '</b></span><button class="fng-btn sm" onclick="' + R() + '.pickDataFolder()">Change</button><button class="fng-btn sm" onclick="' + R() + '.clearDataFolder()">Clear</button>'
      : '<button class="fng-btn sm" onclick="' + R() + '.pickDataFolder()">Set data folder for this machine…</button>';
    return '<div class="fng-save"><div class="fng-l">Folder tree (this machine)</div>'
      + '<div class="fng-row" style="margin-top:5px;align-items:center;gap:8px;flex-wrap:wrap">' + rootRow + '</div>'
      + '<div class="fng-row" style="margin-top:8px"><button class="fng-btn pri" onclick="' + R() + '.createTree()">Create folder tree</button></div>'
      + '<p class="fng-muted" style="font-size:11px;margin:6px 0 0">Creates only the missing folders for the path above (you confirm first). The metadata file is written when you <b>copy</b> it or open <b>eLabNext</b>, so it is always the latest. Save raw data locally during acquisition; transfer to NASAC afterwards.</p></div>';
  }

  function renderFsConfirm() {
    if (!ROOT.ui.fsConfirm || !ROOT._fsPending) return '';
    var pend = ROOT._fsPending, label = '';
    try { label = localStorage.getItem(LS_FSROOT) || 'data folder'; } catch (e) { label = 'data folder'; }
    var missing = pend.missing || [];
    var mk = missing.length
      ? '<p style="margin:8px 0 4px">These folders will be created (only the missing ones):</p><ul class="fng-fslist">' + missing.map(function (m) { return '<li>' + esc(m) + '</li>'; }).join('') + '</ul>'
      : '<p class="fng-muted" style="margin:8px 0">All folders already exist — nothing new will be created.</p>';
    return '<div class="fng-modal" onclick="if(event.target===this)' + R() + '.fsConfirmNo()">'
      + '<div class="fng-modal-card"><div class="fng-modal-h"><h3 style="margin:0">Create folder tree</h3>'
      + '<button class="fng-modal-x" title="Cancel" onclick="' + R() + '.fsConfirmNo()">✕</button></div>'
      + '<p style="margin:0;font-size:13px">Inside your data folder <b>' + esc(label) + '</b>, target:</p>'
      + '<div class="fng-path" style="margin:4px 0">' + esc(pend.segs.join('/') || '(root)') + '</div>' + mk
      + '<p class="fng-muted" style="margin:6px 0 0;font-size:12px">No file is written now — the metadata is saved into this folder when you copy it or open eLabNext.</p>'
      + '<div class="fng-acts" style="margin-top:12px"><button class="fng-btn" onclick="' + R() + '.fsConfirmNo()">Cancel</button>'
      + '<button class="fng-btn pri" onclick="' + R() + '.fsConfirmYes()">Create folders</button></div></div></div>';
  }

  if (typeof indexedDB !== 'undefined') { try { idbGet('root').then(function (h) { if (h) ROOT._fsRoot = h; }).catch(function () {}); } catch (e) {} }

  /* --- usage analytics (event ping) ---------------------------------------
   * Opt-in and fire-and-forget: active ONLY when window.FNG_ANALYTICS_URL is
   * set (in index.html). Each export sends ONE minimal event to a private
   * endpoint (Google Apps Script -> Sheet): no file names and no field values,
   * only lab + operator names, the action, and a few coarse facets. Events are
   * buffered in localStorage and flushed, so a failed POST is retried later. */
  var ANALYTICS_EV_V = 1;
  function analyticsCfg() {
    if (typeof window === 'undefined' || !window.FNG_ANALYTICS_URL) return null;
    return { url: window.FNG_ANALYTICS_URL, key: window.FNG_ANALYTICS_KEY || '' };
  }
  function fieldValueBySource(src) {
    var fs = (ROOT.library && ROOT.library.fields) || [];
    for (var i = 0; i < fs.length; i++) { if (fs[i].source === src) { var v = ROOT.ui.values[fs[i].id]; if (v) return v; } }
    return '';
  }
  function currentDeviceScope() {
    var nm = fieldValueBySource('device'); if (!nm) return '';
    return groupOfDevice(nm) === '__lab' ? 'lab' : 'platform';
  }
  // Pseudonymise the operator: a stable short token instead of the plaintext name,
  // so the datastore never holds raw names. cyrb53 is a fast non-cryptographic hash —
  // this is data-minimisation, not strong anonymity (someone holding both the data and
  // the operator roster could re-derive it), but raw names never leave the browser.
  var OP_SALT = 'fng-op-v1';   // change this to rotate every operator token
  function cyrb53(str, seed) {
    seed = seed || 0;
    var h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
    for (var i = 0, ch; i < str.length; i++) { ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
  }
  function hashOperator(name) {
    name = String(name || '').trim().toLowerCase();
    return name ? 'op-' + cyrb53(OP_SALT + '|' + name).toString(36) : '';
  }
  // The event payload — deliberately minimal. The lab NAME is included; the operator is
  // a stable HASH (never the raw name); never any file name or field value.
  function buildAnalyticsEvent(action) {
    var lab = useLab(); if (!lab) return null;
    var tpl = useFileTpl(lab);
    return { v: ANALYTICS_EV_V, ts: new Date().toISOString(), action: action,
      labId: lab.id || '', lab: lab.name || '', dept: lab.dept || '',
      operator: hashOperator(fieldValueBySource('operator')),
      deviceScope: currentDeviceScope(),
      template: (tpl && tpl.name) || '',
      storage: storageStatusVal(),
      regUsers: (ROOT.library && ROOT.library.operators) ? ROOT.library.operators.length : 0 };
  }
  function aQueue() { try { return JSON.parse(localStorage.getItem(LS_ANALYTICS) || '[]'); } catch (e) { return []; } }
  function aQueueSet(a) { try { localStorage.setItem(LS_ANALYTICS, JSON.stringify(a.slice(-500))); } catch (e) {} }
  var _aLastSig = '', _aLastAt = 0;
  function logEvent(action) {
    if (!analyticsCfg()) return;
    try {
      var ev = buildAnalyticsEvent(action); if (!ev) return;
      var sig = action + '|' + ev.labId + '|' + ev.operator + '|' + ev.template;
      var now = Date.now();
      if (sig === _aLastSig && (now - _aLastAt) < 3000) return;   // drop rapid duplicate clicks
      _aLastSig = sig; _aLastAt = now;
      var q = aQueue(); q.push(ev); aQueueSet(q); flushAnalytics();
    } catch (e) {}
  }
  function flushAnalytics() {
    var cfg = analyticsCfg(); if (!cfg) return;
    var q = aQueue(); if (!q.length) return;
    var batch = q.slice(0, 50);
    var body = JSON.stringify({ key: cfg.key, events: batch });
    try {
      fetch(cfg.url, { method: 'POST', mode: 'no-cors', keepalive: true,
        headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: body })
        .then(function () { aQueueSet(aQueue().slice(batch.length)); })  // assume delivered (opaque response)
        .catch(function () {});                                          // network failure: keep queued, retry next time
    } catch (e) {}
  }

  /* --- rich clipboard: paste a FORMATTED block into the ELN ----------------
   * The ELN (eLabNext) editor is rich-text/HTML: pasting Markdown shows the raw
   * "## ** |" marks. So we put real HTML on the clipboard (rendered headings +
   * tables + the notes), with the Markdown as the plain-text fallback. The
   * HTML tables are themselves machine-readable (Field/Value rows parse cleanly);
   * we also embed the full sidecar JSON as an HTML comment + data-attribute as a
   * best-effort machine record (whether it survives depends on the ELN's
   * sanitiser — the downloaded .json sidecar is the guaranteed canonical form). */
  function clipTable(pairs, c1, c2) {
    var TS = 'border-collapse:collapse;margin:4px 0;', CS = 'border:1px solid #999;padding:4px 9px;text-align:left;';
    var rows = pairs.map(function (p) { return '<tr><td style="' + CS + '">' + esc(p[0]) + '</td><td style="' + CS + '">' + esc(p[1] == null || p[1] === '' ? '—' : p[1]) + '</td></tr>'; }).join('');
    return '<table style="' + TS + '"><thead><tr><th style="' + CS + '">' + esc(c1) + '</th><th style="' + CS + '">' + esc(c2) + '</th></tr></thead><tbody>' + rows + '</tbody></table>';
  }
  // Self-contained HTML (no app CSS classes — those don't exist in the ELN).
  function clipboardHtml() {
    var h = headerObject(); if (!h) return '';
    var html = '<h3 style="margin:0 0 6px">File metadata</h3>'
      + '<p style="margin:0 0 8px"><strong>File name:</strong> <code>' + esc(h.fileName || '(empty)') + '</code><br>';
    if (h.fullPath) html += '<strong>Full path:</strong> <code>' + esc(h.fullPath) + '</code><br>'; else if (h.relPath && h.relPath !== h.fileName) html += '<strong>Relative path:</strong> <code>' + esc(h.relPath) + '</code><br>';
    if (h.literalPath) html += '<strong>Recommended transfer path (NASAC):</strong> <code>' + esc(h.literalPath) + '</code><br>';
    html += '<strong>Lab:</strong> ' + esc(h.lab);
    if (h.department) html += '<br><strong>Department:</strong> ' + esc(h.department);
    if (h.operatorEmail) html += '<br><strong>Operator email:</strong> ' + esc(h.operatorEmail);
    html += '<br><strong>Template:</strong> ' + esc(h.template)
      + '<br><strong>Generated:</strong> ' + fmtDate(new Date(), 'YYYY-MM-DD') + ' ' + fmtDate(new Date(), 'HH:MM') + '</p>';
    html += clipTable(Object.keys(h.fields).map(function (k) { return [k, h.fields[k]]; }), 'Field', 'Value');
    if (h.device) html += '<p style="margin:10px 0 4px"><strong>Device — ' + esc(h.device.name) + '</strong></p>'
      + clipTable(Object.keys(h.device.info).map(function (k) { return [k, h.device.info[k]]; }), 'Property', 'Value');
    if (h.config) html += '<p style="margin:10px 0 4px"><strong>Configuration — ' + esc(h.config.name) + '</strong> (this machine)</p>'
      + clipTable(Object.keys(h.config.settings).map(function (k) { return [k, h.config.settings[k]]; }), 'Setting', 'Value');
    if (notesNonEmpty()) html += '<hr><h3 style="margin:0 0 6px">Notes</h3>' + ROOT.ui.notesHtml;
    return html;
  }
  // Wrap the visible HTML with an embedded machine-readable copy (best-effort).
  function clipboardPayload() {
    var inner = clipboardHtml();
    var json = JSON.stringify(sidecar());
    var html = '<div data-fng-metadata="' + esc(json) + '">' + inner + '</div>'
      + '<!--FNG-METADATA ' + json.replace(/--/g, '\u2013\u2013') + ' FNG-METADATA-->';
    return { html: html, text: notesMarkdown() };
  }
  // Put both text/html and text/plain on the clipboard; fall back gracefully.
  function writeRichClipboard(html, text, done) {
    if (navigator.clipboard && window.ClipboardItem) {
      try {
        navigator.clipboard.write([new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' })
        })]).then(function () { if (done) done(true); }, function () { legacyCopyHtml(html, text, done); });
        return;
      } catch (e) {}
    }
    legacyCopyHtml(html, text, done);
  }
  function legacyCopyHtml(html, text, done) {
    try {
      var holder = document.createElement('div');
      holder.contentEditable = 'true';
      holder.style.cssText = 'position:fixed;left:-9999px;top:0;';
      holder.innerHTML = html;
      document.body.appendChild(holder);
      var range = document.createRange(); range.selectNodeContents(holder);
      var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
      var ok = false; try { ok = document.execCommand('copy'); } catch (e) {}
      sel.removeAllRanges(); document.body.removeChild(holder);
      if (ok) { if (done) done(true); return; }
    } catch (e) {}
    try { if (navigator.clipboard) navigator.clipboard.writeText(text); } catch (e) {}
    if (done) done(false);
  }
  // Every user-input field (not the auto date/counter/lab, not ELN-filled ones) must be
  // filled before a name can be copied/exported. Returns the names still empty.
  function missingInputs() {
    var lab = useLab(); if (!lab) return []; var tpl = useFileTpl(lab); if (!tpl) return [];
    return inputFields(tpl, ROOT.library)
      .filter(function (f) { return !elnAutoValueFor(f) && !String(ROOT.ui.values[f.id] || '').trim(); })
      .map(function (f) { return f.name; });
  }
  // Gate before copy/export: if anything's missing, pop up the list and stop.
  function guard() {
    var m = missingInputs();
    if (m.length) { ROOT.ui.missList = m; ROOT.ui.missOpen = true; rerender(); return false; }
    return true;
  }
  function missModal() {
    if (!ROOT.ui.missOpen) return '';
    var list = ROOT.ui.missList || [];
    return '<div class="fng-modal" onclick="if(event.target===this)' + R() + '.closeMiss()">'
      + '<div class="fng-modal-card"><div class="fng-modal-h"><h3 style="margin:0">Complete the file name</h3>'
      + '<button class="fng-modal-x" title="Close" onclick="' + R() + '.closeMiss()">✕</button></div>'
      + '<p class="fng-muted">Fill in the following field' + (list.length > 1 ? 's' : '') + ' before copying the file name:</p>'
      + '<ul style="margin:6px 0 0;padding-left:20px;line-height:1.9">'
      + list.map(function (n) { return '<li><b style="color:#f0604a">' + esc(n) + '</b></li>'; }).join('')
      + '</ul><div class="fng-acts" style="margin-top:14px"><button class="fng-btn pri" onclick="' + R() + '.closeMiss()">OK</button></div></div></div>';
  }
  ROOT.closeMiss = function () { ROOT.ui.missOpen = false; rerender(); };

  ROOT.copyName = function () {
    if (!guard()) return;
    copyText(curName()); pushHistory(curName()); saveFieldHistories(); logEvent('name');
    var b = document.getElementById('fng-copybtn');
    if (b) { var o = b.innerHTML; b.classList.add('ok'); b.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><polyline points="20 6 9 17 4 12"></polyline></svg>'; setTimeout(function () { b.classList.remove('ok'); b.innerHTML = o; }, 1300); }
    toast('File name copied.');
  };
  ROOT.copyPath = function () { if (!guard()) return; var lit = showLiteralPath(); copyText(lit ? curPath() : relPath()); toast(lit ? 'Full path copied (not verified).' : 'Relative path copied.'); };
  ROOT.copyLocalPath = function () {
    var fp = fullLocalPath();
    copyText(fp || relPath());
    var b = document.getElementById('fng-localcopy');
    if (b) { var o = b.innerHTML; b.classList.add('ok'); b.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><polyline points="20 6 9 17 4 12"></polyline></svg>'; setTimeout(function () { b.classList.remove('ok'); b.innerHTML = o; }, 1300); }
    toast(fp ? 'Full path copied.' : 'Relative path copied.');
  };
  ROOT.downloadSidecar = function () { if (!guard()) return; var name = curName(); if (!name) return; pushHistory(name); saveFieldHistories(); download(name + '.json', JSON.stringify(sidecar(), null, 2), 'application/json'); logEvent('sidecar'); };
  ROOT.copyMarkdown = function () { copyText(notesMarkdown()); toast('Metadata (Markdown) copied.'); };
  // copy the whole metadata + notes block (the icon at the doc's top-right) as
  // FORMATTED HTML so it pastes nicely into the ELN, with a flash.
  ROOT.copyDoc = function () {
    var p = clipboardPayload(); logEvent('eln');
    var b = document.getElementById('fng-md-copybtn');
    if (b) { var o = b.innerHTML; b.classList.add('ok'); b.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><polyline points="20 6 9 17 4 12"></polyline></svg>'; setTimeout(function () { b.classList.remove('ok'); b.innerHTML = o; }, 1300); }
    writeRichClipboard(p.html, p.text, function () { toast('Metadata & notes copied (formatted for the ELN).'); });
    fsSaveMetadataQuietly();
  };
  // eLabNext "go" button. Copies the metadata first (within the click gesture), then
  // opens eLabNext in a tab this button REUSES (named target 'elabnext'), so repeated
  // clicks focus the same tab instead of piling up duplicates. We open the app root, so
  // eLabNext's own session decides the landing page: already signed in -> dashboard,
  // otherwise its login. We cannot read who is logged into eLabNext (that lives on a
  // different origin), so that choice is made by eLabNext, not here.
  // Optional email prefill: set window.FNG_ELN_URL to a URL containing the token {email}
  // (e.g. a login URL your eLabNext instance accepts); the current operator's email is
  // URL-encoded into it. Leave it unset to just open the root.
  function currentOperatorEmail() {
    try {
      var lab = useLab(); if (!lab) return '';
      var tpl = useFileTpl(lab); if (!tpl) return '';
      var id = null;
      (tpl.fieldIds || []).forEach(function (fid) { var f = fieldById(ROOT.library, fid); if (f && f.source === 'operator') id = fid; });
      if (!id) return '';
      var op = operatorByName(ROOT.ui.values[id] || '');
      return (op && op.email) ? op.email : '';
    } catch (e) { return ''; }
  }
  ROOT.openEln = function (ev) {
    if (ev && ev.preventDefault) ev.preventDefault();
    try { ROOT.copyDoc(); } catch (e) {}
    var base = (typeof window !== 'undefined' && window.FNG_ELN_URL) || 'https://smartlab.unige.ch';
    var dest = (base.indexOf('{email}') !== -1) ? base.replace('{email}', encodeURIComponent(currentOperatorEmail())) : base;
    try { var w = window.open(dest, 'elabnext'); if (w && w.focus) w.focus(); }
    catch (e) { try { window.open(dest, '_blank'); } catch (e2) {} }
    return false;
  };
  ROOT.downloadMarkdown = function () { if (!guard()) return; var name = curName(); if (!name) return; pushHistory(name); saveFieldHistories(); download(name + '.md', notesMarkdown(), 'text/markdown'); logEvent('md'); };

  // advance counters for the next file; reset clears what the user typed
  function bumpCounters() {
    var lab = useLab(); if (!lab) return; var tpl = useFileTpl(lab); if (!tpl) return;
    var ctx = { now: new Date(), tplId: tpl.id };
    (tpl.fieldIds || []).forEach(function (id) { var f = fieldById(ROOT.library, id); if (f && f.source === 'counter') counterBump(f, ctx); });
  }
  ROOT.nextRun = function () { bumpCounters(); rerender(); toast('Counter advanced for the next file.'); };
  ROOT.resetForm = function () { ROOT.ui.values = {}; ROOT.ui.notesHtml = ''; ROOT.ui.dateOverride = ''; rerender(); };

  // recent file names on this machine
  function pushHistory(name) {
    if (!name) return;
    var h = recentNames(); h = h.filter(function (x) { return x !== name; }); h.unshift(name); h = h.slice(0, 10);
    try { localStorage.setItem(LS_HIST, JSON.stringify(h)); } catch (e) {}
  }
  function recentNames() { try { return JSON.parse(localStorage.getItem(LS_HIST) || '[]') || []; } catch (e) { return []; } }
  ROOT.copyRecent = function (i) { var h = recentNames(); copyText(h[i] || ''); toast('Copied.'); };
  // per-text-field value history (autocomplete), kept on this machine
  function fieldHistory(id) { try { return JSON.parse(localStorage.getItem('fng.hist.' + id) || '[]') || []; } catch (e) { return []; } }
  function pushFieldHistory(id, val) {
    val = String(val == null ? '' : val).trim(); if (!val) return;
    var h = fieldHistory(id).filter(function (x) { return x !== val; }); h.unshift(val);
    try { localStorage.setItem('fng.hist.' + id, JSON.stringify(h.slice(0, 15))); } catch (e) {}
  }
  function saveFieldHistories() {
    var lab = useLab(); if (!lab) return; var tpl = useFileTpl(lab); if (!tpl) return;
    inputFields(tpl, ROOT.library).forEach(function (f) { if (f.source === 'freetext') pushFieldHistory(f.id, ROOT.ui.values[f.id]); });
  }
  ROOT.recordToSection = function (section, expJournalID) {
    if (!guard()) return;
    var o = sidecar(), h = o.header; if (!h || !h.fileName) return;
    pushHistory(h.fileName); saveFieldHistories();
    var rows = '<tr><td style="color:#6b7592;padding-right:10px">File name</td><td><strong>' + esc(h.fileName) + '</strong></td></tr>';
    if (h.fullPath) rows += '<tr><td style="color:#6b7592">Full path</td><td>' + esc(h.fullPath) + '</td></tr>'; else if (h.relPath) rows += '<tr><td style="color:#6b7592">Relative path</td><td>' + esc(h.relPath) + '</td></tr>';
    if (h.literalPath) rows += '<tr><td style="color:#6b7592">Recommended transfer path (NASAC)</td><td>' + esc(h.literalPath) + '</td></tr>';
    rows += '<tr><td style="color:#6b7592">Lab</td><td>' + esc(h.lab) + '</td></tr>'
          + '<tr><td style="color:#6b7592">Template</td><td>' + esc(h.template) + '</td></tr>';
    Object.keys(h.fields || {}).forEach(function (k) {
      rows += '<tr><td style="color:#6b7592">' + esc(k) + '</td><td>' + esc(h.fields[k] || '—') + '</td></tr>';
    });
    if (h.device) {
      rows += '<tr><td style="color:#6b7592">Device info</td><td><strong>' + esc(h.device.name) + '</strong></td></tr>';
      Object.keys(h.device.info).forEach(function (k) {
        rows += '<tr><td style="color:#6b7592;padding-left:14px">↳ ' + esc(k) + '</td><td>' + esc(h.device.info[k]) + '</td></tr>';
      });
    }
    var html = '<div style="font-family:monospace;font-size:13px;color:#e8edf5;">'
      + '<div style="color:#4af0a0;font-size:11px;letter-spacing:.1em;margin-bottom:6px;">FAIR FILE NAMER · FILE METADATA</div>'
      + '<table style="border-collapse:collapse;font-size:13px;">' + rows + '</table>'
      + '<div style="font-size:11px;color:#6b7592;margin-top:6px;">generated ' + esc(h.generatedAt) + '</div>'
      + (htmlToText(o.notesHtml || '').replace(/\u00a0/g, '').trim() ? '<div style="font-size:12px;color:#9fb0cf;margin-top:6px;"><b>Notes:</b><br>' + o.notesHtml + '</div>' : '') + '</div>';
    var sec = section || (ROOT._sectionData && ROOT._sectionData.section);
    try { if (sec && sec.setContent) sec.setContent(html); } catch (e) {}
    try { if (sec && sec.saveHtmlContent) sec.saveHtmlContent(html, expJournalID || (ROOT._sectionData && ROOT._sectionData.expJournalID)); } catch (e) {}
    toast('Recorded into the experiment.');
  };

  /* ==========================================================================
   * MANAGE MODE (master user)
   * ======================================================================== */
  function buildLab() { return labById(ROOT.build.labId) || labs()[0] || null; }
  function buildTpls(lab) { return tplsOf(lab, ROOT.build.kind); }
  function buildTpl(lab) {
    var list = buildTpls(lab);
    var t = list.filter(function (x) { return x.id === ROOT.build.tplId; })[0] || list[0] || null;
    if (t) ROOT.build.tplId = t.id;
    return t;
  }

  function renderManage() {
    var L = ROOT.library;
    if (!labs().length) {
      return '<p class="fng-muted">No labs yet.</p><div class="fng-acts"><button class="fng-btn pri" onclick="' + R() + '.addLab()">+ Create the first lab</button></div>' + manageLists();
    }
    var lab = buildLab(); ROOT.build.labId = lab.id;

    var labSel = '<div class="fng-f"><span class="fng-l">Lab</span><select class="fng-sel" onchange="' + R() + '.buildLab(this.value)">'
      + labs().map(function (l) { return '<option value="' + esc(l.id) + '"' + (l.id === lab.id ? ' selected' : '') + '>' + esc(l.name) + '</option>'; }).join('') + '</select></div>';

    var kindSel = '<div class="fng-f"><span class="fng-l">Template type</span><select class="fng-sel" onchange="' + R() + '.setKind(this.value)">'
      + '<option value="file"' + (ROOT.build.kind === 'file' ? ' selected' : '') + '>File name</option>'
      + '<option value="folder"' + (ROOT.build.kind === 'folder' ? ' selected' : '') + '>Folder path</option></select></div>';

    var list = buildTpls(lab), tpl = buildTpl(lab);
    var tplSel = list.length
      ? '<div class="fng-f"><span class="fng-l">Template</span><select class="fng-sel" onchange="' + R() + '.pickTpl(this.value)">'
        + list.map(function (t) { return '<option value="' + esc(t.id) + '"' + (tpl && t.id === tpl.id ? ' selected' : '') + '>' + esc(t.name) + (t.default ? ' (default)' : '') + '</option>'; }).join('') + '</select></div>'
      : '<span class="fng-muted">no templates yet</span>';

    var head = '<div class="fng-row">' + labSel + kindSel + tplSel
      + '<button class="fng-btn sm" onclick="' + R() + '.addTpl()">+ New</button>'
      + (tpl ? '<button class="fng-btn sm" onclick="' + R() + '.dupTpl()">Duplicate</button><button class="fng-btn sm" onclick="' + R() + '.delTpl()">Delete</button>' : '')
      + '</div>';

    var editor = tpl ? tileEditor(lab, tpl) : '<p class="fng-muted" style="margin-top:12px">Create a template to start.</p>';

    var col = hasCollisions();
    // Edits auto-save on this machine (no Save button needed). Publishing shares them with the lab.
    var saveBar = '<div class="fng-acts">'
      + (col ? '<button class="fng-btn" disabled title="Resolve duplicates first">Publish changes</button>'
             : '<button class="fng-btn pri" onclick="' + R() + '.publish()">Publish changes</button>')
      + '<button class="fng-btn" onclick="' + R() + '.importLib()">Import library JSON</button>'
      + '</div>'
      + '<div class="fng-f" style="max-width:640px;margin-top:8px"><span class="fng-l">GitLab Web IDE link — derived automatically from this page&rsquo;s address</span>'
      + '<input class="fng-in" readonly value="' + esc(publishLink() || 'set window.FNG_PUBLISH_BASE in index.html') + '"></div>'
      + (col ? '<p style="margin-top:6px;color:#f0604a;font-size:12px">⚠ Resolve the duplicate identifiers flagged with <b>!</b> below before publishing.</p>'
             : '<p class="fng-muted" style="margin-top:6px">Your edits are kept on this machine automatically. <b>Publish changes</b> downloads <code>library.json</code> and copies it — send it to a master to commit, or commit it yourself if you have GitLab access.</p>');

    var warn = '<div class="fng-warn">⚠ Anyone can make changes for your lab here, but changes only take effect once a '
      + '<b>master user</b> in your lab publishes them to the lab repository. Click <b>Publish changes</b> for step‑by‑step instructions.</div>';
    return publishCard() + warn + manageTiles() + renderTplBuilder() + renderLabsOperators() + renderImportReview() + fieldDialog() + publishDialog();
  }

  function publishCard() {
    var col = hasCollisions(), pending = isDirty();
    var pubBtn = col
      ? '<button class="fng-btn" disabled title="Resolve the duplicate identifiers (flagged !) before publishing.">Publish changes</button>'
      : (pending
          ? '<button class="fng-btn pri" title="Download your updated library.json and get step-by-step GitLab instructions to publish it to the lab. Do this after making changes so they reach everyone." onclick="' + R() + '.publish()">Publish changes</button>'
          : '<button class="fng-btn" disabled title="No unpublished changes yet. Edit a template, device, lab or operator and this button lights up.">Publish changes</button>');
    var note = col
      ? '<p style="margin-top:6px;color:#f0604a;font-size:12px">⚠ Resolve the duplicate identifiers flagged with <b>!</b> first.</p>'
      : (pending
          ? '<p class="fng-muted" style="margin-top:6px"><b>You have unpublished changes.</b> Click <b>Publish changes</b> to send them to the lab.</p>'
          : '<p class="fng-muted" style="margin-top:6px">No unpublished changes.</p>');
    return '<div class="fng-card"><h3 style="margin-top:0">Publishing</h3>'
      + '<p class="fng-muted">Your edits are saved on this machine automatically. To share them with your lab, publish.</p>'
      + '<div class="fng-row" style="margin-top:6px;gap:8px;flex-wrap:wrap">' + pubBtn
      + '<button class="fng-btn" title="Load a library.json file (for example one a colleague exported, or a backup) and replace the current library on this machine." onclick="' + R() + '.importLib()">Import library JSON</button></div>'
      + '<div class="fng-f" style="max-width:640px;margin-top:8px"><span class="fng-l">GitLab Web IDE link — derived automatically from this page&rsquo;s address</span>'
      + '<input class="fng-in" readonly value="' + esc(publishLink() || 'set window.FNG_PUBLISH_BASE in index.html') + '"></div>'
      + note + '</div>';
  }
  function tile(cls, icon, title, desc, onclick) {
    return '<button type="button" class="fng-mtile ' + cls + '" title="' + desc + '" onclick="' + onclick + '">'
      + '<span class="fng-mtile-i">' + icon + '</span>'
      + '<span class="fng-mtile-t">' + title + '</span></button>';
  }
  function manageTiles() {
    return '<div class="fng-mtiles">'
      + tile('t-build', '<svg viewBox=\"0 0 160 120\" width=\"50\" height=\"38\" xmlns=\"http://www.w3.org/2000/svg\" aria-hidden=\"true\"><g fill=\"#3F7FD6\"><rect x=\"20\" y=\"84\" width=\"7\" height=\"6\" rx=\"1.5\"/><rect x=\"31\" y=\"84\" width=\"7\" height=\"6\" rx=\"1.5\"/><rect x=\"15\" y=\"90\" width=\"28\" height=\"24\" rx=\"4\"/></g><g fill=\"#7F77DD\"><rect x=\"54\" y=\"84\" width=\"7\" height=\"6\" rx=\"1.5\"/><rect x=\"65\" y=\"84\" width=\"7\" height=\"6\" rx=\"1.5\"/><rect x=\"49\" y=\"90\" width=\"28\" height=\"24\" rx=\"4\"/></g><g fill=\"#E06A3C\"><rect x=\"122\" y=\"84\" width=\"7\" height=\"6\" rx=\"1.5\"/><rect x=\"133\" y=\"84\" width=\"7\" height=\"6\" rx=\"1.5\"/><rect x=\"117\" y=\"90\" width=\"28\" height=\"24\" rx=\"4\"/></g><g fill=\"none\" stroke=\"#9AA3B2\" stroke-width=\"1.5\" stroke-dasharray=\"4 3\"><rect x=\"88\" y=\"84\" width=\"7\" height=\"6\" rx=\"1.5\"/><rect x=\"99\" y=\"84\" width=\"7\" height=\"6\" rx=\"1.5\"/><rect x=\"83\" y=\"90\" width=\"28\" height=\"24\" rx=\"4\" fill=\"rgba(154,163,178,0.12)\"/></g><g fill=\"#2CC98A\" transform=\"rotate(-14 106 36)\"><rect x=\"97\" y=\"18\" width=\"7\" height=\"6\" rx=\"1.5\"/><rect x=\"108\" y=\"18\" width=\"7\" height=\"6\" rx=\"1.5\"/><rect x=\"92\" y=\"24\" width=\"28\" height=\"24\" rx=\"4\"/></g><path d=\"M116 46 C 110 62, 106 70, 98 81\" fill=\"none\" stroke=\"#2CC98A\" stroke-width=\"2.5\" stroke-linecap=\"round\"/><path d=\"M98 82 L105 75 L103 86 Z\" fill=\"#2CC98A\"/></svg>', 'Build templates', 'Create and edit file-name and folder templates, custom fields, and the live example.', R() + '.openTplBuilder()')
      + tile('t-dev', '🔬', 'Manage devices', 'Add and edit lab acquisition devices, and browse the shared platform devices.', R() + '.openDevManager(true)')
      + tile('t-labs', '👥', 'Edit labs and operators', 'Maintain the list of labs (with departments) and operators with their initials.', R() + '.openLabsOps()')
      + '</div>';
  }
  function renderTplBuilder() {
    if (!ROOT.ui.tplOpen || !labs().length) return '';
    var lab = buildLab(); ROOT.build.labId = lab.id;
    var labSel = '<div class="fng-f"><span class="fng-l">Lab</span><select class="fng-sel" onchange="' + R() + '.buildLab(this.value)">'
      + labs().map(function (l) { return '<option value="' + esc(l.id) + '"' + (l.id === lab.id ? ' selected' : '') + '>' + esc(l.name) + '</option>'; }).join('') + '</select></div>';
    var kindSel = '<div class="fng-f"><span class="fng-l">Template type</span><select class="fng-sel" onchange="' + R() + '.setKind(this.value)">'
      + '<option value="file"' + (ROOT.build.kind === 'file' ? ' selected' : '') + '>File name</option>'
      + '<option value="folder"' + (ROOT.build.kind === 'folder' ? ' selected' : '') + '>Folder path</option></select></div>';
    var list = buildTpls(lab), tpl = buildTpl(lab);
    var tplSel = list.length
      ? '<div class="fng-f"><span class="fng-l">Template</span><select class="fng-sel" onchange="' + R() + '.pickTpl(this.value)">'
        + list.map(function (t) { return '<option value="' + esc(t.id) + '"' + (tpl && t.id === tpl.id ? ' selected' : '') + '>' + esc(t.name) + (t.default ? ' (default)' : '') + '</option>'; }).join('') + '</select></div>'
      : '<span class="fng-muted">no templates yet</span>';
    var head = '<div class="fng-row">' + labSel + kindSel + tplSel
      + '<button class="fng-btn sm" onclick="' + R() + '.addTpl()">+ New</button>'
      + (tpl ? '<button class="fng-btn sm" onclick="' + R() + '.dupTpl()">Duplicate</button><button class="fng-btn sm" onclick="' + R() + '.delTpl()">Delete</button>' : '')
      + '</div>';
    var editor = tpl ? tileEditor(lab, tpl) : '<p class="fng-muted" style="margin-top:12px">Create a template to start.</p>';
    return '<div class="fng-modal" onclick="if(event.target===this)' + R() + '.closeTplBuilder()">'
      + '<div class="fng-modal-card fng-bigcard"><div class="fng-modal-h"><h3 style="margin:0">Building templates</h3>'
      + '<button class="fng-modal-x" title="Close" onclick="' + R() + '.closeTplBuilder()">✕</button></div>'
      + head + editor
      + '<div class="fng-acts" style="margin-top:12px"><button class="fng-btn pri" onclick="' + R() + '.closeTplBuilder()">Close</button></div></div></div>';
  }
  function renderLabsOperators() {
    if (!ROOT.ui.labsOpen) return '';
    return '<div class="fng-modal" onclick="if(event.target===this)' + R() + '.closeLabsOps()">'
      + '<div class="fng-modal-card fng-bigcard"><div class="fng-modal-h"><h3 style="margin:0">Edit labs and operators</h3>'
      + '<button class="fng-modal-x" title="Close" onclick="' + R() + '.closeLabsOps()">✕</button></div>'
      + manageLists()
      + '<div class="fng-acts" style="margin-top:12px"><button class="fng-btn pri" onclick="' + R() + '.closeLabsOps()">Close</button></div></div></div>';
  }
  // The simple part: tiles you drag + a live example.
  function tileEditor(lab, tpl) {
    var L = ROOT.library;
    var nameRow = '<div class="fng-row" style="margin:12px 0 4px">'
      + '<div class="fng-f" style="flex:1;min-width:160px"><span class="fng-l">Template name</span>'
      + '<input class="fng-in" value="' + esc(tpl.name) + '" oninput="' + R() + '.setTplName(this.value)"></div>'
      + '<div class="fng-f"><span class="fng-l">Separator</span>'
      + '<input class="fng-in fng-sep" value="' + esc(tpl.separator || (ROOT.build.kind === 'folder' ? '/' : '_')) + '" maxlength="1" oninput="' + R() + '.setSep(this.value)"></div>'
      + '<div class="fng-f"><span class="fng-l">Default for lab</span>'
      + '<select class="fng-sel" onchange="' + R() + '.setDefault(this.value)"><option value="0">no</option><option value="1"' + (tpl.default ? ' selected' : '') + '>yes</option></select></div>'
      + '</div>';

    var baseRow = ROOT.build.kind === 'folder'
      ? '<div class="fng-f" style="margin:8px 0"><span class="fng-l">Recommended transfer destination (NASAC) — written in the metadata as where to archive the raw data; the tool never asserts the file is already there</span>'
        + '<input class="fng-in" value="' + esc(tpl.basePath || '') + '" placeholder="//nasac-m2.isis.unige.ch/m-GHoltmaat/GHoltmaat/USERS/" oninput="' + R() + '.setBasePath(this.value)"></div>'
      : '';

    // tiles already in the template (ordered) — live drag-to-reorder
    var tiles = (tpl.fieldIds || []).map(function (id, i) {
      var f = fieldById(L, id); if (!f) return '';
      return '<span class="fng-tile" draggable="true" data-fid="' + esc(f.id) + '" '
        + 'ondblclick="' + R() + '.openField(\'' + f.id + '\')" '
        + 'ondragstart="' + R() + '.tileDragStart(event)" ondragend="' + R() + '.tileDragEnd(event)">'
        + dot(i) + esc(f.name)
        + '<button class="rm" title="move left" onclick="' + R() + '.moveTile(' + i + ',-1)">◀</button>'
        + '<button class="rm" title="move right" onclick="' + R() + '.moveTile(' + i + ',1)">▶</button>'
        + '<button class="rm" title="edit attributes" onclick="' + R() + '.openField(\'' + f.id + '\')">✎</button>'
        + '<button class="rm" title="remove" onclick="' + R() + '.removeTile(' + i + ')">✕</button></span>';
    }).join('') || '<span class="fng-muted">Click fields below to add them.</span>';

    // available fields not yet used
    var used = {}; (tpl.fieldIds || []).forEach(function (id) { used[id] = 1; });
    var avail = L.fields.filter(function (f) { return !used[f.id]; }).map(function (f) {
      return '<span class="fng-tile" onclick="' + R() + '.addTile(\'' + f.id + '\')">+ ' + esc(f.name) + '</span>';
    }).join('') || '<span class="fng-muted">all fields are in use</span>';

    return nameRow + baseRow
      + '<p class="lead">Drag the tiles to set the order (they shift as you drag). <b>Double-click</b> (or ✎) a tile to edit its format. ✕ removes it; click a field below to add it.</p>'
      + '<div class="fng-tiles" id="fng-tilebox" ondragover="' + R() + '.tileDragOver(event)" ondrop="' + R() + '.tileDrop(event)">' + tiles + '</div>'
      + '<h3 style="margin-top:14px">Available fields</h3>'
      + '<div class="fng-tiles fng-avail">' + avail + '</div>'
      + customFieldsCard()
      + buildExample(lab, tpl);
  }

  function buildExample(lab, tpl) {
    var L = ROOT.library, ctx = { now: new Date(), tplId: tpl.id, lab: lab };
    var sample = {};
    inputFields(tpl, L).forEach(function (f) {
      if (f.source === 'department') sample[f.id] = (DEPARTMENTS[0] || {}).code || 'DEPT';
      else if (f.source === 'operator') sample[f.id] = opName(L.operators[0]) || 'Marie Curie';
      else if (f.source === 'device') sample[f.id] = ((L.devices || [])[0] || {}).name || '2P-B';
      else if (f.source === 'list') sample[f.id] = (f.options || ['Opt'])[0];
      else sample[f.id] = f.name === 'Project' ? 'VIPlearning' : f.name === 'Sample' ? 'M042' : f.name;
    });
    var segs = (tpl.fieldIds || []).map(function (id, i) {
      var v = encodeField(fieldById(L, id), sample, ctx);
      return v ? '<span style="color:' + SEG[i % SEG.length] + '">' + esc(v) + '</span>' : '';
    }).filter(Boolean);
    var sepc = '<span class="sep">' + esc(tpl.separator || '_') + '</span>';
    var prefix = (ROOT.build.kind === 'folder' && tpl.basePath) ? '<span class="fng-muted">' + esc(normPath(tpl.basePath)) + '</span><span class="sep">/</span>' : '';
    return '<div class="fng-ex" id="fng-bex"><div class="h">Live example</div><div class="fng-name">'
      + (segs.length ? prefix + segs.join(sepc) : '<span class="fng-muted">add fields to see the result</span>') + '</div></div>';
  }
  function refreshExample() {
    var lab = buildLab(); if (!lab) return; var tpl = buildTpl(lab); if (!tpl) return;
    var el = document.getElementById('fng-bex'); if (el) el.outerHTML = buildExample(lab, tpl);
  }

  // ---- per-field attribute popup (double-click a tile) -------------------
  function fieldSample(f) {
    if (f.source === 'department') return (DEPARTMENTS[0] || {}).code || 'NEUFO';
    if (f.source === 'operator')   return opName(ROOT.library.operators[0]) || 'Marie Curie';
    if (f.source === 'lab')        return (labs()[0] || {}).name || 'Demo Lab';
    if (f.source === 'device')     return ((ROOT.library.devices || [])[0] || {}).name || '2P-B';
    if (f.source === 'list')       return (f.options || ['Option'])[0];
    return f.name === 'Condition' ? 'baseline drug' : f.name === 'Project' ? 'VIP learning' : f.name;
  }
  function fieldDialog() {
    var id = ROOT.fieldDlg && ROOT.fieldDlg.fieldId; if (!id) return '';
    var f = fieldById(ROOT.library, id); if (!f) return '';
    var rows = '<div class="fng-f"><span class="fng-l">Field name</span>'
      + '<input class="fng-in" value="' + esc(f.name) + '" oninput="' + R() + '.setFieldName(\'' + id + '\',this.value)"></div>';

    if (f.source === 'date') {
      var dtf = ['YYYYMMDD', 'YYYY-MM-DD', 'YYMMDD', 'YYYYMM', 'YYYY', 'YYYYMMDD_HHMM', 'YYYYMMDD_HHMMSS', 'YYYY-MM-DD_HH-MM', 'HHMM', 'HHMMSS'];
      var cur = f.format || 'YYYYMMDD';
      rows += '<div class="fng-f"><span class="fng-l">Date / time format</span><select class="fng-sel" onchange="' + R() + '.setFieldFormat(\'' + id + '\',this.value)">'
        + dtf.map(function (t) { return '<option value="' + t + '"' + (t === cur ? ' selected' : '') + '>' + t + ' — ' + esc(fmtDate(new Date(), t)) + '</option>'; }).join('') + '</select></div>'
        + '<p class="fng-muted">In the file name now: <b>' + esc(fmtDate(new Date(), cur)) + '</b>. Use <code>_HHMM</code> for minute or <code>_HHMMSS</code> for second precision.</p>';
    } else if (f.source === 'counter') {
      var cctx = { now: new Date(), tplId: (buildTpl(buildLab()) || {}).id };
      rows += '<div class="fng-f"><span class="fng-l">Padding (digits)</span><input class="fng-in" type="number" min="1" max="6" value="' + (f.pad || 2) + '" onchange="' + R() + '.setFieldNum(\'' + id + '\',\'pad\',this.value)"></div>'
        + '<div class="fng-f"><span class="fng-l">Reset</span><select class="fng-sel" onchange="' + R() + '.setFieldScope(\'' + id + '\',this.value)">'
        + ['daily', 'global'].map(function (s) { return '<option value="' + s + '"' + ((f.scope || 'daily') === s ? ' selected' : '') + '>' + (s === 'daily' ? 'every day' : 'never (global)') + '</option>'; }).join('') + '</select></div>'
        + '<p class="fng-muted">Next value: <b>' + esc(pad(counterNext(f, cctx), f.pad || 2)) + '</b> · <a class="fng-x2" onclick="' + R() + '.resetCounter(\'' + id + '\')">reset counter</a>. Advances when you click <b>Next run ▸</b> in Use.</p>';
    } else {
      var sample = fieldSample(f), curf = f.format || 'full';
      var opts = [['full', 'Full (cleaned value)'], ['acronym', 'Initials / acronym'], ['first3', 'First 3 letters'], ['lastlower', 'Last name (lowercase)'], ['upper', 'UPPERCASE'], ['lower', 'lowercase']];
      if (f.source !== 'operator' && f.source !== 'lab') opts.splice(1, 0, ['initial', 'First initial']);
      rows += '<div class="fng-f"><span class="fng-l">File-name format</span><select class="fng-sel" onchange="' + R() + '.setFieldFormat(\'' + id + '\',this.value)">'
        + opts.map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === curf ? ' selected' : '') + '>' + o[1] + ' — “' + esc(applyFmt(sample, o[0])) + '”</option>'; }).join('') + '</select></div>';
      if (f.source === 'list') {
        rows += '<div class="fng-f"><span class="fng-l">Options (comma-separated)</span>'
          + '<input class="fng-in" value="' + esc((f.options || []).join(', ')) + '" oninput="' + R() + '.setFieldOptions(\'' + id + '\',this.value)"></div>';
      }
      if (f.source !== 'lab') {
        rows += '<div class="fng-f"><span class="fng-l">Required</span><select class="fng-sel" onchange="' + R() + '.setFieldReq(\'' + id + '\',this.value)"><option value="0">no</option><option value="1"' + (f.required ? ' selected' : '') + '>yes</option></select></div>';
      }
      rows += '<p class="fng-muted">Example for “' + esc(sample) + '” → <b>' + esc(applyFmt(sample, curf)) + '</b> in the file name. ' + (f.source === 'operator' || f.source === 'lab' ? 'Initials/first-3 are managed (and disambiguated) in the table. ' : '') + 'The <b>full value is always kept in the metadata</b>.</p>';
    }

    return '<div class="fng-modal" onclick="if(event.target===this)' + R() + '.closeField()">'
      + '<div class="fng-modal-card"><div class="fng-modal-h"><h3 style="margin:0">Edit field — ' + esc(f.name) + '</h3>'
      + '<button class="fng-modal-x" title="Close" onclick="' + R() + '.closeField()">✕</button></div>'
      + rows
      + '<div class="fng-acts"><button class="fng-btn pri" onclick="' + R() + '.closeField()">Done</button></div></div></div>';
  }
  ROOT.openField = function (id) { ROOT.fieldDlg.fieldId = id; rerender(); };
  ROOT.closeField = function () { ROOT.fieldDlg.fieldId = null; rerender(); };
  ROOT.setFieldName = function (id, v) { var f = fieldById(ROOT.library, id); if (f) f.name = v; dirty(); };  // no rerender (keep focus)
  ROOT.setFieldFormat = function (id, v) { var f = fieldById(ROOT.library, id); if (f) f.format = v; rerender(); };
  ROOT.setFieldOptions = function (id, v) { var f = fieldById(ROOT.library, id); if (f) f.options = v.split(',').map(function (s) { return s.trim(); }).filter(Boolean); dirty(); };
  ROOT.setFieldReq = function (id, v) { var f = fieldById(ROOT.library, id); if (f) f.required = (v === '1'); rerender(); };
  ROOT.setFieldNum = function (id, prop, v) { var f = fieldById(ROOT.library, id); if (f) f[prop] = (v === '' ? undefined : parseInt(v, 10)); rerender(); };
  ROOT.setFieldScope = function (id, v) { var f = fieldById(ROOT.library, id); if (f) f.scope = v; rerender(); };
  ROOT.resetCounter = function (id) { try { var pre = 'fng.counter.' + id + '.'; for (var i = localStorage.length - 1; i >= 0; i--) { var k = localStorage.key(i); if (k && k.indexOf(pre) === 0) localStorage.removeItem(k); } } catch (e) {} rerender(); toast('Counter reset.'); };

  // --- the lists & fields the master maintains (kept out of the way) ---
  function manageLists() {
    var L = ROOT.library;
    var opList = L.operators || [];
    // an editable cell: input + (when duplicated) a red ! after it
    function cellInput(jsCall, val, bad, w) {
      return '<td><input class="fng-in' + (bad ? ' fng-dupin' : '') + '" style="width:' + (w || 120) + 'px" value="' + esc(val) + '" onchange="' + jsCall + '">' + (bad ? '<span class="fng-bang" title="Duplicate — make it unique"> !</span>' : '') + '</td>';
    }
    // Full name | Initials | First 3 table shared by operators and labs; flags any
    // column whose value matches another row, and lets the manager edit it.
    function deptCell(l) {
      return '<td><select class="fng-sel" style="min-width:160px" onchange="' + R() + '.setLabDept(\'' + l.id + '\',this.value)"><option value="">— none —</option>'
        + DEPARTMENTS.map(function (d) { return '<option value="' + esc(d.code) + '"' + (l.dept === d.code ? ' selected' : '') + '>' + esc(d.code) + ' — ' + esc(d.label) + '</option>'; }).join('')
        + '</select></td>';
    }
    function emailCell(e, i) {
      return '<td><input class="fng-in" type="email" style="width:190px" placeholder="name@unige.ch" value="' + esc(e.email || '') + '" onchange="' + R() + '.setOperatorEmail(' + i + ',this.value)"></td>';
    }
    function abbrTable(list, keyOf, fns, extraCell) {
      var fullV = list.map(function (e) { return applyFmt(opName(e), 'full'); });
      var iniV = list.map(abbrIni), f3V = list.map(abbrF3);
      var fD = countMap(fullV), iD = countMap(iniV), tD = countMap(f3V), any = false;
      var rows = list.map(function (e, i) {
        var k = keyOf(e, i);
        var fb = fullV[i] && fD[fullV[i]] > 1, ib = iniV[i] && iD[iniV[i]] > 1, tb = f3V[i] && tD[f3V[i]] > 1;
        if (fb || ib || tb) any = true;
        var iniDisp = (e.initials != null && e.initials !== '') ? e.initials : applyFmt(opName(e), 'acronym');
        var f3Disp = (e.first3 != null && e.first3 !== '') ? e.first3 : applyFmt(opName(e), 'first3');
        return '<tr>' + cellInput(R() + '.' + fns.name + '(' + k + ',this.value)', opName(e), fb, 150)
          + cellInput(R() + '.' + fns.ini + '(' + k + ',this.value)', iniDisp, ib, 80)
          + cellInput(R() + '.' + fns.f3 + '(' + k + ',this.value)', f3Disp, tb, 80)
          + (extraCell ? extraCell(e, i) : '')
          + '<td><button class="fng-btn sm" title="remove" onclick="' + R() + '.' + fns.del + '(' + k + ')">✕</button></td></tr>';
      }).join('');
      return { rows: rows, any: any };
    }
    function abbrTableHtml(t, emptyMsg, kind, head, extraHead) {
      return t.rows
        ? '<table class="fng-doc-t"><thead><tr><th>' + head + '</th><th>Initials</th><th>First 3</th>' + (extraHead ? '<th>' + extraHead + '</th>' : '') + '<th></th></tr></thead><tbody>' + t.rows + '</tbody></table>'
          + (t.any ? '<p class="fng-muted" style="margin-top:6px">Fields flagged <span class="fng-bang">!</span> match another ' + kind + ' — edit them to make each unique.</p>' : '')
        : '<span class="fng-muted">' + emptyMsg + '</span>';
    }
    var ops = abbrTableHtml(abbrTable(opList.slice().sort(function (a, b) { return cmpName(opName(a), opName(b)); }), function (e) { return '' + opList.indexOf(e); }, { name: 'setOperatorName', ini: 'setOperatorInitials', f3: 'setOperatorFirst3', del: 'delOperator' }, emailCell), 'no operators yet', 'operator', 'Full name', 'Email');
    var labsTable = abbrTableHtml(abbrTable(labs(), function (l) { return '\'' + l.id + '\''; }, { name: 'setLabName', ini: 'setLabInitials', f3: 'setLabFirst3', del: 'delLab' }, deptCell), 'no labs yet', 'lab', 'Lab name', 'Department');
    var devDup = countMap((L.devices || []).map(function (d) { return d.name; }));

    var devs = (L.devices || []).map(function (d, i) {
      var infoText = Object.keys(d.info || {}).map(function (k) { return k + ': ' + d.info[k]; }).join('\n');
      var dDup = devDup[d.name] > 1;
      return '<div class="fng-card" style="margin-top:8px">'
        + '<div class="fng-row" style="align-items:flex-end"><div class="fng-f" style="flex:1"><span class="fng-l">Device name (used in the file name)' + (dDup ? ' <span class="fng-bang" title="Another device has this name — device names must be unique">!</span>' : '') + '</span>'
        + '<input class="fng-in' + (dDup ? ' fng-dupin' : '') + '" value="' + esc(d.name) + '" onchange="' + R() + '.setDeviceName(' + i + ',this.value)"></div>'
        + '<button class="fng-btn sm" onclick="' + R() + '.delDevice(' + i + ')">Remove</button></div>'
        + '<div class="fng-f" style="margin-top:6px"><span class="fng-l">Generic info — one "Key: value" per line (added to metadata)</span>'
        + '<textarea class="fng-ta" style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px" placeholder="Software: ScanImage" oninput="' + R() + '.setDeviceInfo(' + i + ',this.value)">' + esc(infoText) + '</textarea></div></div>';
    }).join('') || '<span class="fng-muted">no devices yet</span>';

    return '<div class="fng-card"><h3 style="margin-top:0">Labs</h3>'
      + labsTable
      + '<div class="fng-row" style="margin-top:8px"><button class="fng-btn sm" onclick="' + R() + '.addLab()">+ Add lab</button></div></div>'

      + '<div class="fng-card"><h3 style="margin-top:0">Operators</h3>'
      + ops
      + '<div class="fng-row" style="margin-top:8px"><input class="fng-in" id="fng-newop" placeholder="Full name"><button class="fng-btn sm" onclick="' + R() + '.addOperator()">+ Add operator</button></div></div>'

      + '<div class="fng-card"><h3 style="margin-top:0">Departments <span class="fng-muted">(fixed)</span></h3>'
      + '<div class="fng-mini">' + DEPARTMENTS.map(function (d) { return '<span class="fng-chiprm" style="padding-right:11px">' + esc(d.code) + ' — ' + esc(d.label) + '</span>'; }).join('') + '</div></div>';
  }

  // Custom-field management card — shown in the template editor, just below the
  // "Available fields" palette (so a new field appears in the palette right above).
  function customFieldsCard() {
    var L = ROOT.library;
    var customs = L.fields.filter(function (f) { return !f.builtin; });
    var customList = customs.map(function (f) {
      var meta = f.source === 'list' ? 'list: ' + (f.options || []).join(', ') : f.source === 'date' ? 'date ' + f.format : f.source === 'counter' ? 'counter' : 'free text';
      return '<span class="fng-chiprm">' + esc(f.name) + ' <span class="fng-muted">(' + esc(meta) + ')</span><button onclick="' + R() + '.delField(\'' + f.id + '\')">✕</button></span>';
    }).join('') || '<span class="fng-muted">no custom fields</span>';
    var nf = ROOT.newField;
    var typeSel = '<select class="fng-sel" onchange="' + R() + '.setNF(\'type\',this.value)">'
      + ['freetext', 'list', 'date', 'counter'].map(function (t) { return '<option value="' + t + '"' + (nf.type === t ? ' selected' : '') + '>' + (t === 'freetext' ? 'free text' : t) + '</option>'; }).join('') + '</select>';
    var extra = nf.type === 'list'
      ? '<div class="fng-f" style="flex:1"><span class="fng-l">Options (comma-separated)</span><input class="fng-in" value="' + esc(nf.optionsCsv) + '" placeholder="A, B, C" oninput="' + R() + '.setNF(\'optionsCsv\',this.value)"></div>'
      : nf.type === 'date'
        ? '<div class="fng-f"><span class="fng-l">Date format</span><select class="fng-sel" onchange="' + R() + '.setNF(\'format\',this.value)">' + ['YYYYMMDD', 'YYYY-MM-DD', 'YYMMDD', 'YYYYMM', 'YYYY'].map(function (x) { return '<option' + (nf.format === x ? ' selected' : '') + '>' + x + '</option>'; }).join('') + '</select></div>'
        : '';
    return '<div class="fng-card" style="margin-top:8px"><h3 style="margin-top:0">Custom fields</h3>'
      + '<div class="fng-mini">' + customList + '</div>'
      + '<div class="fng-row" style="margin-top:10px;align-items:flex-end">'
      + '<div class="fng-f"><span class="fng-l">Field name</span><input class="fng-in" value="' + esc(nf.name) + '" placeholder="e.g. Stain" oninput="' + R() + '.setNF(\'name\',this.value)"></div>'
      + '<div class="fng-f"><span class="fng-l">Type</span>' + typeSel + '</div>'
      + extra
      + '<button class="fng-btn sm pri" onclick="' + R() + '.addField()">+ Add custom field</button></div></div>';
  }

  /* --- manage mutations --- */
  ROOT.buildLab = function (id) { ROOT.build.labId = id; ROOT.build.tplId = null; rerender(); };
  ROOT.setKind = function (k) { ROOT.build.kind = k; ROOT.build.tplId = null; rerender(); };
  ROOT.pickTpl = function (id) { ROOT.build.tplId = id; rerender(); };
  ROOT.addTpl = function () {
    var lab = buildLab(); if (!lab) return;
    var t = { id: uid('tpl'), name: 'New template', separator: ROOT.build.kind === 'folder' ? '/' : '_', fieldIds: [] };
    buildTpls(lab).push(t); ROOT.build.tplId = t.id; rerender();
  };
  ROOT.dupTpl = function () {
    var lab = buildLab(), t = buildTpl(lab); if (!t) return;
    var c = JSON.parse(JSON.stringify(t)); c.id = uid('tpl'); c.name = t.name + ' copy'; c.default = false;
    buildTpls(lab).push(c); ROOT.build.tplId = c.id; rerender();
  };
  ROOT.delTpl = function () {
    var lab = buildLab(), list = buildTpls(lab), i = list.findIndex(function (t) { return t.id === ROOT.build.tplId; });
    if (i >= 0) list.splice(i, 1); ROOT.build.tplId = null; rerender();
  };
  ROOT.setTplName = function (v) { var t = buildTpl(buildLab()); if (t) t.name = v; dirty(); };
  ROOT.setSep = function (v) { var t = buildTpl(buildLab()); if (t) { t.separator = v || (ROOT.build.kind === 'folder' ? '/' : '_'); refreshExample(); } };
  ROOT.setBasePath = function (v) { var t = buildTpl(buildLab()); if (t) { t.basePath = v; dirty(); refreshExample(); } };
  ROOT.setDefault = function (v) {
    var lab = buildLab(), t = buildTpl(lab); if (!t) return;
    if (v === '1') buildTpls(lab).forEach(function (x) { x.default = false; });
    t.default = v === '1'; rerender();
  };
  ROOT.addTile = function (fid) { var t = buildTpl(buildLab()); if (t) { t.fieldIds.push(fid); rerender(); } };
  ROOT.removeTile = function (i) { var t = buildTpl(buildLab()); if (t) { t.fieldIds.splice(i, 1); rerender(); } };
  ROOT.moveTile = function (i, dir) { var t = buildTpl(buildLab()); if (!t) return; var j = i + dir; if (j < 0 || j >= t.fieldIds.length) return; var m = t.fieldIds.splice(i, 1)[0]; t.fieldIds.splice(j, 0, m); rerender(); };

  // live drag-to-reorder: the dragged tile follows and siblings shift while held
  ROOT.tileDragStart = function (ev) {
    var t = ev.target && ev.target.closest ? ev.target.closest('.fng-tile') : null; if (!t) return;
    t.classList.add('dragging');
    try { ev.dataTransfer.effectAllowed = 'move'; ev.dataTransfer.setData('text/plain', t.getAttribute('data-fid') || ''); } catch (e) {}
  };
  function tileAfter(box, x, y) {
    var els = [].slice.call(box.querySelectorAll('.fng-tile:not(.dragging)'));
    var res = null, closest = -Infinity;
    els.forEach(function (el) {
      var r = el.getBoundingClientRect();
      if (y >= r.top - 6 && y <= r.bottom + 6) {           // same visual row
        var offset = x - (r.left + r.width / 2);
        if (offset < 0 && offset > closest) { closest = offset; res = el; }
      }
    });
    return res;   // insert before this element; null → append to end
  }
  ROOT.tileDragOver = function (ev) {
    ev.preventDefault();
    var box = document.getElementById('fng-tilebox'); if (!box) return;
    var dragging = box.querySelector('.fng-tile.dragging'); if (!dragging) return;
    var after = tileAfter(box, ev.clientX, ev.clientY);
    if (after == null) box.appendChild(dragging); else box.insertBefore(dragging, after);
  };
  ROOT.tileDrop = function (ev) { ev.preventDefault(); };
  ROOT.tileDragEnd = function () {
    var box = document.getElementById('fng-tilebox'); if (!box) return;
    var ids = [].slice.call(box.querySelectorAll('.fng-tile')).map(function (el) { return el.getAttribute('data-fid'); }).filter(Boolean);
    var t = buildTpl(buildLab());
    if (t && ids.length) t.fieldIds = ids;   // commit the DOM order
    rerender();
  };

  // labs
  ROOT.addLab = function () {
    var name = (window.prompt ? window.prompt('New lab name:') : '') || '';
    name = name.trim(); if (!name) return;
    var l = { id: uid('lab'), name: name, fileTemplates: [], folderTemplates: [] };
    labs().push(l); ROOT.build.labId = l.id; ROOT.build.tplId = null; rerender();
  };
  ROOT.setLabName = function (id, v) { var l = labById(id); if (l) l.name = v; rerender(); };
  ROOT.setLabDept = function (id, code) { var l = labById(id); if (l) { l.dept = code; rerender(); } };
  ROOT.setLabInitials = function (id, v) { var l = labById(id); if (l) setOverride(l, 'initials', 'acronym', v); rerender(); };
  ROOT.setLabFirst3 = function (id, v) { var l = labById(id); if (l) setOverride(l, 'first3', 'first3', v); rerender(); };
  ROOT.renameLab = function (id) {
    var l = labById(id); if (!l) return;
    var name = (window.prompt ? window.prompt('Rename lab:', l.name) : l.name); if (name == null) return;
    name = name.trim(); if (name) { l.name = name; rerender(); }
  };
  ROOT.delLab = function (id) {
    if (window.confirm && !window.confirm('Delete this lab and its templates?')) return;
    var i = labs().findIndex(function (l) { return l.id === id; });
    if (i >= 0) labs().splice(i, 1);
    if (ROOT.build.labId === id) { ROOT.build.labId = null; ROOT.build.tplId = null; }
    rerender();
  };

  // operators
  ROOT.addOperator = function () {
    var el = document.getElementById('fng-newop'); var v = el ? el.value.trim() : '';
    if (v) { ROOT.library.operators.push({ name: v }); rerender(); }
  };
  ROOT.delOperator = function (i) { ROOT.library.operators.splice(i, 1); rerender(); };
  // store an initials/first-3 override only when it differs from the auto value (keeps it following the name otherwise)
  function setOverride(e, key, mode, v) { v = (v || '').trim(); var auto = applyFmt(e.name || '', mode); if (!v || sanitizeVal(v) === auto) delete e[key]; else e[key] = v; }
  ROOT.setOperatorName = function (i, v) { var o = ROOT.library.operators[i]; if (o) o.name = v; rerender(); };
  ROOT.setOperatorInitials = function (i, v) { var o = ROOT.library.operators[i]; if (o) setOverride(o, 'initials', 'acronym', v); rerender(); };
  ROOT.setOperatorFirst3 = function (i, v) { var o = ROOT.library.operators[i]; if (o) setOverride(o, 'first3', 'first3', v); rerender(); };
  ROOT.setOperatorEmail = function (i, v) { var o = ROOT.library.operators[i]; if (o) o.email = (v || '').trim(); dirty(); };   // no rerender (keep focus)

  // devices (master-maintained). Name change / info edit do NOT rerender (keep cursor).
  ROOT.addDevice = function () {
    var el = document.getElementById('fng-newdev'); var v = el ? el.value.trim() : '';
    if (v) { ROOT.library.devices.push({ id: uid('dev'), name: v, info: {} }); rerender(); }
  };
  ROOT.delDevice = function (i) { ROOT.library.devices.splice(i, 1); rerender(); };
  ROOT.setDeviceName = function (i, v) { var d = ROOT.library.devices[i]; if (d) d.name = v; rerender(); };
  ROOT.setDeviceInfo = function (i, text) {
    var d = ROOT.library.devices[i]; if (!d) return;
    var info = {};
    (text || '').split(/\n/).forEach(function (line) {
      var idx = line.indexOf(':'); if (idx > 0) { var k = line.slice(0, idx).trim(); if (k) info[k] = line.slice(idx + 1).trim(); }
    });
    d.info = info; dirty();
  };

  // custom fields
  ROOT.setNF = function (k, v) { ROOT.newField[k] = v; if (k === 'type') rerender(); };
  ROOT.addField = function () {
    var nf = ROOT.newField, name = (nf.name || '').trim(); if (!name) { toast('Give the field a name.'); return; }
    var f = { id: uid('cf'), name: name, source: nf.type };
    if (nf.type === 'list') f.options = (nf.optionsCsv || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    if (nf.type === 'date') f.format = nf.format || 'YYYYMMDD';
    if (nf.type === 'counter') { f.pad = 2; f.scope = 'daily'; }
    ROOT.library.fields.push(f);
    ROOT.newField = { name: '', type: 'freetext', optionsCsv: '', format: 'YYYYMMDD' };
    rerender();
  };
  ROOT.delField = function (id) {
    ROOT.library.fields = ROOT.library.fields.filter(function (f) { return f.id !== id; });
    // remove it from any template that used it
    labs().forEach(function (l) {
      ['fileTemplates', 'folderTemplates'].forEach(function (k) {
        l[k].forEach(function (t) { t.fieldIds = (t.fieldIds || []).filter(function (x) { return x !== id; }); });
      });
    });
    rerender();
  };

  // save / export / import
  function snapshot() { try { return JSON.stringify(ROOT.library); } catch (e) { return ''; } }
  function isDirty() { return snapshot() !== ROOT._savedSnapshot; }
  // No Save button anymore — edits auto-persist on this machine. Called by the
  // cursor-preserving editors (field name/format, base path, device info, …) that
  // mutate without a full rerender, so their changes are still saved immediately.
  function dirty() {
    if (!ROOT._platformMode && ROOT.library) { try { localStorage.setItem(libCacheKey(), JSON.stringify(ROOT.library)); } catch (e) {} }
  }
  ROOT.save = function () {
    if (hasCollisions()) { toast('Resolve the duplicate identifiers (flagged with !) first.'); return; }
    saveLibrary();
    ROOT._savedSnapshot = snapshot();
    dirty();
    toast('Saved locally. Export → paste into Configure to share with the lab.');
  };
  // Guided publish: download library.json, copy it, and show the GitLab drop-in steps.
  ROOT.publish = function () {
    if (hasCollisions()) { toast('Resolve the duplicate identifiers (flagged with !) first.'); return; }
    var pretty = JSON.stringify(ROOT.library, null, 2);
    download('library.json', pretty);
    if (navigator.clipboard) { try { navigator.clipboard.writeText(pretty); } catch (e) {} }
    ROOT._savedSnapshot = snapshot();   // published — greys the button until the next change
    ROOT.ui.publishOpen = true; rerender();
  };
  ROOT.closePublish = function () { ROOT.ui.publishOpen = false; rerender(); };
  ROOT.openTplBuilder = function () { ROOT.ui.tplOpen = true; rerender(); };
  ROOT.closeTplBuilder = function () { ROOT.ui.tplOpen = false; rerender(); };
  ROOT.openLabsOps = function () { ROOT.ui.labsOpen = true; rerender(); };
  ROOT.closeLabsOps = function () { ROOT.ui.labsOpen = false; rerender(); };
  ROOT.setPublishUrl = function (v) { ROOT.library.publishUrl = (v || '').trim(); dirty(); };
  // The lab slug the page was opened with — from ?cfg=/<slug>/library.json or ?lib=<slug>.
  // This is authoritative: it's how this very page was loaded, so it can't be stale.
  function labSlug() {
    var u = resolveLibUrl().replace(/^\.?\//, '');   // strip leading ./ or /
    var m = u.match(/^([^\/?#]+)\/library\.json(?:[?#]|$)/);   // <slug>/library.json
    if (m && m[1] !== '.') return m[1];
    m = u.match(/^libs\/([^\/?#]+)\.json(?:[?#]|$)/);          // libs/<slug>.json
    if (m) return m[1];
    return '';
  }
  // The GitLab Web IDE link, built from FNG_PUBLISH_BASE (the UNIGE group root,
  // set once in index.html) + the lab slug → …/-/ide/project/<group>/filenamer-<slug>/edit/main/-/library.json.
  // Derived from the slug FIRST so a library.json copied from another lab (carrying a stale
  // publishUrl) can never misdirect the master. publishUrl is used only as a fallback for
  // non-slug contexts (eLab / a locally opened file).
  // Build a GitLab Web IDE deep link that opens <file> in <project> under the group
  // root <base>: .../-/ide/project/<group>/<project>/edit/main/-/<file>. Lands the
  // master straight in the IDE instead of the single-file editor page.
  function ideUrl(base, project, file) {
    base = String(base || '').replace(/\/+$/, '');
    var m = base.match(/^(https?:\/\/[^\/]+)(\/.*)?$/);
    var origin = m ? m[1] : base;
    var group = (m && m[2] ? m[2] : '').replace(/^\/+|\/+$/g, '');
    var proj = group ? (group + '/' + project) : project;
    return origin + '/-/ide/project/' + proj + '/edit/main/-/' + file;
  }
  function publishLink() {
    var base = (typeof window !== 'undefined' && window.FNG_PUBLISH_BASE) || '';
    var slug = labSlug();
    if (base && slug) return ideUrl(base, 'filenamer-' + slug, 'library.json');
    if (ROOT.library.publishUrl) return ROOT.library.publishUrl;
    return '';
  }
  function publishDialog() {
    if (!ROOT.ui.publishOpen) return '';
    var url = publishLink();
    var step1 = url
      ? '<a class="fng-btn pri" href="' + esc(url) + '" target="_blank" rel="noopener">Open this lab\'s library in the Web IDE ▸</a>'
      : '<span class="fng-muted">Set the “Web IDE link” field (under the buttons) to get a one-click link here.</span>';
    return '<div class="fng-modal" onclick="if(event.target===this)' + R() + '.closePublish()">'
      + '<div class="fng-modal-card"><div class="fng-modal-h"><h3 style="margin:0">Publish to the lab</h3>'
      + '<button class="fng-modal-x" title="Close" onclick="' + R() + '.closePublish()">✕</button></div>'
      + '<p class="fng-muted">✓ <code>library.json</code> downloaded &nbsp;·&nbsp; ✓ contents copied to your clipboard.</p>'
      + '<p style="font-size:13px;margin:4px 0"><b>If you are not a master user:</b> send the downloaded <code>library.json</code> '
      + 'to your lab master and tell them what you changed. A master commits it (only masters have GitLab access).</p>'
      + '<p style="font-size:13px;margin:10px 0 4px"><b>If you are a master user</b>, commit it now:</p>'
      + '<ol style="font-size:13px;line-height:1.8;padding-left:20px;margin:6px 0">'
      + '<li>' + step1 + ' — opens <code>library.json</code> in the editor.</li>'
      + '<li><b>Replace the contents.</b> The new JSON is already on your clipboard: click inside <code>library.json</code>, select all (Ctrl/Cmd+A) and paste (Ctrl/Cmd+V). <span class="fng-muted">Or drag the downloaded <code>library.json</code> onto it in the file tree to overwrite it.</span></li>'
      + '<li>Open <b>Source control</b> in the left sidebar, type a short message, and <b>Commit to <code>main</code></b>.</li>'
      + '<li>Mirroring forwards it to GitLab Pages — machines pick it up within a few minutes.</li>'
      + '</ol>'
      + '<div class="fng-acts"><button class="fng-btn pri" onclick="' + R() + '.closePublish()">Done</button></div></div></div>';
  }
  /* ==========================================================================
   * IMPORT REVIEW — when a library.json is imported, diff it against the current
   * library and let the master review by section (Lab members / Devices / Build
   * templates), accept/reject/edit each change, then merge the accepted ones into
   * the working library (so the normal Publish step shares them). Nothing is
   * applied until "Apply reviewed changes".
   * ======================================================================== */
  var RV_SECTIONS = [{ id: 'members', label: 'Lab members' }, { id: 'devices', label: 'Devices' }, { id: 'templates', label: 'Build templates' }];
  function rvFindi(a, pred) { for (var i = 0; i < a.length; i++) { if (pred(a[i], i)) return i; } return -1; }
  function rvClone(x) { return JSON.parse(JSON.stringify(x)); }
  function rvEq(a, b) { try { return JSON.stringify(a) === JSON.stringify(b); } catch (e) { return a === b; } }
  function rvFieldNames(lib) { var m = {}; ((lib && lib.fields) || []).forEach(function (f) { m[f.id] = f.name; }); return m; }

  // Ordered, human-readable property rows for one item; flags which are editable.
  function rvProps(kind, obj, lib) {
    if (!obj) return [];
    if (kind === 'op') return [{ k: 'name', l: 'Full name', v: opName(obj), ro: true }, { k: 'initials', l: 'Initials', v: obj.initials || '' }, { k: 'first3', l: 'First 3', v: obj.first3 || '' }, { k: 'email', l: 'Email', v: obj.email || '' }];
    if (kind === 'device') { var info = Object.keys(obj.info || {}).map(function (kk) { return kk + ': ' + obj.info[kk]; }).join('\n'); return [{ k: 'name', l: 'Name', v: obj.name || '' }, { k: 'info', l: 'Info', v: info, area: true }]; }
    if (kind === 'field') { var meta = obj.source === 'list' ? ((obj.options || []).join(', ')) : obj.source === 'date' ? (obj.format || '') : ''; return [{ k: 'name', l: 'Name', v: obj.name || '' }, { k: 'source', l: 'Type', v: obj.source || '', ro: true }, { k: 'options', l: (obj.source === 'list' ? 'Options' : 'Details'), v: meta, ro: obj.source !== 'list' }]; }
    if (kind === 'lab') return [{ k: 'name', l: 'Lab name', v: obj.name || '' }, { k: 'dept', l: 'Department', v: obj.dept || '' }, { k: 'initials', l: 'Initials', v: obj.initials || '' }, { k: 'first3', l: 'First 3', v: obj.first3 || '' }];
    if (kind === 'tpl') { var fm = rvFieldNames(lib); var fl = (obj.fieldIds || []).map(function (id) { return fm[id] || id; }).join(' \u00b7 '); return [{ k: 'name', l: 'Name', v: obj.name || '' }, { k: 'default', l: 'Default for lab', v: obj.default ? 'yes' : 'no', sel: true }, { k: 'separator', l: 'Separator', v: obj.separator || '' }, { k: 'basePath', l: 'Base path', v: obj.basePath || '' }, { k: 'fields', l: 'Fields', v: fl, ro: true }]; }
    return [];
  }

  // Flat list of changes between two normalized libraries.
  function diffLibraries(oldL, newL) {
    var items = [];
    function push(o) { o.decision = 'accept'; o.editing = false; o.edited = null; items.push(o); }
    function listDiff(oldArr, newArr, kind, section, keyOf, labelOf) {
      var o = {}, n = {}, seen = {};
      (oldArr || []).forEach(function (x) { o[keyOf(x)] = x; });
      (newArr || []).forEach(function (x) { n[keyOf(x)] = x; });
      Object.keys(o).forEach(function (k) { seen[k] = 1; }); Object.keys(n).forEach(function (k) { seen[k] = 1; });
      Object.keys(seen).forEach(function (k) {
        var a = o[k], b = n[k];
        if (a && !b) push({ section: section, kind: kind, key: kind + '::' + k, status: 'removed', label: labelOf(a), current: a, incoming: null });
        else if (!a && b) push({ section: section, kind: kind, key: kind + '::' + k, status: 'added', label: labelOf(b), current: null, incoming: b });
        else if (!rvEq(a, b)) push({ section: section, kind: kind, key: kind + '::' + k, status: 'changed', label: labelOf(b), current: a, incoming: b });
      });
    }
    listDiff(oldL.operators, newL.operators, 'op', 'members', function (x) { return opName(x); }, function (x) { return opName(x); });
    listDiff(oldL.devices, newL.devices, 'device', 'devices', function (x) { return x.id || x.name; }, function (x) { return x.name || x.id; });
    listDiff((oldL.fields || []).filter(function (f) { return !f.builtin; }), (newL.fields || []).filter(function (f) { return !f.builtin; }), 'field', 'templates', function (x) { return x.id; }, function (x) { return (x.name || x.id) + ' (custom field)'; });
    // labs: identity under members, templates under build-templates
    var oL = {}, nL = {}, seenL = {};
    (oldL.labs || []).forEach(function (l) { oL[l.id] = l; });
    (newL.labs || []).forEach(function (l) { nL[l.id] = l; });
    Object.keys(oL).forEach(function (k) { seenL[k] = 1; }); Object.keys(nL).forEach(function (k) { seenL[k] = 1; });
    Object.keys(seenL).forEach(function (id) {
      var a = oL[id], b = nL[id];
      if (a && !b) { push({ section: 'members', kind: 'lab', key: 'lab::' + id, status: 'removed', label: (a.name || id) + ' (whole lab)', current: a, incoming: null }); return; }
      if (!a && b) { push({ section: 'members', kind: 'lab', key: 'lab::' + id, status: 'added', label: (b.name || id) + ' (whole lab)', current: null, incoming: b }); return; }
      var idA = { name: a.name, dept: a.dept || '', initials: a.initials || '', first3: a.first3 || '' };
      var idB = { name: b.name, dept: b.dept || '', initials: b.initials || '', first3: b.first3 || '' };
      if (!rvEq(idA, idB)) push({ section: 'members', kind: 'lab', key: 'lab::' + id, status: 'changed', label: (b.name || id), current: a, incoming: b });
      ['file', 'folder'].forEach(function (tk) {
        var arrO = (tk === 'file' ? a.fileTemplates : a.folderTemplates) || [];
        var arrN = (tk === 'file' ? b.fileTemplates : b.folderTemplates) || [];
        var to = {}, tn = {}, seenT = {}; arrO.forEach(function (t) { to[t.id] = t; }); arrN.forEach(function (t) { tn[t.id] = t; });
        Object.keys(to).forEach(function (k) { seenT[k] = 1; }); Object.keys(tn).forEach(function (k) { seenT[k] = 1; });
        var lname = (b.name || a.name || id);
        Object.keys(seenT).forEach(function (tid) {
          var ta = to[tid], tb = tn[tid];
          var label = (tk === 'file' ? 'File template ' : 'Folder template ') + ((tb || ta).name || tid) + ' \u2014 ' + lname;
          var common = { section: 'templates', kind: 'tpl', key: 'tpl::' + id + '::' + tk + '::' + tid, labId: id, tkind: tk, label: label };
          if (ta && !tb) push({ section: common.section, kind: common.kind, key: common.key, labId: id, tkind: tk, label: label, status: 'removed', current: ta, incoming: null });
          else if (!ta && tb) push({ section: common.section, kind: common.kind, key: common.key, labId: id, tkind: tk, label: label, status: 'added', current: null, incoming: tb });
          else if (!rvEq(ta, tb)) push({ section: common.section, kind: common.kind, key: common.key, labId: id, tkind: tk, label: label, status: 'changed', current: ta, incoming: tb });
        });
      });
    });
    return items;
  }

  function rvApply() {
    var items = (ROOT._review && ROOT._review.items) || [];
    var m = rvClone(ROOT.library);
    m.operators = m.operators || []; m.devices = m.devices || []; m.fields = m.fields || []; m.labs = m.labs || [];
    function valOf(it) { return it.edited != null ? it.edited : it.incoming; }
    items.forEach(function (it) {
      if (it.decision !== 'accept') return;
      if (it.kind === 'op') {
        var nm = opName(it.current || it.incoming);
        var i = rvFindi(m.operators, function (o) { return opName(o) === nm; });
        if (it.status === 'removed') { if (i >= 0) m.operators.splice(i, 1); }
        else { var v = valOf(it); if (i >= 0) m.operators[i] = v; else m.operators.push(v); }
      } else if (it.kind === 'device') {
        var dk = (it.current || it.incoming).id || (it.current || it.incoming).name;
        var di = rvFindi(m.devices, function (d) { return (d.id || d.name) === dk; });
        if (it.status === 'removed') { if (di >= 0) m.devices.splice(di, 1); }
        else { var dv = valOf(it); if (di >= 0) m.devices[di] = dv; else m.devices.push(dv); }
      } else if (it.kind === 'field') {
        var fid = (it.current || it.incoming).id;
        var fi = rvFindi(m.fields, function (f) { return f.id === fid; });
        if (it.status === 'removed') { if (fi >= 0) m.fields.splice(fi, 1); }
        else { var fv = valOf(it); if (fi >= 0) m.fields[fi] = fv; else m.fields.push(fv); }
      } else if (it.kind === 'lab') {
        var id = (it.current || it.incoming).id;
        var li = rvFindi(m.labs, function (l) { return l.id === id; });
        if (it.status === 'removed') { if (li >= 0) m.labs.splice(li, 1); }
        else if (it.status === 'added') { m.labs.push(valOf(it)); }
        else if (li >= 0) { var nl = valOf(it); ['name', 'dept', 'initials', 'first3'].forEach(function (kk) { if (nl[kk] != null && nl[kk] !== '') m.labs[li][kk] = nl[kk]; else delete m.labs[li][kk]; }); }
      } else if (it.kind === 'tpl') {
        var lli = rvFindi(m.labs, function (l) { return l.id === it.labId; }); if (lli < 0) return; var lab = m.labs[lli];
        var arr = it.tkind === 'file' ? (lab.fileTemplates = lab.fileTemplates || []) : (lab.folderTemplates = lab.folderTemplates || []);
        var tid = (it.current || it.incoming).id;
        var ti = rvFindi(arr, function (t) { return t.id === tid; });
        if (it.status === 'removed') { if (ti >= 0) arr.splice(ti, 1); }
        else { var tv = valOf(it); if (ti >= 0) arr[ti] = tv; else arr.push(tv); }
      }
    });
    ROOT.library = normalize(m);
    ROOT.ui.reviewOpen = false; ROOT._review = null;
    rerender(); toast('Reviewed changes applied \u2014 use Publish changes to share them.');
  }

  ROOT.reviewSec = function (el) { if (ROOT._review) { ROOT._review.section = el.getAttribute('data-sec'); rerender(); } };
  ROOT.reviewDecide = function (i, accept) { var it = ROOT._review && ROOT._review.items[i]; if (it) { it.decision = accept ? 'accept' : 'reject'; rerender(); } };
  ROOT.reviewToggleEdit = function (i) { var it = ROOT._review && ROOT._review.items[i]; if (it) { it.editing = !it.editing; if (it.editing && it.edited == null) it.edited = rvClone(it.incoming || {}); rerender(); } };
  ROOT.reviewAll = function (accept) { var rv = ROOT._review; if (!rv) return; rv.items.forEach(function (it) { if (it.section === rv.section) it.decision = accept ? 'accept' : 'reject'; }); rerender(); };
  ROOT.reviewEdit = function (i, el) {
    var it = ROOT._review && ROOT._review.items[i]; if (!it) return;
    var key = el.getAttribute('data-k'), val = el.value;
    if (it.edited == null) it.edited = rvClone(it.incoming || it.current || {});
    if (it.kind === 'device' && key === 'info') { var info = {}; (val || '').split('\n').forEach(function (line) { var pp = line.indexOf(':'); if (pp > 0) { var a = line.slice(0, pp).trim(), b = line.slice(pp + 1).trim(); if (a) info[a] = b; } }); it.edited.info = info; }
    else if (it.kind === 'field' && key === 'options') { it.edited.options = (val || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean); }
    else if (it.kind === 'tpl' && key === 'default') { it.edited.default = (val === '1'); }
    else { it.edited[key] = val; }
  };
  ROOT.reviewApply = function () { rvApply(); };
  ROOT.reviewCancel = function () { ROOT.ui.reviewOpen = false; ROOT._review = null; rerender(); toast('Import cancelled \u2014 nothing changed.'); };

  function rvCard(it, i) {
    var st = it.status, rejected = it.decision !== 'accept';
    var curP = rvProps(it.kind, it.current, ROOT.library);
    var incObj = it.edited != null ? it.edited : it.incoming;
    var incP = rvProps(it.kind, incObj, ROOT._review.incoming);
    var curMap = {}; curP.forEach(function (pp) { curMap[pp.k] = pp.v; });
    function rows(ps, editable) {
      if (!ps.length) return '<div class="fng-rv-empty">\u2014</div>';
      return ps.map(function (pp) {
        var chg = (st === 'changed') && (curMap[pp.k] !== pp.v);
        var valHtml;
        if (editable && it.editing && !pp.ro) {
          if (pp.sel) valHtml = '<select class="fng-sel" data-k="' + pp.k + '" onchange="' + R() + '.reviewEdit(' + i + ',this)"><option value="0"' + (pp.v === 'no' ? ' selected' : '') + '>no</option><option value="1"' + (pp.v === 'yes' ? ' selected' : '') + '>yes</option></select>';
          else if (pp.area) valHtml = '<textarea class="fng-ta" data-k="' + pp.k + '" oninput="' + R() + '.reviewEdit(' + i + ',this)">' + esc(pp.v) + '</textarea>';
          else valHtml = '<input class="fng-in" data-k="' + pp.k + '" value="' + esc(pp.v) + '" oninput="' + R() + '.reviewEdit(' + i + ',this)">';
        } else { valHtml = '<span class="fng-rv-v">' + (pp.v ? esc(pp.v).replace(/\n/g, '<br>') : '<i class="fng-muted">\u2014</i>') + '</span>'; }
        return '<div class="fng-rv-prop' + (chg ? ' chg' : '') + '"><span class="fng-rv-k">' + esc(pp.l) + '</span>' + valHtml + '</div>';
      }).join('');
    }
    var sides;
    if (st === 'added') sides = '<div class="fng-rv-side"><div class="fng-rv-sh">New</div>' + rows(incP, true) + '</div>';
    else if (st === 'removed') sides = '<div class="fng-rv-side"><div class="fng-rv-sh">Will be removed</div>' + rows(curP, false) + '</div>';
    else sides = '<div class="fng-rv-side"><div class="fng-rv-sh">Current</div>' + rows(curP, false) + '</div><div class="fng-rv-side"><div class="fng-rv-sh">Incoming</div>' + rows(incP, true) + '</div>';
    var canEdit = (st !== 'removed') && incP.some(function (pp) { return !pp.ro; });
    return '<div class="fng-rv-card s-' + st + (rejected ? ' rej' : '') + '">'
      + '<div class="fng-rv-top"><span class="fng-rv-badge b-' + st + '">' + (st === 'added' ? 'Added' : st === 'removed' ? 'Removed' : 'Changed') + '</span>'
      + '<span class="fng-rv-label">' + esc(it.label) + '</span><span class="fng-rv-dec">'
      + (canEdit ? '<button class="fng-btn sm" onclick="' + R() + '.reviewToggleEdit(' + i + ')">' + (it.editing ? 'Done' : 'Edit') + '</button>' : '')
      + '<button class="fng-btn sm' + (it.decision === 'accept' ? ' pri' : '') + '" onclick="' + R() + '.reviewDecide(' + i + ',true)">Accept</button>'
      + '<button class="fng-btn sm' + (it.decision === 'reject' ? ' pri' : '') + '" onclick="' + R() + '.reviewDecide(' + i + ',false)">Reject</button>'
      + '</span></div><div class="fng-rv-sides">' + sides + '</div></div>';
  }

  function renderImportReview() {
    if (!ROOT.ui.reviewOpen || !ROOT._review) return '';
    var rv = ROOT._review, items = rv.items;
    var nav = RV_SECTIONS.map(function (sdef) {
      var n = 0; items.forEach(function (it) { if (it.section === sdef.id) n++; });
      if (!n) return '';
      return '<button type="button" class="fng-rv-navb' + (rv.section === sdef.id ? ' on' : '') + '" data-sec="' + sdef.id + '" onclick="' + R() + '.reviewSec(this)">' + esc(sdef.label) + '<span class="fng-rv-count">' + n + '</span></button>';
    }).join('');
    var cards = ''; items.forEach(function (it, i) { if (it.section === rv.section) cards += rvCard(it, i); });
    var accepted = 0; items.forEach(function (it) { if (it.decision === 'accept') accepted++; });
    return '<div class="fng-modal" onclick="if(event.target===this)' + R() + '.reviewCancel()">'
      + '<div class="fng-modal-card fng-rvcard"><div class="fng-modal-h"><h3 style="margin:0">Review imported changes</h3>'
      + '<button class="fng-modal-x" title="Cancel" onclick="' + R() + '.reviewCancel()">\u2715</button></div>'
      + '<p class="fng-muted" style="margin:0 0 10px">Accept, reject or edit each change. Accepted changes are merged into your working library; then use <b>Publish changes</b> to share them with the lab.</p>'
      + '<div class="fng-rv"><div class="fng-rv-nav">' + nav + '</div><div class="fng-rv-body"><div class="fng-rv-bar">'
      + '<button class="fng-btn sm" onclick="' + R() + '.reviewAll(true)">Accept all shown</button>'
      + '<button class="fng-btn sm" onclick="' + R() + '.reviewAll(false)">Reject all shown</button></div>' + cards + '</div></div>'
      + '<div class="fng-acts" style="margin-top:12px;justify-content:space-between;align-items:center"><span class="fng-muted">' + accepted + ' of ' + items.length + ' change' + (items.length === 1 ? '' : 's') + ' will be applied</span>'
      + '<span style="display:flex;gap:8px"><button class="fng-btn" onclick="' + R() + '.reviewCancel()">Cancel</button><button class="fng-btn pri" onclick="' + R() + '.reviewApply()">Apply reviewed changes</button></span></div></div></div>';
  }

  ROOT.importLib = function () {
    var inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,application/json';
    inp.onchange = function () {
      var f = inp.files[0]; if (!f) return; var r = new FileReader();
      r.onload = function () {
        var lib = parseLib(r.result);
        if (!lib) { toast('Could not parse that file.'); return; }
        var incoming = normalize(lib);
        var items = diffLibraries(ROOT.library, incoming);
        if (!items.length) { toast('That file matches the current library \u2014 no changes to review.'); return; }
        var first = items[0].section;
        for (var si = 0; si < RV_SECTIONS.length; si++) { var has = false; items.forEach(function (it) { if (it.section === RV_SECTIONS[si].id) has = true; }); if (has) { first = RV_SECTIONS[si].id; break; } }
        ROOT._review = { incoming: incoming, items: items, section: first };
        ROOT.ui.reviewOpen = true; rerender();
      };
      r.readAsText(f);
    };
    inp.click();
  };

  /* ==========================================================================
   * PLATFORM-ADMIN MODE  (?platform=<slug>&admin=1)
   *   A self-contained screen for ONE platform's manager to edit their own
   *   device list and publish it to that platform's repo (filenamer-plat-<slug>).
   *   A manager only ever opens their own slug, so they can edit only their devices.
   * ======================================================================== */
  function loadPlatformEdit(slug) {
    try { var s = localStorage.getItem('fng.platform.' + slug); if (s) return normalizePlatformFile(JSON.parse(s), slug); } catch (e) {}
    return normalizePlatformFile({}, slug, slug);
  }
  function platEditSnapshot() { return JSON.stringify(ROOT.platformEdit || {}); }
  // Refresh the editor from the hosted file without clobbering unsaved edits.
  function syncPlatformEdit() {
    if (typeof fetch !== 'function') return;
    var slug = ROOT._platformSlug; var u = platformFileUrl(slug); if (!u) return;
    fetch(u + (u.indexOf('?') >= 0 ? '&' : '?') + 't=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r && r.ok ? r.text() : null; })
      .then(function (txt) {
        if (!txt) return; var o; try { o = JSON.parse(txt); } catch (e) { return; }
        var pf = normalizePlatformFile(o, slug), fresh = JSON.stringify(pf);
        if (fresh === platEditSnapshot()) return;
        try { localStorage.setItem('fng.platform.' + slug, fresh); } catch (e) {}
        if (ROOT._platSnapshot && ROOT._platSnapshot !== platEditSnapshot()) {
          toast('A newer version of this platform is available — reload to edit it.'); return;
        }
        ROOT.platformEdit = pf; ROOT._platSnapshot = fresh; rerender();
      })
      .catch(function () {});
  }
  function platformPublishLink() {
    var base = (typeof window !== 'undefined' && window.FNG_PUBLISH_BASE) || '';
    if (!base) return 'set window.FNG_PUBLISH_BASE in index.html';
    return ideUrl(base, 'filenamer-plat-' + (ROOT._platformSlug || ''), 'platform.json');
  }
  function platTree() {
    var p = ROOT.platformEdit || { devices: [] };
    var pickId = ROOT.ui.platPick;
    var dup = countMap((p.devices || []).map(function (d) { return d.name; }));
    var items = (p.devices || []).length ? (p.devices || []).slice().sort(function (a, b) { return cmpName(a.name, b.name); }).map(function (d) {
      var bad = d.name && dup[d.name] > 1;
      return '<button type="button" class="fng-treeitem' + (d.id === pickId ? ' on' : '') + '" onclick="' + R() + '.platPick(\'' + d.id + '\')">' + esc(d.name || '(unnamed)') + (bad ? ' <span class="fng-bang" title="Duplicate name">!</span>' : '') + '</button>';
    }).join('') : '<span class="fng-muted" style="padding:4px 8px">no devices yet</span>';
    return '<div class="fng-tree">'
      + '<div class="fng-treefolder open" style="cursor:default">▾ ' + esc(p.name || ROOT._platformSlug || 'Platform') + ' devices</div>'
      + '<div class="fng-treekids">' + items
      + '<button type="button" class="fng-treeadd" onclick="' + R() + '.addPDevice()">+ add device</button></div>'
      + '</div>';
  }
  function platMiddle() {
    var p = ROOT.platformEdit || { devices: [] };
    var d = (p.devices || []).filter(function (x) { return x.id === ROOT.ui.platPick; })[0];
    if (!d) return '<div class="fng-dmmid"><p class="fng-muted">Select a device on the left, or add one, to edit its name and description.</p></div>';
    var di = (p.devices || []).indexOf(d);
    var dup = countMap((p.devices || []).map(function (x) { return x.name; }));
    var dDup = d.name && dup[d.name] > 1;
    var infoText = Object.keys(d.info || {}).map(function (k) { return k + ': ' + d.info[k]; }).join('\n');
    var head = '<div class="fng-row" style="justify-content:space-between;align-items:center;gap:8px"><h3 style="margin:0">' + esc(d.name || '(unnamed)') + '</h3>'
      + '<button class="fng-btn sm" onclick="' + R() + '.delPDevice(' + di + ')">Remove device</button></div>';
    var desc = '<div class="fng-card" style="margin-top:10px"><h3 style="margin-top:0">Description <span class="fng-muted" style="text-transform:none;letter-spacing:0">· this platform · editable</span></h3>'
      + '<div class="fng-f"><span class="fng-l">Device name (used in the file name)' + (dDup ? ' <span class="fng-bang" title="Another device in this platform has this name — make it unique">!</span>' : '') + '</span>'
      + '<input class="fng-in' + (dDup ? ' fng-dupin' : '') + '" value="' + esc(d.name) + '" onchange="' + R() + '.setPDeviceName(' + di + ',this.value)"></div>'
      + '<div class="fng-f" style="margin-top:6px"><span class="fng-l">Generic info — one "Key: value" per line (added to metadata)</span>'
      + '<textarea class="fng-ta" style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;min-height:120px" placeholder="Software: Aurora" oninput="' + R() + '.setPDeviceInfo(' + di + ',this.value)">' + esc(infoText) + '</textarea></div></div>';
    return '<div class="fng-dmmid">' + head + desc + '</div>';
  }
  function renderPlatformAdmin() {
    if (!ROOT._isMaster) {
      return '<h3 style="margin-top:0">Platform devices</h3>'
        + '<p class="fng-muted">This page edits one platform\'s device list. Open it from the platform link your administrator gave you (<code>platform.html?platform=&lt;slug&gt;</code>).</p>';
    }
    var p = ROOT.platformEdit || normalizePlatformFile({}, ROOT._platformSlug, ROOT._platformSlug);
    return '<div class="fng-tabs"><button class="fng-tab on">Platform devices</button></div>'
      + '<h3 style="margin-top:0">Platform devices · <code>' + esc(ROOT._platformSlug || '') + '</code></h3>'
      + '<p class="fng-muted">These devices appear as the <b>' + esc(p.name) + '</b> tab in <b>every</b> lab\'s device picker. You edit only this platform.</p>'
      + '<div class="fng-f" style="max-width:480px"><span class="fng-l">Platform name (the tab label)</span>'
      + '<input class="fng-in" value="' + esc(p.name) + '" onchange="' + R() + '.setPlatformEditName(this.value)"></div>'
      + '<div class="fng-dmbody" style="margin-top:12px"><div class="fng-dmleft">' + platTree() + '</div>' + platMiddle() + '</div>'
      + '<div class="fng-acts" style="margin-top:14px"><button class="fng-btn pri" onclick="' + R() + '.publishPlatform()">Publish changes</button></div>'
      + '<div class="fng-f" style="max-width:640px;margin-top:8px"><span class="fng-l">GitLab Web IDE link</span>'
      + '<input class="fng-in" readonly value="' + esc(platformPublishLink()) + '"></div>'
      + '<p class="fng-muted" style="margin-top:6px">Your edits are kept on this machine automatically. <b>Publish changes</b> downloads <code>platform.json</code> and copies it — commit it in GitLab to share with all labs.</p>';
  }
  ROOT.platPick = function (id) { ROOT.ui.platPick = id; rerender(); };
  ROOT.setPlatformEditName = function (v) { if (ROOT.platformEdit) { ROOT.platformEdit.name = v; rerender(); } };
  ROOT.addPDevice = function () {
    if (!ROOT.platformEdit) return;
    var name = (typeof window !== 'undefined' && window.prompt) ? window.prompt('New device name:', '') : '';
    if (name === null) return; name = (name || '').trim(); if (!name) return;
    var d = { id: uid('dev'), name: name, info: {} };
    ROOT.platformEdit.devices.push(d); ROOT.ui.platPick = d.id; dirtyP(); rerender();
  };
  ROOT.delPDevice = function (di) {
    if (!ROOT.platformEdit) return;
    var d = ROOT.platformEdit.devices[di];
    if (d && d.id === ROOT.ui.platPick) ROOT.ui.platPick = null;
    ROOT.platformEdit.devices.splice(di, 1); dirtyP(); rerender();
  };
  ROOT.setPDeviceName = function (di, v) { var d = ROOT.platformEdit && ROOT.platformEdit.devices[di]; if (d) { d.name = v; rerender(); } };
  ROOT.setPDeviceInfo = function (di, text) {   // no rerender — keep the textarea cursor
    var d = ROOT.platformEdit && ROOT.platformEdit.devices[di]; if (!d) return;
    var info = {};
    (text || '').split(/\n/).forEach(function (line) { var idx = line.indexOf(':'); if (idx > 0) { var k = line.slice(0, idx).trim(); if (k) info[k] = line.slice(idx + 1).trim(); } });
    d.info = info; dirtyP();
  };
  function dirtyP() {   // autosave the platform edit on this machine (no Save button); keeps cursor
    if (ROOT.platformEdit) { try { localStorage.setItem('fng.platform.' + ROOT._platformSlug, platEditSnapshot()); } catch (e) {} }
  }
  ROOT.savePlatform = function () {
    try { localStorage.setItem('fng.platform.' + ROOT._platformSlug, platEditSnapshot()); } catch (e) {}
    ROOT._platSnapshot = platEditSnapshot(); rerender();
    toast('Saved on this machine. Publish to share with all labs.');
  };
  ROOT.publishPlatform = function () {
    var p = ROOT.platformEdit || {};
    var pretty = JSON.stringify({ version: 1, name: p.name, devices: p.devices || [] }, null, 2);
    download('platform.json', pretty);
    if (navigator.clipboard) { try { navigator.clipboard.writeText(pretty); } catch (e) {} }
    try { localStorage.setItem('fng.platform.' + ROOT._platformSlug, platEditSnapshot()); } catch (e) {}
    ROOT._platSnapshot = platEditSnapshot();
    ROOT.ui.platPublishOpen = true; rerender();
  };
  ROOT.closePlatPublish = function () { ROOT.ui.platPublishOpen = false; rerender(); };
  function platformsPublishDialog() {
    if (!ROOT.ui.platPublishOpen) return '';
    var url = platformPublishLink();
    return '<div class="fng-modal" onclick="if(event.target===this)' + R() + '.closePlatPublish()">'
      + '<div class="fng-modal-card"><div class="fng-modal-h"><h3 style="margin:0">Publish platform devices</h3>'
      + '<button class="fng-modal-x" title="Close" onclick="' + R() + '.closePlatPublish()">✕</button></div>'
      + '<p class="fng-muted">✓ <code>platform.json</code> downloaded &nbsp;·&nbsp; ✓ contents copied to your clipboard.</p>'
      + '<ol style="font-size:13px;line-height:1.8;padding-left:20px;margin:6px 0">'
      + '<li><a class="fng-btn pri" href="' + esc(url) + '" target="_blank" rel="noopener">Open platform.json in the Web IDE ▸</a></li>'
      + '<li><b>Replace the contents.</b> The new JSON is already on your clipboard: click inside <code>platform.json</code>, select all (Ctrl/Cmd+A) and paste (Ctrl/Cmd+V). <span class="fng-muted">Or drag the downloaded <code>platform.json</code> onto it in the file tree to overwrite it.</span></li>'
      + '<li>Open <b>Source control</b> in the left sidebar, type a short message, and <b>Commit to <code>main</code></b>. All labs pick it up within minutes.</li>'
      + '</ol><div class="fng-acts"><button class="fng-btn pri" onclick="' + R() + '.closePlatPublish()">Done</button></div></div></div>';
  }

  /* ==========================================================================
   * SHELL
   * ======================================================================== */
  function shell() {
    if (ROOT._platformMode) return '<div class="fng">' + css() + renderPlatformAdmin() + platformsPublishDialog() + '</div>';
    var master = ROOT._isMaster !== false;
    // Only show the tab bar for masters (Use + Manage). A plain user has just one
    // screen, so there's no point showing a lone "Use" tab.
    var tabs = master ? '<div class="fng-tabs">'
      + '<button class="fng-tab' + (ROOT.ui.mode === 'use' ? ' on' : '') + '" onclick="' + R() + '.go(\'use\')">Use</button>'
      + '<button class="fng-tab' + (ROOT.ui.mode === 'manage' ? ' on' : '') + '" onclick="' + R() + '.go(\'manage\')">Manage</button>'
      + '</div>' : '';
    var body = (ROOT.ui.mode === 'manage' && master) ? renderManage() : renderUse();
    return '<div class="fng">' + css() + tabs + body + renderDevManager() + renderConfigManager() + renderFsConfirm() + '</div>';
  }
  ROOT.go = function (m) { ROOT.ui.mode = m; rerender(); };

  function rerender() {
    // Auto-persist on this machine so edits are never lost (no Save button).
    if (!ROOT._platformMode && ROOT.library) { try { localStorage.setItem(libCacheKey(), JSON.stringify(ROOT.library)); } catch (e) {} }
    if (ROOT._platformMode && ROOT.platformEdit) { try { localStorage.setItem('fng.platform.' + ROOT._platformSlug, JSON.stringify(ROOT.platformEdit)); } catch (e) {} }
    var host = ROOT._host || document.getElementById('fng-host');
    if (host) { host.innerHTML = shell(); return; }
    var sd = ROOT._sectionData;
    if (sd && sd.section && sd.section.setContent) { try { sd.section.setContent(shell()); } catch (e) {} }
  }
  function download(fname, text, type) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: type || 'application/json' }));
    a.download = fname; document.body.appendChild(a); a.click(); a.remove();
  }
  function toast(msg) {
    try { if (window.eLabSDK2 && eLabSDK2.UI && eLabSDK2.UI.Toast) { eLabSDK2.UI.Toast.showToast(msg); return; } } catch (e) {}
    console.log('[FAIR File Namer] ' + msg);
  }

  /* ==========================================================================
   * REGISTRATION + ENTRY POINT
   * ======================================================================== */
  /* Resolve the values the ELN should fill automatically: operator, department,
   * lab and project. The logged-in user → Operator is wired now; the others are
   * marked TODO — drop in the eLabSDK calls for your instance and they will flow
   * through to the locked fields and the lab selection with no other changes. */
  function resolveELNContext(data, cb) {
    var ctx = {};
    // TODO(ELN): set these from your eLabSDK / experiment context once integrated:
    //   ctx.department = <user's department/section code, must match DEPARTMENTS>;
    //   ctx.lab        = <eLab group name, should match a lab name in the library>;
    //   ctx.project    = <the experiment's study/project name>;
    try {
      if (window.eLabSDK && eLabSDK.API && eLabSDK.API.call) {
        eLabSDK.API.call({
          method: 'GET', path: 'user',
          onSuccess: function (x, s, resp) { var r = resp || {}; ctx.operator = ((r.firstName || '') + ' ' + (r.lastName || '')).trim(); cb(ctx); },
          onError: function () { cb(ctx); }
        });
        return;
      }
    } catch (e) {}
    cb(ctx);
  }
  function applyELNLabSelection() {
    var name = (ROOT.elnAutofill || {}).lab; if (!name) return;
    var match = labs().filter(function (l) { return l.name === name; })[0];
    if (match) ROOT.ui.labId = match.id;
  }

  function registerSection() {
    if (!(window.eLabSDK && eLabSDK.Experiment && eLabSDK.Experiment.CustomSectionType)) return false;
    new eLabSDK.Experiment.CustomSectionType({
      rootVar: ADDON.rootVar, name: ADDON.name, category: ADDON.category,
      type: ADDON.type, label: ADDON.label, version: ADDON.version,
      getContent: function (data, section) {
        ROOT._sectionData = { section: section, expJournalID: data && data.expJournalID };
        if (ROOT._elnResolved) return shell();
        return new Promise(function (resolve) {
          resolveELNContext(data, function (ctx) {
            ROOT.elnAutofill = ctx || {};
            ROOT._elnResolved = true;
            applyELNLabSelection();
            resolve(shell());
          });
        });
      },
      menuItems: function (data) {
        return Promise.resolve([{
          id: 'fngRecord', icon: 'save', text: 'Record name', color: '#28a745', showViewMode: false,
          action: function (sd) { ROOT.recordToSection((sd && sd.section) || data.section, data.expJournalID); }
        }]);
      }
    });
    return true;
  }

  ROOT.init = function (configuration, addonContext) {
    if (ROOT._registered) return; ROOT._registered = true;
    var cfg = configuration || ROOT.configurationValues || {};
    ROOT.library = loadLibrary(cfg);
    ROOT.platforms = loadPlatformsCache();   // shared platform devices (cached; refreshed below)
    try { syncSharedPlatforms(); } catch (e) {}
    ROOT._savedSnapshot = snapshot();   // start in a clean (greyed Save) state
    // Everyone can edit the library (one shared link); committing is gated by GitLab access.
    ROOT._isMaster = true;
    registerSection();
  };

  /* --- side-loading scaffolding (mirrors the Developer-Platform uploads) --- */
  ROOT.configurationSchema = function () {
    return {
      templateLibrary: { type: 'string', format: 'textarea', title: 'Template library (JSON)',
        description: 'Lab templates, operator list and custom fields as JSON. Built in the add-on (Manage → Export). Shared at GROUP scope.', default: '' },
      allowMemberEditing: { type: 'boolean', format: 'checkbox', title: 'Let any member manage templates',
        description: 'Off (recommended): only the master user sees the Manage tab.', default: false, required: false }
    };
  };
  ROOT.configurationValues = { templateLibrary: '', allowMemberEditing: false };

  /* --- standalone bootstrap (open index.html directly) -------------------- */
  if (typeof document !== 'undefined') {
    function fngBoot() {
      var host = document.getElementById('fng-host');
      if (host && !(window.eLabSDK && eLabSDK.Experiment)) {
        ROOT._host = host;
        var pmatch = location.search.match(/[?&]platform=([^&]+)/);     // per-platform editor
        ROOT._platformMode = !!pmatch;
        ROOT._platformSlug = pmatch ? decodeURIComponent(pmatch[1]) : '';
        try { localStorage.removeItem('fng.admin'); } catch (e) {}
        // Lab app: EVERYONE can edit the library (one shared link). Committing to GitLab is
        // gated by repo access, not the app. The platform editor still gates on its own flag.
        ROOT._isMaster = ROOT._platformMode
          ? (/[?&]admin=1/.test(location.search) || (typeof window !== 'undefined' && window.FNG_PLATFORM_ADMIN === true))
          : true;
        ROOT.platforms = loadPlatformsCache();                          // shared devices (instant, cached)
        function fngRender() {                           // instant: cached copy or bundled default
          if (ROOT._platformMode) {
            ROOT.platformEdit = loadPlatformEdit(ROOT._platformSlug);
            ROOT._platSnapshot = platEditSnapshot();
            host.innerHTML = shell(); return;
          }
          ROOT.library = loadLibrary({});
          ROOT._savedSnapshot = snapshot();
          host.innerHTML = shell();
        }
        try {
          fngRender();
        } catch (e1) {
          // A corrupted local cache (or an unexpected library shape) can throw during render.
          // Never leave a blank page: drop this lab's cache and rebuild from the bundled
          // default; if that still fails, show the error instead of nothing.
          try { localStorage.removeItem(libCacheKey()); } catch (e) {}
          try {
            fngRender();
          } catch (e2) {
            host.innerHTML = '<div style="padding:16px;font-family:system-ui;line-height:1.5;color:#f0604a">'
              + '<b>FAIR File Namer failed to start.</b><br>' + esc((e2 && e2.message) || 'Unknown error')
              + '<br><span style="color:#9fb0cf">Reload the page. If it persists, the shared '
              + '<code>library.json</code> may be invalid — check the latest commit.</span></div>';
          }
        }
        if (ROOT._platformMode) { syncPlatformEdit(); }   // refresh just this platform's file
        else { syncSharedLibrary(); syncSharedPlatforms(); try { flushAnalytics(); } catch (e) {} }   // lab templates + merged platform devices
      }
    }
    // run now if the DOM is already parsed (e.g. cache-busted async load), else wait
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fngBoot);
    else fngBoot();

    // Some browsers (notably Edge) restore the page from the back/forward cache
    // WITHOUT re-running scripts, so the background library check never fires and the
    // user keeps seeing the stale cached copy. Re-check the network whenever the page
    // is shown again from cache, or when the tab regains visibility.
    function fngRecheck() {
      if (!ROOT._host || (window.eLabSDK && eLabSDK.Experiment)) return;
      try {
        if (ROOT._platformMode) { syncPlatformEdit(); }
        else { syncSharedLibrary(); syncSharedPlatforms(); }
      } catch (e) {}
    }
    window.addEventListener('pageshow', function (e) {
      if (e && e.persisted) {
        // Restored from the back/forward cache (the Edge case): this is effectively a
        // fresh viewing, so clear the "user is mid-task" flag — outside Manage — so the
        // newest library is applied rather than only cached for later. Re-render preserves
        // any values already typed (applyDefaults only fills empty fields).
        if (ROOT.ui && ROOT.ui.mode !== 'manage') ROOT.ui.touched = false;
        fngRecheck();
      }
    });
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') fngRecheck(); });
  }

  /* --- headless test exports ---------------------------------------------- */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { sanitizeVal: sanitizeVal, fmtDate: fmtDate, encodeField: encodeField,
      buildName: buildName, inputFields: inputFields, defaultLibrary: defaultLibrary, normalize: normalize,
      normalizeIndex: normalizeIndex, normalizePlatformFile: normalizePlatformFile,
      deviceGroups: deviceGroups, findDeviceByName: findDeviceByName, groupOfDevice: groupOfDevice,
      headerObject: headerObject, sidecar: sidecar, relPath: relPath, folderSubtree: folderSubtree, archiveRoot: archiveRoot, curName: curName, curPath: curPath, storageStatus: storageStatus, looksLocalRoot: looksLocalRoot, showLiteralPath: showLiteralPath, locationBlock: locationBlock, headerMarkdown: headerMarkdown, ideUrl: ideUrl, cmpName: cmpName, notesMarkdown: notesMarkdown, clipboardHtml: clipboardHtml, notesNonEmpty: notesNonEmpty, buildAnalyticsEvent: buildAnalyticsEvent, favDevices: favDevices, isFav: isFav, addFav: addFav, removeFav: removeFav, devmgrTree: devmgrTree, renderManage: renderManage, isDirty: isDirty, diffLibraries: diffLibraries, fsProbe: fsProbe, fsMkdirp: fsMkdirp, fsWrite: fsWrite, openEln: function(){return ROOT.openEln.apply(ROOT,arguments);}, currentOperatorEmail: currentOperatorEmail,
      _setState: function (s) { s = s || {}; if (s.library) ROOT.library = s.library; if (s.platforms) ROOT.platforms = s.platforms; if (s.ui) ROOT.ui = s.ui; } };
  }

})();
