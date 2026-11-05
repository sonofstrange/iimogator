function createMatching(question, onChange) {
  const palette = ['#285fc8', '#157582', '#56762b', '#9a4674', '#956017'];
  const assignments = new Map();
  let selectedLeft = null;

  const root = document.createElement('div');
  root.className = 'matching-exercise';
  root.innerHTML = `
    <p class="matching-hint">Выбери карточку слева, затем её пару справа.</p>
    <div class="matching-board">
      <div class="matching-column col-left"></div>
      <div class="matching-column col-right"></div>
    </div>
    <div class="matching-footer">
      <span class="matching-status">Пар: 0 / ${question.left.length}</span>
      <button type="button" class="small-button matching-reset">Сбросить пары</button>
    </div>
  `;

  const hint = root.querySelector('.matching-hint');
  const status = root.querySelector('.matching-status');
  const colLeft = root.querySelector('.col-left');
  const colRight = root.querySelector('.col-right');
  const resetButton = root.querySelector('.matching-reset');

  resetButton.addEventListener('click', () => {
    window.sfx?.play('click');
    assignments.clear();
    selectedLeft = null;
    update();
  });

  const cards = [[], []];

  function update() {
    cards.forEach((side, sideIndex) => side.forEach((button, index) => {
      const pairIndex = sideIndex === 0 ? assignments.has(index) ? index : undefined : [...assignments.keys()].find(left => assignments.get(left) === index);
      const badge = button.querySelector('.pair-badge');
      button.classList.toggle('paired', pairIndex !== undefined);
      button.classList.toggle('selected', sideIndex === 0 && selectedLeft === index);
      button.style.setProperty('--pair-color', pairIndex === undefined ? '#665078' : palette[pairIndex]);
      badge.textContent = sideIndex === 0 ? String(index + 1) : pairIndex === undefined ? '·' : String(pairIndex + 1);
    }));
    status.textContent = `Пар: ${assignments.size} / ${question.left.length}`;
    hint.textContent = selectedLeft === null ? assignments.size === question.left.length ? 'Пары собраны. Можно изменить их до проверки.' : 'Выбери карточку слева, затем её пару справа.' : `Теперь выбери пару справа для карточки ${selectedLeft + 1}.`;
    onChange();
  }

  [question.left, question.right].forEach((items, side) => items.forEach((text, index) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'match-card';
    btn.dataset.side = side === 0 ? 'left' : 'right';
    btn.dataset.cardIndex = index;
    btn.innerHTML = `<span class="pair-badge">${side === 0 ? index + 1 : '·'}</span><span class="pair-label">${text}</span>`;
    
    btn.addEventListener('click', () => {
      if (side === 0) {
        selectedLeft = selectedLeft === index ? null : index;
        window.sfx?.play('pop');
        window.maxHaptic?.('selection');
      } else {
        if (selectedLeft === null) {
          hint.textContent = 'Сначала выбери карточку слева.';
          window.sfx?.play('error');
          return;
        }
        const prev = [...assignments.keys()].find(left => assignments.get(left) === index);
        if (prev !== undefined) assignments.delete(prev);
        assignments.set(selectedLeft, index);
        window.sfx?.play('save');
        window.maxHaptic?.('light');
        selectedLeft = question.left.findIndex((_, left) => !assignments.has(left));
        if (selectedLeft === -1) selectedLeft = null;
      }
      update();
    });

    cards[side].push(btn);
    (side === 0 ? colLeft : colRight).appendChild(btn);
  }));

  return {
    node: root,
    value() {
      return assignments.size === question.left.length ? Object.fromEntries([...assignments].map(([left, right]) => [String(left), question.right[right]])) : null;
    },
  };
}
