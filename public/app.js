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
let photos = [];
let photoUrls = [];

function getPhotos() {
  return photos;
}
window.getPhotos = getPhotos;

function renderPhotosList() {
  const preview = document.getElementById('photo-preview');
  const list = document.getElementById('photo-list');
  const countEl = document.getElementById('photo-count');
  if (!preview) return;
  if (!photos.length) {
    preview.hidden = true;
    if (list) list.replaceChildren();
    if (countEl) countEl.textContent = '';
    return;
  }
  preview.hidden = false;
  if (countEl) countEl.textContent = `Выбрано фото: ${photos.length} / 10`;
  if (list) {
    list.replaceChildren();
    photos.forEach((f, idx) => {
      const item = document.createElement('div');
      item.className = 'photo-item';
      const img = document.createElement('img');
      img.src = photoUrls[idx];
      img.alt = f.name;
      const name = document.createElement('span');
      name.textContent = f.name;
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'small-button';
      del.textContent = '×';
      del.title = 'Удалить это фото';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        removePhotoAt(idx);
      });
      item.append(img, name, del);
      list.append(item);
    });
  }
  const firstImg = document.getElementById('preview-image');
  if (firstImg && photoUrls[0]) firstImg.src = photoUrls[0];
  const nameEl = document.getElementById('file-name');
  if (nameEl) nameEl.textContent = photos.length === 1 ? photos[0].name : `${photos.length} фото выбрано`;
}

function removePhotoAt(idx) {
  if (photoUrls[idx]) URL.revokeObjectURL(photoUrls[idx]);
  photos.splice(idx, 1);
  photoUrls.splice(idx, 1);
  renderPhotosList();
  window.sfx?.play('click');
  maxHaptic('light');
  if (typeof sourceChanged === 'function') sourceChanged();
}

function clearPhoto() {
  photoUrls.forEach(u => URL.revokeObjectURL(u));
  photoUrls = [];
  photos = [];
  fileInput.value = '';
  renderPhotosList();
  document.getElementById('file-error').textContent = '';
  window.sfx?.play('click');
  if (typeof sourceChanged === 'function') sourceChanged();
}

function processImageFile(file) {
  return new Promise((resolve) => {
    const isImage = (file.type && file.type.startsWith('image/')) || /\.(jpe?g|png|webp|bmp|gif|heic)$/i.test(file.name || '');
    if (!isImage) return resolve(null);
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
          const processed = new File([blob], (file.name || 'photo.jpg').replace(/\.[^.]+$/, '.jpg'), {type: 'image/jpeg'});
          resolve(processed);
        }, 'image/jpeg', 0.88);
      } else {
        resolve(file);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(file);
    };
    img.src = url;
  });
}

async function usePhotos(fileList) {
  const error = document.getElementById('file-error');
  if (error) error.textContent = '';
  const files = Array.from(fileList || []);
  if (!files.length) return;
  for (const file of files) {
    if (photos.length >= 10) break;
    const processed = await processImageFile(file);
    if (processed) {
      photos.push(processed);
      photoUrls.push(URL.createObjectURL(processed));
    }
  }
  renderPhotosList();
  window.sfx?.play('pop');
  maxHaptic('light');
  if (typeof sourceChanged === 'function') sourceChanged();
}

fileInput.addEventListener('change', () => {
  if (fileInput.files && fileInput.files.length) {
    usePhotos(fileInput.files);
    fileInput.value = '';
  }
});

const removePhotoBtn = document.getElementById('remove-photo');
if (removePhotoBtn) removePhotoBtn.addEventListener('click', clearPhoto);

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
  const dropped = event.dataTransfer?.files;
  if (dropped && dropped.length) usePhotos(dropped);
});

window.addEventListener('paste', event => {
  const items = event.clipboardData?.items;
  if (!items) return;
  const pastedFiles = [];
  for (const item of items) {
    if (item.type && item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) pastedFiles.push(file);
    }
  }
  if (pastedFiles.length) {
    const photoTab = document.querySelector('.input-tab[data-source="photo"]');
    if (photoTab) photoTab.click();
    usePhotos(pastedFiles);
  }
});

function initAutoResize() {
  const areas = document.querySelectorAll('textarea');
  areas.forEach(t => {
    const resize = () => {
      t.style.height = 'auto';
      t.style.height = Math.max(t.scrollHeight + 4, 70) + 'px';
    };
    t.addEventListener('input', resize);
  });
}
document.addEventListener('DOMContentLoaded', initAutoResize);
