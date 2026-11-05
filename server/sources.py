import html
import io
import json
import os
import re
import tempfile
import threading
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urljoin, urlparse

import httpx
from bs4 import BeautifulSoup
from PIL import Image

MAX_TEXT = 120_000
MAX_PHOTO = 10 * 1024 * 1024
MAX_AUDIO = 80 * 1024 * 1024


class SourceError(ValueError):
    pass


@dataclass
class Source:
    title: str
    kind: str
    text: str = ''
    image: str = ''
    url: str = ''


def checked_text(text):
    text = text.strip()
    if not text:
        raise SourceError('Текст не найден')
    if len(text) > MAX_TEXT:
        raise SourceError('Слишком длинный текст')
    return text


def public_url(url):
    parsed = urlparse(url)
    if parsed.scheme not in ('http', 'https') or not parsed.hostname:
        raise SourceError('Неверная ссылка')
    host = parsed.hostname.lower()
    if host in ('localhost', '127.0.0.1', '169.254.169.254', '[::1]', '::1') or host.startswith(('127.', '10.', '192.168.', '172.16.')):
        raise SourceError('Локальные адреса запрещены')
    return url


def fetch_public(url, limit=6 * 1024 * 1024):
    public_url(url)
    try:
        with httpx.Client(timeout=25, follow_redirects=True, headers={'User-Agent': 'Mozilla/5.0'}) as client:
            resp = client.get(url)
            resp.raise_for_status()
            if len(resp.content) > limit:
                raise SourceError('Страница слишком большая')
            return resp.content, resp.headers.get('content-type', ''), str(resp.url)
    except SourceError:
        raise
    except Exception:
        raise SourceError('Не удалось открыть сайт')


def validate_photo(content):
    if not content or len(content) > MAX_PHOTO:
        raise SourceError('Файл больше 10 МБ')
    try:
        with Image.open(io.BytesIO(content)) as img:
            fmt = (img.format or '').upper()
            if fmt not in ('JPEG', 'PNG', 'WEBP'):
                raise SourceError('Нужен JPG, PNG или WEBP')
            return f'image/{fmt.lower()}'
    except Exception:
        raise SourceError('Не удалось прочитать фото')


def captions_text(content, extension):
    decoded = content.decode('utf-8-sig', errors='replace')
    if extension == 'json3':
        payload = json.loads(decoded)
        lines = [''.join(segment.get('utf8', '') for segment in event.get('segs', [])) for event in payload.get('events', [])]
    else:
        soup = BeautifulSoup(decoded, 'html.parser')
        if soup.find('text') or soup.find('p'):
            lines = [node.get_text(' ', strip=True) for node in soup.find_all(['text', 'p'])]
        else:
            lines = decoded.splitlines()
    cleaned = []
    for line in lines:
        line = line.strip()
        if not line or '-->' in line or re.match(r'^(WEBVTT|Kind:|Language:|NOTE|STYLE)', line) or line.isdigit():
            continue
        line = html.unescape(re.sub(r'<[^>]+>', '', line))
        if line and (not cleaned or cleaned[-1] != line):
            cleaned.append(line)
    return checked_text('\n'.join(cleaned))


_whisper = None
_whisper_lock = threading.Lock()


def transcribe_audio(path):
    global _whisper
    with _whisper_lock:
        from faster_whisper import WhisperModel
        if _whisper is None:
            _whisper = WhisperModel(os.getenv('WHISPER_MODEL', 'base'), device='cpu', compute_type='int8', cpu_threads=2)
        segments, _ = _whisper.transcribe(path, beam_size=3, vad_filter=True)
        text = '\n'.join(segment.text.strip() for segment in segments)
    return checked_text(text)


def video_source(url):
    import yt_dlp
    options = {
        'quiet': True, 'no_warnings': True, 'noplaylist': True,
        'socket_timeout': 20, 'retries': 1, 'extractor_retries': 1,
    }
    try:
        with yt_dlp.YoutubeDL(options) as downloader:
            info = downloader.extract_info(url, download=False)
        if not info or info.get('_type') in ('playlist', 'multi_video'):
            raise SourceError('Плейлисты не поддерживаются')
        if info.get('is_live'):
            raise SourceError('Прямой эфир не поддерживается')
        if (info.get('duration') or 0) > 5400:
            raise SourceError('Видео больше 90 минут')
        title = str(info.get('title') or 'Видеолекция')[:300]
        for captions in (info.get('subtitles', {}), info.get('automatic_captions', {})):
            languages = sorted(captions, key=lambda lang: (not lang.startswith('ru'), not lang.startswith('en'), lang))
            for lang in languages[:3]:
                choices = sorted(captions[lang], key=lambda item: {'json3': 0, 'vtt': 1, 'srv1': 2}.get(item.get('ext'), 10))
                for caption in choices[:2]:
                    try:
                        body, _, _ = fetch_public(caption['url'])
                        text = captions_text(body, caption.get('ext', 'vtt'))
                        if len(text) >= 30:
                            return Source(title, 'subtitles', text=text, url=url)
                    except (httpx.HTTPError, SourceError, ValueError):
                        continue
        with tempfile.TemporaryDirectory(prefix='iimogator-') as directory:
            download_options = {
                **options, 'format': 'bestaudio/best',
                'max_filesize': MAX_AUDIO,
                'outtmpl': str(Path(directory) / 'lecture.%(ext)s'),
                'progress_hooks': [limit_download],
            }
            with yt_dlp.YoutubeDL(download_options) as downloader:
                downloaded = downloader.extract_info(url, download=True)
                audio_path = downloader.prepare_filename(downloaded)
            if not Path(audio_path).is_file() or Path(audio_path).stat().st_size > MAX_AUDIO:
                raise SourceError('Аудио больше 80 МБ')
            return Source(title, 'transcription', text=transcribe_audio(audio_path), url=url)
    except SourceError:
        raise
    except Exception:
        raise SourceError('Не удалось открыть видео')


def limit_download(progress):
    if (progress.get('downloaded_bytes') or 0) > MAX_AUDIO:
        raise SourceError('Аудио больше 80 МБ')


def extract_link(url):
    public_url(url)
    parsed = urlparse(url)
    host = parsed.hostname.lower()
    video_hosts = ('youtube.com', 'youtu.be', 'rutube.ru', 'vkvideo.ru', 'vk.com', 'vimeo.com')
    if any(host == item or host.endswith('.' + item) for item in video_hosts) or re.search(r'\.(mp4|webm|m4a|mp3|m3u8)(?:$|\?)', parsed.path):
        return video_source(url)
    try:
        content, mime, final_url = fetch_public(url)
        if mime.startswith(('audio/', 'video/')):
            return video_source(final_url)
        if 'html' not in mime and not mime.startswith('text/'):
            raise SourceError('Неверный формат')
        soup = BeautifulSoup(content, 'html.parser')
        title = soup.title.get_text(' ', strip=True)[:300] if soup.title else 'Лекция по ссылке'
        embedded = soup.find('iframe', src=re.compile(r'youtube|rutube|vimeo|vkvideo', re.I))
        for node in soup(['script', 'style', 'nav', 'footer', 'header', 'form', 'aside', 'noscript']):
            node.decompose()
        main = soup.find('article') or soup.find('main') or soup.body or soup
        text = '\n'.join(line.strip() for line in main.get_text('\n', strip=True).splitlines() if line.strip())
        if len(text) < 300 and embedded:
            return extract_link(urljoin(final_url, embedded.get('src', '')))
        if len(text) < 100:
            raise SourceError('Мало текста на странице')
        return Source(title, 'page', checked_text(text), url=final_url)
    except httpx.HTTPError:
        raise SourceError('Не удалось открыть страницу')
