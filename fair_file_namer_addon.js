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
  var LS_DOCFONT = 'fng.doc.font';               // per-machine metadata display font
  var LS_DOCSIZE = 'fng.doc.size';               // per-machine metadata display size
  var LS_HIST = 'fng.recentNames';               // per-machine recent file names

  // Display options for the rendered metadata document.
  var FONTS = { sans: 'IBM Plex Sans, system-ui, -apple-system, Segoe UI, sans-serif', serif: 'Georgia, "Times New Roman", serif', mono: 'ui-monospace, Menlo, Consolas, monospace' };
  var SIZES = { s: '12px', m: '14px', l: '16px', xl: '18px' };

  /* ----- FIXED department list (edit here once for your faculty). ---------- */
  var DEPARTMENTS = [
    { code: 'NEUFO', label: 'Neurosciences Fondamentales' },
    { code: 'PATIM', label: 'Pathology & Imaging' },
    { code: 'MIMOL', label: 'Molecular Imaging' }
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
      case 'upper':  return sanitizeVal(s).toUpperCase();
      case 'lower':  return sanitizeVal(s).toLowerCase();
      case 'full':
      default:       return sanitizeVal(s);
    }
  }
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
  function loadLibrary(cfg) {
    var lib = (cfg && cfg.templateLibrary) ? parseLib(cfg.templateLibrary) : null;
    if (!lib) { try { lib = parseLib(localStorage.getItem(LS_KEY)); } catch (e) {} }
    if (!lib) lib = defaultLibrary();
    return normalize(lib);
  }
  function saveLibrary() {
    var json = JSON.stringify(ROOT.library);
    try { localStorage.setItem(LS_KEY, json); } catch (e) {}
    // optional direct config write (fails soft; Export→Configure is the reliable path)
    try {
      if (window.eLabSDK && eLabSDK.Plugin && typeof eLabSDK.Plugin.setConfiguration === 'function') {
        eLabSDK.Plugin.setConfiguration({ scope: 'GROUP', configuration: { templateLibrary: json } });
      }
    } catch (e) {}
    return json;
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
      + '.fng-tile.drag{opacity:.35;}'
      + '.fng-tile.over{border-color:var(--ac);}'
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
      if (f.source === 'device') {
        var md = machineDevice();
        if (md && (ROOT.library.devices || []).some(function (d) { return d.name === md; })) ROOT.ui.values[f.id] = md;
      } else {
        var av = elnAutoValueFor(f);
        if (av) ROOT.ui.values[f.id] = av;
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
        ctrl = '<select class="fng-sel" onchange="' + R() + '.setVal(\'' + f.id + '\',this.value)"><option value="">— select —</option>'
          + DEPARTMENTS.map(function (d) { return '<option value="' + esc(d.code) + '"' + (d.code === v ? ' selected' : '') + '>' + esc(d.code) + ' — ' + esc(d.label) + '</option>'; }).join('') + '</select>';
      } else if (f.source === 'operator') {
        ctrl = '<select class="fng-sel" onchange="' + R() + '.setVal(\'' + f.id + '\',this.value)"><option value="">— select —</option>'
          + (L.operators || []).map(function (o) { var n = opName(o); return '<option value="' + esc(n) + '"' + (n === v ? ' selected' : '') + '>' + esc(n) + '</option>'; }).join('') + '</select>';
      } else if (f.source === 'device') {
        var on = v && v === machineDevice();
        ctrl = '<div class="fng-devwrap"><select class="fng-sel" onchange="' + R() + '.setVal(\'' + f.id + '\',this.value)"><option value="">— select —</option>'
          + (L.devices || []).map(function (d) { return '<option value="' + esc(d.name) + '"' + (d.name === v ? ' selected' : '') + '>' + esc(d.name) + '</option>'; }).join('') + '</select>'
          + '<button class="fng-star' + (on ? ' on' : '') + '" title="' + (on ? 'Default device on this machine — click to remove' : 'Set as this machine\'s default device') + '" onclick="' + R() + '.setMachineDevice()">★</button></div>';
      } else if (f.source === 'list') {
        ctrl = '<select class="fng-sel" onchange="' + R() + '.setVal(\'' + f.id + '\',this.value)"><option value="">— select —</option>'
          + (f.options || []).map(function (o) { return '<option value="' + esc(o) + '"' + (o === v ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') + '</select>';
      } else {
        ctrl = '<input class="fng-in" value="' + esc(v) + '" autocomplete="off" spellcheck="false" oninput="' + R() + '.setVal(\'' + f.id + '\',this.value)">';
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
      + recentBlock() + decodeBlock();
  }

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
    var segs = (tpl.fieldIds || []).map(function (id, i) {
      var v = encodeField(fieldById(L, id), ROOT.ui.values, ctx);
      return v ? '<span style="color:' + SEG[i % SEG.length] + '">' + esc(v) + '</span>' : '';
    }).filter(Boolean);
    var sepc = '<span class="sep">' + esc(tpl.separator || '_') + '</span>';
    var nameHtml = segs.length ? segs.join(sepc) : '<span class="fng-muted">fill in the fields…</span>';
    var folder = defaultTpl(lab.folderTemplates);
    var pathHtml = '';
    if (folder) {
      var path = buildName(folder, L, ROOT.ui.values, ctx);
      var base = buildName(tpl, L, ROOT.ui.values, ctx);
      pathHtml = '<div class="fng-path">' + esc((path ? path + '/' : '') + base) + '</div>';
    }
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
  ROOT.setVal = function (k, v) { ROOT.ui.values[k] = v; refreshUsePreview(); refreshHeader(); };
  function refreshUsePreview() { var el = document.getElementById('fng-ex'); if (el) el.outerHTML = usePreview(); }
  // refresh only the rendered header — never the notes editor (keeps the cursor)
  function refreshHeader() { var el = document.getElementById('fng-md-header'); if (el) el.innerHTML = headerHtml(); }

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
    // attach the selected device's generic info (software, version, …)
    (tpl.fieldIds || []).forEach(function (id) {
      var f = fieldById(L, id);
      if (f && f.source === 'device') {
        var sel = ROOT.ui.values[id] || '';
        var d = (L.devices || []).filter(function (x) { return x.name === sel; })[0];
        if (d && d.info && Object.keys(d.info).length) h.device = { name: d.name, info: d.info };
      }
    });
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
    md.push('**Template:** ' + h.template + '  ');
    md.push('**Generated:** ' + fmtDate(new Date(), 'YYYY-MM-DD') + ' ' + fmtDate(new Date(), 'HH:MM'));
    md.push('', '| Field | Value |', '| --- | --- |');
    Object.keys(h.fields).forEach(function (k) { md.push('| ' + k + ' | ' + (h.fields[k] || '—') + ' |'); });
    if (h.device) {
      md.push('', '**Device — ' + h.device.name + '**', '', '| Property | Value |', '| --- | --- |');
      Object.keys(h.device.info).forEach(function (k) { md.push('| ' + k + ' | ' + h.device.info[k] + ' |'); });
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
    html += '<b>Lab:</b> ' + esc(h.lab) + '<br><b>Template:</b> ' + esc(h.template)
      + '<br><b>Generated:</b> ' + fmtDate(new Date(), 'YYYY-MM-DD') + ' ' + fmtDate(new Date(), 'HH:MM') + '</p>'
      + '<table class="fng-doc-t"><thead><tr><th>Field</th><th>Value</th></tr></thead><tbody>';
    Object.keys(h.fields).forEach(function (k) { html += '<tr><td>' + esc(k) + '</td><td>' + esc(h.fields[k] || '—') + '</td></tr>'; });
    html += '</tbody></table>';
    if (h.device) {
      html += '<p style="margin-top:10px"><b>Device — ' + esc(h.device.name) + '</b></p><table class="fng-doc-t"><tbody>';
      Object.keys(h.device.info).forEach(function (k) { html += '<tr><td>' + esc(k) + '</td><td>' + esc(h.device.info[k]) + '</td></tr>'; });
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
    var doc = '<div class="fng-doc" id="fng-doc" style="font-family:' + fam + ';font-size:' + sz + '">'
      + '<div id="fng-md-header">' + headerHtml() + '</div>'
      + '<hr class="fng-doc-hr">'
      + '<div class="fng-notes-edit" id="fng-md-notes" contenteditable="true" data-ph="Type your notes here…" '
      + 'oninput="' + R() + '.onNotesHtml(this.innerHTML)">' + (ROOT.ui.notesHtml || '') + '</div></div>';
    return toolbar + doc;
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
    var p = folder ? buildName(folder, ROOT.library, ROOT.ui.values, { now: nowDate(), tplId: tpl ? tpl.id : '', lab: lab }) : '';
    return (p ? p + '/' : '') + curName();
  }
  function sidecar() {
    var h = headerObject() || {};
    h.generatedAt = new Date().toISOString();   // precise time only in the saved file
    return { header: h, notes: htmlToText(ROOT.ui.notesHtml || ''), notesHtml: ROOT.ui.notesHtml || '' };
  }
  function copyText(t) { if (t && navigator.clipboard) navigator.clipboard.writeText(t); }
  // required-field gate before committing a name
  function missingRequired() {
    var lab = useLab(); if (!lab) return []; var tpl = useFileTpl(lab); if (!tpl) return [];
    return inputFields(tpl, ROOT.library).filter(function (f) { return f.required && !String(ROOT.ui.values[f.id] || '').trim(); }).map(function (f) { return f.name; });
  }
  function guard() { var m = missingRequired(); if (m.length) { toast('Please fill required field(s): ' + m.join(', ')); return false; } return true; }

  ROOT.copyName = function () {
    if (!guard()) return;
    copyText(curName()); pushHistory(curName());
    var b = document.getElementById('fng-copybtn');
    if (b) { var o = b.innerHTML; b.classList.add('ok'); b.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><polyline points="20 6 9 17 4 12"></polyline></svg>'; setTimeout(function () { b.classList.remove('ok'); b.innerHTML = o; }, 1300); }
    toast('File name copied.');
  };
  ROOT.copyPath = function () { if (!guard()) return; copyText(curPath()); toast('Full path copied.'); };
  ROOT.downloadSidecar = function () { if (!guard()) return; var name = curName(); if (!name) return; pushHistory(name); download(name + '.json', JSON.stringify(sidecar(), null, 2), 'application/json'); };
  ROOT.copyMarkdown = function () { copyText(notesMarkdown()); toast('Metadata (Markdown) copied.'); };
  ROOT.downloadMarkdown = function () { if (!guard()) return; var name = curName(); if (!name) return; pushHistory(name); download(name + '.md', notesMarkdown(), 'text/markdown'); };

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
  ROOT.recordToSection = function (section, expJournalID) {
    if (!guard()) return;
    var o = sidecar(), h = o.header; if (!h || !h.fileName) return;
    pushHistory(h.fileName);
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
    var saveBtn = col
      ? '<button class="fng-btn" id="fng-savebtn" disabled title="Resolve the duplicates flagged with ! first">Save</button>'
      : (isDirty()
          ? '<button class="fng-btn pri" id="fng-savebtn" onclick="' + R() + '.save()">Save</button>'
          : '<button class="fng-btn saved" id="fng-savebtn" disabled>Saved ✓</button>');
    var saveBar = '<div class="fng-acts">' + saveBtn
      + (col ? '<button class="fng-btn" disabled title="Resolve duplicates first">Export library JSON</button>'
             : '<button class="fng-btn" onclick="' + R() + '.exportLib()">Export library JSON</button>')
      + '<button class="fng-btn" onclick="' + R() + '.importLib()">Import library JSON</button>'
      + '</div>'
      + (col ? '<p style="margin-top:6px;color:#f0604a;font-size:12px">⚠ Resolve the duplicate identifiers flagged with <b>!</b> in Manage lists &amp; fields before saving or exporting.</p>'
             : '<p class="fng-muted" style="margin-top:6px">To publish to the whole lab: <b>Export</b>, then paste the JSON into the add-on\'s <b>Configure → templateLibrary</b> (GROUP scope).</p>');

    return head + editor + saveBar + manageLists() + fieldDialog();
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

    // tiles already in the template (ordered, draggable)
    var tiles = (tpl.fieldIds || []).map(function (id, i) {
      var f = fieldById(L, id); if (!f) return '';
      return '<span class="fng-tile" draggable="true" id="fng-t-' + i + '" '
        + 'ondblclick="' + R() + '.openField(\'' + f.id + '\')" '
        + 'ondragstart="' + R() + '.dragStart(event,' + i + ')" ondragend="' + R() + '.dragEnd()" '
        + 'ondragover="' + R() + '.dragOver(event,' + i + ')" ondrop="' + R() + '.drop(event,' + i + ')" ondragleave="' + R() + '.dragLeave(' + i + ')">'
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

    return nameRow
      + '<p class="lead">Drag the tiles to set the order. <b>Double-click</b> (or ✎) a tile to edit its format. ✕ removes it; click a field below to add it.</p>'
      + '<div class="fng-tiles" id="fng-tilebox">' + tiles + '</div>'
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
    return '<div class="fng-ex" id="fng-bex"><div class="h">Live example</div><div class="fng-name">'
      + (segs.join(sepc) || '<span class="fng-muted">add fields to see the result</span>') + '</div></div>';
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
      var opts = [['full', 'Full (cleaned value)'], ['acronym', 'Initials / acronym'], ['first3', 'First 3 letters'], ['upper', 'UPPERCASE'], ['lower', 'lowercase']];
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
    function abbrTable(list, keyOf, fns) {
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
          + '<td><button class="fng-btn sm" title="remove" onclick="' + R() + '.' + fns.del + '(' + k + ')">✕</button></td></tr>';
      }).join('');
      return { rows: rows, any: any };
    }
    function abbrTableHtml(t, emptyMsg, kind, head) {
      return t.rows
        ? '<table class="fng-doc-t"><thead><tr><th>' + head + '</th><th>Initials</th><th>First 3</th><th></th></tr></thead><tbody>' + t.rows + '</tbody></table>'
          + (t.any ? '<p class="fng-muted" style="margin-top:6px">Fields flagged <span class="fng-bang">!</span> match another ' + kind + ' — edit them to make each unique.</p>' : '')
        : '<span class="fng-muted">' + emptyMsg + '</span>';
    }
    var ops = abbrTableHtml(abbrTable(opList, function (e, i) { return '' + i; }, { name: 'setOperatorName', ini: 'setOperatorInitials', f3: 'setOperatorFirst3', del: 'delOperator' }), 'no operators yet', 'operator', 'Full name');
    var labsTable = abbrTableHtml(abbrTable(labs(), function (l) { return '\'' + l.id + '\''; }, { name: 'setLabName', ini: 'setLabInitials', f3: 'setLabFirst3', del: 'delLab' }), 'no labs yet', 'lab', 'Lab name');
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

    return '<details class="fng-adv"' + (ROOT.ui.manageOpen ? ' open' : '') + ' ontoggle="' + R() + '.setManageOpen(this.open)"><summary>Manage lists &amp; fields</summary>'
      + '<div class="fng-card"><h3 style="margin-top:0">Labs</h3>'
      + labsTable
      + '<div class="fng-row" style="margin-top:8px"><button class="fng-btn sm" onclick="' + R() + '.addLab()">+ Add lab</button></div></div>'

      + '<div class="fng-card"><h3 style="margin-top:0">Operators</h3>'
      + ops
      + '<div class="fng-row" style="margin-top:8px"><input class="fng-in" id="fng-newop" placeholder="Full name"><button class="fng-btn sm" onclick="' + R() + '.addOperator()">+ Add operator</button></div></div>'

      + '<div class="fng-card"><h3 style="margin-top:0">Acquisition devices</h3>'
      + '<p class="fng-muted">Each device\'s generic info (software, version, …) is written into the metadata whenever that device is selected.</p>'
      + devs
      + '<div class="fng-row" style="margin-top:10px"><input class="fng-in" id="fng-newdev" placeholder="Device name e.g. 2P-B"><button class="fng-btn sm" onclick="' + R() + '.addDevice()">+ Add device</button></div></div>'

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
  ROOT.setDefault = function (v) {
    var lab = buildLab(), t = buildTpl(lab); if (!t) return;
    if (v === '1') buildTpls(lab).forEach(function (x) { x.default = false; });
    t.default = v === '1'; rerender();
  };
  ROOT.addTile = function (fid) { var t = buildTpl(buildLab()); if (t) { t.fieldIds.push(fid); rerender(); } };
  ROOT.removeTile = function (i) { var t = buildTpl(buildLab()); if (t) { t.fieldIds.splice(i, 1); rerender(); } };
  ROOT.moveTile = function (i, dir) { var t = buildTpl(buildLab()); if (!t) return; var j = i + dir; if (j < 0 || j >= t.fieldIds.length) return; var m = t.fieldIds.splice(i, 1)[0]; t.fieldIds.splice(j, 0, m); rerender(); };

  ROOT._drag = null;
  ROOT.dragStart = function (ev, i) { ROOT._drag = i; var el = document.getElementById('fng-t-' + i); if (el) el.classList.add('drag'); try { ev.dataTransfer.effectAllowed = 'move'; } catch (e) {} };
  ROOT.dragEnd = function () { var el = document.querySelector('.fng-tile.drag'); if (el) el.classList.remove('drag'); };
  ROOT.dragOver = function (ev, i) { ev.preventDefault(); var el = document.getElementById('fng-t-' + i); if (el) el.classList.add('over'); };
  ROOT.dragLeave = function (i) { var el = document.getElementById('fng-t-' + i); if (el) el.classList.remove('over'); };
  ROOT.drop = function (ev, i) {
    ev.preventDefault(); var from = ROOT._drag; ROOT._drag = null;
    if (from == null || from === i) { rerender(); return; }
    var t = buildTpl(buildLab()); if (!t) return;
    var m = t.fieldIds.splice(from, 1)[0]; t.fieldIds.splice(i, 0, m); rerender();
  };

  // labs
  ROOT.addLab = function () {
    var name = (window.prompt ? window.prompt('New lab name:') : '') || '';
    name = name.trim(); if (!name) return;
    var l = { id: uid('lab'), name: name, fileTemplates: [], folderTemplates: [] };
    labs().push(l); ROOT.build.labId = l.id; ROOT.build.tplId = null; rerender();
  };
  ROOT.setLabName = function (id, v) { var l = labById(id); if (l) l.name = v; rerender(); };
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
  // reflect the saved/unsaved state on the Save button (greyed when nothing to save)
  function dirty() {
    var b = document.getElementById('fng-savebtn'); if (!b) return;
    if (hasCollisions()) { b.disabled = true; b.textContent = 'Save'; b.classList.remove('pri', 'saved'); return; }
    if (isDirty()) { b.disabled = false; b.textContent = 'Save'; b.classList.add('pri'); b.classList.remove('saved'); }
    else { b.disabled = true; b.textContent = 'Saved ✓'; b.classList.remove('pri'); b.classList.add('saved'); }
  }
  ROOT.save = function () {
    if (hasCollisions()) { toast('Resolve the duplicate identifiers (flagged with !) first.'); return; }
    saveLibrary();
    ROOT._savedSnapshot = snapshot();
    dirty();
    toast('Saved locally. Export → paste into Configure to share with the lab.');
  };
  ROOT.exportLib = function () {
    if (hasCollisions()) { toast('Resolve the duplicate identifiers (flagged with !) first.'); return; }
    var pretty = JSON.stringify(ROOT.library, null, 2);
    download('fileNamer_templates.json', pretty);
    if (navigator.clipboard) navigator.clipboard.writeText(JSON.stringify(ROOT.library)).then(function () { toast('Downloaded + copied. Paste into Configure → templateLibrary.'); });
  };
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
   * SHELL
   * ======================================================================== */
  function shell() {
    var master = ROOT._isMaster !== false;
    var tabs = '<div class="fng-tabs">'
      + '<button class="fng-tab' + (ROOT.ui.mode === 'use' ? ' on' : '') + '" onclick="' + R() + '.go(\'use\')">Use</button>'
      + (master ? '<button class="fng-tab' + (ROOT.ui.mode === 'manage' ? ' on' : '') + '" onclick="' + R() + '.go(\'manage\')">Manage</button>' : '')
      + '</div>';
    var body = (ROOT.ui.mode === 'manage' && master) ? renderManage() : renderUse();
    return '<div class="fng">' + css() + tabs + body + '</div>';
  }
  ROOT.go = function (m) { ROOT.ui.mode = m; rerender(); };

  function rerender() {
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
    ROOT._savedSnapshot = snapshot();   // start in a clean (greyed Save) state
    // Only a master user manages templates. Default true; tighten via the
    // `allowMemberEditing` config flag or eLabSDK2.System.Group permissions.
    // Who may manage templates. TODO(ELN): replace the final fallback with a real
    // eLab group-admin / permission check once the sandbox is available. For now,
    // honor the config flag; default to true so the add-on is usable before that
    // wiring exists (tighten to `false` once the permission source is connected).
    ROOT._isMaster = (cfg.allowMemberEditing === true) || !!(addonContext && addonContext.isMaster) || true;
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
        ROOT._host = host; ROOT.library = loadLibrary({}); ROOT._isMaster = true;
        ROOT._savedSnapshot = snapshot();
        host.innerHTML = shell();
      }
    }
    // run now if the DOM is already parsed (e.g. cache-busted async load), else wait
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fngBoot);
    else fngBoot();
  }

  /* --- headless test exports ---------------------------------------------- */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { sanitizeVal: sanitizeVal, fmtDate: fmtDate, encodeField: encodeField,
      buildName: buildName, inputFields: inputFields, defaultLibrary: defaultLibrary, normalize: normalize };
  }

})();
