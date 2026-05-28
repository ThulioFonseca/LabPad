"""Calendar collector: reads a published Outlook calendar (.ics).

Expands recurring events and returns events for the next N days already
formatted (day label and time), so the frontend only needs to display them.
"""
import datetime

import icalendar
import recurring_ical_events

from collectors.http_log import fetch as _http_fetch
import config
import settings

# (connect 5s, read 25s) — corporate Office365 calendars can be slow.
_TIMEOUT = (5, 25)
_UA = "Mozilla/5.0 (HomelabMonitor)"

# Day/month abbreviations (Monday=0 .. Sunday=6).
_WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
           "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def _tz():
    try:
        from zoneinfo import ZoneInfo
        return ZoneInfo(settings.get("system", "timezone", "UTC"))
    except Exception:
        return datetime.timezone.utc


def _to_local(value, tz):
    """Convert an icalendar date/datetime to a datetime with local tz."""
    if isinstance(value, datetime.datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=tz)
        return value.astimezone(tz)
    # plain date -> all-day event
    return datetime.datetime(value.year, value.month, value.day, tzinfo=tz)


def _day_label(day, today):
    delta = (day - today).days
    if delta == 0:
        return "Today"
    if delta == 1:
        return "Tomorrow"
    return "%s, %d %s" % (_WEEKDAYS[day.weekday()], day.day,
                          _MONTHS[day.month - 1])


def _time_label(start_local, end_local, all_day):
    if all_day:
        return "All day"
    label = start_local.strftime("%H:%M")
    if end_local is not None and end_local != start_local:
        label += "–" + end_local.strftime("%H:%M")
    return label


def collect():
    url = settings.get("calendar", "url", "")
    if not url:
        return {"events": [], "configured": False}

    response = _http_fetch(url, headers={"User-Agent": _UA}, timeout=_TIMEOUT)
    calendar = icalendar.Calendar.from_ical(response.content)

    tz = _tz()
    now = datetime.datetime.now(tz)
    today = now.date()
    days = settings.get("calendar", "days", 3)
    window_end = now + datetime.timedelta(days=days)

    # recurring_ical_events expands RRULE (weekly meetings etc.) within the window.
    occurrences = recurring_ical_events.of(calendar).between(now, window_end)

    rows = []
    for component in occurrences:
        dtstart = component.get("DTSTART")
        if dtstart is None:
            continue
        raw_start = dtstart.dt
        all_day = not isinstance(raw_start, datetime.datetime)
        start_local = _to_local(raw_start, tz)

        end_local = None
        dtend = component.get("DTEND")
        if dtend is not None:
            end_local = _to_local(dtend.dt, tz)

        day = start_local.date()
        summary = component.get("SUMMARY")
        location = component.get("LOCATION")

        rows.append((start_local, {
            "title": str(summary) if summary else "(no title)",
            "location": str(location) if location else None,
            "all_day": all_day,
            "day_key": day.isoformat(),
            "day_label": _day_label(day, today),
            "time_label": _time_label(start_local, end_local, all_day),
            "start_epoch": int(start_local.timestamp()),
            "end_epoch": int(end_local.timestamp()) if end_local else None,
        }))

    rows.sort(key=lambda row: row[0])
    events = [row[1] for row in rows][:config.CALENDAR_MAX_EVENTS]
    return {"events": events, "configured": True}
