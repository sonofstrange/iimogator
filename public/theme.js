const lightTheme = document.getElementById('light-theme');
let darkTheme = false;
try { darkTheme = localStorage.getItem('iimogator-theme') === 'dark'; } catch (_) {}

function applyTheme() {
  lightTheme.disabled = darkTheme;
  document.querySelector('meta[name="theme-color"]').content = darkTheme ? '#08071d' : '#a79cdb';
  const button = document.getElementById('theme-toggle');
  if (!button) return;
  button.setAttribute('aria-label', darkTheme ? 'Включить светлую тему' : 'Включить тёмную тему');
  button.title = darkTheme ? 'Включить светлую тему' : 'Включить тёмную тему';
  button.querySelector('.theme-moon').toggleAttribute('hidden', darkTheme);
  button.querySelector('.theme-sun').toggleAttribute('hidden', !darkTheme);
}

applyTheme();
document.addEventListener('DOMContentLoaded', () => {
  applyTheme();
  document.getElementById('theme-toggle').addEventListener('click', () => {
    darkTheme = !darkTheme;
    applyTheme();
    try { localStorage.setItem('iimogator-theme', darkTheme ? 'dark' : 'light'); } catch (_) {}
  });
});
