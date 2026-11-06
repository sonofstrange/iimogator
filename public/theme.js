let darkTheme = false;
try {
  darkTheme = localStorage.getItem('iimogator-theme') === 'dark';
} catch (_) {}

function applyTheme() {
  document.documentElement.classList.toggle('dark-theme', darkTheme);
  document.documentElement.classList.toggle('light-theme', !darkTheme);
  const link = document.getElementById('light-theme') || document.getElementById('classic-theme');
  if (link) {
    link.disabled = darkTheme;
    link.media = darkTheme ? 'not all' : 'all';
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = darkTheme ? '#08071d' : '#968dc4';

  const button = document.getElementById('theme-toggle');
  if (!button) return;

  button.setAttribute('aria-label', darkTheme ? 'Включить светлую тему' : 'Включить тёмную тему');
  button.title = darkTheme ? 'Включить светлую тему' : 'Включить тёмную тему';
  const moon = button.querySelector('.theme-moon');
  const sun = button.querySelector('.theme-sun');
  if (moon) moon.toggleAttribute('hidden', darkTheme);
  if (sun) sun.toggleAttribute('hidden', !darkTheme);

  if (!button._bound) {
    button._bound = true;
    button.onclick = (e) => {
      e.preventDefault();
      darkTheme = !darkTheme;
      applyTheme();
      try { localStorage.setItem('iimogator-theme', darkTheme ? 'dark' : 'light'); } catch (_) {}
    };
  }
}

applyTheme();
document.addEventListener('DOMContentLoaded', applyTheme);
window.addEventListener('load', applyTheme);
