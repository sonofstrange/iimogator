const dayMs = 86400000;
export const dateNumber = day => Date.parse(day + 'T00:00:00Z') / dayMs;
export const addDays = (day, count) => new Date((dateNumber(day) + count) * dayMs).toISOString().slice(0, 10);
export const localDay = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
export const dayLabel = (day, year = false) => new Date(day + 'T12:00:00').toLocaleDateString('ru-RU', {day: 'numeric', month: 'long', ...(year ? {year: 'numeric'} : {})}).replace(' г.', '');

export function compactDateRange(start, end) {
  if (!start) return 'Дата не указана';
  if (!end || end === start) return dayLabel(start, true);
  if (start.slice(0, 7) === end.slice(0, 7)) return `${Number(start.slice(8))}-${dayLabel(end, true)}`;
  if (start.slice(0, 4) === end.slice(0, 4)) return `${dayLabel(start)} - ${dayLabel(end, true)}`;
  return `${dayLabel(start, true)} - ${dayLabel(end, true)}`;
}

function startsOn(event, day) {
  if (!event.start || day < event.start) return false;
  const rule = event.repeat;
  if (!rule) return day === event.start;
  if (rule.until && day > rule.until) return false;
  const delta = dateNumber(day) - dateNumber(event.start);
  const start = new Date(event.start + 'T12:00:00Z');
  const current = new Date(day + 'T12:00:00Z');
  if (rule.frequency === 'daily') return delta % rule.interval === 0;
  if (rule.frequency === 'weekly') {
    const startWeekday = (start.getUTCDay() + 6) % 7;
    const weekday = (current.getUTCDay() + 6) % 7;
    const week = Math.floor((delta + startWeekday) / 7);
    return week % rule.interval === 0 && (rule.weekdays.length ? rule.weekdays : [startWeekday]).includes(weekday);
  }
  const months = (current.getUTCFullYear() - start.getUTCFullYear()) * 12 + current.getUTCMonth() - start.getUTCMonth();
  if (rule.frequency === 'monthly') return months % rule.interval === 0 && current.getUTCDate() === start.getUTCDate();
  return (current.getUTCFullYear() - start.getUTCFullYear()) % rule.interval === 0 && current.getUTCMonth() === start.getUTCMonth() && current.getUTCDate() === start.getUTCDate();
}

export function occurrences(event, day) {
  if (!event.start || day < event.start) return [];
  if (!event.repeat) return day <= (event.end || event.start) ? [{event, day: event.start, status: event.status}] : [];
  const duration = event.end ? dateNumber(event.end) - dateNumber(event.start) : 0;
  const result = [];
  for (let offset = 0; offset <= duration; offset++) {
    const start = addDays(day, -offset);
    const exception = event.exceptions[start];
    if (exception !== 'excluded' && startsOn(event, start)) result.push({event, day: start, status: exception || event.status});
  }
  return result;
}

export function weekSegments(days) {
  const segments = new Map();
  days.forEach((events, column) => {
    for (const occurrence of events) {
      const key = `${occurrence.event.id}:${occurrence.day}`;
      if (!segments.has(key)) segments.set(key, {...occurrence, first: column, last: column});
      else segments.get(key).last = column;
    }
  });
  const ordered = [...segments.values()].sort((a, b) =>
    (b.last - b.first) - (a.last - a.first) || a.first - b.first || a.event.title.localeCompare(b.event.title, 'ru'));
  const lanes = [];
  for (const segment of ordered) {
    let lane = lanes.findIndex(items => items.every(item => item.last < segment.first || item.first > segment.last));
    if (lane < 0) {
      lane = lanes.length;
      lanes.push([]);
    }
    lanes[lane].push(segment);
    segment.lane = lane;
  }
  return ordered;
}

export function stageState(stage, today) {
  if (stage.status === 'done') return 'Выполнено';
  if (stage.status === 'skipped') return 'Пропущено';
  if (!stage.start) return 'Дата не указана';
  if (stage.repeat) return 'Повторяется';
  if ((stage.end || stage.start) < today) return 'Дата прошла';
  if (stage.start === today && (!stage.end || stage.end === stage.start)) return 'Сегодня';
  return stage.start <= today ? 'Идёт' : 'Предстоит';
}

export function nextStage(stages, today) {
  let nearest = null;
  for (const stage of stages) {
    if (stage.status !== 'planned' || !stage.start) continue;
    let start = stage.start;
    let end = stage.end || start;
    if (stage.repeat) {
      let found = null;
      for (let offset = 0; offset <= 365; offset++) {
        const day = addDays(today, offset);
        found = occurrences(stage, day).find(item => item.status === 'planned');
        if (found) break;
      }
      if (!found) continue;
      start = found.day;
      end = stage.end ? addDays(start, dateNumber(stage.end) - dateNumber(stage.start)) : start;
    }
    if (end < today) continue;
    const relevantDay = start < today ? today : start;
    if (!nearest || relevantDay < nearest.relevantDay) nearest = {stage, start, end, relevantDay};
  }
  return nearest;
}
