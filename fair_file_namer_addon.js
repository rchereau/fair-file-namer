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
  var LS_DEPT = 'fng.machine.lastDept';          // per-machine last-selected department
  var LS_OPER = 'fng.machine.lastOperator';      // per-machine last-selected operator
  var LS_DOCFONT = 'fng.doc.font';               // per-machine metadata display font
  var LS_DOCSIZE = 'fng.doc.size';               // per-machine metadata display size
  var LS_HIST = 'fng.recentNames';               // per-machine recent file names
  var LS_PLATFORMS = 'fng.platforms.cache';      // shared faculty-wide platform devices (cached)

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
        var busy = (ROOT.ui.mode === 'manage') || (ROOT.ui.values && Object.keys(ROOT.ui.values).length > 0);
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
      + '.fng-star{flex:none;background:transparent;border:1px solid var(--bd);border-radius:6px;color:var(--dim);cursor:pointer;font-size:14px;line-height:1;padding:7px 9px;}'
      + '.fng-star:hover{border-color:var(--ac);color:var(--ac);}'
      + '.fng-star.on{color:var(--ac);border-color:var(--ac);}'
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
      + '.fng-modal-card.fng-dmcard{width:96vw;max-width:1320px;}'
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
      + '.fng-missing select,.fng-missing input{border-color:#f0a04a;}'
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
  ROOT.setDateOverride = function (v) { ROOT.ui.dateOverride = v || ''; refreshUsePreview(); refreshHeader(); };

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
        ctrl = '<select class="fng-sel" onchange="' + R() + '.setVal(\'' + f.id + '\',this.value)"><option value="">— select —</option>'
          + DEPARTMENTS.map(function (d) { return '<option value="' + esc(d.code) + '"' + (d.code === v ? ' selected' : '') + '>' + esc(d.code) + ' — ' + esc(d.label) + '</option>'; }).join('') + '</select>';
      } else if (f.source === 'operator') {
        ctrl = '<select class="fng-sel" onchange="' + R() + '.setVal(\'' + f.id + '\',this.value)"><option value="">— select —</option>'
          + (L.operators || []).map(function (o) { var n = opName(o); return '<option value="' + esc(n) + '"' + (n === v ? ' selected' : '') + '>' + esc(n) + '</option>'; }).join('') + '</select>';
      } else if (f.source === 'device') {
        // Opens the Manage devices window to browse / select / edit / configure devices.
        ctrl = '<button type="button" class="fng-btn fng-devbtn' + (v ? ' pri' : '') + '" title="Open the device manager" onclick="' + R() + '.openDevManager()">'
          + (v ? esc(v) : 'Manage devices ▾') + '</button>';
      } else if (f.source === 'list') {
        ctrl = '<select class="fng-sel" onchange="' + R() + '.setVal(\'' + f.id + '\',this.value)"><option value="">— select —</option>'
          + (f.options || []).map(function (o) { return '<option value="' + esc(o) + '"' + (o === v ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') + '</select>';
      } else {
        var dl = 'fng-dl-' + f.id, hist = fieldHistory(f.id).slice(0, 5);
        ctrl = '<input class="fng-in" list="' + dl + '" value="' + esc(v) + '" spellcheck="false" oninput="' + R() + '.setVal(\'' + f.id + '\',this.value)">'
          + '<datalist id="' + dl + '">' + hist.map(function (x) { return '<option value="' + esc(x) + '"></option>'; }).join('') + '</datalist>';
      }
      var lblcls = 'fng-l' + (f.required ? ' req' : '');
      var miss = f.required && !String(v).trim();
      var fcls = 'fng-f' + (f.source === 'department' ? ' fng-narrow' : '');
      return '<div class="' + fcls + '"><span class="' + lblcls + '">' + esc(f.name) + '</span>'
        + '<div' + (miss ? ' class="fng-missing"' : '') + '>' + ctrl + '</div>' + extra + '</div>';
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
      + '<button class="fng-btn" onclick="' + R() + '.copyPath()">Copy full path</button>'
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
      : '<button class="fng-btn pri" onclick="' + R() + '.devmgrUse()">Set as default device for this machine</button>';
    var head = '<div class="fng-row" style="justify-content:space-between;align-items:center;gap:8px"><h3 style="margin:0">' + esc(p.name) + '</h3>' + useBtn + '</div>';
    var desc;
    if (p.scope === 'lab') {
      var d = labDeviceById(p.id) || { name: p.name, info: {} };
      var infoText = Object.keys(d.info || {}).map(function (k) { return k + ': ' + d.info[k]; }).join('\n');
      desc = '<div class="fng-card" style="margin-top:10px"><h3 style="margin-top:0">Description <span class="fng-muted" style="text-transform:none;letter-spacing:0">· shared library · editable</span></h3>'
        + '<div class="fng-f"><span class="fng-l">Device name (used in the file name)</span><input class="fng-in" value="' + esc(d.name) + '" onchange="' + R() + '.devmgrSetLabName(\'' + p.id + '\',this.value)"></div>'
        + '<div class="fng-f" style="margin-top:6px"><span class="fng-l">Generic info — one "Key: value" per line (added to metadata)</span>'
        + '<textarea class="fng-ta" style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;min-height:120px" oninput="' + R() + '.devmgrSetLabInfo(\'' + p.id + '\',this.value)">' + esc(infoText) + '</textarea></div>'
        + '<div class="fng-row" style="margin-top:8px;align-items:center"><button class="fng-btn sm" onclick="' + R() + '.devmgrDelLabDevice(\'' + p.id + '\')">Remove device</button>'
        + '<span class="fng-muted">Edits are kept on this machine; use <b>Publish changes</b> in Manage to send them to a master.</span></div></div>';
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
    var labDevs = (ROOT.library && ROOT.library.devices) || [];
    var labKids = dm.openLab ? '<div class="fng-treekids">' + (labDevs.length ? labDevs.map(function (d) {
      return '<button type="button" class="fng-treeitem' + (pick.scope === 'lab' && pick.id === d.id ? ' on' : '') + '" onclick="' + R() + '.devmgrPickLab(\'' + d.id + '\')">' + esc(d.name) + '</button>';
    }).join('') : '<span class="fng-muted" style="padding:4px 8px">no devices yet</span>')
      + '<button type="button" class="fng-treeadd" onclick="' + R() + '.devmgrAddLab()">+ add device</button></div>' : '';
    var plats = (ROOT.platforms || []);
    var platKids = dm.openPlat ? '<div class="fng-treekids">' + (plats.length ? plats.map(function (p) {
      var devKids = dm.openPlatId === p.id ? '<div class="fng-treekids">' + ((p.devices || []).length ? (p.devices || []).map(function (d) {
        return '<button type="button" class="fng-treeitem' + (pick.scope === 'plat' && pick.platId === p.id && pick.id === d.id ? ' on' : '') + '" onclick="' + R() + '.devmgrPickPlat(\'' + p.id + '\',\'' + d.id + '\')">' + esc(d.name) + '</button>';
      }).join('') : '<span class="fng-muted" style="padding:4px 8px">no devices</span>') + '</div>' : '';
      return '<button type="button" class="fng-treefolder sub' + (dm.openPlatId === p.id ? ' open' : '') + '" onclick="' + R() + '.devmgrTogglePlat(\'' + p.id + '\')">' + (dm.openPlatId === p.id ? '▾ ' : '▸ ') + esc(p.name) + '</button>' + devKids;
    }).join('') : '<span class="fng-muted" style="padding:4px 8px">no platforms yet</span>') + '</div>' : '';
    return '<div class="fng-tree">'
      + '<button type="button" class="fng-treefolder' + (dm.openLab ? ' open' : '') + '" onclick="' + R() + '.devmgrToggleLab()">' + (dm.openLab ? '▾ ' : '▸ ') + 'Lab devices</button>' + labKids
      + '<button type="button" class="fng-treefolder' + (dm.openPlat ? ' open' : '') + '" onclick="' + R() + '.devmgrTogglePlatRoot()">' + (dm.openPlat ? '▾ ' : '▸ ') + 'Platform devices</button>' + platKids
      + '</div>';
  }
  function renderDevManager() {
    var dm = ROOT.ui.devmgr; if (!dm || !dm.open) return '';
    return '<div class="fng-modal" onclick="if(event.target===this)' + R() + '.closeDevManager()">'
      + '<div class="fng-modal-card fng-dmcard"><div class="fng-modal-h"><h3 style="margin:0">Manage devices</h3>'
      + '<button class="fng-modal-x" title="Close" onclick="' + R() + '.closeDevManager()">✕</button></div>'
      + '<div class="fng-dmbody"><div class="fng-dmleft">' + devmgrTree() + '</div>' + devmgrMiddle() + devmgrRight() + '</div>'
      + '<div class="fng-acts" style="margin-top:12px"><button class="fng-btn pri" onclick="' + R() + '.closeDevManager()">Done</button></div></div></div>';
  }
  ROOT.openDevManager = function () {
    var dm = ROOT.ui.devmgr = ROOT.ui.devmgr || {};
    dm.open = true;
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
  ROOT.devmgrToggleLab = function () { ROOT.ui.devmgr.openLab = !ROOT.ui.devmgr.openLab; rerender(); };
  ROOT.devmgrTogglePlatRoot = function () { ROOT.ui.devmgr.openPlat = !ROOT.ui.devmgr.openPlat; rerender(); };
  ROOT.devmgrTogglePlat = function (pid) { ROOT.ui.devmgr.openPlatId = (ROOT.ui.devmgr.openPlatId === pid ? null : pid); rerender(); };
  ROOT.devmgrPickLab = function (id) { var d = labDeviceById(id); if (!d) return; ROOT.ui.devmgr.pick = { scope: 'lab', id: id, name: d.name }; rerender(); };
  ROOT.devmgrPickPlat = function (pid, id) { var p = (ROOT.platforms || []).filter(function (x) { return x.id === pid; })[0]; var d = p && (p.devices || []).filter(function (x) { return x.id === id; })[0]; if (!d) return; ROOT.ui.devmgr.pick = { scope: 'plat', platId: pid, id: id, name: d.name }; rerender(); };
  ROOT.devmgrUse = function () {
    var p = ROOT.ui.devmgr && ROOT.ui.devmgr.pick; if (!p) return;
    var lab = useLab(), tpl = lab && useFileTpl(lab), fid = tpl && deviceFieldId(tpl);
    if (fid) ROOT.ui.values[fid] = p.name;
    try { localStorage.setItem(LS_DEVICE, p.name); } catch (e) {}
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
    var pathHtml = folder ? '<div class="fng-path">' + esc(curPath()) + '</div>' : '';
    return '<div class="fng-ex" id="fng-ex"><div class="h">File name</div>'
      + '<div class="fng-namerow"><div class="fng-name">' + nameHtml + '</div>'
      + '<button class="fng-copy" id="fng-copybtn" title="Copy file name" onclick="' + R() + '.copyName()">'
      + '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"></path></svg>'
      + '</button></div>' + pathHtml + '</div>';
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
  // config handlers act on (operator + the device OPENED in the Manage devices window)
  ROOT.selectConfig = function (id) { var op = currentOperator(), dev = pickedDeviceName(); if (!op || !dev) return; setActiveConfigId(op, dev, id); rerender(); };
  ROOT.newConfig = function () {
    var op = currentOperator(); if (!op) { toast('Select your operator on the main screen first.'); return; }
    var dev = pickedDeviceName(); if (!dev) return;
    var def = 'Config ' + (odConfigs(op, dev).length + 1);
    var name = (typeof window !== 'undefined' && window.prompt) ? window.prompt('Name this configuration:', def) : def;
    if (name === null) return; name = (name || '').trim() || def;
    var m = loadAllConfigs(), k = cfgKey(op, dev); m[k] = m[k] || [];
    var c = { id: uid('cfg'), name: name, text: CONFIG_TEMPLATE };
    m[k].push(c); saveAllConfigs(m); setActiveConfigId(op, dev, c.id); rerender();
  };
  ROOT.editConfig = function (text) {   // no rerender — keep the textarea cursor
    var op = currentOperator(), dev = pickedDeviceName(); if (!op || !dev) return;
    var m = loadAllConfigs(), k = cfgKey(op, dev), c = (m[k] || []).filter(function (x) { return x.id === activeConfigId(op, dev); })[0];
    if (!c) return; c.text = text; saveAllConfigs(m); refreshHeader();
  };
  ROOT.renameConfig = function () {
    var op = currentOperator(), dev = pickedDeviceName(); if (!op || !dev) return;
    var m = loadAllConfigs(), k = cfgKey(op, dev), c = (m[k] || []).filter(function (x) { return x.id === activeConfigId(op, dev); })[0]; if (!c) return;
    var n = (typeof window !== 'undefined' && window.prompt) ? window.prompt('Rename configuration:', c.name) : c.name;
    if (n === null) return; c.name = (n || '').trim() || c.name; saveAllConfigs(m); rerender();
  };
  ROOT.deleteConfig = function () {
    var op = currentOperator(), dev = pickedDeviceName(); if (!op || !dev) return;
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
    var h = { fileName: curName(), fullPath: folder ? curPath() : '', lab: lab.name, template: tpl.name, separator: sepc, pattern: pattern, fields: fields };
    // Department is bound to the lab — always recorded in the metadata, even if it
    // isn't part of the naming template.
    var depCode = (lab && lab.dept) ? lab.dept : '';
    if (!depCode) (tpl.fieldIds || []).forEach(function (id) { var ff = fieldById(L, id); if (ff && ff.source === 'department') depCode = ROOT.ui.values[id] || depCode; });
    if (depCode) { var dlh = DEPARTMENTS.filter(function (d) { return d.code === depCode; })[0]; h.department = dlh ? (depCode + ' — ' + dlh.label) : depCode; }
    // attach the selected device's generic info (software, version, …)
    (tpl.fieldIds || []).forEach(function (id) {
      var f = fieldById(L, id);
      if (f && f.source === 'device') {
        var sel = ROOT.ui.values[id] || '';
        var d = findDeviceByName(sel);
        if (d && d.info && Object.keys(d.info).length) h.device = { name: d.name, info: d.info };
      }
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
    if (h.fullPath && h.fullPath !== h.fileName) md.push('**Full path:** `' + h.fullPath + '`  ');
    md.push('**Lab:** ' + h.lab + '  ');
    if (h.department) md.push('**Department:** ' + h.department + '  ');
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
    if (h.fullPath && h.fullPath !== h.fileName) html += '<b>Full path:</b> <code>' + esc(h.fullPath) + '</code><br>';
    html += '<b>Lab:</b> ' + esc(h.lab) + (h.department ? '<br><b>Department:</b> ' + esc(h.department) : '') + '<br><b>Template:</b> ' + esc(h.template)
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
    var doc = '<div class="fng-doc" id="fng-doc" style="position:relative;font-family:' + fam + ';font-size:' + sz + '">'
      + copyBtn
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
  function notesMarkdown() { return headerMarkdown() + '\n\n---\n\n' + NOTE_MARK + '\n\n' + htmlToMd(ROOT.ui.notesHtml || ''); }

  function curName() { var lab = useLab(); var tpl = lab && useFileTpl(lab); return tpl ? buildName(tpl, ROOT.library, ROOT.ui.values, { now: nowDate(), tplId: tpl.id, lab: lab }) : ''; }
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
    copyText(curName()); pushHistory(curName()); saveFieldHistories();
    var b = document.getElementById('fng-copybtn');
    if (b) { var o = b.innerHTML; b.classList.add('ok'); b.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><polyline points="20 6 9 17 4 12"></polyline></svg>'; setTimeout(function () { b.classList.remove('ok'); b.innerHTML = o; }, 1300); }
    toast('File name copied.');
  };
  ROOT.copyPath = function () { if (!guard()) return; copyText(curPath()); toast('Full path copied.'); };
  ROOT.downloadSidecar = function () { if (!guard()) return; var name = curName(); if (!name) return; pushHistory(name); saveFieldHistories(); download(name + '.json', JSON.stringify(sidecar(), null, 2), 'application/json'); };
  ROOT.copyMarkdown = function () { copyText(notesMarkdown()); toast('Metadata (Markdown) copied.'); };
  // copy the whole metadata + notes block (the icon at the doc's top-right), with a flash
  ROOT.copyDoc = function () {
    copyText(notesMarkdown());
    var b = document.getElementById('fng-md-copybtn');
    if (b) { var o = b.innerHTML; b.classList.add('ok'); b.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><polyline points="20 6 9 17 4 12"></polyline></svg>'; setTimeout(function () { b.classList.remove('ok'); b.innerHTML = o; }, 1300); }
    toast('Metadata & notes copied.');
  };
  ROOT.downloadMarkdown = function () { if (!guard()) return; var name = curName(); if (!name) return; pushHistory(name); saveFieldHistories(); download(name + '.md', notesMarkdown(), 'text/markdown'); };

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
    if (h.fullPath) rows += '<tr><td style="color:#6b7592">Full path</td><td>' + esc(h.fullPath) + '</td></tr>';
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
      + (o.notesHtml ? '<div style="font-size:12px;color:#9fb0cf;margin-top:6px;"><b>Notes:</b><br>' + o.notesHtml + '</div>' : '') + '</div>';
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
      + '<div class="fng-f" style="max-width:640px;margin-top:8px"><span class="fng-l">GitLab file URL — derived automatically from this page&rsquo;s address</span>'
      + '<input class="fng-in" readonly value="' + esc(publishLink() || 'set window.FNG_PUBLISH_BASE in index.html') + '"></div>'
      + (col ? '<p style="margin-top:6px;color:#f0604a;font-size:12px">⚠ Resolve the duplicate identifiers flagged with <b>!</b> below before publishing.</p>'
             : '<p class="fng-muted" style="margin-top:6px">Your edits are kept on this machine automatically. <b>Publish changes</b> downloads <code>library.json</code> and copies it — send it to a master to commit, or commit it yourself if you have GitLab access.</p>');

    var warn = '<div class="fng-warn">⚠ Anyone can make changes for your lab here, but changes only take effect once a '
      + '<b>master user</b> in your lab publishes them to the lab repository. Click <b>Publish changes</b> for step‑by‑step instructions.</div>';
    return warn + head + editor + saveBar + manageLists() + fieldDialog() + publishDialog();
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
      ? '<div class="fng-f" style="margin:8px 0"><span class="fng-l">Base path (NAS root) — prepended to the folder structure</span>'
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
          + (extraCell ? extraCell(e) : '')
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
    var ops = abbrTableHtml(abbrTable(opList, function (e, i) { return '' + i; }, { name: 'setOperatorName', ini: 'setOperatorInitials', f3: 'setOperatorFirst3', del: 'delOperator' }), 'no operators yet', 'operator', 'Full name');
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

    return '<h3 style="margin-top:22px">Lists &amp; fields</h3>'
      + '<div class="fng-card"><h3 style="margin-top:0">Labs</h3>'
      + labsTable
      + '<div class="fng-row" style="margin-top:8px"><button class="fng-btn sm" onclick="' + R() + '.addLab()">+ Add lab</button></div></div>'

      + '<div class="fng-card"><h3 style="margin-top:0">Operators</h3>'
      + ops
      + '<div class="fng-row" style="margin-top:8px"><input class="fng-in" id="fng-newop" placeholder="Full name"><button class="fng-btn sm" onclick="' + R() + '.addOperator()">+ Add operator</button></div></div>'

      + '<div class="fng-card"><h3 style="margin-top:0">Acquisition devices</h3>'
      + '<p class="fng-muted">Lab devices and the shared platform devices are managed in a dedicated window — browse, edit lab devices, and keep your own local configs.</p>'
      + '<div class="fng-row" style="margin-top:6px"><button class="fng-btn pri" onclick="' + R() + '.openDevManager()">Manage devices ▾</button></div></div>'

      + '<div class="fng-card"><h3 style="margin-top:0">Departments <span class="fng-muted">(fixed)</span></h3>'
      + '<div class="fng-mini">' + DEPARTMENTS.map(function (d) { return '<span class="fng-chiprm" style="padding-right:11px">' + esc(d.code) + ' — ' + esc(d.label) + '</span>'; }).join('') + '</div></div>'

      + '<div class="fng-card"><h3 style="margin-top:0">Custom fields</h3>'
      + '<div class="fng-mini">' + customList + '</div>'
      + '<div class="fng-row" style="margin-top:10px;align-items:flex-end">'
      + '<div class="fng-f"><span class="fng-l">Field name</span><input class="fng-in" value="' + esc(nf.name) + '" placeholder="e.g. Stain" oninput="' + R() + '.setNF(\'name\',this.value)"></div>'
      + '<div class="fng-f"><span class="fng-l">Type</span>' + typeSel + '</div>'
      + extra
      + '<button class="fng-btn sm pri" onclick="' + R() + '.addField()">+ Add field</button></div></div>'
      + '</details>';
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
    ROOT.ui.publishOpen = true; rerender();
  };
  ROOT.closePublish = function () { ROOT.ui.publishOpen = false; rerender(); };
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
  // The GitLab "edit this file" link, built from FNG_PUBLISH_BASE (the UNIGE group root,
  // set once in index.html) + the lab slug → …/filenamer-<slug>/-/edit/main/library.json.
  // Derived from the slug FIRST so a library.json copied from another lab (carrying a stale
  // publishUrl) can never misdirect the master. publishUrl is used only as a fallback for
  // non-slug contexts (eLab / a locally opened file).
  function publishLink() {
    var base = (typeof window !== 'undefined' && window.FNG_PUBLISH_BASE) || '';
    var slug = labSlug();
    if (base && slug) return base.replace(/\/+$/, '') + '/filenamer-' + slug + '/-/edit/main/library.json';
    if (ROOT.library.publishUrl) return ROOT.library.publishUrl;
    return '';
  }
  function publishDialog() {
    if (!ROOT.ui.publishOpen) return '';
    var url = publishLink();
    var step1 = url
      ? '<a class="fng-btn pri" href="' + esc(url) + '" target="_blank" rel="noopener">Open this lab\'s file in GitLab ▸</a>'
      : '<span class="fng-muted">Set the “GitLab file URL” field (under the buttons) to get a one-click link here.</span>';
    return '<div class="fng-modal" onclick="if(event.target===this)' + R() + '.closePublish()">'
      + '<div class="fng-modal-card"><div class="fng-modal-h"><h3 style="margin:0">Publish to the lab</h3>'
      + '<button class="fng-modal-x" title="Close" onclick="' + R() + '.closePublish()">✕</button></div>'
      + '<p class="fng-muted">✓ <code>library.json</code> downloaded &nbsp;·&nbsp; ✓ contents copied to your clipboard.</p>'
      + '<p style="font-size:13px;margin:4px 0"><b>If you are not a master user:</b> send the downloaded <code>library.json</code> '
      + 'to your lab master and tell them what you changed. A master commits it (only masters have GitLab access).</p>'
      + '<p style="font-size:13px;margin:10px 0 4px"><b>If you are a master user</b>, commit it now:</p>'
      + '<ol style="font-size:13px;line-height:1.8;padding-left:20px;margin:6px 0">'
      + '<li>' + step1 + '</li>'
      + '<li>In GitLab, click <b>Edit</b> on <code>library.json</code> (or <b>Upload file → Replace</b> with the downloaded one).</li>'
      + '<li>If editing: select all (Ctrl/Cmd+A) and <b>paste</b> (Ctrl/Cmd+V) the copied JSON.</li>'
      + '<li>Enter a short message and <b>Commit to <code>main</code></b>. Machines update within a few minutes.</li>'
      + '</ol>'
      + '<div class="fng-acts"><button class="fng-btn pri" onclick="' + R() + '.closePublish()">Done</button></div></div></div>';
  }
  ROOT.importLib = function () {
    var inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,application/json';
    inp.onchange = function () {
      var f = inp.files[0]; if (!f) return; var r = new FileReader();
      r.onload = function () { var lib = parseLib(r.result); if (lib) { ROOT.library = normalize(lib); rerender(); toast('Imported.'); } else toast('Could not parse that file.'); };
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
    return base.replace(/\/+$/, '') + '/filenamer-plat-' + (ROOT._platformSlug || '') + '/-/edit/main/platform.json';
  }
  function renderPlatformAdmin() {
    if (!ROOT._isMaster) {
      return '<h3 style="margin-top:0">Platform devices</h3>'
        + '<p class="fng-muted">This page edits one platform\'s device list. Open it with '
        + '<code>?platform=&lt;slug&gt;&amp;admin=1</code> to manage it.</p>';
    }
    var p = ROOT.platformEdit || normalizePlatformFile({}, ROOT._platformSlug, ROOT._platformSlug);
    var dup = countMap((p.devices || []).map(function (d) { return d.name; }));
    var devs = (p.devices || []).map(function (d, di) {
      var infoText = Object.keys(d.info || {}).map(function (k) { return k + ': ' + d.info[k]; }).join('\n');
      var dDup = d.name && dup[d.name] > 1;
      return '<div class="fng-card" style="margin-top:8px">'
        + '<div class="fng-row" style="align-items:flex-end"><div class="fng-f" style="flex:1"><span class="fng-l">Device name (used in the file name)' + (dDup ? ' <span class="fng-bang" title="Another device in this platform has this name — make it unique">!</span>' : '') + '</span>'
        + '<input class="fng-in' + (dDup ? ' fng-dupin' : '') + '" value="' + esc(d.name) + '" onchange="' + R() + '.setPDeviceName(' + di + ',this.value)"></div>'
        + '<button class="fng-btn sm" onclick="' + R() + '.delPDevice(' + di + ')">Remove</button></div>'
        + '<div class="fng-f" style="margin-top:6px"><span class="fng-l">Generic info — one "Key: value" per line (added to metadata)</span>'
        + '<textarea class="fng-ta" style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px" placeholder="Software: Aurora" oninput="' + R() + '.setPDeviceInfo(' + di + ',this.value)">' + esc(infoText) + '</textarea></div></div>';
    }).join('') || '<span class="fng-muted">no devices yet</span>';

    return '<div class="fng-tabs"><button class="fng-tab on">Platform devices</button></div>'
      + '<h3 style="margin-top:0">Platform devices · <code>' + esc(ROOT._platformSlug || '') + '</code></h3>'
      + '<p class="fng-muted">These devices appear as the <b>' + esc(p.name) + '</b> tab in <b>every</b> lab\'s device picker. You edit only this platform.</p>'
      + '<div class="fng-f" style="max-width:480px"><span class="fng-l">Platform name (the tab label)</span>'
      + '<input class="fng-in" value="' + esc(p.name) + '" onchange="' + R() + '.setPlatformEditName(this.value)"></div>'
      + devs
      + '<div class="fng-row" style="margin-top:12px"><input class="fng-in" id="fng-newpdev" placeholder="Device name e.g. Aurora-Flow"><button class="fng-btn sm" onclick="' + R() + '.addPDevice()">+ Add device</button></div>'
      + '<div class="fng-acts" style="margin-top:14px"><button class="fng-btn pri" onclick="' + R() + '.publishPlatform()">Publish changes</button></div>'
      + '<div class="fng-f" style="max-width:640px;margin-top:8px"><span class="fng-l">GitLab file URL</span>'
      + '<input class="fng-in" readonly value="' + esc(platformPublishLink()) + '"></div>'
      + '<p class="fng-muted" style="margin-top:6px">Your edits are kept on this machine automatically. <b>Publish changes</b> downloads <code>platform.json</code> and copies it — commit it in GitLab to share with all labs.</p>';
  }
  ROOT.setPlatformEditName = function (v) { if (ROOT.platformEdit) { ROOT.platformEdit.name = v; rerender(); } };
  ROOT.addPDevice = function () {
    var el = document.getElementById('fng-newpdev'); var v = el ? el.value.trim() : '';
    if (v && ROOT.platformEdit) { ROOT.platformEdit.devices.push({ id: uid('dev'), name: v, info: {} }); rerender(); }
  };
  ROOT.delPDevice = function (di) { if (ROOT.platformEdit) { ROOT.platformEdit.devices.splice(di, 1); rerender(); } };
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
      + '<li><a class="fng-btn pri" href="' + esc(url) + '" target="_blank" rel="noopener">Open platform.json in GitLab ▸</a></li>'
      + '<li>Click <b>Edit</b> (or <b>Upload file → Replace</b>), select all and paste the copied JSON.</li>'
      + '<li>Enter a message and <b>Commit to <code>main</code></b>. All labs pick it up within minutes.</li>'
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
    return '<div class="fng">' + css() + tabs + body + renderDevManager() + '</div>';
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
        else { syncSharedLibrary(); syncSharedPlatforms(); }   // lab templates + merged platform devices
      }
    }
    // run now if the DOM is already parsed (e.g. cache-busted async load), else wait
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fngBoot);
    else fngBoot();
  }

  /* --- headless test exports ---------------------------------------------- */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { sanitizeVal: sanitizeVal, fmtDate: fmtDate, encodeField: encodeField,
      buildName: buildName, inputFields: inputFields, defaultLibrary: defaultLibrary, normalize: normalize,
      normalizeIndex: normalizeIndex, normalizePlatformFile: normalizePlatformFile,
      deviceGroups: deviceGroups, findDeviceByName: findDeviceByName, groupOfDevice: groupOfDevice,
      _setState: function (s) { s = s || {}; if (s.library) ROOT.library = s.library; if (s.platforms) ROOT.platforms = s.platforms; } };
  }

})();
