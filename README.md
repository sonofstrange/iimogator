# ИИмогатор

Мини-приложение и чат-бот для платформы MAX для подготовки к учёбе и ведения расписания олимпиад.

- Чат-бот на платформе MAX: https://max.ru/ideya_fiks_155_bot
- Веб-версия: https://iimogator.rusanoff.ru/
- Готовый Docker-образ: `sonofstrange/iimogator:latest` (на Docker Hub: https://hub.docker.com/r/sonofstrange/iimogator)

## Требования

- Python 3.12+
- Docker и Docker Compose (для контейнерного запуска)
- Зависимости Python перечислены в `requirements.txt`

## Настройка окружения

Скопируйте пример конфигурации и укажите свои ключи:

```bash
cp .env.example .env
```

Основные переменные в `.env`:
- `AI_API_KEY` - API ключ для генерации материалов и проверки ответов
- `AI_BASE_URL` - адрес OpenAI-совместимого API (по умолчанию https://router.cheap/v1)
- `AI_MODEL` - используемая модель (по умолчанию qwen3.8-flash)
- `MAX_BOT_TOKEN` - токен бота в MAX для проверки подписи пользователей

## Запуск в Docker

### Быстрый запуск из готового образа на Docker Hub

```bash
# 1. Скачать готовый образ
docker pull sonofstrange/iimogator:latest

# 2. Запустить контейнер
docker run -d --name iimogator -p 8080:8080 --env-file .env sonofstrange/iimogator:latest
```

### Сборка и запуск через Docker Compose (рекомендуется)

```bash
# Сборка и фоновый запуск
docker compose up -d --build

# Проверка статуса
docker compose ps

# Остановка
docker compose down
```

После запуска сервис доступен по адресу `http://127.0.0.1:8080`.

### Сборка и запуск через Docker CLI из исходников

```bash
# Сборка образа
docker build -t sonofstrange/iimogator:latest .

# Запуск контейнера
docker run -d --name iimogator -p 8080:8080 --env-file .env sonofstrange/iimogator:latest

# Остановка контейнера
docker stop iimogator && docker rm iimogator
```

## Запуск через командную строку (без Docker)

```bash
# 1. Создание и активация виртуального окружения
python -m venv .venv
source .venv/bin/activate       # Linux / macOS
# .venv\Scripts\activate        # Windows

# 2. Установка зависимостей
pip install -r requirements.txt

# 3. Запуск сервера приложения
python -m uvicorn server.app:app --host 127.0.0.1 --port 8080
```

Сервер будет запущен и доступен в браузере по адресу `http://127.0.0.1:8080`.
