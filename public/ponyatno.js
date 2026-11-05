(() => {
  let понятно = false;
  let наблюдатель;
  let логотип;
  const оригиналы = new Map();
  const подсказки = new Map();

  function перевод(текст) {
    const родитель = текст.parentElement;
    const надпись = текст.nodeValue.trim();
    const известные = {
      'Подготовка': 'Понятная вкладка для подготовки',
      'Расписание': 'Понятная вкладка с расписанием',
      'Подготовить материал': 'Понятная кнопка для подготовки материала',
      'Составить тест': 'Понятная кнопка для создания теста',
      'Здесь появится результат': 'Понятное место для результата',
      'Сначала добавь материал.': 'Понятная просьба добавить материал',
      'Добавь материал': 'Понятная просьба добавить материал',
      'Что подготовить?': 'Понятный вопрос о формате',
      'ИСТОЧНИК': 'ПОНЯТНЫЙ ИСТОЧНИК',
      'ФОРМАТ': 'ПОНЯТНЫЙ ФОРМАТ',
      'РЕЗУЛЬТАТ': 'ПОНЯТНЫЙ РЕЗУЛЬТАТ',
      'Олимпиада по ссылке': 'Понятная кнопка для олимпиады',
      '+ Событие': 'Понятная кнопка для события',
    };
    if (известные[надпись]) return известные[надпись];
    if (родитель.closest('button, [role="button"]')) return `Понятная кнопка «${надпись}»`;
    if (родитель.closest('h1, h2, h3, h4, h5, h6, legend, .window-bar')) return `Понятный заголовок «${надпись}»`;
    if (родитель.closest('label')) return `Понятная подпись «${надпись}»`;
    if (родитель.closest('[role="alert"], .field-error')) return `Понятное сообщение об ошибке: ${надпись}`;
    if (родитель.closest('[role="status"], #progress-message')) return `Понятное сообщение о работе: ${надпись}`;
    return `Понятная надпись «${надпись}»`;
  }

  function понятныеПоля(узел) {
    const поля = узел.nodeType === Node.ELEMENT_NODE && узел.matches('[placeholder]') ? [узел] : [];
    if (узел.querySelectorAll) поля.push(...узел.querySelectorAll('[placeholder]'));
    for (const поле of поля) {
      if (подсказки.has(поле)) continue;
      const оригинал = поле.getAttribute('placeholder');
      const замена = поле.id === 'material' ? 'Понятная просьба вставить текст лекции…'
        : поле.id === 'schedule-search' ? 'Понятное поле для поиска события…'
        : поле.id === 'lecture-link' ? 'Понятное поле для ссылки на лекцию…'
        : `Понятная подсказка: ${оригинал}`;
      подсказки.set(поле, {оригинал, замена});
      поле.setAttribute('placeholder', замена);
    }
  }

  function понятнее(узел) {
    понятныеПоля(узел);
    const обход = document.createTreeWalker(узел, NodeFilter.SHOW_TEXT);
    const тексты = узел.nodeType === Node.TEXT_NODE ? [узел] : [];
    while (обход.nextNode()) тексты.push(обход.currentNode);
    for (const текст of тексты) {
      if (!текст.nodeValue.trim() || текст.parentElement?.closest('script, style, textarea, input, [contenteditable], [aria-hidden="true"]')) continue;
      const исходный = текст.nodeValue;
      const замена = исходный.replace(/\S(?:[\s\S]*\S)?/, перевод(текст));
      if (исходный === замена) continue;
      оригиналы.set(текст, {исходный, замена});
      текст.nodeValue = замена;
    }
  }

  window.понятно = () => {
    понятно = !понятно;
    if (понятно) {
      const картинка = document.querySelector('.brand img');
      логотип = document.createElement('span');
      логотип.className = 'понятно-логотип';
      картинка.before(логотип);
      логотип.append(картинка);
      document.body.classList.add('понятно-режим');
      понятнее(document.body);
      наблюдатель = new MutationObserver(изменения => {
        наблюдатель.disconnect();
        for (const изменение of изменения) {
          if (изменение.type === 'characterData') понятнее(изменение.target);
          else for (const узел of изменение.addedNodes) понятнее(узел);
        }
        наблюдатель.observe(document.body, {childList: true, characterData: true, subtree: true});
      });
      наблюдатель.observe(document.body, {childList: true, characterData: true, subtree: true});
      return 'Понятно.';
    }
    наблюдатель.disconnect();
    document.body.classList.remove('понятно-режим');
    логотип.replaceWith(...логотип.childNodes);
    логотип = null;
    for (const [поле, {оригинал, замена}] of подсказки) {
      if (поле.getAttribute('placeholder') === замена) поле.setAttribute('placeholder', оригинал);
    }
    подсказки.clear();
    for (const [текст, {исходный, замена}] of оригиналы) {
      if (текст.nodeValue === замена) текст.nodeValue = исходный;
    }
    оригиналы.clear();
    return 'Теперь всё как было.';
  };
})();
