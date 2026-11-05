import asyncio
import json
import logging
import os
import time
from datetime import date, datetime, timedelta

import httpx

logger = logging.getLogger('reminders')
_reminders_task = None


def init_reminders_tables(connection):
    connection.execute(
        'CREATE TABLE IF NOT EXISTS max_users ('
        'user_id INTEGER PRIMARY KEY, '
        'calendar_owner TEXT NOT NULL, '
        'reminders_enabled INTEGER NOT NULL DEFAULT 1, '
        'updated_at REAL NOT NULL)'
    )
    connection.execute('CREATE INDEX IF NOT EXISTS idx_max_users_owner ON max_users(calendar_owner)')
    connection.execute(
        'CREATE TABLE IF NOT EXISTS sent_reminders ('
        'id TEXT PRIMARY KEY, '
        'user_id INTEGER NOT NULL, '
        'event_id TEXT NOT NULL, '
        'event_date TEXT NOT NULL, '
        'sent_at REAL NOT NULL)'
    )
    connection.execute('CREATE INDEX IF NOT EXISTS idx_sent_reminders_user ON sent_reminders(user_id)')


def register_max_user(connection, user_id, calendar_owner):
    connection.execute(
        'INSERT INTO max_users (user_id, calendar_owner, updated_at) VALUES (?, ?, ?) '
        'ON CONFLICT(user_id) DO UPDATE SET calendar_owner=excluded.calendar_owner, updated_at=excluded.updated_at',
        (user_id, calendar_owner, time.time())
    )


def event_occurs_on(event, target_date):
    start_str = event.get('start')
    if not start_str:
        return False
    try:
        start = date.fromisoformat(start_str)
    except ValueError:
        return False
    if target_date < start:
        return False

    end_str = event.get('end')
    try:
        end = date.fromisoformat(end_str) if end_str else start
    except ValueError:
        end = start

    repeat = event.get('repeat')
    exceptions = event.get('exceptions') or {}

    if not repeat:
        return start <= target_date <= end

    until_str = repeat.get('until')
    if until_str:
        try:
            if target_date > date.fromisoformat(until_str):
                return False
        except ValueError:
            pass

    duration = max(0, (end - start).days)
    freq = repeat.get('frequency')
    interval = max(1, int(repeat.get('interval') or 1))
    weekdays = repeat.get('weekdays') or []

    for offset in range(duration + 1):
        occ_start = target_date - timedelta(days=offset)
        if occ_start < start:
            continue
        occ_str = occ_start.isoformat()
        if exceptions.get(occ_str) == 'excluded':
            continue

        delta = (occ_start - start).days
        applies = False
        if freq == 'daily':
            applies = (delta % interval == 0)
        elif freq == 'weekly':
            start_w = start.weekday()
            curr_w = occ_start.weekday()
            week = (delta + start_w) // 7
            allowed_w = weekdays if weekdays else [start_w]
            applies = (week % interval == 0) and (curr_w in allowed_w)
        elif freq == 'monthly':
            months = (occ_start.year - start.year) * 12 + (occ_start.month - start.month)
            applies = (months % interval == 0) and (occ_start.day == start.day)
        elif freq == 'yearly':
            years = occ_start.year - start.year
            applies = (years % interval == 0) and (occ_start.month == start.month) and (occ_start.day == start.day)

        if applies:
            return True
    return False


def format_reminder_text(event):
    title = event.get('title') or 'Событие'
    start_time = event.get('start_time')
    location = event.get('location')
    desc = (event.get('description') or '').strip()

    lines = []
    if start_time:
        clean_time = start_time[:5]
        lines.append(f'🔔 Напоминание: сегодня в {clean_time}')
    else:
        lines.append('📅 Напоминание на сегодня')
    lines.append(f'«{title}»')
    if location:
        lines.append(f'Место: {location}')
    if desc:
        preview = desc.splitlines()[0][:100]
        lines.append(preview)
    return '\n'.join(lines)


def evaluate_event_reminder(event, now):
    if event.get('status') in ('done', 'skipped'):
        return False, '', ''

    remind = event.get('remind') or ''
    if not remind:
        return False, '', ''

    offsets = {
        '0m': 0,
        '15m': 15,
        '30m': 30,
        '1h': 60,
        '2h': 120,
        '1d': 1440,
    }
    offset_minutes = offsets.get(remind)
    if offset_minutes is None:
        return False, '', ''

    today = now.date()
    start_time_str = event.get('start_time')
    candidate_dates = [today]
    if offset_minutes >= 1440:
        candidate_dates.append(today + timedelta(days=1))

    for event_date in candidate_dates:
        if not event_occurs_on(event, event_date):
            continue
        exceptions = event.get('exceptions') or {}
        if exceptions.get(event_date.isoformat()) in ('done', 'skipped', 'excluded'):
            continue

        event_id = event.get('id', '')
        if start_time_str:
            try:
                parts = [int(p) for p in start_time_str.split(':')[:2]]
                event_dt = datetime(event_date.year, event_date.month, event_date.day, parts[0], parts[1])
                diff_min = (event_dt - now).total_seconds() / 60
                if -5 <= diff_min <= offset_minutes:
                    reminder_id = f'{event_id}:{event_date.isoformat()}:{remind}'
                    return True, reminder_id, format_reminder_text(event)
            except Exception:
                pass
        else:
            notify_date = event_date - timedelta(days=1) if remind == '1d' else event_date
            if notify_date == today and 8 <= now.hour < 12:
                reminder_id = f'{event_id}:{event_date.isoformat()}:{remind}'
                return True, reminder_id, format_reminder_text(event)

    return False, '', ''


async def send_max_message(user_id, text, token=None):
    token = token or os.getenv('MAX_BOT_TOKEN', '')
    if not token or not user_id:
        return False
    url = f'https://platform-api2.max.ru/messages?user_id={user_id}'
    headers = {'Authorization': token, 'Content-Type': 'application/json'}
    payload = {'text': text}
    try:
        async with httpx.AsyncClient(verify=False, timeout=10.0) as client:
            response = await client.post(url, headers=headers, json=payload)
            return response.is_success
    except Exception as error:
        logger.warning(f'Failed to send MAX reminder to {user_id}: {error}')
        return False


async def check_all_reminders(get_db_fn, now=None, token=None):
    now = now or datetime.now()
    token = token or os.getenv('MAX_BOT_TOKEN', '')
    if not token:
        return 0

    with get_db_fn() as db:
        users = db.execute('SELECT user_id, calendar_owner FROM max_users WHERE reminders_enabled=1').fetchall()
        if not users:
            return 0

        sent_count = 0
        for user_id, owner_hash in users:
            rows = db.execute("SELECT id, data FROM calendar_items WHERE owner=? AND kind='event'", (owner_hash,)).fetchall()
            for item_id, raw in rows:
                try:
                    event = json.loads(raw)
                    event['id'] = item_id
                except Exception:
                    continue

                needed, reminder_key, text = evaluate_event_reminder(event, now)
                if not needed:
                    continue

                full_key = f'{user_id}:{reminder_key}'
                already_sent = db.execute('SELECT 1 FROM sent_reminders WHERE id=?', (full_key,)).fetchone()
                if already_sent:
                    continue

                ok = await send_max_message(user_id, text, token=token)
                if ok:
                    db.execute(
                        'INSERT INTO sent_reminders (id, user_id, event_id, event_date, sent_at) VALUES (?, ?, ?, ?, ?)',
                        (full_key, user_id, item_id, now.date().isoformat(), time.time())
                    )
                    sent_count += 1
        return sent_count


def start_reminders_task(get_db_fn, interval=60):
    global _reminders_task
    if _reminders_task is None or _reminders_task.done():
        _reminders_task = asyncio.create_task(reminders_loop(get_db_fn, interval))


def stop_reminders_task():
    global _reminders_task
    if _reminders_task and not _reminders_task.done():
        _reminders_task.cancel()
        _reminders_task = None


async def reminders_loop(get_db_fn, interval=60):
    while True:
        try:
            await check_all_reminders(get_db_fn)
        except asyncio.CancelledError:
            break
        except Exception as error:
            logger.warning(f'Error in reminders loop: {error}')
        try:
            await asyncio.sleep(interval)
        except asyncio.CancelledError:
            break
