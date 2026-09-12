/**
 * Calendar.gs — Phase 2 read-only calendar endpoint.
 *
 * Uses the built-in CalendarApp service with the documented, least-privilege
 * https://www.googleapis.com/auth/calendar.readonly scope. The official
 * CalendarApp reference lists that scope for both getDefaultCalendar() and
 * Calendar#getEvents(). This file deliberately calls read methods only; the
 * local static suite rejects Calendar write-method symbols as an additional
 * guard. Live Apps Script authorization remains unverified because no live
 * deployment or account access is authorized for this phase.
 */

const CALENDAR_EVENT_LOOKAHEAD_DAYS_ = 7;
const CALENDAR_EVENT_LIMIT_ = 10;

/**
 * Browser-callable. Reads the user's default calendar for the next
 * CALENDAR_EVENT_LOOKAHEAD_DAYS_ days, capped at CALENDAR_EVENT_LIMIT_
 * events, returning only {title, start, end, allDay} per event. Never
 * throws: any CalendarApp failure (missing permission, disabled service,
 * or anything else) is caught and reported as {status: 'unavailable'}
 * with one generic, safe message — the actual error is logged
 * server-side only, never returned to the browser. Deliberately called
 * separately from getDashboardData() (see Code.gs) so a slow or failing
 * Calendar can never block Home or Tasks from loading.
 */
function getUpcomingEvents() {
  try {
    const calendar = CalendarApp.getDefaultCalendar();
    const now = new Date();
    const until = new Date(now.getTime() + CALENDAR_EVENT_LOOKAHEAD_DAYS_ * 24 * 60 * 60 * 1000);
    const rawEvents = calendar.getEvents(now, until);

    const events = rawEvents.slice(0, CALENDAR_EVENT_LIMIT_).map(function (ev) {
      return {
        title: ev.getTitle(),
        start: ev.getStartTime().toISOString(),
        end: ev.getEndTime().toISOString(),
        allDay: ev.isAllDayEvent()
      };
    });

    return { status: 'ok', events: events, message: '' };
  } catch (err) {
    console.error('getUpcomingEvents failed: ' + (err && err.stack ? err.stack : err));
    return {
      status: 'unavailable',
      events: [],
      message: 'Calendar is not available right now.'
    };
  }
}
