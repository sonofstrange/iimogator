import asyncio
import hashlib
import io
import json
import os
import re
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import date, time
from pathlib import Path
from urllib.parse import parse_qs, quote_plus, urljoin, urlparse

import httpx
from bs4 import BeautifulSoup
from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, ValidationError

from .sources import Source, SourceError, fetch_public


from typing import Any

class Link(BaseModel):
    title: str = "Ссылка"
    url: str = ""


class Event(BaseModel, extra='allow'):
    start: Any = None
    end: Any = None
    start_time: Any = None
    end_time: Any = None
    subjects: list = []
    olympiad_id: Any = None
    order: int = 0


class Olympiad(BaseModel, extra='allow'):
    warnings: list = []
    sources: list = []
    subjects: list = []


class OlympiadDraft(BaseModel):
    olympiad: Olympiad
    stages: list[Event] = []
    warnings: list = []
    sources: list = []


def check_event(event):
    if not isinstance(event, dict):
        event = dict(event)

    start = event.get('start')
    end = event.get('end')
    if start and end and str(end) < str(start):
        raise HTTPException(422, 'Конец раньше начала')

    start_time = event.get('start_time')
    end_time = event.get('end_time')
    if start_time and end_time and str(end_time) < str(start_time):
        raise HTTPException(422, 'Время конца раньше начала')

    for link in event.get('links') or []:
        url = link.get('url', '')
        if url and not url.startswith('http'):
            raise HTTPException(422, 'Некорректная ссылка')

    repeat = event.get('repeat')
    if repeat:
        for day in repeat.get('weekdays', []):
            if day > 6:
                raise HTTPException(422, 'Неверные дни недели')


def parse_draft(data):
    if not isinstance(data, dict):
        raise ValueError('Ожидался JSON объект')
    for stage in data.get('stages', []):
        if not isinstance(stage, dict):
            raise ValueError('Этап олимпиады должен быть объектом')
        if stage.get('end') and not stage.get('start'):
            stage['start'], stage['end'] = stage['end'], None
            stage['description'] = 'Дедлайн. ' + (stage.get('description') or '')
        if stage.get('end_time') and not stage.get('start_time') and not stage.get('end'):
            stage['start_time'], stage['end_time'] = stage['end_time'], None
        for key in ('start', 'end'):
            val = stage.get(key)
            if isinstance(val, str) and val:
                stage[key] = date.fromisoformat(val)
        for key in ('start_time', 'end_time'):
            val = stage.get(key)
            if isinstance(val, str) and val:
                stage[key] = time.fromisoformat(val)
    draft = OlympiadDraft.model_validate(data)
    for stage in draft.stages:
        for subject in (stage.subjects or []):
            if subject not in draft.olympiad.subjects:
                draft.olympiad.subjects.append(subject)
    draft.olympiad.subjects = list(dict.fromkeys(draft.olympiad.subjects))
    return draft


@contextmanager
def database():
    path = Path(os.getenv('CALENDAR_DB', str(Path(__file__).resolve().parent.parent / 'data/calendar.sqlite3')))
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path, timeout=10)
    connection.execute('PRAGMA journal_mode=WAL')
    connection.execute('CREATE TABLE IF NOT EXISTS calendar_items (id TEXT PRIMARY KEY, owner TEXT NOT NULL, kind TEXT NOT NULL, data TEXT NOT NULL)')
    connection.execute('CREATE INDEX IF NOT EXISTS calendar_owner ON calendar_items(owner)')
    from .reminders import init_reminders_tables
    init_reminders_tables(connection)
    try:
        with connection:
            yield connection
    finally:
        connection.close()


def owner(x_calendar_key: str = Header(default=''), x_max_data: str = Header(default='')):
    if x_max_data:
        from .max_auth import max_user
        from .reminders import register_max_user
        try:
            user_id = max_user(x_max_data, os.getenv('MAX_BOT_TOKEN', ''))
            calendar_owner = hashlib.sha256(f'max:{user_id}'.encode()).hexdigest()
            with database() as connection:
                register_max_user(connection, user_id, calendar_owner)
            return calendar_owner
        except (ValueError, KeyError, TypeError):
            raise HTTPException(401, 'Ошибка MAX')
    try:
        return hashlib.sha256(uuid.UUID(x_calendar_key).bytes).hexdigest()
    except ValueError:
        raise HTTPException(401, 'Нет ключа')


def insert(connection, user, kind, value):
    item_id = uuid.uuid4().hex
    if hasattr(value, 'model_dump'):
        data = value.model_dump(mode='json')
    elif isinstance(value, dict):
        data = value
    else:
        data = dict(value)
    connection.execute('INSERT INTO calendar_items VALUES (?, ?, ?, ?)', (item_id, user, kind, json.dumps(data, ensure_ascii=False, default=str)))
    return {**data, 'id': item_id}

def existing(connection, user, kind, item_id):
    row = connection.execute('SELECT data FROM calendar_items WHERE owner=? AND kind=? AND id=?', (user, kind, item_id)).fetchone()
    if not row:
        raise HTTPException(404, 'Не найдено')
    return json.loads(row[0])


def check_group(connection, user, event):
    if event.get('olympiad_id'):
        existing(connection, user, 'olympiad', event['olympiad_id'])

def read_schedule(user):
    with database() as connection:
        rows = connection.execute('SELECT id, kind, data FROM calendar_items WHERE owner=? ORDER BY rowid', (user,)).fetchall()
    result = {'events': [], 'olympiads': []}
    for item_id, kind, data in rows:
        result['events' if kind == 'event' else 'olympiads'].append({**json.loads(data), 'id': item_id})
    return result


def page_text(url):
    content, mime, final_url = fetch_public(url)
    if 'pdf' in mime or content.startswith(b'%PDF'):
        from pypdf import PdfReader
        try:
            reader = PdfReader(io.BytesIO(content))
            if len(reader.pages) > 100:
                raise SourceError('Слишком большой PDF')
            text = '\n'.join(page.extract_text() or '' for page in reader.pages)
        except SourceError:
            raise
        except Exception:
            raise SourceError('Не удалось прочитать PDF')
        if len(text.strip()) < 50:
            raise SourceError('В PDF нет текста')
        return text[:55000], final_url, []
    if 'html' not in mime and not mime.startswith('text/'):
        raise SourceError('Неверный формат')
    soup = BeautifulSoup(content, 'html.parser')
    for node in soup(['script', 'style', 'noscript', 'svg', 'form']):
        node.decompose()
    main = (soup.select_one('main, [role=main]') or soup.select_one('#main-content, .main-content, #content')
            or soup.find('article'))
    if not main:
        candidates = soup.select('.content')
        main = max(candidates, key=lambda node: (bool(node.find('h1')), len(node.get_text(' ', strip=True))), default=None) or soup.body or soup
    links = []
    for anchor in main.find_all('a', href=True):
        href = urljoin(final_url, anchor['href']).split('#')[0]
        image = anchor.find('img', alt=True)
        label = anchor.get_text(' ', strip=True) or anchor.get('title', '') or (image.get('alt', '') if image else '')
        if urlparse(href).scheme in ('http', 'https') and label:
            links.append((label[:150], href))
            anchor.append(f' [{href}]')
    for row in reversed(main.find_all('tr')):
        row.replace_with('\n' + row.get_text(' | ', strip=True) + '\n')
    return main.get_text('\n', strip=True)[:55000], final_url, links


def schedule_excerpt(text, limit):
    if len(text) <= limit:
        return text
    lines = text.splitlines()
    selected = set(range(min(20, len(lines))))
    pattern = re.compile(r'\d{1,2}[./]\d{1,2}|\b20\d{2}\b|\d{1,2}:\d{2}|январ|феврал|март|апрел|ма[йя]|июн|июл|август|сентябр|октябр|ноябр|декабр|регистрац|расписан|срок|отбор|финал|этап|апелляц', re.I)
    for index, line in enumerate(lines):
        if pattern.search(line):
            selected.update(range(max(0, index - 3), min(len(lines), index + 4)))
    excerpt = '\n'.join(lines[index] for index in sorted(selected))
    return excerpt[:limit]


def navigation_candidates(links, seen, season_start, allow_history=False):
    # простой фильтр ссылок по ключевым словам
    keywords = ('расписан', 'календар', 'срок', 'график', 'дат', 'регистрац', 'этап', 'отбор', 'финал')
    result = []
    for title, url in links:
        if url in seen or not url.startswith(('http://', 'https://')):
            continue
        text = (title + ' ' + url).lower()
        if not any(k in text for k in keywords):
            continue
        if 'архив' in text and not allow_history:
            continue
        m = re.search(r'\b(20\d{2})\b', title)
        if m and int(m.group(1)) < season_start and not allow_history:
            continue
        result.append((title, url))
    return result[:10]



def is_spa_or_empty(text, links):
    clean = text.strip()
    spa_markers = (
        'включите javascript', 'enable javascript',
        'загрузка страницы', 'loading page',
        'это может занять несколько секунд', 'пожалуйста, подождите'
    )
    lower = clean.lower()
    if any(marker in lower for marker in spa_markers) and len(clean) < 400:
        return True
    if len(links) == 0 and len(clean) < 180:
        return True
    return False


def search_query_from_url(url, page_title=''):
    parsed = urlparse(url)
    slugs = [part for part in parsed.path.split('/') if part and part not in ('events', 'event', 'olympiads', 'olympiad', 'ru', 'en')]
    parts = []
    if slugs:
        last = slugs[-1]
        tokens = re.split(r'[-_.]', last)
        for t in tokens:
            tl = t.lower()
            if tl == 'nsk':
                parts.extend(['nsk', 'новосибирск'])
            elif tl == 'spb':
                parts.extend(['spb', 'петербург'])
            elif tl == 'msk':
                parts.extend(['msk', 'москва'])
            elif tl not in ('html', 'htm', 'php', 'index'):
                parts.append(t)
    if page_title and len(page_title) > 3 and not any(k in page_title.lower() for k in ('загрузка', 'loading', '404', 'главная')):
        parts.insert(0, page_title)
    if not parts:
        parts.append(parsed.hostname or '')
    parts.append('олимпиада')
    return ' '.join(parts)


def web_search_links(query, exclude_host=None):
    url = f'https://html.duckduckgo.com/html/?q={quote_plus(query)}'
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
    }
    try:
        with httpx.Client(timeout=10, follow_redirects=True, headers=headers) as client:
            resp = client.get(url)
            if resp.status_code != 200:
                return []
        soup = BeautifulSoup(resp.content, 'html.parser')
        results = []
        for item in soup.select('.result'):
            title_el = item.select_one('.result__title a')
            if not title_el:
                continue
            href = title_el.get('href', '')
            if 'uddg=' in href:
                parsed = parse_qs(urlparse(href).query)
                real_url = parsed.get('uddg', [href])[0]
            else:
                real_url = href
            if not real_url.startswith(('http://', 'https://')):
                continue
            cand_host = (urlparse(real_url).hostname or '').lower()
            if exclude_host and (cand_host == exclude_host or cand_host.endswith('.' + exclude_host)):
                continue
            title = title_el.get_text(' ', strip=True)
            results.append((title, real_url))
        return results
    except Exception:
        return []

async def olympiad_source(url, ask_model):
    try:
        text, final_url, links = await asyncio.to_thread(page_text, url)
    except httpx.HTTPError:
        raise SourceError('Сайт недоступен')

    pages = [Link(title='Исходная страница', url=final_url)]
    parts = [f'СТРАНИЦА {final_url}\n{schedule_excerpt(text, 14000)}']
    seen = {url, final_url}
    unavailable = []
    discovered = list(links)

    if is_spa_or_empty(text, links):
        query = search_query_from_url(final_url)
        search_results = await asyncio.to_thread(web_search_links, query, (urlparse(final_url).hostname or '').lower())
        found_count = 0
        for stitle, surl in search_results[:4]:
            try:
                cand_text, cand_url, cand_links = await asyncio.to_thread(page_text, surl)
                if len(cand_text.strip()) >= 200 and cand_url not in seen:
                    parts.append(f'СТРАНИЦА ИЗ ПОИСКА {cand_url}\n{schedule_excerpt(cand_text, 14000)}')
                    pages.append(Link(title=f'Поиск: {stitle[:60]}', url=cand_url))
                    discovered.extend(cand_links)
                    seen.add(cand_url)
                    found_count += 1
                    if found_count >= 2:
                        break
            except Exception:
                continue
        if found_count == 0 and len(text.strip()) < 100:
            raise SourceError('Страница загружается через JavaScript (SPA) и не содержит текста в исходном коде. Вставьте прямую ссылку на регламент или скопируйте текст расписания.')
    current = date.today()
    season_start = current.year if current.month >= 8 else current.year - 1
    requested_year = re.search(r'(?:year=|/)(20\d{2})(?:\D|$)', final_url)
    allow_history = bool(requested_year and int(requested_year.group(1)) < season_start)
    for limit in (3, 2):
        options = navigation_candidates(discovered, seen, season_start, allow_history)
        if not options:
            break
        chosen = [link for _, link in options[:limit]]
        titles = {link: title for title, link in options}
        seen.update(chosen)
        fetched = await asyncio.gather(*(asyncio.to_thread(page_text, link) for link in chosen), return_exceptions=True)
        for link, result in zip(chosen, fetched):
            if isinstance(result, (SourceError, httpx.HTTPError)):
                unavailable.append(link)
                continue
            if isinstance(result, BaseException):
                raise result
            extra, actual, new_links = result
            if actual in seen and actual != link:
                continue
            seen.add(actual)
            parts.append(f'СТРАНИЦА {actual}\n{schedule_excerpt(extra, 9000)}')
            pages.append(Link(title=titles[link], url=actual))
            discovered.extend(new_links)
    return Source('Олимпиада', 'page', '\n\n'.join(parts), url=final_url), pages, unavailable


def calendar_router(ask_model):
    from fastapi import Depends
    router = APIRouter(prefix='/api/calendar')
    
    @router.post('/move-browser')
    def move_browser(x_calendar_key: str = Header(default=''), x_max_data: str = Header(default='')):
        if not x_max_data:
            raise HTTPException(401, 'Открой приложение в MAX.')
        target = owner(x_calendar_key, x_max_data)
        source = owner(x_calendar_key, '')
        with database() as connection:
            count = connection.execute('SELECT COUNT(*) FROM calendar_items WHERE owner=?', (target,)).fetchone()[0]
            if count:
                raise HTTPException(409, 'Расписание уже есть')
            connection.execute('UPDATE calendar_items SET owner=? WHERE owner=?', (target, source))
        return {'ok': True}

    @router.get('')
    def schedule(user: str = Depends(owner)):
        return read_schedule(user)

    @router.get('/capabilities')
    def capabilities(user: str = Depends(owner)):
        return {'subject_statuses': True}

    @router.get('/reminders')
    def get_reminders(user: str = Depends(owner)):
        with database() as connection:
            row = connection.execute('SELECT user_id, reminders_enabled FROM max_users WHERE calendar_owner=?', (user,)).fetchone()
        if not row:
            return {'available': False, 'enabled': False}
        return {'available': True, 'user_id': row[0], 'enabled': bool(row[1])}

    @router.post('/reminders/toggle')
    def toggle_reminders(user: str = Depends(owner)):
        with database() as connection:
            row = connection.execute('SELECT reminders_enabled FROM max_users WHERE calendar_owner=?', (user,)).fetchone()
            if not row:
                raise HTTPException(401, 'Напоминания доступны при входе через MAX.')
            new_state = 0 if row[0] else 1
            connection.execute('UPDATE max_users SET reminders_enabled=? WHERE calendar_owner=?', (new_state, user))
        return {'available': True, 'enabled': bool(new_state)}

    @router.post('/reminders/test')
    async def test_reminder(user: str = Depends(owner)):
        with database() as connection:
            row = connection.execute('SELECT user_id FROM max_users WHERE calendar_owner=?', (user,)).fetchone()
        if not row:
            raise HTTPException(401, 'Напоминания доступны при входе через MAX.')
        from .reminders import send_max_message
        user_id = row[0]
        text = '🔔 Тестовое напоминание ИИмогатора\nБот подключён, напоминания перед событиями будут приходить сюда.'
        ok = await send_max_message(user_id, text)
        if not ok:
            raise HTTPException(502, 'Не удалось отправить сообщение. Начни диалог с ботом в MAX.')
        return {'ok': True}

    @router.post('/events')
    def create_event(event: dict, user: str = Depends(owner)):
        with database() as connection:
            check_event(event)
            check_group(connection, user, event)
            return insert(connection, user, 'event', event)

    @router.put('/events/{item_id}')
    def update_event(item_id: str, event: dict, user: str = Depends(owner)):
        with database() as connection:
            check_event(event)
            existing(connection, user, 'event', item_id)
            check_group(connection, user, event)
            connection.execute('UPDATE calendar_items SET data=? WHERE id=? AND owner=?', (json.dumps(event, ensure_ascii=False), item_id, user))
        return {**event, 'id': item_id}

    @router.delete('/events/{item_id}')
    def delete_event(item_id: str, user: str = Depends(owner)):
        with database() as connection:
            existing(connection, user, 'event', item_id)
            connection.execute('DELETE FROM calendar_items WHERE id=? AND owner=?', (item_id, user))
        return {'ok': True}

    class Occurrence(BaseModel):
        day: date
        event: dict = None
        status: str = 'excluded'

    @router.post('/events/{item_id}/occurrence')
    def change_occurrence(item_id: str, change: Occurrence, user: str = Depends(owner)):
        with database() as connection:
            original = existing(connection, user, 'event', item_id)
            if not original.get('repeat'):
                raise HTTPException(422, 'Событие не повторяется')
            if 'exceptions' not in original or not isinstance(original['exceptions'], dict):
                original['exceptions'] = {}
            original['exceptions'][change.day.isoformat()] = 'excluded' if change.event else change.status
            connection.execute('UPDATE calendar_items SET data=? WHERE id=? AND owner=?', (json.dumps(original, ensure_ascii=False), item_id, user))
            if change.event:
                check_event(change.event)
                change.event['repeat'] = None
                change.event['exceptions'] = {}
                check_group(connection, user, change.event)
                insert(connection, user, 'event', change.event)
        return {'ok': True}
    @router.post('/olympiads')
    def create_olympiad(draft: OlympiadDraft, user: str = Depends(owner)):
        with database() as connection:
            draft.olympiad.warnings, draft.olympiad.sources = draft.warnings, draft.sources
            group = insert(connection, user, 'olympiad', draft.olympiad)
            for index, stage in enumerate(draft.stages):
                stage.olympiad_id = group['id']
                stage.order = index
                insert(connection, user, 'event', stage)
        return group

    @router.put('/olympiads/{item_id}')
    def update_olympiad(item_id: str, draft: OlympiadDraft, user: str = Depends(owner)):
        with database() as connection:
            existing(connection, user, 'olympiad', item_id)
            draft.olympiad.warnings, draft.olympiad.sources = draft.warnings, draft.sources
            connection.execute('UPDATE calendar_items SET data=? WHERE id=? AND owner=?', (draft.olympiad.model_dump_json(), item_id, user))
            connection.execute("DELETE FROM calendar_items WHERE owner=? AND kind='event' AND json_extract(data, '$.olympiad_id')=?", (user, item_id))
            for index, stage in enumerate(draft.stages):
                stage.olympiad_id, stage.order = item_id, index
                insert(connection, user, 'event', stage)
        return {'id': item_id}

    @router.delete('/olympiads/{item_id}')
    def delete_olympiad(item_id: str, user: str = Depends(owner)):
        with database() as connection:
            existing(connection, user, 'olympiad', item_id)
            connection.execute("DELETE FROM calendar_items WHERE owner=? AND kind='event' AND json_extract(data, '$.olympiad_id')=?", (user, item_id))
            connection.execute('DELETE FROM calendar_items WHERE id=? AND owner=?', (item_id, user))
        return {'ok': True}

    @router.post('/import')
    async def import_olympiad(request: Link, user: str = Depends(owner)):
        source, pages, unavailable = await olympiad_source(request.url, ask_model)
        schema = '''{"olympiad":{"title":"Название","description":"Описание","subjects":["Предмет"],"links":[{"title":"Сайт","url":"https://…"}]},"stages":[{"title":"Этап","subjects":[],"description":"Условия","start":"YYYY-MM-DD или null","end":"YYYY-MM-DD или null","start_time":null,"end_time":null,"timezone":"","location":"","links":[]}],"warnings":[]}'''
        instruction = f"""Извлеки расписание олимпиады и её этапы из текста. Сегодня {date.today().isoformat()}.
Верни JSON со следующей структурой:
1. olympiad:
   - title: официальное название олимпиады и учебный сезон.
   - description: краткие условия участия и ограничения (до 400 символов).
   - subjects: список официальных школьных предметов олимпиады (например: Информатика, Математика, Физика, Химия, Биология, Русский язык). Обобщай специализации и синонимы: программирование, IT, разработка - это Информатика; алгебра, геометрия - это Математика. Не дублируй синонимы.
   - links: полезные ссылки (официальный сайт, регистрация).
2. stages: все найденные этапы и дедлайны (регистрация, отборочные туры, финал, публикация результатов, апелляции).
   - Для каждого этапа укажи title, description, start и end (даты строго в формате YYYY-MM-DD или null, если дата неизвестна).
   - start_time и end_time (HH:MM:SS или null), timezone (например МСК), location.
   - subjects: список предметов, к которым относится этот этап (пустой список - общий этап).
   - links: прямые ссылки для этого этапа.
3. warnings: список предупреждений (если сезон устарел, даты не подтверждены или расписание неполное).

Не придумывай даты и ссылки, которых нет в тексте. Если дата неизвестна - используй null.
Формат строго JSON по схеме:\n{schema}""" 
        draft = await ask_model(source, instruction, schema, parse_draft, max_tokens=11000, operation='calendar')
        draft.sources = pages
        for url in unavailable:
            if len(draft.warnings) < 30:
                draft.warnings.append('Не удалось открыть страницу: ' + url)
        draft.olympiad.status = 'active'
        for stage in draft.stages:
            stage.status, stage.repeat, stage.exceptions, stage.olympiad_id = 'planned', None, {}, None
        return draft

    class Backup(BaseModel):
        events: list[dict] = []
        olympiads: list[dict] = []

    @router.post('/restore')
    def restore(backup: Backup, user: str = Depends(owner)):
        try:
            groups = [(str(group.get('id', '')), Olympiad.model_validate(group)) for group in backup.olympiads]
            events = [Event.model_validate(event) for event in backup.events]
        except ValidationError:
            raise HTTPException(422, 'Ошибка в файле бэкапа')
        group_ids = [old for old, _ in groups]
        if any(not item for item in group_ids) or len(group_ids) != len(set(group_ids)) or any(event.olympiad_id and event.olympiad_id not in group_ids for event in events):
            raise HTTPException(422, 'Нарушены связи в бэкапе')
        with database() as connection:
            ids = {old: insert(connection, user, 'olympiad', group)['id'] for old, group in groups}
            for event in events:
                event.olympiad_id = ids.get(event.olympiad_id)
                insert(connection, user, 'event', event)
        return {'ok': True}

    return router
