/* ============================================================================
 * FAIR File Namer  —  eLabNext add-on (starter / sandbox testing version)
 * ----------------------------------------------------------------------------
 * Custom Experiment SECTION ("FAIR File Namer") that:
 *   - prefills INST / PI / PROJ from per-lab CONFIGURATION (set via Configure)
 *   - prefills SCI from the logged-in user (REST current-user lookup)
 *   - lets the user pick the acquisition DEVICE from the configured list
 *   - lets the user type only the SAMPLE / animal ID
 *   - builds basename:  INST_PI_SCI_PROJ_SAMP_DEV_YYYYMMDD
 *   - copies it to the clipboard (to paste into the acquisition software)
 *   - can record the generated name into the section (ELN provenance)
 *
 * Entry point: the platform calls FNG_SIDELOAD.init(configuration, ctx).
 * During side-loading no configuration is passed, so we fall back to the
 * defaults attached to the root variable (mirrors defaultConfiguration.json).
 *
 * Docs: custom section   https://developer.elabnext.com/docs/custom-experiment-section
 *       configuration    https://developer.elabnext.com/docs/add-on-configuration
 *       user (V2)        https://developer.elabnext.com/docs/elabsdk2systemuser
 *
 * Two uploads in the Developer Platform accompany this file:
 *   - configurationSchema.json   (Configuration Schema box)
 *   - defaultConfiguration.json  (Default configuration box)
 * Set the add-on's install scope to GROUP so each lab configures its own values.
 * ========================================================================== */

(function () {
  'use strict';

  /* --- Fixed metadata. rootVar MUST equal the eLab add-on identifier. ----- */
  var ADDON = {
    rootVar:  'FNG_SIDELOAD',
    name:     'FAIR File Namer',
    version:  '0.1.0',
    category: 'Data',
    type:     'fairFileNamer',
    label:    'FAIR File Namer'
  };

  /* --- Institution dropdown options (the known units). The per-lab default
   *     selection comes from configuration (institutionCode). --------------- */
  var INSTITUTIONS = [
    { code: 'NEUFO', label: 'NEUFO \u2014 Neurosciences Fondamentales' },
    { code: 'PATIM', label: 'PATIM \u2014 Pathology & Imaging' },
    { code: 'MIMOL', label: 'MIMOL \u2014 Molecular Imaging' }
  ];

  /* ==========================================================================
   * ENCODING LOGIC  —  identical rules to the standalone LabFileNamer tool.
   *   pattern: INST_PI_SCI_PROJ_SAMP_DEV_YYYYMMDD  (empty fields are skipped)
   * ======================================================================== */
  function sanitize(s) { return (s || '').replace(/[^a-zA-Z0-9\-]/g, '').toUpperCase(); }
  function toSlug(s, n) { return (s || '').replace(/\s+/g, '').replace(/[^a-zA-Z0-9]/g, '').slice(0, n); }
  function initials(n) {
    var p = (n || '').trim().split(/\s+/).filter(Boolean);
    if (!p.length) return '';
    if (p.length === 1) return p[0].slice(0, 2).toUpperCase();
    return p.map(function (x) { return x[0].toUpperCase(); }).join('');
  }
  function pi3(s) { return (s || '').trim().replace(/[^a-zA-Z]/g, '').slice(0, 3).toUpperCase(); }
  function today() {
    var d = new Date();
    return '' + d.getFullYear()
             + String(d.getMonth() + 1).padStart(2, '0')
             + String(d.getDate()).padStart(2, '0');
  }
  function buildName(st) {
    return [
      st.inst,
      pi3(st.pi),
      initials(st.sci),
      toSlug(st.proj, 8),
      sanitize(st.samp),
      (st.dev || '').replace(/[^a-zA-Z0-9\-]/g, ''),
      today()
    ].filter(Boolean).join('_');
  }

  /* ==========================================================================
   * ROOT NAMESPACE  —  declared literally so the portal's code scan finds the
   * identifier, and used as the add-on's entry-point object.
   * ======================================================================== */
  var FNG_SIDELOAD = window.FNG_SIDELOAD || {};
  window.FNG_SIDELOAD = FNG_SIDELOAD;
  var ROOT = FNG_SIDELOAD;
  ROOT.state = ROOT.state || {};
  ROOT._cfg  = ROOT._cfg  || {};

  /* --- Side-loading scaffolding: mirrors of the two JSON uploads. ----------
   *     After publishing these can be removed (the platform injects them), but
   *     keeping them lets you side-load the same file unchanged. ------------- */
  ROOT.configurationSchema = function () {
    return {
      institutionCode: { type: 'string', enum: ['NEUFO', 'PATIM', 'MIMOL'],
        title: 'Institution / unit code', default: 'NEUFO' },
      piLastName: { type: 'string', title: 'Lab PI last name', default: '' },
      devices: { type: 'array', uniqueItems: true, title: 'Acquisition devices',
        items: { type: 'string' } },
      defaultProject: { type: 'string', title: 'Default project (optional)',
        required: false, default: '' }
    };
  };
  ROOT.configurationValues = {
    institutionCode: 'NEUFO',
    piLastName: 'Holtmaat',
    devices: ['2P-B', 'Rig4', 'Confocal1', 'Wide-A'],
    defaultProject: ''
  };

  /* ==========================================================================
   * CONTEXT RESOLUTION
   *   INST / PI / PROJ come from configuration (synchronous, no SDK call).
   *   SCI comes from the logged-in user, fetched asynchronously (below).
   * ======================================================================== */
  function resolveContext(data) {
    var cfg = ROOT._cfg || {};
    return {
      inst: cfg.institutionCode || '',
      pi:   cfg.piLastName || '',
      proj: cfg.defaultProject || ''
      // --- Optional: override PROJ with the experiment's real project/study --
      //   https://developer.elabnext.com/docs/elabsdk2journalexperiment
      //   (read it from the experiment context or via eLabSDK.API.call).
    };
  }

  /* --- Scientist name (logged-in user) -> SCI ------------------------------
   *   The V2 User class exposes only a numeric id (eLabSDK2.System.User.getUserId());
   *   there is no synchronous name getter. So we read the current-user record
   *   from the REST API. `path: 'user'` is the eLabJournal current-user endpoint
   *   and returns the authenticated user's details.
   *   *** CONFIRM in the API Reference (/reference) that the path is 'user' and
   *   the fields are firstName / lastName for your instance; adjust if needed.
   *   Fails soft: on any error SCI is left blank and the user can type it. ---- */
  function fetchCurrentUserName() {
    return new Promise(function (resolve) {
      try {
        if (!(window.eLabSDK && eLabSDK.API && eLabSDK.API.call)) { resolve(''); return; }
        eLabSDK.API.call({
          method: 'GET',
          path: 'user',
          onSuccess: function (xhr, status, resp) {
            var r = resp || {};
            resolve(((r.firstName || '') + ' ' + (r.lastName || '')).trim());
          },
          onError: function () { resolve(''); }
        });
      } catch (e) { resolve(''); }
    });
  }

  // Device dropdown options, derived from the configured device list.
  function resolveDevices() {
    var cfg = ROOT._cfg || {};
    var list = Array.isArray(cfg.devices) ? cfg.devices : [];
    return list.map(function (d) { return { code: String(d), label: String(d) }; });
  }

  /* ==========================================================================
   * PANEL  —  HTML + live preview (inline handlers key off the rootVar).
   * ======================================================================== */
  function optionsHTML(list, selected) {
    return ['<option value="">\u2014 select \u2014</option>'].concat(
      list.map(function (o) {
        return '<option value="' + o.code + '"' + (o.code === selected ? ' selected' : '') + '>'
             + o.label + '</option>';
      })
    ).join('');
  }
  function field(lbl, inner, req) {
    return '<div class="fng-f' + (req ? ' req' : '') + '"><label>' + lbl + '</label>' + inner + '</div>';
  }
  function inputEl(key, val, ph) {
    return '<input type="text" autocomplete="off" spellcheck="false" placeholder="' + (ph || '') + '" '
         + 'value="' + (val || '') + '" oninput="' + ADDON.rootVar + '.set(\'' + key + '\',this.value)">';
  }
  function selectEl(key, opts) {
    return '<select onchange="' + ADDON.rootVar + '.set(\'' + key + '\',this.value)">' + opts + '</select>';
  }
  function panelHTML(st) {
    return ''
      + '<div class="fng-wrap">'
      + '<style>'
      + '.fng-wrap{font-family:inherit;color:#c8d0e0;}'
      + '.fng-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:10px;}'
      + '.fng-f{display:flex;flex-direction:column;background:#1a1e2a;border:1px solid #252b3b;border-radius:5px;padding:6px 8px;}'
      + '.fng-f.req{border-color:#4af0a0;}'
      + '.fng-f label{font-size:9px;letter-spacing:.08em;text-transform:uppercase;color:#6b7592;margin-bottom:3px;}'
      + '.fng-f input,.fng-f select{background:transparent;border:none;outline:none;color:#e8edf5;font-size:13px;width:100%;}'
      + '.fng-out{background:#141720;border:1px solid #4af0a0;border-radius:6px;padding:10px 12px;}'
      + '.fng-out .lbl{font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:#4af0a0;margin-bottom:5px;}'
      + '.fng-name{font-family:monospace;font-size:15px;color:#e8edf5;word-break:break-all;}'
      + '.fng-btn{margin-top:8px;background:transparent;border:1px solid #252b3b;border-radius:4px;color:#9aa4bd;font-size:11px;padding:4px 10px;cursor:pointer;}'
      + '.fng-btn:hover{border-color:#4af0a0;color:#4af0a0;}'
      + '</style>'
      + '<div class="fng-grid">'
      +   field('Institution',           selectEl('inst', optionsHTML(INSTITUTIONS, st.inst)))
      +   field('Lab PI (last name)',     inputEl('pi',  st.pi,  'e.g. Holtmaat'))
      +   field('Scientist (first last)', inputEl('sci', st.sci, 'e.g. Marie Curie'))
      +   field('Project',                inputEl('proj', st.proj, 'e.g. WhiskerLearning'))
      +   field('Sample / animal ID',     inputEl('samp', st.samp, 'e.g. M042'), true)
      +   field('Acquisition device',     selectEl('dev', optionsHTML(resolveDevices(), st.dev)))
      + '</div>'
      + '<div class="fng-out">'
      +   '<div class="lbl">\u25B8 Generated basename \u00B7 INST_PI_SCI_PROJ_SAMP_DEV_YYYYMMDD</div>'
      +   '<div class="fng-name" id="fng-name">' + (buildName(st) || 'fill in the fields\u2026') + '</div>'
      +   '<button class="fng-btn" type="button" onclick="' + ADDON.rootVar + '.copy()">Copy to clipboard</button>'
      + '</div>'
      + '</div>';
  }

  ROOT.set = function (key, val) {
    ROOT.state[key] = val;
    var el = document.getElementById('fng-name');
    if (el) el.textContent = buildName(ROOT.state) || 'fill in the fields\u2026';
  };
  ROOT.copy = function () {
    var name = buildName(ROOT.state);
    if (name && navigator.clipboard) navigator.clipboard.writeText(name);
  };
  ROOT.recordToSection = function (section, expJournalID) {
    var name = buildName(ROOT.state);
    if (!name || !section) return;
    var html = '<div style="font-family:monospace;font-size:14px;color:#e8edf5;">'
             + 'Generated file basename: <strong>' + name + '</strong>'
             + '<br><span style="font-size:11px;color:#6b7592;">recorded ' + today() + '</span></div>';
    try { section.setContent(html); } catch (e) {}
    try { if (typeof section.saveHtmlContent === 'function') section.saveHtmlContent(html, expJournalID); } catch (e) {}
  };

  /* ==========================================================================
   * REGISTRATION  —  done inside init() so it can use the configuration.
   * ======================================================================== */
  function registerSection() {
    new eLabSDK.Experiment.CustomSectionType({
      rootVar:  ADDON.rootVar,
      name:     ADDON.name,
      category: ADDON.category,
      type:     ADDON.type,
      label:    ADDON.label,
      version:  ADDON.version,

      // getContent may return a Promise (see docs); we use that to fetch the
      // logged-in user's name before rendering, so SCI is prefilled.
      getContent: function (data, section) {
        var ctx = resolveContext(data);
        ROOT.state = {
          inst: ROOT.state.inst || ctx.inst || '',
          pi:   ROOT.state.pi   || ctx.pi   || '',
          sci:  ROOT.state.sci  || '',
          proj: ROOT.state.proj || ctx.proj || '',
          samp: ROOT.state.samp || '',
          dev:  ROOT.state.dev  || ''
        };
        if (ROOT.state.sci) { return panelHTML(ROOT.state); }
        return fetchCurrentUserName().then(function (name) {
          if (name) ROOT.state.sci = name;
          return panelHTML(ROOT.state);
        });
      },

      menuItems: function (data) {
        return Promise.resolve([
          {
            id: 'fngRecord',
            icon: 'save',
            text: 'Record name',
            color: '#28a745',
            showViewMode: false,
            action: function (sectionData) {
              var section = (sectionData && sectionData.section) || data.section;
              ROOT.recordToSection(section, data.expJournalID);
            }
          }
        ]);
      }
    });
  }

  /* --- Entry point the platform calls. ------------------------------------ */
  ROOT.init = function (configuration, addonContext) {
    if (ROOT._registered) return;            // idempotent
    ROOT._registered = true;
    // Use saved/production config, else the attached defaults (side-loading
    // and first-run production both arrive here with no usable configuration).
    ROOT._cfg = configuration || ROOT.configurationValues || {};
    registerSection();
  };

})();
