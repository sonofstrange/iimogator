const maxLaunchData = (window.WebApp && window.WebApp.initData) ||
  new URLSearchParams(location.hash.slice(1)).get('WebAppData') ||
  new URLSearchParams(location.search).get('WebAppData') ||
  (() => { try { return sessionStorage.getItem('WebAppData') || ''; } catch { return ''; } })() || '';
if (maxLaunchData) {
  try { sessionStorage.setItem('WebAppData', maxLaunchData); } catch {}
}
window.maxLaunchData = maxLaunchData;
const appBase = new URL('.', document.baseURI).pathname.replace(/\/$/, '');

if (window.WebApp) {
  try {
    window.WebApp.ready?.();
    window.WebApp.expand?.();
  } catch (e) {}
}

function maxHaptic(type = 'light') {
  try {
    if (window.WebApp && window.WebApp.HapticFeedback) {
      if (['success', 'warning', 'error'].includes(type)) {
        window.WebApp.HapticFeedback.notificationOccurred(type);
      } else {
        window.WebApp.HapticFeedback.impactOccurred(type);
      }
    }
  } catch (e) {}
}
window.maxHaptic = maxHaptic;

function wireTabs(selector, attribute, panelPrefix, onSelect = () => {}) {
  const buttons = [...document.querySelectorAll(selector)];
  function select(button, userAction = false) {
    buttons.forEach(item => {
      const active = item === button;
      item.classList.toggle('active', active);
      const panel = document.getElementById(panelPrefix + item.dataset[attribute]);
      if (panel) panel.hidden = !active;
    });
    onSelect(button.dataset[attribute]);
    button.dispatchEvent(new CustomEvent('tab-selected'));
    if (userAction) {
      window.sfx?.play('tab');
      maxHaptic('selection');
    }
  }
  buttons.forEach(button => {
    button.addEventListener('click', () => select(button, true));
  });
  return value => {
    const button = buttons.find(item => item.dataset[attribute] === value);
    if (button) select(button, false);
  };
}

const selectMainTab = wireTabs('.nav-tab', 'tab', 'panel-', value => {
  history.replaceState(null, '', '#' + value);
});
const rawTab = location.hash.slice(1);
const activeTab = (!rawTab || rawTab.includes('WebAppData') || !['study', 'calendar'].includes(rawTab)) ? 'study' : rawTab;
selectMainTab(activeTab);
document.querySelector('.brand').addEventListener('click', () => selectMainTab('study'));
let source = 'text';
let mode = 'material';
wireTabs('.input-tab', 'source', 'source-', value => { source = value; });
wireTabs('.format-tab', 'mode', 'format-', value => {
  mode = value;
  document.getElementById('prepare-label').textContent = value === 'test' ? 'Составить тест' : 'Подготовить материал';
});

document.querySelectorAll('.choice-group input[type="radio"]').forEach(radio => {
  radio.addEventListener('change', () => {
    window.sfx?.play('pop');
    maxHaptic('selection');
  });
});

const material = document.getElementById('material');
material.addEventListener('input', () => {
  document.getElementById('char-count').textContent = `${material.value.length.toLocaleString('ru-RU')} / 50 000`;
});
const fileInput = document.getElementById('photo-file');
let photo = null;
let photoUrl = null;
function clearPhoto() {
  if (photoUrl) URL.revokeObjectURL(photoUrl);
  photoUrl = null;
  photo = null;
  fileInput.value = '';
  document.getElementById('photo-preview').hidden = true;
  document.getElementById('drop-area').hidden = false;
  document.getElementById('file-error').textContent = '';
  window.sfx?.play('click');
}
function usePhoto(file) {
  const error = document.getElementById('file-error');
  error.textContent = '';
  if (!file) return;
  const isImage = (file.type && file.type.startsWith('image/')) || /\.(jpe?g|png|webp|bmp|gif|heic)$/i.test(file.name || '');
  if (!isImage) {
    error.textContent = 'Выбери фото в формате JPG, PNG или WEBP.';
    window.sfx?.play('error');
    return;
  }
  const img = new Image();
  const url = URL.createObjectURL(file);
  img.onload = () => {
    URL.revokeObjectURL(url);
    const maxDim = 1600;
    let w = img.naturalWidth || img.width;
    let h = img.naturalHeight || img.height;
    if (w > maxDim || h > maxDim) {
      if (w > h) {
        h = Math.round((h * maxDim) / w);
        w = maxDim;
      } else {
        w = Math.round((w * maxDim) / h);
        h = maxDim;
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob(blob => {
        if (!blob) blob = file;
        photo = new File([blob], (file.name || 'photo.jpg').replace(/\.[^.]+$/, '.jpg'), {type: 'image/jpeg'});
        if (photoUrl) URL.revokeObjectURL(photoUrl);
        photoUrl = URL.createObjectURL(photo);
        document.getElementById('preview-image').src = photoUrl;
        document.getElementById('file-name').textContent = file.name || 'photo.jpg';
        document.getElementById('photo-preview').hidden = false;
        document.getElementById('drop-area').hidden = true;
        window.sfx?.play('pop');
        maxHaptic('light');
        if (typeof sourceChanged === 'function') sourceChanged();
      }, 'image/jpeg', 0.88);
    } else {
      photo = file;
      if (photoUrl) URL.revokeObjectURL(photoUrl);
      photoUrl = URL.createObjectURL(file);
      document.getElementById('preview-image').src = photoUrl;
      document.getElementById('file-name').textContent = file.name;
      document.getElementById('photo-preview').hidden = false;
      document.getElementById('drop-area').hidden = true;
      window.sfx?.play('pop');
      maxHaptic('light');
      if (typeof sourceChanged === 'function') sourceChanged();
    }
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    photo = file;
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    photoUrl = URL.createObjectURL(file);
    document.getElementById('preview-image').src = photoUrl;
    document.getElementById('file-name').textContent = file.name;
    document.getElementById('photo-preview').hidden = false;
    document.getElementById('drop-area').hidden = true;
    window.sfx?.play('pop');
    maxHaptic('light');
    if (typeof sourceChanged === 'function') sourceChanged();
  };
  img.src = url;
}
fileInput.addEventListener('change', () => {
  if (fileInput.files && fileInput.files[0]) usePhoto(fileInput.files[0]);
});
document.getElementById('remove-photo').addEventListener('click', clearPhoto);
const dropArea = document.getElementById('drop-area');
['dragenter', 'dragover'].forEach(name => dropArea.addEventListener(name, event => {
  event.preventDefault();
  dropArea.classList.add('dragging');
}));
['dragleave', 'drop'].forEach(name => dropArea.addEventListener(name, event => {
  event.preventDefault();
  dropArea.classList.remove('dragging');
}));
dropArea.addEventListener('drop', event => {
  event.preventDefault();
  const file = event.dataTransfer?.files?.[0];
  if (file) usePhoto(file);
});
window.addEventListener('paste', event => {
  const items = event.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.type && item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) {
        const photoTab = document.querySelector('.input-tab[data-source="photo"]');
        if (photoTab) photoTab.click();
        usePhoto(file);
        break;
      }
    }
  }
});
