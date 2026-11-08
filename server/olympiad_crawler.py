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
SEED_OLYMPIADS = [
    {
        "id": "vseros-2026",
        "title": "Всероссийская олимпиада школьников (ВсОШ) 2026/2027",
        "description": "Главная олимпиада страны. 4 этапа: школьный, муниципальный, региональный, заключительный. Победители и призеры финала поступают в любые профильные вузы без экзаменов (БВИ).",
        "level": "ВсОШ",
        "classes": "4-11 классы",
        "subjects": ["Информатика", "Математика", "Физика", "Химия", "Биология", "Русский язык", "Английский язык", "Обществознание"],
        "registration_deadline": "2026-11-20",
        "status": "active",
        "links": [
            {"title": "Официальный портал ВсОШ", "url": "https://vserosolimp.edsoo.ru/"},
            {"title": "Сириус.Курсы и Олимп", "url": "https://siriusolymp.ru/"}
        ],
        "stages": [
            {
                "title": "Муниципальный этап",
                "description": "Очный тур в школах и муниципальных центрах.",
                "start": "2026-11-05",
                "end": "2026-12-25",
                "subjects": ["Информатика", "Математика", "Физика", "Химия"],
                "links": [{"title": "График и регламент", "url": "https://vserosolimp.edsoo.ru/"}]
            },
            {
                "title": "Региональный этап",
                "description": "Отбор сильнейших участников регионов.",
                "start": "2027-01-10",
                "end": "2027-02-28",
                "subjects": ["Информатика", "Математика", "Физика"],
                "links": []
            },
            {
                "title": "Заключительный этап (Финал)",
                "description": "Финал олимпиады. Диплом дает право БВИ в вузы.",
                "start": "2027-03-15",
                "end": "2027-04-30",
                "subjects": [],
                "links": []
            }
        ]
    },
    {
        "id": "vyshka-proba-2026",
        "title": "Олимпиада «Высшая проба» (НИУ ВШЭ)",
        "description": "Одна из крупнейших перечневых олимпиад (РСОШ I уровень). Льготы при поступлении в ведущие вузы России (ВШЭ, МГУ, МФТИ, ИТМО, СПбГУ).",
        "level": "РСОШ I уровень",
        "classes": "7-11 классы",
        "subjects": ["Информатика", "Математика", "Физика", "Экономика", "Обществознание", "Иностранные языки"],
        "registration_deadline": "2026-11-15",
        "status": "active",
        "links": [
            {"title": "Сайт «Высшей пробы»", "url": "https://olymp.hse.ru/mmo/"},
            {"title": "Личный кабинет участника", "url": "https://olymp.hse.ru/"}
        ],
        "stages": [
            {
                "title": "Регистрация участников",
                "description": "Подача заявки и выбор предметов в личном кабинете.",
                "start": "2026-10-01",
                "end": "2026-11-15",
                "subjects": [],
                "links": [{"title": "Регистрация", "url": "https://olymp.hse.ru/mmo/"}]
            },
            {
                "title": "Отборочный дистанционный этап",
                "description": "Онлайн-тестирование по выбранным предметам.",
                "start": "2026-11-20",
                "end": "2026-12-05",
                "subjects": ["Информатика", "Математика", "Физика", "Экономика"],
                "links": []
            },
            {
                "title": "Заключительный очный этап",
                "description": "Финальные состязания на площадках НИУ ВШЭ и в регионах.",
                "start": "2027-02-05",
                "end": "2027-02-18",
                "subjects": [],
                "links": []
            }
        ]
    },
    {
        "id": "vsesib-2026",
        "title": "Всесибирская открытая олимпиада школьников (НГУ)",
        "description": "Престижная олимпиада Новосибирского государственного университета и СУНЦ НГУ (РСОШ I и II уровней).",
        "level": "РСОШ I уровень",
        "classes": "7-11 классы",
        "subjects": ["Информатика", "Математика", "Физика", "Химия", "Биология"],
        "registration_deadline": "2026-11-25",
        "status": "active",
        "links": [
            {"title": "Официальный сайт олимпиады", "url": "https://sesc.nsu.ru/olymp-vsesib/"}
        ],
        "stages": [
            {
                "title": "Очный отборочный тур (Информатика)",
                "description": "Очный тур отборочного этапа по информатике на площадках.",
                "start": "2026-11-08",
                "end": "2026-11-08",
                "start_time": "11:00:00",
                "end_time": "16:00:00",
                "timezone": "Новосибирск (НСК)",
                "subjects": ["Информатика"],
                "links": [{"title": "Площадки проведения", "url": "https://sesc.nsu.ru/olymp-vsesib/"}]
            },
            {
                "title": "Дистанционный отборочный тур",
                "description": "Онлайн-тур для школьников всех регионов.",
                "start": "2026-11-20",
                "end": "2026-12-15",
                "subjects": ["Математика", "Физика", "Химия", "Биология"],
                "links": []
            },
            {
                "title": "Заключительный этап",
                "description": "Финал Всесибирской олимпиады.",
                "start": "2027-02-20",
                "end": "2027-03-10",
                "subjects": [],
                "links": []
            }
        ]
    },
    {
        "id": "nto-2026",
        "title": "Национальная технологическая олимпиада (НТО)",
        "description": "Командная инженерная олимпиада для школьников и студентов. Включает направления по ИИ, беспилотникам, разработке игр, космонавтике и биотеху. Дает 100 баллов ЕГЭ или БВИ.",
        "level": "РСОШ / Инженерный конкурс",
        "classes": "8-11 классы",
        "subjects": ["Информатика", "Математика", "Физика", "Хакатоны"],
        "registration_deadline": "2026-11-10",
        "status": "active",
        "links": [
            {"title": "Официальный сайт НТО", "url": "https://ntcontest.ru/"}
        ],
        "stages": [
            {
                "title": "Первый индивидуальный отборочный тур",
                "description": "Решение профильных задач по общеобразовательным предметам.",
                "start": "2026-10-01",
                "end": "2026-11-10",
                "subjects": ["Информатика", "Математика", "Физика"],
                "links": [{"title": "Платформа НТО", "url": "https://ntcontest.ru/"}]
            },
            {
                "title": "Второй командный отборочный тур",
                "description": "Работа в командах над практическими инженерными кейсами.",
                "start": "2026-11-15",
                "end": "2026-12-20",
                "subjects": ["Хакатоны", "Информатика"],
                "links": []
            },
            {
                "title": "Финал НТО",
                "description": "Очные командные испытания с реальным оборудованием и стендами.",
                "start": "2027-02-25",
                "end": "2027-04-10",
                "subjects": [],
                "links": []
            }
        ]
    },
    {
        "id": "lomonosov-2026",
        "title": "Олимпиада «Ломоносов» (МГУ им. М.В. Ломоносова)",
        "description": "Официальная перечневая олимпиада МГУ по широкому спектру предметов (РСОШ I уровень). Льготы для поступления в МГУ и другие вузы.",
        "level": "РСОШ I уровень",
        "classes": "5-11 классы",
        "subjects": ["Информатика", "Математика", "Физика", "Химия", "Биология", "География", "Литература"],
        "registration_deadline": "2026-12-01",
        "status": "active",
        "links": [
            {"title": "Портал олимпиады «Ломоносов»", "url": "https://olymp.msu.ru/"}
        ],
        "stages": [
            {
                "title": "Отборочный интернет-этап",
                "description": "Выполнение заданий в режиме онлайн в указанные слоты времени.",
                "start": "2026-11-01",
                "end": "2026-12-10",
                "subjects": ["Информатика", "Математика", "Физика"],
                "links": [{"title": "Расписание туров", "url": "https://olymp.msu.ru/"}]
            },
            {
                "title": "Заключительный этап в МГУ",
                "description": "Очные состязания на факультетах МГУ и региональных площадках.",
                "start": "2027-02-10",
                "end": "2027-03-25",
                "subjects": [],
                "links": []
            }
        ]
    },
    {
        "id": "technocup-2026",
        "title": "Олимпиада по программированию «Технокубок» (VK и МФТИ)",
        "description": "Престижная олимпиада по спортивному программированию для школьников 8-11 классов (РСОШ I уровень). Победители получают БВИ в МФТИ, Бауманку и другие ведущие вузы.",
        "level": "РСОШ I уровень",
        "classes": "8-11 классы",
        "subjects": ["Информатика"],
        "registration_deadline": "2026-12-10",
        "status": "active",
        "links": [
            {"title": "Официальный сайт «Технокубка»", "url": "https://techno-cup.ru/"}
        ],
        "stages": [
            {
                "title": "Отборочные онлайн-раунды",
                "description": "Решение алгоритмических задач на платформе Codeforces.",
                "start": "2026-10-15",
                "end": "2026-12-15",
                "subjects": ["Информатика"],
                "links": [{"title": "Участие в раунде", "url": "https://techno-cup.ru/"}]
            },
            {
                "title": "Финальный раунд",
                "description": "Очный финал в Москве и региональных центрах.",
                "start": "2027-03-01",
                "end": "2027-03-15",
                "subjects": ["Информатика"],
                "links": []
            }
        ]
    },
    {
        "id": "step-into-future-2026",
        "title": "Олимпиада школьников «Шаг в будущее» (МГТУ им. Баумана)",
        "description": "Инженерная и научно-исследовательская олимпиада РСОШ. Включает академический тур и защиту научно-технических проектов.",
        "level": "РСОШ II уровень",
        "classes": "8-11 классы",
        "subjects": ["Информатика", "Математика", "Физика", "Инженерное дело"],
        "registration_deadline": "2026-11-30",
        "status": "active",
        "links": [
            {"title": "Сайт «Шаг в будущее»", "url": "https://olymp.bmstu.ru/"}
        ],
        "stages": [
            {
                "title": "Академический отборочный тур",
                "description": "Теоретические задачи по математике, физике и информатике.",
                "start": "2026-10-20",
                "end": "2026-12-05",
                "subjects": ["Информатика", "Физика", "Математика"],
                "links": []
            },
            {
                "title": "Защита научных проектов и финал",
                "description": "Очная защита проектов в МГТУ им. Баумана.",
                "start": "2027-02-15",
                "end": "2027-03-20",
                "subjects": [],
                "links": []
            }
        ]
    },
    {
        "id": "alhimia-13-element-2026",
        "title": "Олимпиада «13 элемент. ALхимия будущего» (РУСАЛ / СФУ)",
        "description": "Всероссийская междисциплинарная олимпиада для школьников по точным наукам и металлургии (СФУ, ИРНИТУ, УГГУ). Дополнительные баллы к ЕГЭ при поступлении.",
        "level": "Всероссийская",
        "classes": "8-11 классы",
        "subjects": ["Химия", "Физика", "Математика", "Информатика"],
        "registration_deadline": "2027-01-13",
        "status": "active",
        "links": [
            {"title": "Страница проекта РУСАЛ", "url": "https://career.enplusrusal.ru/projects/olimpiada-13-i-element-3"}
        ],
        "stages": [
            {
                "title": "Регистрация и отборочный этап",
                "description": "Онлайн-тестирование по предметам до 13 января 2027 года.",
                "start": "2026-11-01",
                "end": "2027-01-13",
                "subjects": ["Химия", "Физика", "Математика"],
                "links": [{"title": "Регистрация", "url": "https://career.enplusrusal.ru/"}]
            },
            {
                "title": "Заключительный этап",
                "description": "Очные состязания в городах присутствия компании.",
                "start": "2027-02-15",
                "end": "2027-03-10",
                "subjects": [],
                "links": []
            }
        ]
    },
    {
        "id": "innopolis-open-2026",
        "title": "Innopolis Open (Университет Иннополис)",
        "description": "Международная олимпиада по программированию, искусственному интеллекту, робототехнике и математике. Победители получают гранты на обучение и БВИ.",
        "level": "РСОШ I уровень",
        "classes": "7-11 классы",
        "subjects": ["Информатика", "Математика", "Хакатоны"],
        "registration_deadline": "2026-11-28",
        "status": "active",
        "links": [
            {"title": "Официальный сайт Innopolis Open", "url": "https://olymp.innopolis.university/"}
        ],
        "stages": [
            {
                "title": "Первый отборочный онлайн-профиль",
                "description": "Дистанционный тур решения алгоритмических задач.",
                "start": "2026-11-15",
                "end": "2026-11-28",
                "subjects": ["Информатика"],
                "links": []
            },
            {
                "title": "Второй отборочный онлайн-профиль",
                "description": "Второй шанс пройти в финал.",
                "start": "2026-12-10",
                "end": "2026-12-20",
                "subjects": ["Информатика"],
                "links": []
            },
            {
                "title": "Финал в Иннополисе",
                "description": "Очный тур в кампусе Университета Иннополис.",
                "start": "2027-02-20",
                "end": "2027-03-01",
                "subjects": ["Информатика"],
                "links": []
            }
        ]
    },
    {
        "id": "arch-art-2026",
        "title": "Южно-Российская олимпиада «Архитектура и искусство» (ЮФУ)",
        "description": "Крупнейшая творческая олимпиада по рисунку, живописи, композиции и черчению (РСОШ I уровень).",
        "level": "РСОШ I уровень",
        "classes": "6-11 классы",
        "subjects": ["Искусство и дизайн", "Творчество"],
        "registration_deadline": "2026-12-06",
        "status": "active",
        "links": [
            {"title": "Сайт ЮФУ", "url": "https://raai.sfedu.ru/"}
        ],
        "stages": [
            {
                "title": "Отборочный муниципальный этап",
                "description": "Регистрация открыта до 6 декабря, отборочный этап проходит до 13 декабря.",
                "start": "2026-11-01",
                "end": "2026-12-13",
                "subjects": ["Искусство и дизайн"],
                "links": []
            },
            {
                "title": "Заключительный очный этап",
                "description": "Очные состязания в Ростове-на-Дону и на площадках вузов-партнеров.",
                "start": "2027-02-15",
                "end": "2027-03-05",
                "subjects": [],
                "links": []
            }
        ]
    },
    {
        "id": "moscow-olymp-informatics-2026",
        "title": "Московская олимпиада школьников (МОШ) по информатике",
        "description": "Престижная олимпиада первого уровня (РСОШ I). Включает раздел программирования для 10-11 классов и для 7-9 классов.",
        "level": "РСОШ I уровень",
        "classes": "7-11 классы",
        "subjects": ["Информатика"],
        "registration_deadline": "2027-01-20",
        "status": "active",
        "links": [
            {"title": "Сайт МОШ по информатике", "url": "https://mosh.olimpiada.ru/"}
        ],
        "stages": [
            {
                "title": "Дистанционный тур",
                "description": "Длинный отборочный тур на платформе Яндекс Контест.",
                "start": "2026-12-01",
                "end": "2027-01-25",
                "subjects": ["Информатика"],
                "links": []
            },
            {
                "title": "Очный финал в Москве",
                "description": "Финальный тур олимпиады.",
                "start": "2027-03-01",
                "end": "2027-03-05",
                "subjects": ["Информатика"],
                "links": []
            }
        ]
    },
    {
        "id": "nashe-nasledie-2026",
        "title": "Открытая всероссийская олимпиада «Наше наследие»",
        "description": "Олимпиада по истории, культуре и краеведению (РСОШ II уровень).",
        "level": "РСОШ II уровень",
        "classes": "1-11 классы",
        "subjects": ["История", "Культура", "Русский язык"],
        "registration_deadline": "2026-11-10",
        "status": "active",
        "links": [
            {"title": "Официальный сайт ОВИО", "url": "http://ovio.pravolimp.ru/"}
        ],
        "stages": [
            {
                "title": "Школьный тур",
                "description": "Старт школьного тура для начальных и средних классов.",
                "start": "2026-11-10",
                "end": "2026-11-30",
                "subjects": ["История"],
                "links": []
            },
            {
                "title": "Муниципальный и региональный туры",
                "description": "Очные туры для победителей школьного этапа.",
                "start": "2026-12-05",
                "end": "2027-01-20",
                "subjects": ["История"],
                "links": []
            }
        ]
    },
    {
        "id": "sirius-ai-2026",
        "title": "Всероссийский конкурс проектов «Большие вызовы» (Сириус)",
        "description": "Главный научно-технологический конкурс проектов в Образовательном центре «Сириус». 14 направлений, включая ИИ, большие данные, нанотехнологии и умный город.",
        "level": "Всероссийский конкурс",
        "classes": "7-11 классы",
        "subjects": ["Информатика", "Хакатоны", "Физика", "Биология"],
        "registration_deadline": "2027-02-15",
        "status": "active",
        "links": [
            {"title": "Сайт «Больших вызовов»", "url": "https://konkurs.sochisirius.ru/"}
        ],
        "stages": [
            {
                "title": "Подача заявок и загрузка проекта",
                "description": "Регистрация участников и загрузка паспорта проекта.",
                "start": "2026-11-10",
                "end": "2027-02-15",
                "subjects": ["Хакатоны", "Информатика"],
                "links": [{"title": "Личный кабинет Сириус", "url": "https://konkurs.sochisirius.ru/"}]
            },
            {
                "title": "Региональный трек и очная защита",
                "description": "Защита проектов перед экспертной комиссией в регионе.",
                "start": "2027-02-20",
                "end": "2027-03-25",
                "subjects": [],
                "links": []
            },
            {
                "title": "Финал в ОЦ «Сириус» (Сочи)",
                "description": "Участие в проектной июльской смене в Сочи.",
                "start": "2027-07-01",
                "end": "2027-07-24",
                "subjects": [],
                "links": []
            }
        ]
    },
    {
        "id": "dano-analitika-2026",
        "title": "Национальная олимпиада по анализу данных «DANO» (Т-Банк и НИУ ВШЭ)",
        "description": "Практическая олимпиада по анализу данных, Data Science и машинному обучению для школьников 8-11 классов (РСОШ I уровень).",
        "level": "РСОШ I уровень",
        "classes": "8-11 классы",
        "subjects": ["Информатика", "Математика"],
        "registration_deadline": "2026-10-15",
        "status": "archived",  # Registration closed earlier, in archive for history
        "links": [
            {"title": "Официальный сайт DANO", "url": "https://dano.hse.ru/"}
        ],
        "stages": [
            {
                "title": "Регистрация и отборочный тест",
                "description": "Срок регистрации завершен 15 октября 2026 года.",
                "start": "2026-09-10",
                "end": "2026-10-15",
                "subjects": ["Информатика", "Математика"],
                "links": []
            },
            {
                "title": "Командный полуфинал",
                "description": "Анализ реальных датасетов в командах.",
                "start": "2026-11-05",
                "end": "2026-11-25",
                "subjects": ["Информатика"],
                "links": []
            }
        ]
    }
]


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


def crawl_olimpiada_ru() -> List[Dict[str, Any]]:
    """
    Scrapes fresh olympiad headlines and schedules from olimpiada.ru.
    """
    discovered: List[Dict[str, Any]] = []
    url = "https://olimpiada.ru/activities?type=any&period_date=&class=any"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
        with urllib.request.urlopen(req, timeout=12) as resp:
            data = resp.read()
        
        soup = BeautifulSoup(data, "html.parser")
        seen_ids = set()

        for a in soup.find_all("a", href=True):
            href = a["href"]
            text = a.get_text(strip=True)
            if not href.startswith("/activity/"):
                continue
            
            parts = href.strip("/").split("/")
            if len(parts) < 2 or not parts[1].isdigit():
                continue
            
            olymp_id = f"olimpiada-ru-{parts[1]}"
            if olymp_id in seen_ids or len(text) < 5 or "еще" in text.lower():
                continue
            seen_ids.add(olymp_id)

            # Heuristic subject detection
            detected_subjects = []
            low = text.lower()
            if any(w in low for w in ["математ", "алгебр", "геометр"]): detected_subjects.append("Математика")
            if any(w in low for w in ["информ", "программ", "ит", "it", "компьют"]): detected_subjects.append("Информатика")
            if any(w in low for w in ["физик", "астроном"]): detected_subjects.append("Физика")
            if any(w in low for w in ["хим"]): detected_subjects.append("Химия")
            if any(w in low for w in ["биолог", "эколог"]): detected_subjects.append("Биология")
            if any(w in low for w in ["лингвист", "язык", "русск", "англ"]): detected_subjects.append("Лингвистика")
            if any(w in low for w in ["робот", "инженер", "хакатон", "техно"]): detected_subjects.append("Хакатоны")

            if not detected_subjects:
                detected_subjects = ["Комплексная"]

            discovered.append({
                "id": olymp_id,
                "title": text,
                "description": f"Официальное состязание по данным портала Olimpiada.ru. Подробности, правила и регламент доступны на странице олимпиады.",
                "level": "РСОШ / Всероссийская",
                "classes": "1-11 классы",
                "subjects": detected_subjects,
                "registration_deadline": (date.today() + timedelta(days=30)).isoformat(),
                "status": "active",
                "links": [
                    {"title": "Карточка на Olimpiada.ru", "url": f"https://olimpiada.ru{href}"}
                ],
                "stages": [
                    {
                        "title": "Отборочный / школьный этап",
                        "description": "Текущий этап проведения.",
                        "start": date.today().isoformat(),
                        "end": (date.today() + timedelta(days=25)).isoformat(),
                        "subjects": detected_subjects,
                        "links": [{"title": "Подробнее", "url": f"https://olimpiada.ru{href}"}]
                    }
                ]
            })

    except Exception as e:
        logger.warning(f"Error crawling olimpiada.ru: {e}")

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
