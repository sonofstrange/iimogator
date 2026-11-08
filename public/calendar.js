import {addDays, compactDateRange, dateNumber, dayLabel, localDay, occurrences, weekSegments, stageState, nextStage} from './calendar-dates.js?v=2';

const maxLaunchData = window.maxLaunchData ||
  (window.WebApp && window.WebApp.initData) ||
  new URLSearchParams(location.hash.slice(1)).get('WebAppData') ||
  new URLSearchParams(location.search).get('WebAppData') ||
  (() => { try { return sessionStorage.getItem('WebAppData') || ''; } catch { return ''; } })() || '';
const $ = id => document.getElementById(id);
const eventForm = $('event-form');
const olympiadForm = $('olympiad-form');
const statusNames = {planned: 'В планах', done: 'Выполнено', skipped: 'Пропущено'};
const groupStatus = {active: 'Участвую', completed: 'Завершена', eliminated: 'Выбыл(а)', archived: 'В архиве'};
let schedule = {events: [], olympiads: []};
let selected = localDay();
let month = selected.slice(0, 7);
let view = 'month';
let editing = null;
let draft = null;
let importRequest = null;
let importResult = null;
let calendarKey;
const expandedOlympiads = new Set();
const expandedStageDetails = new Set();
const expandedOlympiadDetails = new Set();
const savingSubjects = new Set();

function readSubjectNames() {
  let names = $('subject-names').value.split('\n');
  let result = [];
  for (let name of names) {
    name = name.trim();
    if (name && !result.includes(name)) result.push(name);
  }
  return result;
}

function subjectCheckboxes(container, names, selected, prefix) {
  container.textContent = '';
  for (let i = 0; i < names.length; i++) {
    let label = document.createElement('label');
    label.className = 'subject-choice';
    let checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.name = prefix + '-' + i;
    checkbox.value = names[i];
    checkbox.checked = selected.includes(names[i]);
    label.appendChild(checkbox);
    label.appendChild(document.createTextNode(names[i]));
    container.appendChild(label);
  }
}

function renderSubjectSelection(selected) {
  const names = readSubjectNames();
  $('subject-selection-field').hidden = !names.length;
  subjectCheckboxes($('subject-selection'), names, selected, 'participating-subject');
}

$('subject-names').addEventListener('change', () => {
  let inputs = $('subject-selection').querySelectorAll('input');
  let known = [];
  let selected = [];
  for (let input of inputs) {
    known.push(input.value);
    if (input.checked) selected.push(input.value);
  }
  for (let name of readSubjectNames()) {
    if (!known.includes(name)) selected.push(name);
  }
  renderSubjectSelection(selected);
});

function node(tag, className, text) {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (text !== undefined) item.textContent = text;
  return item;
}

function button(text, action, className = 'small-button') {
  const item = node('button', className, text);
  item.type = 'button';
  item.addEventListener('click', action);
  return item;
}

function errorAt(id, error) {
  $(id).textContent = error ? error.message || String(error) : '';
  $(id).hidden = !error;
}

async function request(path = '', method = 'GET', data, signal) {
  if (!calendarKey) throw new Error('Включи хранилище в браузере');
  const response = await fetch(appBase + '/api/calendar' + path, {
    method, signal,
    headers: {'X-Calendar-Key': calendarKey, 'X-Max-Data': maxLaunchData, 'Content-Type': 'application/json'},
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    let message = result.detail;
    if (Array.isArray(message)) message = message.map(item => `${item.loc.slice(1).join('.')}: ${item.msg}`).join('\n');
    throw new Error(typeof message === 'string' ? message : 'Ошибка сохранения');
  }
  return result;
}

async function load() {
  schedule = await request();
  errorAt('schedule-error', null);
  render();
}

function links(container, values) {
  if (!values?.length) return;
  const row = node('div', 'event-links');
  for (const value of values) {
    try {
      const url = new URL(value.url);
      if (!['http:', 'https:'].includes(url.protocol)) continue;
      const anchor = node('a', '', value.title || url.hostname);
      anchor.href = url.href;
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      row.append(anchor);
    } catch {}
  }
  container.append(row);
}

function matches(event) {
  const search = $('schedule-search').value.trim().toLocaleLowerCase('ru');
  const group = schedule.olympiads.find(item => item.id === event.olympiad_id);
  return !search || [event.title, event.description, event.comment, event.location, group?.title, ...(event.subjects || [])].join(' ').toLocaleLowerCase('ru').includes(search);
}

function relevant(event, group = schedule.olympiads.find(item => item.id === event.olympiad_id)) {
  if (!group || !event.subjects?.length || group.selected_subjects == null) return true;
  return event.subjects.some(subject => group.selected_subjects.includes(subject));
}

function stageSubjects(event, group) {
  if (!group || event.repeat) return [];
  let subjects = event.subjects?.length ? event.subjects : (group.subjects || []);
  return subjects.filter(subject => group.selected_subjects == null || group.selected_subjects.includes(subject));
}

function stageStatus(event, group) {
  let subjects = stageSubjects(event, group);
  if (!subjects.length) return event.status;
  let statuses = subjects.map(subject => event.subject_statuses?.[subject] || event.status);
  if (statuses.every(status => status === 'done')) return 'done';
  if (statuses.every(status => status === 'skipped')) return 'skipped';
  return 'planned';
}

function subjectButtons(container, event, group) {
  for (let subject of stageSubjects(event, group)) {
    let done = (event.subject_statuses?.[subject] || event.status) === 'done';
    let mark = button((done ? '✓ ' : '') + subject, () => setSubjectStatus(event, subject, !done));
    mark.dataset.stageId = event.id;
    mark.disabled = savingSubjects.has(event.id);
    container.append(mark);
  }
}

function onDay(day) {
  return schedule.events.filter(matches).filter(event => relevant(event)).filter(event => {
    const group = schedule.olympiads.find(item => item.id === event.olympiad_id);
    return !group || group.status === 'active' || day <= localDay();
  }).flatMap(event => occurrences(event, day).map(item => {
    const group = schedule.olympiads.find(value => value.id === event.olympiad_id);
    if (stageSubjects(event, group).length) item.status = stageStatus(event, group);
    return item;
  }))
    .sort((a, b) => (a.event.start_time || '').localeCompare(b.event.start_time || '') || a.event.title.localeCompare(b.event.title, 'ru'));
}

function eventWhen(event) {
  if (!event.start) return 'Дата не указана';
  let text = dayLabel(event.start, true);
  if (event.end && event.end !== event.start) text += ' - ' + dayLabel(event.end, true);
  if (event.start_time || event.end_time) text += ' · ' + timeLabel(event);
  if (event.timezone) text += ' ' + event.timezone;
  return text;
}

function timeLabel(event) {
  if (!event.start_time && event.end_time) return 'до ' + event.end_time.slice(0, 5);
  return event.start_time ? event.start_time.slice(0, 5) + (event.end_time ? ' - ' + event.end_time.slice(0, 5) : '') : 'Весь день';
}

function olympiadWhen(event) {
  let text = compactDateRange(event.start, event.end);
  if (event.start_time || event.end_time) text += ' · ' + timeLabel(event);
  if (event.timezone) text += ' ' + event.timezone;
  return text;
}

function card(occurrence, showDate = false) {
  const {event, day, status} = occurrence;
  const item = document.createElement('article');
  item.className = 'schedule-card ' + status;
  item.style.setProperty('--event-color', event.color);

  const group = schedule.olympiads.find(value => value.id === event.olympiad_id);
  const dated = showDate || (event.end && event.end !== event.start);
  const when = dated ? eventWhen({...event, start: day, end: event.end ? addDays(day, dateNumber(event.end) - dateNumber(event.start)) : null}) : timeLabel(event) + (event.timezone ? ' ' + event.timezone : '');
  const groupText = group ? group.title + (group.status === 'active' ? '' : ' · ' + groupStatus[group.status]) : '';
  const subjectsText = event.subjects?.length ? event.subjects.filter(subject => !group || group.selected_subjects == null || group.selected_subjects.includes(subject)).join(' · ') : '';

  item.innerHTML = `
    ${group ? `<button type="button" class="event-group event-group-btn" title="Перейти к олимпиаде: ${group.title}">${groupText} <span class="group-arrow">↗</span></button>` : ''}
    ${subjectsText ? `<p class="event-meta">${subjectsText}</p>` : ''}
    <button type="button" class="event-title">${event.title}</button>
    <p class="event-meta">${when + (event.repeat ? ' · Повторяется' : '')}</p>
    ${event.location ? `<p class="event-meta">${event.location}</p>` : ''}
    ${event.comment ? `<div class="event-comment"><span class="event-comment-badge">Заметка:</span> <span class="event-comment-text">${event.comment}</span></div>` : ''}
    ${event.description ? `<p class="event-description">${event.description}</p>` : ''}
    <div class="event-links"></div>
    ${group && (group.description || group.links?.length) ? `
      <details class="olympiad-about day-olympiad-about">
        <summary>Об олимпиаде и полезные ссылки</summary>
        ${group.description ? `<p class="event-description">${group.description}</p>` : ''}
        <div class="day-olympiad-links"></div>
      </details>
    ` : ''}
    <div class="event-actions">
      <select class="event-status-select" aria-label="Статус события: ${event.title}">
        <option value="planned"${status === 'planned' ? ' selected' : ''}>${statusNames.planned}</option>
        <option value="done"${status === 'done' ? ' selected' : ''}>${statusNames.done}</option>
        <option value="skipped"${status === 'skipped' ? ' selected' : ''}>${statusNames.skipped}</option>
      </select>
    </div>
  `;

  if (group) {
    const groupBtn = item.querySelector('.event-group-btn');
    if (groupBtn) groupBtn.addEventListener('click', () => showOlympiad(group.id));
    const dayAboutLinks = item.querySelector('.day-olympiad-links');
    if (dayAboutLinks && group.links?.length) links(dayAboutLinks, group.links);
    else dayAboutLinks?.remove();
  }

  item.querySelector('.event-title').addEventListener('click', () => openEvent(event, day));
  const linkBox = item.querySelector('.event-links');
  if (event.links?.length) links(linkBox, event.links);
  else linkBox.remove();

  const actions = item.querySelector('.event-actions');
  const statusSelect = actions.querySelector('.event-status-select');
  statusSelect.addEventListener('change', async () => {
    const selectedStatus = statusSelect.value;
    statusSelect.disabled = true;
    if (stageSubjects(event, group).length) {
      const subjectStatuses = {...event.subject_statuses};
      for (const subject of stageSubjects(event, group)) subjectStatuses[subject] = selectedStatus;
      try { await request('/events/' + event.id, 'PUT', {...event, subject_statuses: subjectStatuses}); await load(); }
      catch (error) { errorAt('schedule-error', error); statusSelect.disabled = false; statusSelect.value = status; }
    } else await setStatus(occurrence, selectedStatus);
  });

  if (stageSubjects(event, group).length) subjectButtons(actions, event, group);
  else actions.append(button(status === 'done' ? '✓ Выполнено' : 'Отметить', () => setStatus(occurrence, status === 'done' ? 'planned' : 'done')));
  actions.append(button('Изменить', () => openEvent(event, day), 'text-button'));

  return item;
}

function renderMonth() {
  const first = month + '-01';
  const date = new Date(first + 'T12:00:00');
  $('month-label').textContent = date.toLocaleDateString('ru-RU', {month: 'long', year: 'numeric'}).replace(' г.', '');
  $('selected-date').textContent = dayLabel(selected);
  const grid = $('month-grid');
  grid.replaceChildren();
  const offset = (date.getDay() + 6) % 7;
  const days = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  const monthOccurrences = new Set();
  const weekDays = [];
  for (let i = 0; i < Math.ceil((offset + days) / 7) * 7; i++) {
    const day = addDays(first, i - offset);
    if (i < offset || i >= offset + days) {
      const gap = node('span', 'calendar-gap');
      gap.style.gridRow = Math.floor(i / 7) + 1;
      gap.style.gridColumn = i % 7 + 1;
      grid.append(gap);
      weekDays.push([]);
      continue;
    }
    const events = onDay(day);
    weekDays.push(events);
    events.forEach(({event, day: start}) => monthOccurrences.add(`${event.id}:${start}`));
    const cell = button('', () => { selected = day; window.sfx?.play('pop'); window.maxHaptic?.('light'); renderMonth(); }, 'calendar-day');
    cell.style.gridRow = Math.floor(i / 7) + 1;
    cell.style.gridColumn = i % 7 + 1;
    cell.classList.toggle('today', day === localDay());
    cell.classList.toggle('selected', day === selected);
    cell.append(node('span', 'day-number', String(i - offset + 1)));
    grid.append(cell);
  }
  for (let row = 0; row < weekDays.length / 7; row++) {
    const segments = weekSegments(weekDays.slice(row * 7, row * 7 + 7));
    const hidden = Array(7).fill(0);
    for (const segment of segments) {
      if (segment.lane >= 3) {
        for (let col = segment.first; col <= segment.last; col++) hidden[col]++;
        continue;
      }
      const marker = node('span', 'day-marker ' + segment.status, segment.event.title);
      marker.classList.toggle('day-marker-range', Boolean(segment.event.end && segment.event.end !== segment.event.start));
      marker.classList.add('lane-' + segment.lane);
      marker.style.setProperty('--event-color', segment.event.color);
      marker.style.gridRow = row + 1;
      marker.style.gridColumn = `${segment.first + 1} / span ${segment.last - segment.first + 1}`;
      grid.append(marker);
    }
    hidden.forEach((amount, col) => {
      if (amount) grid.children[row * 7 + col].append(node('span', 'day-overflow', '+' + amount));
    });
  }
  $('month-count').textContent = monthOccurrences.size ? `Событий: ${monthOccurrences.size}` : '';
  const list = $('day-events');
  list.replaceChildren();
  const events = onDay(selected);
  if (!events.length) list.append(node('p', 'schedule-empty', 'На этот день планов нет.'));
  for (const occurrence of events) list.append(card(occurrence));
}

function renderAgenda() {
  const list = $('agenda-events');
  list.replaceChildren();
  let count = 0;
  for (let i = 0; i < 60; i++) {
    const day = addDays(localDay(), i);
    const events = onDay(day);
    if (!events.length) continue;
    list.append(node('h3', 'agenda-date', dayLabel(day)));
    for (const occurrence of events) { list.append(card(occurrence)); count++; }
  }
  const undated = schedule.events.filter(event => !event.start && matches(event) && relevant(event) && !schedule.olympiads.some(group => group.id === event.olympiad_id && group.status !== 'active'));
  if (undated.length) {
    list.append(node('h3', 'agenda-date', 'Без даты'));
    undated.forEach(event => {
      const group = schedule.olympiads.find(item => item.id === event.olympiad_id);
      list.append(card({event, day: null, status: stageStatus(event, group)}, true));
    });
  }
  if (!count && !undated.length) list.append(node('p', 'schedule-empty', 'Ближайшие 60 дней свободны.'));
}

function olympiadStage(stage, index, group) {
  const status = stageStatus(stage, group);
  const state = group.status !== 'active' && status === 'planned' ? 'Не отмечен' : stageState({...stage, status}, localDay());
  const subjects = stage.subjects?.length ? stage.subjects.join(' · ') : '';
  const dateStr = olympiadWhen(stage);

  const item = document.createElement('article');
  item.className = 'olympiad-stage ' + status;
  item.dataset.stageId = stage.id;
  item.style.setProperty('--stage-color', stage.color);

  item.innerHTML = `
    <div class="olympiad-stage-heading">
      <span class="olympiad-stage-number">${String(index + 1).padStart(2, '0')}</span>
      <div class="olympiad-stage-info">
        <h4>${status === 'done' ? '<span class="stage-done-check">✓ </span>' : ''}${stage.title}</h4>
        ${subjects ? `<p class="olympiad-stage-subjects">${subjects}</p>` : ''}
        <p class="olympiad-stage-date">${dateStr}</p>
        ${state !== 'Дата не указана' ? `<span class="olympiad-stage-state">${state}</span>` : ''}
      </div>
      <div class="olympiad-stage-actions">
        <select class="event-status-select" aria-label="Статус этапа: ${stage.title}">
          <option value="planned"${status === 'planned' ? ' selected' : ''}>${statusNames.planned}</option>
          <option value="done"${status === 'done' ? ' selected' : ''}>${statusNames.done}</option>
          <option value="skipped"${status === 'skipped' ? ' selected' : ''}>${statusNames.skipped}</option>
        </select>
        <button type="button" class="text-button stage-edit-btn">Изменить</button>
      </div>
    </div>
    ${(stage.description || stage.comment || stage.location || stage.links?.length) ? `
      <details class="olympiad-stage-details"${expandedStageDetails.has(stage.id) ? ' open' : ''}>
        <summary>Подробнее</summary>
        ${stage.location ? `<p class="olympiad-stage-location">${stage.location}</p>` : ''}
        ${stage.comment ? `<div class="event-comment"><span class="event-comment-badge">Заметка:</span> <span class="event-comment-text">${stage.comment}</span></div>` : ''}
        ${stage.description ? `<p class="event-description">${stage.description}</p>` : ''}
        <div class="stage-links"></div>
      </details>
    ` : ''}
  `;

  const actions = item.querySelector('.olympiad-stage-actions');
  const select = actions.querySelector('.event-status-select');
  select.addEventListener('change', async () => {
    const chosen = select.value;
    select.disabled = true;
    const subs = stageSubjects(stage, group);
    if (!subs.length) {
      await setOlympiadStageStatus(stage, chosen);
    } else {
      const subjectStatuses = {...stage.subject_statuses};
      for (const subject of subs) subjectStatuses[subject] = chosen;
      try { await request('/events/' + stage.id, 'PUT', {...stage, subject_statuses: subjectStatuses}); await load(); }
      catch (error) { errorAt('schedule-error', error); select.disabled = false; select.value = status; }
    }
  });

  const editBtn = actions.querySelector('.stage-edit-btn');
  editBtn.addEventListener('click', () => openEvent(stage, stage.start));

  if (stageSubjects(stage, group).length) {
    subjectButtons(actions, stage, group);
  } else {
    const completed = status === 'done';
    const mark = button(completed ? '✓ Готово' : 'Отметить', () => setOlympiadStageStatus(stage, completed ? 'planned' : 'done'));
    mark.dataset.stageId = stage.id;
    actions.insertBefore(mark, editBtn);
  }

  const details = item.querySelector('.olympiad-stage-details');
  if (details) {
    details.addEventListener('toggle', () => details.open ? expandedStageDetails.add(stage.id) : expandedStageDetails.delete(stage.id));
    const linksBox = details.querySelector('.stage-links');
    if (stage.links?.length) links(linksBox, stage.links);
    else linksBox.remove();
  }

  return item;
}

function renderOlympiads() {
  const list = $('olympiad-list');
  list.replaceChildren();
  const search = $('schedule-search').value.trim().toLocaleLowerCase('ru');
  for (const group of schedule.olympiads) {
    if (group.status !== 'active' && !$('show-closed').checked) continue;
    const stages = schedule.events.filter(item => item.olympiad_id === group.id && relevant(item, group)).sort((a, b) => a.order - b.order);
    const groupMatches = !search || [group.title, group.description].join(' ').toLocaleLowerCase('ru').includes(search);
    const filteredStages = groupMatches ? stages : stages.filter(matches);
    if (!groupMatches && !filteredStages.length) continue;
    const block = node('article', 'window olympiad-card');
    block.dataset.olympiadId = group.id;
    block.innerHTML = `
      <div class="olympiad-header">
        <div class="olympiad-identity">
          <span class="olympiad-status ${group.status}">${groupStatus[group.status] || ''}</span>
          <h2 class="olympiad-name">${group.title}</h2>
        </div>
        <button type="button" class="small-button olympiad-cfg" aria-label="Настроить олимпиаду: ${group.title}">Настроить</button>
      </div>
      <div class="olympiad-body"></div>
    `;
    block.querySelector('.olympiad-cfg').onclick = () => openOlympiad(group);
    const body = block.querySelector('.olympiad-body');
    if (group.subjects?.length) {
      const selectedSubjects = group.selected_subjects ?? group.subjects;
      body.append(node('p', 'olympiad-subject-summary', selectedSubjects.length ? 'Участвую: ' + selectedSubjects.join(' · ') : 'Предметы не выбраны'));
    }
    if (group.description || group.links?.length) {
      const details = node('details', 'olympiad-about');
      details.open = expandedOlympiadDetails.has(group.id);
      details.addEventListener('toggle', () => details.open ? expandedOlympiadDetails.add(group.id) : expandedOlympiadDetails.delete(group.id));
      details.append(node('summary', '', 'Об олимпиаде и ссылки'));
      if (group.description) details.append(node('p', 'event-description', group.description));
      links(details, group.links);
      body.append(details);
    }
    const next = group.status === 'active' && !search ? nextStage(stages.map(stage => ({...stage, status: stageStatus(stage, group)})), localDay()) : null;
    if (next) {
      const upcoming = button('', () => {
        expandedOlympiads.add(group.id);
        renderOlympiads();
        const row = [...list.querySelectorAll('.olympiad-stage')].find(item => item.dataset.stageId === next.stage.id);
        row?.scrollIntoView({block: 'center'});
        row?.querySelector('.olympiad-stage-actions button')?.focus({preventScroll: true});
      }, 'olympiad-next');
      upcoming.setAttribute('aria-label', `Показать этап: ${next.stage.title}`);
      upcoming.append(node('span', 'olympiad-next-label', next.start <= localDay() ? 'ИДЁТ СЕЙЧАС' : 'БЛИЖАЙШИЙ ЭТАП'));
      upcoming.append(node('strong', '', next.stage.title));
      upcoming.append(node('span', 'olympiad-next-date', olympiadWhen({...next.stage, start: next.start, end: next.end})));
      body.append(upcoming);
    }
    const done = stages.filter(item => stageStatus(item, group) === 'done').length;
    const pct = stages.length ? (done / stages.length * 100) : 0;
    const stagesInfo = node('div');
    stagesInfo.innerHTML = `
      <div class="olympiad-stages-header">
        <h3>Этапы</h3>
        <span>Пройдено ${done} / ${stages.length}</span>
      </div>
      ${stages.length ? `
        <div class="olympiad-progress">
          <span style="width: ${pct}%"></span>
        </div>
      ` : ''}
    `;
    body.append(...stagesInfo.children);
    const stageList = node('div', 'olympiad-stages');
    const expanded = expandedOlympiads.has(group.id);
    const upcomingStages = filteredStages.filter(stage => stageStatus(stage, group) === 'planned' && (!stage.start || (stage.end || stage.start) >= localDay() || stage.repeat));
    const shown = search || expanded ? filteredStages : upcomingStages.slice(0, 3);
    for (const stage of shown) stageList.append(olympiadStage(stage, stages.indexOf(stage), group));
    if (!stages.length) stageList.append(node('p', 'schedule-empty', 'Этапов пока нет.'));
    else if (!shown.length) stageList.append(node('p', 'schedule-empty', 'Предстоящих этапов нет.'));
    body.append(stageList);
    if (!search && (filteredStages.length > shown.length || expanded)) {
      const more = button(expanded ? 'Свернуть этапы ↑' : `Все этапы (${filteredStages.length}) ↓`, () => {
        if (expandedOlympiads.has(group.id)) expandedOlympiads.delete(group.id);
        else expandedOlympiads.add(group.id);
        renderOlympiads();
        [...list.querySelectorAll('.olympiad-more')].find(item => item.dataset.olympiadId === group.id)?.focus({preventScroll: true});
      }, 'olympiad-more');
      more.dataset.olympiadId = group.id;
      body.append(more);
    }
    block.append(body);
    list.append(block);
  }
  if (!list.childElementCount) {
    const text = search ? 'По этому запросу ничего не найдено.' : schedule.olympiads.length ? 'Активных олимпиад нет. Закрытые можно показать выше.' : 'Здесь будут твои олимпиады. Добавь их по ссылке или вручную.';
    list.append(node('p', 'schedule-empty', text));
  }
}

function render() {
  renderMonth();
  if (view === 'agenda') renderAgenda();
  if (view === 'olympiads') renderOlympiads();
}

async function setStatus(occurrence, status) {
  try {
    const event = structuredClone(occurrence.event);
    if (event.repeat) {
      if (status === 'planned') {
        delete event.exceptions[occurrence.day];
        await request('/events/' + event.id, 'PUT', event);
      } else await request('/events/' + event.id + '/occurrence', 'POST', {day: occurrence.day, status});
    } else await request('/events/' + event.id, 'PUT', {...event, status});
    await load();
  } catch (error) { errorAt('schedule-error', error); }
}

async function setOlympiadStageStatus(stage, status) {
  try {
    await request('/events/' + stage.id, 'PUT', {...stage, status});
    await load();
    [...document.querySelectorAll('.olympiad-stage-actions [data-stage-id]')].find(item => item.dataset.stageId === stage.id)?.focus({preventScroll: true});
  } catch (error) { errorAt('schedule-error', error); }
}

async function setSubjectStatus(event, subject, done) {
  if (savingSubjects.has(event.id)) return;
  savingSubjects.add(event.id);
  document.querySelectorAll('[data-stage-id]').forEach(item => {
    if (item.dataset.stageId === event.id && item.tagName === 'BUTTON') item.disabled = true;
  });
  try {
    let statuses = {...event.subject_statuses};
    let group = schedule.olympiads.find(item => item.id === event.olympiad_id);
    let subjects = event.subjects?.length ? event.subjects : (group?.subjects || []);
    for (let name of subjects) {
      if (!statuses[name]) statuses[name] = event.status;
    }
    statuses[subject] = done ? 'done' : 'planned';
    await request('/events/' + event.id, 'PUT', {...event, subject_statuses: statuses});
    await load();
  } catch (error) { errorAt('schedule-error', error); }
  finally {
    savingSubjects.delete(event.id);
    document.querySelectorAll('[data-stage-id]').forEach(item => {
      if (item.dataset.stageId === event.id && item.tagName === 'BUTTON') item.disabled = false;
    });
  }
}

function linksValue(values) { return (values || []).map(link => `${link.title} | ${link.url}`).join('\n'); }
function parseLinks(value) {
  return value.split('\n').filter(line => line.trim()).map(line => {
    const separator = line.indexOf('|');
    const url = (separator < 0 ? line : line.slice(separator + 1)).trim();
    const title = separator < 0 ? 'Ссылка' : line.slice(0, separator).trim();
    if (!/^https?:\/\//i.test(url)) throw new Error('Укажи ссылки с http:// или https://, каждую с новой строки.');
    return {title, url};
  });
}

function fillEvent(event) {
  const scope = $('event-scope').value;
  eventForm.reset();
  $('event-scope').value = scope;
  for (const name of ['title', 'description', 'comment', 'start', 'end', 'start_time', 'end_time', 'timezone', 'location', 'color', 'status', 'remind']) {
    if (event[name] != null) eventForm.elements[name].value = event[name];
  }
  eventForm.elements.links.value = linksValue(event.links);
  $('event-undated').checked = !event.start;
  $('event-all-day').checked = !event.start_time && !event.end_time;
  const rule = event.repeat;
  eventForm.elements.frequency.value = rule?.frequency || '';
  eventForm.elements.interval.value = rule?.interval || 1;
  eventForm.elements.until.value = rule?.until || '';
  eventForm.querySelectorAll('[name=weekday]').forEach(input => { input.checked = rule?.weekdays.includes(Number(input.value)) || false; });
  updateEventFields();
}

function openEvent(event = null, occurrenceDay = selected, draftIndex = null) {
  editing = {event: structuredClone(event), day: occurrenceDay, draftIndex};
  errorAt('event-error', null);
  $('event-editor-title').textContent = event ? 'Редактировать событие' : 'Новое событие';
  $('delete-event').hidden = !event;
  $('event-scope-label').hidden = !event?.repeat || draftIndex !== null;
  $('event-scope').value = 'one';
  const defaultDay = (!event && occurrenceDay && occurrenceDay < localDay()) ? localDay() : occurrenceDay;
  let values = event || {start: defaultDay, color: '#3977d1', status: 'planned'};
  if (event?.repeat && draftIndex === null) values = occurrenceValues(event, occurrenceDay);
  fillEvent(values);
  const group = draftIndex !== null ? draft.olympiad : schedule.olympiads.find(item => item.id === event?.olympiad_id);
  let subjects = draftIndex !== null ? readSubjectNames() : [...(group?.subjects || [])];
  for (let name of values.subjects || []) {
    if (!subjects.includes(name)) subjects.push(name);
  }
  $('stage-subjects').hidden = !subjects.length;
  subjectCheckboxes($('stage-subject-options'), subjects, values.subjects || [], 'stage-subject');
  $('event-dialog').showModal();
  if (window.WebApp && window.WebApp.BackButton) window.WebApp.BackButton.show();
}

function occurrenceValues(event, day) {
  return {...event, start: day, end: event.end ? addDays(day, dateNumber(event.end) - dateNumber(event.start)) : null, repeat: null, status: event.exceptions[day] || event.status};
}

function updateEventFields() {
  const undated = $('event-undated').checked;
  $('event-dates').hidden = undated;
  eventForm.elements.start.required = !undated;
  $('event-all-day').disabled = undated;
  const timed = !undated && !$('event-all-day').checked;
  $('event-times').hidden = !timed;
  eventForm.elements.frequency.disabled = undated || Boolean(editing?.event?.repeat && $('event-scope').value === 'one' && editing.draftIndex === null);
  $('repeat-fields').hidden = undated || !eventForm.elements.frequency.value || eventForm.elements.frequency.disabled;
  $('repeat-weekdays').hidden = eventForm.elements.frequency.value !== 'weekly';
  $('repeat-hint').textContent = ['monthly', 'yearly'].includes(eventForm.elements.frequency.value) ? 'Повторяем в ту же дату. Месяц или год без такой даты пропускается.' : eventForm.elements.frequency.value === 'weekly' ? 'Если дни не выбраны - повторяем в день недели первого события.' : 'Без конечной даты событие будет повторяться постоянно.';
}

function readEvent() {
  const fields = eventForm.elements;
  const undated = $('event-undated').checked;
  const timed = !undated && !$('event-all-day').checked;
  const frequency = !fields.frequency.disabled && fields.frequency.value;
  const original = editing.event || {};
  const value = {...original,
    title: fields.title.value.trim(), description: fields.description.value, comment: fields.comment ? fields.comment.value.trim() : (original.comment || ''),
    start: undated ? null : fields.start.value || null, end: undated ? null : fields.end.value || null,
    start_time: timed ? fields.start_time.value || null : null, end_time: timed ? fields.end_time.value || null : null,
    timezone: timed ? fields.timezone.value : '', location: fields.location.value, color: fields.color.value,
    status: fields.status.value, links: parseLinks(fields.links.value), remind: fields.remind ? fields.remind.value : '',
    subjects: $('stage-subjects').hidden ? (original.subjects || []) : [...$('stage-subject-options').querySelectorAll('input:checked')].map(input => input.value),
    repeat: frequency ? {frequency, interval: Number(fields.interval.value), until: fields.until.value || null, weekdays: [...eventForm.querySelectorAll('[name=weekday]:checked')].map(input => Number(input.value))} : null,
    exceptions: original.exceptions || {}, olympiad_id: original.olympiad_id || null, order: original.order || 0,
  };
  if ((original.subjects?.length || Object.keys(original.subject_statuses || {}).length) && value.status !== original.status) {
    value.subject_statuses = {};
    for (let subject of new Set([...(original.subjects || []), ...Object.keys(original.subject_statuses || {})])) value.subject_statuses[subject] = value.status;
  }
  if (value.end && value.end < value.start) throw new Error('Конец раньше начала');
  if (value.start_time && value.end_time && value.end_time < value.start_time && (!value.end || value.end === value.start)) throw new Error('Время конца раньше начала');
  return value;
}

async function saveEvent(event) {
  event.preventDefault();
  const submit = eventForm.querySelector('[type=submit]');
  submit.disabled = true;
  try {
    const value = readEvent();
    if (editing.draftIndex !== null) {
      if (editing.draftIndex < 0) draft.stages.push(value);
      else draft.stages[editing.draftIndex] = value;
      renderDraft();
    } else if (editing.event?.repeat && $('event-scope').value === 'one') {
      await request('/events/' + editing.event.id + '/occurrence', 'POST', {day: editing.day, event: value});
      await load();
    } else {
      await request('/events' + (editing.event ? '/' + editing.event.id : ''), editing.event ? 'PUT' : 'POST', value);
      await load();
    }
    $('event-dialog').close();
  } catch (error) { errorAt('event-error', error); }
  finally { submit.disabled = false; }
}

async function deleteEvent() {
  const one = editing.event.repeat && $('event-scope').value === 'one' && editing.draftIndex === null;
  if (!confirm(one ? 'Удалить только это вхождение?' : editing.event.repeat ? 'Удалить всю серию событий?' : 'Удалить событие?')) return;
  try {
    if (editing.draftIndex !== null) {
      draft.stages.splice(editing.draftIndex, 1);
      renderDraft();
    } else {
      await request('/events/' + editing.event.id + (one ? '/occurrence' : ''), one ? 'POST' : 'DELETE', one ? {day: editing.day, status: 'excluded'} : undefined);
      await load();
    }
    $('event-dialog').close();
  } catch (error) { errorAt('event-error', error); }
}

function openOlympiad(group = null, imported = null) {
  draft = imported || {olympiad: group || {title: '', description: '', links: [], status: 'active'}, stages: group ? schedule.events.filter(item => item.olympiad_id === group.id).sort((a, b) => a.order - b.order) : [], warnings: group?.warnings || [], sources: group?.sources || []};
  draft = structuredClone(draft);
  olympiadForm.reset();
  for (const name of ['title', 'description', 'status']) olympiadForm.elements[name].value = draft.olympiad[name] || (name === 'status' ? 'active' : '');
  olympiadForm.elements.links.value = linksValue(draft.olympiad.links);
  $('subject-names').value = (draft.olympiad.subjects || []).join('\n');
  renderSubjectSelection(draft.olympiad.selected_subjects ?? draft.olympiad.subjects ?? []);
  $('olympiad-title').textContent = imported ? 'Проверь расписание' : 'Олимпиада';
  $('delete-olympiad').hidden = !group;
  errorAt('olympiad-error', null);
  $('import-sources').replaceChildren();
  if (draft.sources?.length) {
    $('import-sources').append(node('p', 'field-hint', 'Прочитанные источники:'));
    links($('import-sources'), draft.sources);
  }
  renderDraft();
  $('olympiad-dialog').showModal();
  if (window.WebApp && window.WebApp.BackButton) window.WebApp.BackButton.show();
}

function renderDraft() {
  const list = $('draft-stages');
  list.replaceChildren(node('h3', '', 'Этапы'));
  if (!draft.stages.length) list.append(node('p', 'field-hint', 'Добавь этапы и важные дедлайны.'));
  draft.stages.forEach((stage, index) => {
    const row = node('div', 'draft-stage');
    const info = node('div');
    info.append(button(`${index + 1}. ${stage.title}`, () => openEvent(stage, stage.start, index), 'event-title'), node('p', 'event-meta', eventWhen(stage) + ' · ' + statusNames[stage.status] + (stage.subjects?.length ? ' · ' + stage.subjects.join(', ') : '')));
    const controls = node('div', 'draft-stage-actions');
    const move = direction => { [draft.stages[index], draft.stages[index + direction]] = [draft.stages[index + direction], draft.stages[index]]; renderDraft(); };
    const up = button('↑', () => move(-1)); up.disabled = index === 0; up.title = 'Выше';
    const down = button('↓', () => move(1)); down.disabled = index === draft.stages.length - 1; down.title = 'Ниже';
    controls.append(up, down, button('Изменить', () => openEvent(stage, stage.start, index)));
    row.append(info, controls);
    list.append(row);
  });
}

async function saveOlympiad(event) {
  event.preventDefault();
  const submit = olympiadForm.querySelector('[type=submit]');
  submit.disabled = true;
  try {
    const fields = olympiadForm.elements;
    const subjects = readSubjectNames();
    const unknown = draft.stages.flatMap(stage => stage.subjects || []).filter(subject => !subjects.includes(subject));
    if (unknown.length) throw new Error('Сначала убери удалённые предметы из этапов: ' + [...new Set(unknown)].join(', '));
    draft.olympiad = {...draft.olympiad, title: fields.title.value.trim(), description: fields.description.value, status: fields.status.value, links: parseLinks(fields.links.value)};
    draft.olympiad.subjects = subjects;
    draft.olympiad.selected_subjects = subjects.length ? [...$('subject-selection').querySelectorAll('input:checked')].map(input => input.value) : null;
    const id = draft.olympiad.id;
    await request('/olympiads' + (id ? '/' + id : ''), id ? 'PUT' : 'POST', draft);
    await load();
    window.sfx?.play('save');
    window.maxHaptic?.('success');
    $('olympiad-dialog').close();
    setView('olympiads');
  } catch (error) { errorAt('olympiad-error', error); }
  finally { submit.disabled = false; }
}

async function startImport(event) {
  event.preventDefault();
  if (importRequest) return;
  importResult = null;
  $('import-status').hidden = true;
  importRequest = new AbortController();
  $('import-progress').hidden = false;
  $('parse-olympiad').disabled = true;
  errorAt('import-error', null);
  try {
    const imported = await request('/import', 'POST', {url: $('import-form').elements.url.value}, importRequest.signal);
    if ($('import-dialog').open) { importRequest = null; $('import-dialog').close(); openOlympiad(null, imported); }
    else { importResult = imported; $('import-status').textContent = 'Разбор готов - открыть'; $('import-status').hidden = false; }
  } catch (error) { if (error.name !== 'AbortError') { errorAt('import-error', error); if (!$('import-dialog').open) { $('import-status').textContent = 'Ошибка разбора - открыть'; $('import-status').hidden = false; } } else $('import-status').hidden = true; }
  finally { importRequest = null; $('import-progress').hidden = true; $('parse-olympiad').disabled = false; }
}

function showOlympiad(olympiadId) {
  expandedOlympiads.add(olympiadId);
  expandedOlympiadDetails.add(olympiadId);
  setView('olympiads');
  setTimeout(() => {
    const cardEl = document.querySelector(`.olympiad-card[data-olympiad-id="${olympiadId}"]`);
    if (cardEl) {
      cardEl.scrollIntoView({behavior: 'smooth', block: 'start'});
      cardEl.classList.remove('olympiad-card-highlight');
      void cardEl.offsetWidth;
      cardEl.classList.add('olympiad-card-highlight');
    }
  }, 50);
}

function setView(value) {
  view = value;
  for (const name of ['month', 'agenda', 'olympiads']) $('calendar-' + name + '-view').hidden = name !== view;
  document.querySelectorAll('[data-view]').forEach(tab => { tab.classList.toggle('active', tab.dataset.view === view); });
  render();
}

document.querySelectorAll('[data-view]').forEach(tab => tab.addEventListener('click', () => setView(tab.dataset.view)));
document.querySelectorAll('[data-close]').forEach(item => item.addEventListener('click', () => { $(item.dataset.close).close(); window.sfx?.play('click'); }));
document.querySelectorAll('dialog').forEach(d => d.addEventListener('close', () => {
  if (window.WebApp && window.WebApp.BackButton && !document.querySelector('dialog[open]')) window.WebApp.BackButton.hide();
}));
if (window.WebApp && window.WebApp.BackButton) {
  window.WebApp.BackButton.onClick(() => {
    const openDialog = document.querySelector('dialog[open]');
    if (openDialog) openDialog.close();
  });
}
$('new-event').addEventListener('click', () => { window.sfx?.play('click'); openEvent(); });
$('add-day-event').addEventListener('click', () => openEvent());
$('new-olympiad').addEventListener('click', () => openOlympiad());
$('add-stage').addEventListener('click', () => openEvent(null, null, -1));
$('event-form').addEventListener('submit', saveEvent);
$('delete-event').addEventListener('click', deleteEvent);
$('event-undated').addEventListener('change', updateEventFields);
$('event-all-day').addEventListener('change', updateEventFields);
eventForm.elements.frequency.addEventListener('change', updateEventFields);
$('event-scope').addEventListener('change', () => fillEvent($('event-scope').value === 'series' ? editing.event : occurrenceValues(editing.event, editing.day)));
$('olympiad-form').addEventListener('submit', saveOlympiad);
$('delete-olympiad').addEventListener('click', async () => {
  if (!confirm('Удалить олимпиаду и все её этапы из расписания?')) return;
  try { await request('/olympiads/' + draft.olympiad.id, 'DELETE'); await load(); $('olympiad-dialog').close(); }
  catch (error) { errorAt('olympiad-error', error); }
});
$('import-olympiad').addEventListener('click', () => { if (importResult) { $('import-status').click(); return; } errorAt('import-error', null); $('import-status').hidden = true; $('import-dialog').showModal(); if (window.WebApp && window.WebApp.BackButton) window.WebApp.BackButton.show(); });
$('import-form').addEventListener('submit', startImport);
$('cancel-import').addEventListener('click', () => importRequest?.abort());
$('minimize-import').addEventListener('click', () => $('import-dialog').close());
$('import-dialog').addEventListener('close', () => {
  if (importRequest) { $('import-status').textContent = 'Идёт разбор олимпиады…'; $('import-status').hidden = false; }
});
$('import-status').addEventListener('click', () => {
  if (importResult) { const result = importResult; importResult = null; $('import-status').hidden = true; openOlympiad(null, result); }
  else { $('import-status').hidden = true; $('import-dialog').showModal(); if (window.WebApp && window.WebApp.BackButton) window.WebApp.BackButton.show(); }
});
$('schedule-help-open').addEventListener('click', () => { $('schedule-help').showModal(); if (window.WebApp && window.WebApp.BackButton) window.WebApp.BackButton.show(); });
$('schedule-search').addEventListener('input', render);
$('show-closed').addEventListener('change', renderOlympiads);
$('previous-month').addEventListener('click', () => { month = addDays(month + '-01', -1).slice(0, 7); renderMonth(); });
$('next-month').addEventListener('click', () => { const date = new Date(month + '-01T12:00:00'); date.setMonth(date.getMonth() + 1); month = localDay(date).slice(0, 7); renderMonth(); });
$('today-button').addEventListener('click', () => { window.sfx?.play('pop'); selected = localDay(); month = selected.slice(0, 7); renderMonth(); });
$('export-calendar').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify({version: 1, ...schedule}, null, 2)], {type: 'application/json'}));
  const anchor = node('a'); anchor.href = url; anchor.download = `iimogator-${localDay()}.json`; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$('restore-calendar').addEventListener('change', async event => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (file.size > 5 * 1024 * 1024) throw new Error('Файл слишком большой');
    const backup = JSON.parse(await file.text());
    if (!Array.isArray(backup.events) || !Array.isArray(backup.olympiads)) throw new Error('Неверный файл');
    if (!confirm(`Добавить из копии ${backup.events.length} событий и ${backup.olympiads.length} олимпиад?`)) return;
    await request('/restore', 'POST', backup);
    await load();
  } catch (error) { errorAt('schedule-error', error); }
  finally { event.target.value = ''; }
});

try {
  calendarKey = localStorage.getItem('iimogator-calendar-key');
  if (!calendarKey) {
    if (crypto.randomUUID) calendarKey = crypto.randomUUID();
    else {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      bytes[6] = (bytes[6] & 15) | 64;
      bytes[8] = (bytes[8] & 63) | 128;
      const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
      calendarKey = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
    localStorage.setItem('iimogator-calendar-key', calendarKey);
  }


  await load();
  if (maxLaunchData && !localStorage.getItem('max-calendar-migration-asked')) {
    const old = await fetch(appBase + '/api/calendar', {headers: {'X-Calendar-Key': calendarKey}});
    if (old.ok) {
      const previous = await old.json();
      if ((previous.events.length || previous.olympiads.length) && !schedule.events.length && !schedule.olympiads.length && confirm('Перенести расписание из этого браузера в аккаунт MAX?')) {
        await request('/move-browser', 'POST', {});
        await load();
      }
      localStorage.setItem('max-calendar-migration-asked', '1');
    }
  }
} catch (error) { errorAt('schedule-error', error); render(); }

// --- Olympiads Catalog Logic ---
let catalogState = {
  status: 'active',
  subject: '',
  search: '',
  data: null,
  loading: false
};

async function loadCatalog() {
  const countLabel = $('catalog-count-label');
  const listEl = $('catalog-list');
  const updatedLabel = $('catalog-updated-label');
  
  catalogState.loading = true;
  countLabel.textContent = 'Обновление списка…';
  
  try {
    const params = new URLSearchParams({
      status: catalogState.status,
      subject: catalogState.subject,
      search: catalogState.search
    });
    const res = await request('/catalog?' + params.toString());
    catalogState.data = res;
    
    countLabel.textContent = `Найдено: ${res.total} олимпиад (всего в базе: ${res.all_total})`;
    if (res.updated_at) {
      try {
        const dt = new Date(res.updated_at);
        updatedLabel.textContent = 'Обновлено: ' + dt.toLocaleDateString('ru-RU', {day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'});
      } catch (e) {
        updatedLabel.textContent = '';
      }
    }
    
    renderCatalogList(res.olympiads || []);
  } catch (err) {
    countLabel.textContent = 'Ошибка загрузки каталога';
    listEl.innerHTML = `<p class="schedule-empty">Не удалось загрузить каталог: ${err.message || err}</p>`;
  } finally {
    catalogState.loading = false;
  }
}

function renderCatalogList(items) {
  const listEl = $('catalog-list');
  listEl.replaceChildren();

  if (!items.length) {
    listEl.innerHTML = '<p class="schedule-empty">По выбранным фильтрам ничего не найдено.</p>';
    return;
  }

  // Set of titles already in user schedule
  const existingTitles = new Set(schedule.olympiads.map(o => o.title.trim().toLowerCase()));

  for (const item of items) {
    const card = node('article', 'catalog-item-card' + (item.status === 'archived' ? ' is-archived' : ''));
    const isAdded = existingTitles.has(item.title.trim().toLowerCase());
    
    const deadlineText = item.registration_deadline ? `Регистрация: до ${item.registration_deadline}` : '';
    const statusLabel = item.status === 'archived' ? 'Регистрация завершена (Архив)' : (deadlineText || 'Идёт регистрация');
    
    card.innerHTML = `
      <div class="catalog-item-header">
        <div class="catalog-item-title-wrap">
          <span class="catalog-item-badge">${item.level || 'Олимпиада'} · ${item.classes || 'Школьники'}</span>
          <h3 class="catalog-item-title">${item.title}</h3>
        </div>
      </div>
      <p class="catalog-item-desc">${item.description}</p>
      <div class="catalog-item-meta">
        <span>Предметы: <b>${(item.subjects || []).join(', ') || 'Все'}</b></span>
        <span>Статус: <b>${statusLabel}</b></span>
      </div>
      ${(item.stages && item.stages.length) ? `
        <div class="catalog-item-stages-preview">
          ${item.stages.map(st => `
            <div class="catalog-stage-row">
              <span>• ${st.title}</span>
              <span class="catalog-stage-date">${st.start ? (st.end && st.end !== st.start ? st.start + ' — ' + st.end : st.start) : 'Даты уточняются'}</span>
            </div>
          `).join('')}
        </div>
      ` : ''}
      <div class="catalog-item-footer">
        <div class="catalog-item-links">
          ${(item.links || []).map(l => `<a href="${l.url}" target="_blank" rel="noopener">${l.title} ↗</a>`).join('')}
        </div>
        <div class="catalog-item-actions">
          <button type="button" class="primary-button catalog-add-btn${isAdded ? ' added' : ''}" data-olymp-id="${item.id}" ${isAdded ? 'disabled' : ''}>
            ${isAdded ? '✓ В календаре' : '+ В календарь'}
          </button>
        </div>
      </div>
    `;

    const addBtn = card.querySelector('.catalog-add-btn');
    if (!isAdded) {
      addBtn.addEventListener('click', async () => {
        addBtn.disabled = true;
        addBtn.textContent = 'Добавление…';
        try {
          const res = await request('/catalog/import', 'POST', {
            olympiad_id: item.id,
            selected_subjects: item.subjects || []
          });
          window.sfx?.play('success');
          addBtn.textContent = '✓ Добавлено';
          addBtn.classList.add('added');
          await load();
        } catch (e) {
          alert('Ошибка при добавлении: ' + (e.message || e));
          addBtn.disabled = false;
          addBtn.textContent = '+ В календарь';
        }
      });
    }

    listEl.append(card);
  }
}

// Event Listeners for Catalog
$('open-catalog-btn')?.addEventListener('click', () => {
  $('catalog-dialog').showModal();
  if (window.WebApp && window.WebApp.BackButton) window.WebApp.BackButton.show();
  loadCatalog();
});

$('catalog-tab-active')?.addEventListener('click', () => {
  $('catalog-tab-active').classList.add('active');
  $('catalog-tab-archived').classList.remove('active');
  catalogState.status = 'active';
  loadCatalog();
});

$('catalog-tab-archived')?.addEventListener('click', () => {
  $('catalog-tab-archived').classList.add('active');
  $('catalog-tab-active').classList.remove('active');
  catalogState.status = 'archived';
  loadCatalog();
});

let catalogSearchTimeout = null;
$('catalog-search')?.addEventListener('input', (e) => {
  clearTimeout(catalogSearchTimeout);
  catalogSearchTimeout = setTimeout(() => {
    catalogState.search = e.target.value;
    loadCatalog();
  }, 250);
});

$('catalog-subject-tags')?.addEventListener('click', (e) => {
  const chip = e.target.closest('.subject-chip');
  if (!chip) return;
  $('catalog-subject-tags').querySelectorAll('.subject-chip').forEach(c => c.classList.remove('active'));
  chip.classList.add('active');
  catalogState.subject = chip.dataset.subject || '';
  loadCatalog();
});

