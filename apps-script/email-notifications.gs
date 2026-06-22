/**
 * Task Board — EMAIL notifications (Google Apps Script, time-trigger based).
 *
 * Replaces the old Google Chat sending. A time trigger runs every 5 minutes,
 * reads tasks from Supabase, emails the OWNER on assignment and the OWNER + cc
 * MANAGER when a task is almost due / overdue, then writes per-task flags back
 * to Supabase so nothing is emailed twice.
 *
 * SETUP
 *   1) Paste this into your Apps Script project, replacing the old Chat code
 *      (delete sendChatNotifications / setupChatTrigger).
 *   2) Set SUPABASE_ANON_KEY (and APP_URL) below.
 *   3) Run setupTrigger() once and authorize when prompted. It deletes any old
 *      triggers and creates a fresh every-5-minutes trigger on sendTaskEmails.
 *
 * Notes
 *   - Recipient emails come from each task's ownerEmail / managerEmail (written
 *     by the app), falling back to the team directory in the __settings__ row.
 *   - Due times are interpreted in America/New_York (DST handled automatically).
 */

const SUPABASE_URL = 'https://qegyeuaeggaxxebixwsz.supabase.co';
const SUPABASE_ANON_KEY = 'PASTE_YOUR_ANON_PUBLIC_KEY';   // same anon key the app uses
const APP_URL = '';                  // optional, e.g. 'https://your-site.vercel.app'
const TIMEZONE = 'America/New_York';
const DEFAULT_LEAD_MIN = 60;         // "almost due" lead time fallback (minutes)

/** Run once to (re)create the 5-minute trigger and remove old ones. */
function setupTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('sendTaskEmails').timeBased().everyMinutes(5).create();
}

function sbHeaders_() {
  return { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY };
}

/** Main job — invoked by the time trigger every 5 minutes. */
function sendTaskEmails() {
  var resp = UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/tasks?select=*', {
    method: 'get', headers: sbHeaders_(), muteHttpExceptions: true
  });
  if (resp.getResponseCode() >= 300) { Logger.log('Read failed: ' + resp.getContentText()); return; }
  var rows = JSON.parse(resp.getContentText());

  var settingsRow = rows.filter(function (r) { return r.id === '__settings__'; })[0];
  var settings = (settingsRow && settingsRow.data) || {};
  var team = settings.team || [];
  var leadMs = (settings.reminderLeadMin || DEFAULT_LEAD_MIN) * 60000;

  function emailFor(name, stamped) {
    if (stamped) return stamped;
    var m = team.filter(function (x) { return x.name === name; })[0];
    return (m && m.email) || '';
  }

  var now = new Date().getTime();
  var changed = [];

  rows.forEach(function (row) {
    if (row.id === '__settings__' || !row.data) return;
    var t = row.data;
    if (t.status === 'Done' || t.status === 'Recurring Done Today') return;

    var notif = t.notif || (t.notif = { assigned: false, almost: false, overdue: false, lastOwner: t.owner || '' });
    var ownerEmail = emailFor(t.owner, t.ownerEmail);
    var managerEmail = emailFor(t.manager, t.managerEmail);
    var didChange = false;

    // 1) Assigned -> OWNER only
    if (t.owner && ownerEmail && !notif.assigned) {
      sendTaskEmail_(ownerEmail, '', 'Task Assigned', t);
      notif.assigned = true; notif.lastOwner = t.owner; didChange = true;
    }

    // 2) Due reminders -> OWNER + cc MANAGER
    if (t.dueDate) {
      var due = Utilities.parseDate(t.dueDate + ' ' + (t.dueTime || '23:59'), TIMEZONE, 'yyyy-MM-dd HH:mm');
      var ms = due.getTime() - now;
      if (ms <= 0) {
        if (!notif.overdue && ownerEmail) {
          sendTaskEmail_(ownerEmail, managerEmail, 'Task Overdue', t);
          notif.overdue = true; didChange = true;
        }
      } else if (ms <= leadMs) {
        if (!notif.almost && ownerEmail) {
          sendTaskEmail_(ownerEmail, managerEmail, 'Task Almost Due', t);
          notif.almost = true; didChange = true;
        }
      }
    }

    if (didChange) changed.push({ id: row.id, data: t, updated_at: new Date().toISOString() });
  });

  // Write back only the tasks whose flags changed (upsert via anon key).
  if (changed.length) {
    var headers = sbHeaders_();
    headers.Prefer = 'resolution=merge-duplicates';
    var w = UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/tasks?on_conflict=id', {
      method: 'post', contentType: 'application/json',
      headers: headers, payload: JSON.stringify(changed), muteHttpExceptions: true
    });
    if (w.getResponseCode() >= 300) Logger.log('Write failed: ' + w.getContentText());
  }
}

function fmt_(dateStr, timeStr) {
  if (!dateStr) return '—';
  return timeStr ? (dateStr + ' ' + timeStr + ' ET') : dateStr;
}

function sendTaskEmail_(to, cc, kind, t) {
  var subject = kind + ': ' + (t.name || '');
  var html =
    '<h2>' + subject + '</h2>' +
    '<p><b>Owner:</b> ' + (t.owner || '') + '<br>' +
    '<b>Manager:</b> ' + (t.manager || '') + '<br>' +
    '<b>Department:</b> ' + (t.department || '') + '<br>' +
    '<b>Priority:</b> ' + (t.priority || '') + '<br>' +
    '<b>Status:</b> ' + (t.status || '') + '<br>' +
    '<b>Start:</b> ' + fmt_(t.startDate, t.startTime) + '<br>' +
    '<b>Due:</b> ' + fmt_(t.dueDate, t.dueTime) + '</p>' +
    (t.notes ? '<p><b>Notes:</b> ' + t.notes + '</p>' : '') +
    (APP_URL ? '<p><a href="' + APP_URL + '">Open Task Board</a></p>' : '');
  var message = { to: to, subject: subject, htmlBody: html };
  if (cc) message.cc = cc;
  MailApp.sendEmail(message);
}
