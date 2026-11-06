const $ = id => document.getElementById(id);
const byId = $;
const kindLabels = {single: 'Один ответ', multiple: 'Несколько ответов', short: 'Ответ своими словами', matching: 'Сопоставление'};
const sourceLabels = {text: 'Текст', photo: 'Фото', page: 'Страница', subtitles: 'Субтитры видео', transcription: 'Распознанная речь'};
let cachedSource = null;
let activeRequest = null;
let generatedSourceId = null;
let materialData = null;
let quizData = null;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function snapshot() {
  const currentPhotos = (typeof window.getPhotos === 'function') ? window.getPhotos() : (typeof photos !== 'undefined' ? photos : (photo ? [photo] : []));
  return {
    kind: source,
    text: material.value.trim(),
    url: byId('lecture-link').value.trim(),
    photos: currentPhotos.slice(),
    photoCount: currentPhotos.length
  };
}

function sameSource(a, b) {
  if (!a || !b || a.kind !== b.kind) return false;
  if (a.kind === 'photo') {
    if ((a.photoCount || 0) !== (b.photoCount || 0)) return false;
    const aList = a.photos || [];
    const bList = b.photos || [];
    return aList.length === bList.length && aList.every((f, i) => f === bList[i]);
  }
  if (a.kind === 'text') return a.text === b.text;
  return a.url === b.url;
}

function message(heading, text, error = false) {
  byId('result-empty').hidden = false;
  byId('result-content').hidden = true;
  byId('result-heading').textContent = heading;
  byId('result-message').textContent = text;
  byId('result-status').textContent = error ? 'ОШИБКА' : '';
  document.querySelector('.result-window').classList.toggle('notice', error);
}

function progress(text, stage = 0, stages = ['Материал', 'Подготовка', 'Оформление']) {
  byId('work-progress').hidden = !text;
  byId('progress-message').textContent = text;
  if (!text) return;
  byId('result-empty').hidden = true;
  byId('result-status').textContent = 'В РАБОТЕ';
  byId('progress-track').style.setProperty('--stage', Math.min(stage, 2));
  byId('progress-fill').style.width = `${(Math.min(stage, 2) + 0.45) / 3 * 100}%`;
  document.querySelectorAll('.progress-stages li').forEach((node, index) => {
    node.textContent = stages[index];
    node.classList.toggle('done', index < stage);
    node.classList.toggle('current', index === stage);
  });
}

function busy(value) {
  byId('prepare-button').disabled = value;
  byId('cancel-generation').hidden = !value;
  document.querySelectorAll('.input-tab,.format-tab,.source-window input,.source-window textarea,.settings-window input').forEach(node => { node.disabled = value; });
  byId('prepare-label').textContent = value ? 'Готовим…' : mode === 'test' ? 'Составить тест' : 'Подготовить материал';
}

async function api(url, body, signal, multipart = false) {
  const headers = {'X-Max-Data': window.maxLaunchData || ''};
  if (!multipart) headers['Content-Type'] = 'application/json';
  const response = await fetch(appBase + url, {
    method: 'POST',
    headers,
    body: multipart ? body : JSON.stringify(body),
    signal
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 410) cachedSource = null;
    throw new Error(typeof data.detail === 'string' ? data.detail : 'Ошибка запроса');
  }
  return data;
}

function showCurrentResult() {
  if (activeRequest) return;
  const hasResult = cachedSource && sameSource(cachedSource.snapshot, snapshot()) && generatedSourceId === cachedSource.source_id && (mode === 'material' ? materialData : quizData);
  if (!hasResult) {
    message('Здесь появится результат', mode === 'test' ? 'Выбери настройки и нажми «Составить тест».' : 'Добавь материал и нажми «Подготовить материал».');
    return;
  }
  byId('result-empty').hidden = true;
  byId('result-content').hidden = false;
  byId('material-output').hidden = mode !== 'material';
  byId('quiz-output').hidden = mode !== 'test';
  byId('result-status').textContent = 'ГОТОВО';
}

function sourceChanged() {
  if (activeRequest) return;
  byId('source-info').hidden = !cachedSource || !sameSource(cachedSource.snapshot, snapshot());
  showCurrentResult();
}
material.addEventListener('input', sourceChanged);
byId('lecture-link').addEventListener('input', sourceChanged);
fileInput.addEventListener('change', sourceChanged);
byId('remove-photo').addEventListener('click', sourceChanged);
dropArea.addEventListener('drop', sourceChanged);
document.querySelectorAll('.input-tab').forEach(button => button.addEventListener('tab-selected', sourceChanged));
document.querySelectorAll('.format-tab').forEach(button => button.addEventListener('tab-selected', showCurrentResult));

byId('cancel-generation').addEventListener('click', () => activeRequest?.abort());
byId('prepare-button').addEventListener('click', async () => {
  window.sfx?.play('click');
  window.maxHaptic?.('light');
  if (activeRequest) return;
  const input = snapshot();
  if (input.kind === 'text' && !input.text || input.kind === 'photo' && !input.photos.length || input.kind === 'link' && !input.url) {
    message('Добавь материал', 'Вставь текст, выбери фото или укажи ссылку.', true);
    return;
  }
  if (input.kind === 'link' && (!byId('lecture-link').checkValidity() || !/^https?:\/\//i.test(input.url))) {
    message('Проверь ссылку', 'Ссылка должна начинаться с http:// или https://.', true);
    return;
  }
  const settings = {difficulty: document.querySelector('input[name="difficulty"]:checked').value, count: Number(document.querySelector('input[name="count"]:checked').value)};
  const controller = new AbortController();
  activeRequest = controller;
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 15 * 60 * 1000);
  busy(true);
  message('Подготовка', 'Результат появится здесь.');
  document.querySelector('.result-window').scrollIntoView({block: 'start', behavior: 'smooth'});
  try {
    if (!cachedSource || !sameSource(cachedSource.snapshot, input)) {
      progress(input.kind === 'link' ? 'Получаем текст лекции…' : input.kind === 'photo' ? 'Загружаем фото…' : 'Загружаем материал…', 0);
      const form = new FormData();
      form.append('kind', input.kind);
      if (input.kind === 'text') form.append('text', input.text);
      if (input.kind === 'link') form.append('url', input.url);
      if (input.kind === 'photo') {
        input.photos.forEach(f => form.append('files', f));
        if (input.photos[0]) form.append('file', input.photos[0]);
      }
      cachedSource = {...await api('/api/sources', form, controller.signal, true), snapshot: input};
    }
    if (generatedSourceId !== cachedSource.source_id) {
      materialData = null;
      quizData = null;
      byId('material-output').replaceChildren();
      byId('quiz-output').replaceChildren();
      generatedSourceId = cachedSource.source_id;
    }
    byId('source-info').textContent = `${sourceLabels[cachedSource.kind]}: ${cachedSource.title}${cachedSource.characters ? ' · ' + cachedSource.characters.toLocaleString('ru-RU') + ' символов' : ''}`;
    byId('source-info').hidden = false;
    progress(mode === 'test' ? 'Составляем тест…' : 'Готовим конспект…', 1);
    if (mode === 'material') {
      materialData = await api('/api/material', {source_id: cachedSource.source_id}, controller.signal);
      progress('Оформляем материал…', 2);
      renderMaterial(materialData);
    } else {
      quizData = await api('/api/quizzes', {source_id: cachedSource.source_id, ...settings}, controller.signal);
      progress('Оформляем тест…', 2);
      renderQuiz(quizData);
    }
  } catch (error) {
    window.sfx?.play('error');
    window.maxHaptic?.('error');
    message(error.name === 'AbortError' ? 'Остановлено' : 'Не получилось', error.name === 'AbortError' ? timedOut ? 'Обработка заняла слишком много времени. Выбери материал покороче.' : 'Ожидание прервано. Можно попробовать ещё раз.' : error.message, error.name !== 'AbortError');
    return;
  } finally {
    clearTimeout(timeout);
    activeRequest = null;
    busy(false);
    progress('');
    if (byId('result-status').textContent === 'В РАБОТЕ') byId('result-status').textContent = '';
  }
  showCurrentResult();
  window.sfx?.play('success');
  window.maxHaptic?.('success');
  
});

function renderMaterial(data) {
  const root = $('material-output');
  const notesHtml = data.notes.map(n => `<h4>${n.heading}</h4>${n.paragraphs.map(p => `<p>${p}</p>`).join('')}`).join('');
  const thesesHtml = data.theses.map(t => `<li>${t}</li>`).join('');
  root.innerHTML = `
    <h2 class="generated-title">${data.title}</h2>
    <button type="button" class="small-button copy-material">Скопировать</button>
    <section class="material-section"><h3>Конспект</h3>${notesHtml}</section>
    <section class="material-section summary-section"><h3>Выжимка</h3><p>${data.summary}</p></section>
    <section class="material-section"><h3>Тезисы</h3><ul>${thesesHtml}</ul></section>
  `;
  const copy = root.querySelector('.copy-material');
  copy.addEventListener('click', async () => {
    const text = [data.title, '\nКОНСПЕКТ', ...data.notes.flatMap(note => [note.heading, ...note.paragraphs]), '\nВЫЖИМКА', data.summary, '\nТЕЗИСЫ', ...data.theses.map(t => '• ' + t)].join('\n\n');
    try {
      await navigator.clipboard.writeText(text);
      copy.textContent = 'Скопировано';
    } catch {
      copy.textContent = 'Не удалось скопировать';
    }
    setTimeout(() => { copy.textContent = 'Скопировать'; }, 2500);
  });
}

function renderQuiz(data) {
  const root = byId('quiz-output');
  root.innerHTML = `
    <h2 class="generated-title">${data.title}</h2>
    <div class="quiz-score" hidden role="status"></div>
    <form class="quiz-form" novalidate>
      ${data.questions.map((q, i) => `
        <fieldset class="quiz-question" data-question-id="${q.id}">
          <legend>${i + 1}. ${q.prompt}</legend>
          <p class="question-kind">${kindLabels[q.type]}</p>
          ${['single', 'multiple'].includes(q.type) ? q.options.map((opt, optIdx) => `
            <label class="quiz-option">
              <input type="${q.type === 'multiple' ? 'checkbox' : 'radio'}" name="question-${q.id}" value="${optIdx}">
              <span>${opt}</span>
            </label>
          `).join('') : ''}
          ${q.type === 'short' ? `
            <textarea class="short-answer" rows="3" maxlength="1500" placeholder="Напиши ответ своими словами" aria-label="Ответ на вопрос ${i + 1}"></textarea>
          ` : ''}
          <div class="question-feedback" hidden></div>
        </fieldset>
      `).join('')}
      <div class="quiz-footer">
        <span class="answered-count"></span>
        <button type="submit" class="primary-button">Проверить ответы</button>
      </div>
      <p class="field-error" role="alert"></p>
    </form>
  `;

  const form = root.querySelector('.quiz-form');
  const matchingWidgets = new Map();

  data.questions.forEach(q => {
    if (q.type === 'matching') {
      const widget = createMatching(q, () => form.dispatchEvent(new Event('change', {bubbles: true})));
      matchingWidgets.set(q.id, widget);
      const fs = form.querySelector(`[data-question-id="${q.id}"]`);
      const fb = fs.querySelector('.question-feedback');
      fs.insertBefore(widget.node, fb);
    }
  });

  const count = form.querySelector('.answered-count');
  const check = form.querySelector('.primary-button');
  const error = form.querySelector('.field-error');
  const score = root.querySelector('.quiz-score');

  function answers() {
    const values = {};
    data.questions.forEach(question => {
      const fieldset = [...form.querySelectorAll('.quiz-question')].find(node => node.dataset.questionId === question.id);
      if (question.type === 'short') {
        const value = fieldset.querySelector('textarea').value.trim();
        if (value) values[question.id] = value;
      } else if (question.type === 'matching') {
        const value = matchingWidgets.get(question.id).value();
        if (value) values[question.id] = value;
      } else {
        const selected = [...fieldset.querySelectorAll('input:checked')].map(input => Number(input.value));
        if (selected.length) values[question.id] = question.type === 'multiple' ? selected : selected[0];
      }
    });
    return values;
  }
  function updateProgress() {
    count.textContent = `Ответов: ${Object.keys(answers()).length} / ${data.questions.length}`;
  }
  form.addEventListener('input', updateProgress);
  form.addEventListener('change', updateProgress);
  updateProgress();
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const values = answers();
    if (Object.keys(values).length !== data.questions.length) { error.textContent = 'Ответь на все вопросы перед проверкой.'; return; }
    const controller = new AbortController();
    activeRequest = controller;
    busy(true);
    progress('Проверяем ответы по смыслу…', 1, ['Ответы', 'Проверка', 'Оценка']);
    byId('prepare-label').textContent = 'Проверяем…';
    byId('work-progress').scrollIntoView({block: 'start', behavior: 'smooth'});
    form.querySelectorAll('input,textarea,.match-card,.matching-reset').forEach(control => { control.disabled = true; });
    check.disabled = true;
    check.textContent = 'Проверяем…';
    error.textContent = '';
    try {
      const result = await api(`/api/quizzes/${data.quiz_id}/check`, {answers: values}, controller.signal);
      score.textContent = `${result.score} из ${result.total} - ${Math.round(result.score / result.total * 100)}%`;
      score.hidden = false;
      result.results.forEach(item => {
        const fieldset = [...form.querySelectorAll('.quiz-question')].find(node => node.dataset.questionId === item.id);
        fieldset.classList.add(item.correct ? 'answer-correct' : 'answer-incorrect');
        const feedback = fieldset.querySelector('.question-feedback');
        feedback.replaceChildren(element('b', '', item.correct ? 'Верно' : 'Неверно'), element('p', '', 'Правильный ответ: ' + item.correct_answer), element('p', '', item.explanation));
        feedback.hidden = false;
        fieldset.querySelectorAll('input,textarea,.match-card,.matching-reset').forEach(control => { control.disabled = true; });
      });
      check.textContent = 'Тест завершён';
      window.sfx?.play('success');
      window.maxHaptic?.('success');
      score.scrollIntoView({block: 'start', behavior: 'smooth'});
    } catch (failure) {
      error.textContent = failure.name === 'AbortError' ? 'Проверка прервана. Можно повторить.' : failure instanceof TypeError ? 'Соединение прервалось во время проверки. Ответы остались в форме - попробуй ещё раз.' : failure.message;
      form.querySelectorAll('input,textarea,.match-card,.matching-reset').forEach(control => { control.disabled = false; });
      check.disabled = false;
      check.textContent = 'Проверить ответы';
    } finally {
      activeRequest = null;
      busy(false);
      progress('');
      byId('result-status').textContent = 'ГОТОВО';
    }
  });
}

fetch(appBase + '/api/status').then(response => response.json()).then(status => {
  byId('api-availability').textContent = status.generation_ready ? '' : 'Генерация не настроена на сервере';
  byId('api-availability').hidden = status.generation_ready;
}).catch(() => {
  byId('api-availability').textContent = 'Сервер недоступен';
  byId('api-availability').hidden = false;
});


