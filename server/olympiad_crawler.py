"""
Catalog & Crawler for Olympiads and Contests.
Maintains curated database + live crawler from olimpiada.ru and RSOH sources,
tracks registration deadlines, auto-archives passed events, and allows 1-click import into calendar.
"""

import asyncio
import json
import logging
import re
import urllib.request
import urllib.parse
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional
from bs4 import BeautifulSoup

import os
logger = logging.getLogger("olympiad_crawler")

def get_catalog_file() -> Path:
    cal_db = os.getenv("CALENDAR_DB")
    if cal_db:
        p = Path(cal_db).parent / "catalog_olympiads.json"
    else:
        p = Path(__file__).resolve().parent.parent / "data" / "calendar" / "catalog_olympiads.json"
    try:
        p.parent.mkdir(parents=True, exist_ok=True)
    except Exception:
        pass
    return p

# Pre-seeded top olympiads and contests for 2026/2027 with verified deadlines and stages
from .expanded_seeds import EXPANDED_SEED_OLYMPIADS

SEED_OLYMPIADS = EXPANDED_SEED_OLYMPIADS

def load_catalog() -> Dict[str, Any]:
    """Load current olympiad catalog or initialize with seeded data."""
    cat_file = get_catalog_file()
    if cat_file.exists():
        try:
            with open(cat_file, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, dict) and "olympiads" in data:
                    return data
        except Exception as e:
            logger.error(f"Failed to read catalog file: {e}")

    # Fallback to seed data
    data = {
        "updated_at": datetime.now().isoformat(),
        "total": len(SEED_OLYMPIADS),
        "olympiads": SEED_OLYMPIADS
    }
    save_catalog(data)
    return data


def save_catalog(data: Dict[str, Any]):
    """Persist catalog to JSON file."""
    try:
        with open(get_catalog_file(), "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception as e:
        logger.error(f"Failed to save catalog: {e}")


def update_catalog_statuses(catalog: Dict[str, Any]) -> bool:
    """
    Check registration deadlines and stage dates:
    Automatically marks items as 'archived' when deadlines have passed,
    or 'active' when registration / future stages are open.
    """
    today_str = date.today().isoformat()
    changed = False

    for item in catalog.get("olympiads", []):
        old_status = item.get("status", "active")
        deadline = item.get("registration_deadline")
        
        # Check stages
        stages = item.get("stages", [])
        has_future_stage = any(
            (stage.get("end") and stage["end"] >= today_str) or 
            (stage.get("start") and stage["start"] >= today_str)
            for stage in stages
        )

        if deadline and deadline < today_str and not has_future_stage:
            item["status"] = "archived"
        elif (deadline and deadline >= today_str) or has_future_stage:
            item["status"] = "active"

        if item.get("status") != old_status:
            changed = True

    return changed


def detect_olympiad_level(title: str, desc: str = "") -> str:
    t = (title + " " + desc).lower()
    
    # Commercial / educational platforms (never RSOH)
    if any(k in t for k in ["учи.ру", "uchi.ru", "фоксфорд", "foxford", "знаника", "инфоурок", "якласс"]):
        return "Онлайн-платформа"
    if any(k in t for k in ["кенгуру", "русский медвежонок", "кит - компьютеры", "золотое руно", "бритиш бульдог"]):
        return "Школьный конкурс"
        
    # Vseros (highest state level)
    if any(k in t for k in ["всероссийская олимпиада школьников", "всош", "школьный этап всош", "муниципальный этап всош", "региональный этап всош"]):
        return "ВсОШ"
        
    # RSOH Level 1
    if any(k in t for k in [
        "высшая проба", "ломоносов", "покори воробь", "московская олимпиада школьников", "мош",
        "открытая олимпиада школьников по программированию", "спбгу", "физтех", "турнир городов"
    ]):
        return "РСОШ I уровень"

    # RSOH Level 2
    if any(k in t for k in [
        "росатом", "курчатов", "шаг в будущее", "технокубок", "всесибирск", "всесиб",
        "иннополис", "innopolis open", "надежда энергетики", "бельчонок", "юные таланты", "будущие исследователи"
    ]):
        return "РСОШ II уровень"

    # RSOH Level 3
    if any(k in t for k in [
        "изумруд", "гранит науки", "океан знаний", "мисис", "строгановск", "формула единства", "третье тысячелетие", "самара", "толстовск"
    ]):
        return "РСОШ III уровень"

    # IT / Hackathons
    if any(k in t for k in ["нто", "национальная технологическая", "хакатон", "rucode", "vk cup", "чемпионат по программированию", "ctf"]):
        return "Хакатон / IT"

    # Check if RSOH mentioned
    if "рсош" in t or "перечнев" in t:
        return "РСОШ"

    return "Олимпиада"


def crawl_olimpiada_ru() -> List[Dict[str, Any]]:
    """
    Scrapes fresh olympiad headlines, subjects and schedules from olimpiada.ru across all subject sections.
    Uses olimpiada.ru megalist API across all 35 subject categories to fetch 200+ competitions with real timelines.
    """
    discovered: List[Dict[str, Any]] = []
    seen_ids = set()
    today_str = date.today().isoformat()

    def fetch_subject_html(subj_id: int) -> str:
        query = urllib.parse.urlencode([("subject[%d]" % subj_id, "on"), ("period", "year"), ("class", "any")])
        url = f"https://olimpiada.ru/include/activity/megalist.php?{query}"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "X-Requested-With": "XMLHttpRequest"})
        try:
            with urllib.request.urlopen(req, timeout=8) as resp:
                return resp.read().decode('utf-8', errors='ignore')
        except Exception as e:
            logger.debug(f"Subject {subj_id} crawl error: {e}")
            return ""

    try:
        with ThreadPoolExecutor(max_workers=6) as executor:
            html_results = list(executor.map(fetch_subject_html, range(1, 36)))
    except Exception as e:
        logger.warning(f"Parallel crawl failed: {e}")
        html_results = []

    for html in html_results:
        if not html:
            continue
        try:
            soup = BeautifulSoup(html, "html.parser")
            for c in soup.find_all(class_="fav_olimp"):
                act_id = c.get("act")
                if not act_id or act_id in seen_ids:
                    continue
                h = c.find(class_="headline")
                if not h:
                    continue
                title = h.get_text(strip=True)
                if len(title) < 4:
                    continue
                seen_ids.add(act_id)

                desc_el = c.find(class_="olimp_desc")
                desc = desc_el.get_text(strip=True) if desc_el else "Официальное состязание перечня РСОШ и портала Olimpiada.ru."

                classes_el = c.find(class_="classes_dop")
                classes = classes_el.get_text(strip=True) if classes_el else "1-11 классы"

                subjects = []
                for stag in c.find_all(class_="subject_tag"):
                    stext = stag.get_text(strip=True)
                    if stext and stext not in subjects:
                        subjects.append(stext)

                # Normalize / augment subjects so UI filter chips work
                normalized = list(subjects)
                low_title_desc = (title + " " + desc + " " + " ".join(subjects)).lower()
                if any(k in low_title_desc for k in ["информ", "програм", "ит", "it", "компьют"]):
                    if "Информатика" not in normalized: normalized.append("Информатика")
                if any(k in low_title_desc for k in ["математ", "алгебр", "геометр"]):
                    if "Математика" not in normalized: normalized.append("Математика")
                if any(k in low_title_desc for k in ["физик", "астроном"]):
                    if "Физика" not in normalized: normalized.append("Физика")
                if any(k in low_title_desc for k in ["хим"]):
                    if "Химия" not in normalized: normalized.append("Химия")
                if any(k in low_title_desc for k in ["биолог", "эколог", "медиц"]):
                    if "Биология" not in normalized: normalized.append("Биология")
                if any(k in low_title_desc for k in ["робот", "инженер", "хакатон", "техно", "черчен"]):
                    if "Хакатоны" not in normalized: normalized.append("Хакатоны")
                if any(k in low_title_desc for k in ["язык", "русск", "англ", "немец", "франц", "лингв", "литерат"]):
                    if "Лингвистика" not in normalized: normalized.append("Лингвистика")
                if any(k in low_title_desc for k in ["эконом", "финанс"]):
                    if "Экономика" not in normalized: normalized.append("Экономика")
                if any(k in low_title_desc for k in ["истор", "обществ", "прав"]):
                    if "История" not in normalized: normalized.append("История")

                if not normalized:
                    normalized = ["Комплексная"]

                stages = []
                reg_deadline = None

                for ev in c.find_all(class_="tl_event"):
                    ev_date_str = ev.get("date")
                    ev_len = ev.get("length")
                    cls_list = ev.get("class", [])

                    font_el = ev.find("font")
                    if font_el and font_el.get_text(strip=True):
                        clean_name = font_el.get_text(strip=True)
                    else:
                        f_el = ev.find(class_="tl_cont_f")
                        raw = f_el.get_text(strip=True) if f_el else ""
                        clean_name = re.sub(r'<!--.*?-->', '', raw).strip()
                        clean_name = re.sub(r'^\s*[\d.]+\s*[а-яА-ЯёЁ]+\s*(?:\.\.\.|\.\.|\-|\—)\s*[\d.]*\s*[а-яА-ЯёЁ]*\s*', '', clean_name).strip()

                    cls_list = ev.get("class", [])
                    if not clean_name:
                        if "ereg" in cls_list: clean_name = "Регистрация участников"
                        elif "eoch" in cls_list: clean_name = "Заключительный очный этап"
                        else: clean_name = "Отборочный этап"

                    stage_title = clean_name

                    start_date = ev_date_str
                    end_date = None
                    if start_date and ev_len and ev_len.isdigit():
                        days = int(ev_len)
                        if days > 1:
                            try:
                                s_dt = date.fromisoformat(start_date)
                                end_date = (s_dt + timedelta(days=days)).isoformat()
                            except Exception:
                                pass
                    if "ereg" in cls_list:
                        reg_deadline = end_date or start_date

                    stages.append({
                        "title": stage_title,
                        "description": "Этап состязания с портала Olimpiada.ru",
                        "start": start_date,
                        "end": end_date or start_date,
                        "subjects": normalized,
                        "links": [{"title": "Карточка этапа", "url": f"https://olimpiada.ru/activity/{act_id}"}]
                    })

                if not stages:
                    stages.append({
                        "title": "Отборочный / основной этап",
                        "description": "Сроки проведения согласно регламенту состязания.",
                        "start": today_str,
                        "end": (date.today() + timedelta(days=30)).isoformat(),
                        "subjects": normalized,
                        "links": [{"title": "Официальная страница", "url": f"https://olimpiada.ru/activity/{act_id}"}]
                    })

                status = "active"
                if reg_deadline and reg_deadline < today_str:
                    has_future = any((st.get("end") and st["end"] >= today_str) or (st.get("start") and st["start"] >= today_str) for st in stages)
                    if not has_future:
                        status = "archived"

                discovered.append({
                    "id": f"olimpiada-ru-{act_id}",
                    "title": title,
                    "description": desc,
                    "level": detect_olympiad_level(title, desc),
                    "classes": classes,
                    "subjects": normalized,
                    "registration_deadline": reg_deadline,
                    "status": status,
                    "links": [
                        {"title": "Карточка на Olimpiada.ru", "url": f"https://olimpiada.ru/activity/{act_id}"}
                    ],
                    "stages": stages
                })
        except Exception as e:
            logger.warning(f"Error parsing megalist card: {e}")

    logger.info(f"Crawled {len(discovered)} olympiads from olimpiada.ru across all subjects.")
    return discovered


def sync_catalog(force_crawl: bool = False) -> Dict[str, Any]:
    """
    Runs catalog synchronization:
    - Loads existing catalog
    - Updates deadline statuses (auto-archive)
    - If needed or forced, crawls new items from olimpiada.ru and merges them
    """
    catalog = load_catalog()
    status_changed = update_catalog_statuses(catalog)

    # Check last update
    last_update_str = catalog.get("updated_at")
    should_crawl = force_crawl
    if not should_crawl and last_update_str:
        try:
            last_dt = datetime.fromisoformat(last_update_str)
            if datetime.now() - last_dt > timedelta(hours=24):
                should_crawl = True
        except Exception:
            should_crawl = True

    if should_crawl:
        logger.info("Executing automated crawler for olympiads...")
        crawled = crawl_olimpiada_ru()
        existing_ids = {item["id"] for item in catalog.get("olympiads", [])}
        
        # Merge without overwriting manually curated seeds
        for item in crawled:
            if item["id"] not in existing_ids:
                catalog["olympiads"].append(item)
                existing_ids.add(item["id"])
        
        catalog["updated_at"] = datetime.now().isoformat()
        catalog["total"] = len(catalog["olympiads"])
        save_catalog(catalog)
        return catalog

    if status_changed:
        catalog["updated_at"] = datetime.now().isoformat()
        save_catalog(catalog)

    return catalog


async def catalog_background_loop():
    """Daily background task to update catalog deadlines and fetch fresh events."""
    while True:
        try:
            await asyncio.to_thread(sync_catalog, False)
        except Exception as e:
            logger.error(f"Error in catalog background loop: {e}")
        # Run every 24 hours
        await asyncio.sleep(86400)
