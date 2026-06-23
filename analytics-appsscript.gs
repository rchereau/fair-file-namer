/**
 * FAIR File Namer — usage analytics collector (Google Apps Script)
 * ----------------------------------------------------------------
 * Receives event pings from the tool and stores them in THIS spreadsheet,
 * and serves them back to the private dashboard (stats.html).
 *
 * SETUP (once):
 *   1. Create a new Google Sheet (this becomes your private datastore).
 *   2. Extensions > Apps Script. Paste this whole file. Save.
 *   3. Edit WRITE_KEY and READ_KEY below to two different long random strings.
 *   4. Deploy > New deployment > type "Web app".
 *        - Execute as:  Me
 *        - Who has access:  Anyone        (access is gated by the keys, not by login)
 *      Copy the resulting .../exec URL.
 *   5. In index.html set FNG_ANALYTICS_URL = that URL and FNG_ANALYTICS_KEY = WRITE_KEY.
 *   6. In stats.html set ANALYTICS_URL = that URL and KEY = READ_KEY.
 *
 * The Sheet, and therefore all data, stays owned by you alone. Only someone who
 * has a key can write/read. Re-deploy (Manage deployments > Edit > new
 * version) after any change to this script.
 */

// TWO keys. The WRITE key lives in the PUBLIC app (index.html) and can only append
// events. The READ key lives ONLY in your local stats.html and is required to read
// the data and to set launch dates. Never put the READ key in anything you publish.
var WRITE_KEY = 'CHANGE-ME-write-key';             // -> index.html  (FNG_ANALYTICS_KEY)
var READ_KEY  = 'CHANGE-ME-read-key-keep-private'; // -> stats.html (KEY)
var SHEET_EVENTS = 'events';
var EVENT_COLS = ['ts', 'action', 'labId', 'lab', 'dept', 'operator', 'deviceScope', 'template', 'storage', 'v', 'recvAt'];
var SHEET_LAUNCH = 'launch';
var LAUNCH_COLS = ['labId', 'lab', 'launchDate', 'updatedAt'];

/** Append incoming events. Body: { key, events:[ {...}, ... ] }. */
function doPost(e) {
  try {
    var data = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (data.type === 'launch') {                                 // setting launch dates: READ key only
      if (data.key !== READ_KEY) return _json({ ok: false, error: 'bad key' });
      _upsertLaunch(data.rows || []); return _json({ ok: true, type: 'launch' });
    }
    if (data.key !== WRITE_KEY) return _json({ ok: false, error: 'bad key' });  // appending events: WRITE key
    var sh = _sheet(SHEET_EVENTS, EVENT_COLS);
    var now = new Date().toISOString();
    var rows = (data.events || []).map(function (ev) {
      return [ev.ts || now, ev.action || '', ev.labId || '', ev.lab || '', ev.dept || '',
              ev.operator || '', ev.deviceScope || '', ev.template || '', ev.storage || '', ev.v || 1, now];
    });
    if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, EVENT_COLS.length).setValues(rows);
    return _json({ ok: true, n: rows.length });
  } catch (err) {
    return _json({ ok: false, error: String(err) });
  }
}

/**
 * Serve all events to the dashboard.
 *   ?key=READ_KEY                -> JSON  { ok, events:[...] }
 *   ?key=READ_KEY&callback=fn    -> JSONP fn({ ok, events:[...] })   (use this from the browser)
 */
function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.key !== READ_KEY) return _maybeJsonp(p.callback, { ok: false, error: 'bad key' });
  var events = _read(_sheet(SHEET_EVENTS, EVENT_COLS));
  var launch = _read(_sheet(SHEET_LAUNCH, LAUNCH_COLS));
  return _maybeJsonp(p.callback, { ok: true, events: events, launch: launch });
}

/** Upsert launch dates by labId. rows: [{ labId, lab, launchDate }]. Empty launchDate clears it. */
function _upsertLaunch(rows) {
  var sh = _sheet(SHEET_LAUNCH, LAUNCH_COLS);
  var existing = _read(sh), at = {};
  existing.forEach(function (r, i) { at[r.labId] = i + 2; });   // 1-based + header row
  var now = new Date().toISOString();
  rows.forEach(function (r) {
    if (!r.labId) return;
    var line = [r.labId, r.lab || '', r.launchDate || '', now];
    if (at[r.labId]) sh.getRange(at[r.labId], 1, 1, LAUNCH_COLS.length).setValues([line]);
    else { sh.appendRow(line); at[r.labId] = sh.getLastRow(); }
  });
}

/* ----------------------------- helpers ---------------------------------- */
function _sheet(name, cols) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); sh.getRange(1, 1, 1, cols.length).setValues([cols]); }
  return sh;
}
function _read(sh) {
  var n = sh.getLastRow();
  if (n < 2) return [];
  var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var vals = sh.getRange(2, 1, n - 1, sh.getLastColumn()).getValues();
  return vals.map(function (row) {
    var o = {}; head.forEach(function (h, i) { o[h] = row[i]; }); return o;
  });
}
function _json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function _maybeJsonp(callback, obj) {
  if (callback) {
    return ContentService.createTextOutput(callback + '(' + JSON.stringify(obj) + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return _json(obj);
}
