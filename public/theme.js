const themes = ['soft', 'classic', 'dark'];
const themeNames = {
  soft: 'Мягкая',
  classic: 'Классическая',
  dark: 'Тёмная',
};

let currentTheme = 'soft';
try {
  const saved = localStorage.getItem('iimogator-theme');
  if (themes.includes(saved)) {
    currentTheme = saved;
  } else if (saved === 'light') {
    currentTheme = 'soft';
  }
} catch (_) {}

function applyTheme() {
  document.documentElement.setAttribute('data-theme', currentTheme);
  if (document.body) document.body.setAttribute('data-theme', currentTheme);

  const softCss = document.getElementById('soft-theme');
  const classicCss = document.getElementById('classic-theme');
  if (softCss) softCss.disabled = currentTheme !== 'soft';
  if (classicCss) classicCss.disabled = currentTheme !== 'classic';

  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) {
    metaTheme.content = currentTheme === 'dark' ? '#08071d' : (currentTheme === 'soft' ? '#9c91ce' : '#a79cdb');
  }

  const button = document.getElementById('theme-toggle');
  if (!button) return;

  const nextIndex = (themes.indexOf(currentTheme) + 1) % themes.length;
  const nextTheme = themes[nextIndex];
  const label = `Тема: ${themeNames[currentTheme]} (переключить на: ${themeNames[nextTheme]})`;
  button.setAttribute('aria-label', label);
  button.title = label;

  const moon = button.querySelector('.theme-moon');
  const sun = button.querySelector('.theme-sun');
  const star = button.querySelector('.theme-star');

  if (moon) moon.toggleAttribute('hidden', currentTheme !== 'dark');
  if (sun) sun.toggleAttribute('hidden', currentTheme !== 'classic');
  if (star) star.toggleAttribute('hidden', currentTheme !== 'soft');
}

applyTheme();

document.addEventListener('DOMContentLoaded', () => {
  applyTheme();
  const toggle = document.getElementById('theme-toggle');
  if (toggle) {
    toggle.addEventListener('click', () => {
      const nextIndex = (themes.indexOf(currentTheme) + 1) % themes.length;
      currentTheme = themes[nextIndex];
      applyTheme();
      try { localStorage.setItem('iimogator-theme', currentTheme); } catch (_) {}
    });
  }
});
