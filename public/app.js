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

const selectMainTabBase = wireTabs('.nav-tab', 'tab', 'panel-', value => {
  const helpPanel = document.getElementById('panel-help');
  if (helpPanel) helpPanel.hidden = true;
  history.replaceState(null, '', '#' + value);
});

function selectMainTab(value) {
  const helpPanel = document.getElementById('panel-help');
  if (value === 'help') {
    document.querySelectorAll('.nav-tab').forEach(b => {
      b.classList.remove('active');
      b.setAttribute('aria-selected', 'false');
      b.setAttribute('tabindex', '-1');
    });
    document.querySelectorAll('main > section').forEach(p => {
      if (p.id !== 'panel-help') p.hidden = true;
    });
    if (helpPanel) helpPanel.hidden = false;
    history.replaceState(null, '', '#help');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  if (helpPanel) helpPanel.hidden = true;
  selectMainTabBase(value);
}

function resolveInitialTab() {
  const hashRaw = (location.hash || '').replace(/^#/, '');
  const cleanHash = hashRaw.split('?')[0].split('&')[0];
  if (['help', 'calendar', 'study'].includes(cleanHash)) {
    return cleanHash;
  }

  function findParam(params, ...keys) {
    if (!params) return null;
    for (const [k, v] of params.entries()) {
      for (const target of keys) {
        if (k.toLowerCase() === target.toLowerCase()) return v;
      }
    }
    return null;
  }

  const searchParams = new URLSearchParams(location.search);
  const hashParams = new URLSearchParams(hashRaw);
  let launchParams = null;
  try {
    const raw = window.maxLaunchData || '';
    launchParams = new URLSearchParams(raw.includes('%') ? decodeURIComponent(raw) : raw);
  } catch (e) {}

  const candidateKeys = ['webappstartparam', 'start_param', 'startparam', 'startapp', 'payload'];
  const startParam = (window.WebApp && (
    window.WebApp.initDataUnsafe?.start_param ||
    window.WebApp.initDataUnsafe?.WebAppStartParam ||
    window.WebApp.initDataUnsafe?.startParam ||
    window.WebApp.initDataUnsafe?.payload
  )) ||
  findParam(searchParams, ...candidateKeys) ||
  findParam(hashParams, ...candidateKeys) ||
  findParam(launchParams, ...candidateKeys) ||
  '';

  const val = String(startParam).toLowerCase().trim();
  if (val === 'help' || val === 'instructions' || val.includes('help')) return 'help';
  if (val === 'calendar' || val.includes('calendar')) return 'calendar';
  if (val === 'study') return 'study';
  return 'study';
}

const activeTab = resolveInitialTab();
selectMainTab(activeTab);

window.addEventListener('hashchange', () => {
  const h = (location.hash || '').replace(/^#/, '').split('?')[0];
  if (['study', 'calendar', 'help'].includes(h)) {
    selectMainTab(h);
  }
});
document.querySelector('.brand').addEventListener('click', () => selectMainTab('study'));
document.getElementById('help-back-btn')?.addEventListener('click', () => selectMainTab('study'));
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


// --- Fullscreen Zoom & Pan Viewer Engine ---
let viewerHelpIdx = 1;
let viewerZoomLevel = 1.0;
let viewerBaseScale = 1.0;
let viewerPanX = 0;
let viewerPanY = 0;
let viewerIsDragging = false;
let viewerDragStartX = 0;
let viewerDragStartY = 0;
let viewerDragInitialPanX = 0;
let viewerDragInitialPanY = 0;
let viewerPinchInitialDist = 0;
let viewerPinchInitialZoom = 1.0;

function computeViewerFitScale() {
  const stage = document.getElementById('help-viewer-stage');
  const img = document.getElementById('help-viewer-img');
  if (!stage || !img) return 1.0;
  const natW = img.naturalWidth || 1800;
  const natH = img.naturalHeight || 1272;
  const stageW = Math.max(stage.clientWidth - 20, 200);
  const stageH = Math.max(stage.clientHeight - 20, 200);
  const scaleW = stageW / natW;
  const scaleH = stageH / natH;
  return Math.min(scaleW, scaleH);
}

function applyViewerTransform(smooth = false) {
  const img = document.getElementById('help-viewer-img');
  const resetBtn = document.getElementById('help-zoom-reset');
  if (!img) return;
  const totalScale = viewerBaseScale * viewerZoomLevel;
  img.style.transition = smooth ? 'transform 0.2s cubic-bezier(0.2, 0, 0, 1)' : 'none';
  img.style.transform = `translate(${viewerPanX}px, ${viewerPanY}px) scale(${totalScale})`;
  if (resetBtn) {
    const pct = Math.round(viewerZoomLevel * 100);
    resetBtn.textContent = pct + '%';
  }
}

function setViewerZoom(newZoom, centerX = 0, centerY = 0, smooth = true) {
  const oldZoom = viewerZoomLevel;
  viewerZoomLevel = Math.max(0.7, Math.min(3.5, newZoom));
  // Adjust pan to zoom into center
  if (oldZoom !== viewerZoomLevel && (centerX !== 0 || centerY !== 0)) {
    const ratio = viewerZoomLevel / oldZoom;
    viewerPanX = centerX - (centerX - viewerPanX) * ratio;
    viewerPanY = centerY - (centerY - viewerPanY) * ratio;
  }
  // If zoomed back to fit, center image
  if (viewerZoomLevel <= 1.02) {
    viewerZoomLevel = 1.0;
    viewerPanX = 0;
    viewerPanY = 0;
  }
  applyViewerTransform(smooth);
}

function openHelpViewer(cardIdx) {
  viewerHelpIdx = Math.max(1, Math.min(5, cardIdx));
  const viewer = document.getElementById('help-viewer');
  const img = document.getElementById('help-viewer-img');
  const title = document.getElementById('help-viewer-title');
  if (!viewer || !img) return;

  title.textContent = `Карточка ${viewerHelpIdx} из 5`;
  img.src = `help/card_${viewerHelpIdx}.jpg`;
  viewer.hidden = false;
  document.body.style.overflow = 'hidden';

  function onImgReady() {
    viewerBaseScale = computeViewerFitScale();
    viewerZoomLevel = 1.0;
    viewerPanX = 0;
    viewerPanY = 0;
    applyViewerTransform(false);
  }

  if (img.complete && img.naturalWidth) {
    onImgReady();
  } else {
    img.onload = onImgReady;
  }

  if (window.WebApp && window.WebApp.BackButton) {
    window.WebApp.BackButton.show();
    window.WebApp.BackButton.onClick(closeHelpViewer);
  }
}

function closeHelpViewer() {
  const viewer = document.getElementById('help-viewer');
  if (viewer) viewer.hidden = true;
  document.body.style.overflow = '';
}

// Stage Interactions: Drag & Wheel
const stage = document.getElementById('help-viewer-stage');
if (stage) {
  stage.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    viewerIsDragging = true;
    viewerDragStartX = e.clientX;
    viewerDragStartY = e.clientY;
    viewerDragInitialPanX = viewerPanX;
    viewerDragInitialPanY = viewerPanY;
    stage.classList.add('grabbing');
  });

  window.addEventListener('mousemove', e => {
    if (!viewerIsDragging) return;
    viewerPanX = viewerDragInitialPanX + (e.clientX - viewerDragStartX);
    viewerPanY = viewerDragInitialPanY + (e.clientY - viewerDragStartY);
    applyViewerTransform(false);
  });

  window.addEventListener('mouseup', () => {
    if (viewerIsDragging) {
      viewerIsDragging = false;
      stage.classList.remove('grabbing');
    }
  });

  // Wheel zoom
  stage.addEventListener('wheel', e => {
    e.preventDefault();
    const rect = stage.getBoundingClientRect();
    const cursorX = e.clientX - rect.left - rect.width / 2;
    const cursorY = e.clientY - rect.top - rect.height / 2;
    const delta = e.deltaY < 0 ? 0.25 : -0.25;
    setViewerZoom(viewerZoomLevel + delta, cursorX, cursorY, false);
  }, { passive: false });

  // Double click to zoom in / reset
  stage.addEventListener('dblclick', e => {
    e.preventDefault();
    if (viewerZoomLevel > 1.05) {
      setViewerZoom(1.0, 0, 0, true);
    } else {
      const rect = stage.getBoundingClientRect();
      const cursorX = e.clientX - rect.left - rect.width / 2;
      const cursorY = e.clientY - rect.top - rect.height / 2;
      setViewerZoom(2.0, cursorX, cursorY, true);
    }
  });

  // Touch Support (drag and pinch)
  stage.addEventListener('touchstart', e => {
    if (e.touches.length === 1) {
      viewerIsDragging = true;
      viewerDragStartX = e.touches[0].clientX;
      viewerDragStartY = e.touches[0].clientY;
      viewerDragInitialPanX = viewerPanX;
      viewerDragInitialPanY = viewerPanY;
    } else if (e.touches.length === 2) {
      viewerIsDragging = false;
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      viewerPinchInitialDist = Math.hypot(dx, dy);
      viewerPinchInitialZoom = viewerZoomLevel;
    }
  }, { passive: false });

  stage.addEventListener('touchmove', e => {
    e.preventDefault();
    if (e.touches.length === 1 && viewerIsDragging) {
      viewerPanX = viewerDragInitialPanX + (e.touches[0].clientX - viewerDragStartX);
      viewerPanY = viewerDragInitialPanY + (e.touches[0].clientY - viewerDragStartY);
      applyViewerTransform(false);
    } else if (e.touches.length === 2 && viewerPinchInitialDist > 0) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      const ratio = dist / viewerPinchInitialDist;
      setViewerZoom(viewerPinchInitialZoom * ratio, 0, 0, false);
    }
  }, { passive: false });

  stage.addEventListener('touchend', () => {
    viewerIsDragging = false;
    viewerPinchInitialDist = 0;
  });
}

// Viewer Control Buttons
document.getElementById('help-zoom-in')?.addEventListener('click', () => {
  setViewerZoom(viewerZoomLevel + 0.35, 0, 0, true);
});
document.getElementById('help-zoom-out')?.addEventListener('click', () => {
  setViewerZoom(viewerZoomLevel - 0.35, 0, 0, true);
});
document.getElementById('help-zoom-reset')?.addEventListener('click', () => {
  if (viewerZoomLevel === 1.0) {
    setViewerZoom(1.75, 0, 0, true);
  } else {
    setViewerZoom(1.0, 0, 0, true);
  }
});
document.getElementById('help-viewer-close')?.addEventListener('click', closeHelpViewer);

document.getElementById('help-viewer-prev')?.addEventListener('click', () => {
  openHelpViewer(viewerHelpIdx > 1 ? viewerHelpIdx - 1 : 5);
});
document.getElementById('help-viewer-next')?.addEventListener('click', () => {
  openHelpViewer(viewerHelpIdx < 5 ? viewerHelpIdx + 1 : 1);
});

// Window resize updates fit scale
window.addEventListener('resize', () => {
  const viewer = document.getElementById('help-viewer');
  if (viewer && !viewer.hidden) {
    viewerBaseScale = computeViewerFitScale();
    applyViewerTransform(false);
  }
});

// Keyboard navigation
document.addEventListener('keydown', e => {
  const viewer = document.getElementById('help-viewer');
  if (!viewer || viewer.hidden) return;
  if (e.key === 'Escape') closeHelpViewer();
  else if (e.key === 'ArrowLeft') openHelpViewer(viewerHelpIdx > 1 ? viewerHelpIdx - 1 : 5);
  else if (e.key === 'ArrowRight') openHelpViewer(viewerHelpIdx < 5 ? viewerHelpIdx + 1 : 1);
  else if (e.key === '+' || e.key === '=') setViewerZoom(viewerZoomLevel + 0.35, 0, 0, true);
  else if (e.key === '-') setViewerZoom(viewerZoomLevel - 0.35, 0, 0, true);
  else if (e.key === '0') setViewerZoom(1.0, 0, 0, true);
});

// Wire card click triggers
document.querySelectorAll('.help-card-item').forEach(card => {
  const idx = parseInt(card.dataset.cardIdx, 10);
  const imgWrap = card.querySelector('.help-img-wrap');
  const zoomBtn = card.querySelector('.help-zoom-btn');
  if (imgWrap) imgWrap.addEventListener('click', () => openHelpViewer(idx));
  if (zoomBtn) zoomBtn.addEventListener('click', e => {
    e.stopPropagation();
    openHelpViewer(idx);
  });
});


// --- Help Section Quick Navigation ---
document.querySelectorAll('.help-nav-pill').forEach(pill => {
  pill.addEventListener('click', () => {
    document.querySelectorAll('.help-nav-pill').forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    const target = pill.dataset.helpTarget;
    if (target === 'all') {
      document.querySelectorAll('.help-card-item').forEach(c => {
        c.hidden = false;
        c.style.display = '';
      });
      document.querySelector('.help-cards-grid')?.scrollIntoView({behavior: 'smooth', block: 'start'});
    } else {
      const idx = parseInt(target, 10);
      document.querySelectorAll('.help-card-item').forEach(c => {
        const cIdx = parseInt(c.dataset.cardIdx, 10);
        c.hidden = cIdx !== idx;
        c.style.display = cIdx === idx ? 'block' : 'none';
      });
      const el = document.getElementById('help-card-' + target);
      if (el) el.scrollIntoView({behavior: 'smooth', block: 'start'});
    }
  });
});
