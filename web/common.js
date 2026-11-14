// Общие функции клиента и панели преподавателя
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

async function api(method, url, body) {
  const opts = { method, headers: {}, credentials: 'same-origin' };
  // токен вкладки: позволяет держать открытыми студента и преподавателя в одном браузере
  let tabToken = null;
  try { tabToken = sessionStorage.getItem('aiedu_token'); } catch (e) { }
  if (tabToken) opts.headers['Authorization'] = 'Bearer ' + tabToken;
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  let res;
  const quiet = /\/(state|live)$/.test(url);
  if (!quiet) loadbar(1);
  try {
    res = await fetch(url, opts);
  } catch (e) {
    throw new Error('Нет связи с сервером платформы');
  } finally {
    if (!quiet) loadbar(-1);
  }
  let data = null;
  const ct = res.headers.get('Content-Type') || '';
  if (ct.includes('application/json')) data = await res.json();
  if (res.status === 401 && !url.endsWith('/api/login') && location.pathname !== '/' && location.pathname !== '/index.html') {
    location.href = '/';
    throw new Error('Требуется вход');
  }
  if (!res.ok) throw new Error((data && data.error) || ('Ошибка ' + res.status));
  return data;
}

// ---------------------------------------------------------------- прогресс-полоса запросов
let _loads = 0, _loadTimer = null;
function loadbar(delta) {
  let el = document.querySelector('.loadbar');
  if (!el) { el = document.createElement('div'); el.className = 'loadbar'; document.body && document.body.appendChild(el); }
  _loads = Math.max(0, _loads + delta);
  clearTimeout(_loadTimer);
  if (_loads > 0) _loadTimer = setTimeout(() => el.classList.add('on'), 120);
  else el.classList.remove('on');
}

// ---------------------------------------------------------------- графика: иконки, матрица ИИ, курсор
const ICON_PATHS = {
  play: 'M5 3l9 5-9 5z',
  check: 'M2.5 8.5l3.5 3.5 7.5-8',
  send: 'M2 8h11M9 4l4 4-4 4',
  plus: 'M8 2.5v11M2.5 8h11',
  back: 'M14 8H3M7 4L3 8l4 4',
  close: 'M3.5 3.5l9 9M12.5 3.5l-9 9',
  logout: 'M6 2.5H2.5v11H6M10 5l3 3-3 3M13 8H6',
  book: 'M2.5 2.5h4.5v11H2.5zM9 2.5h4.5v11H9z',
  live: 'M2.5 3.5h11v7h-11zM5.5 13.5h5M8 10.5v3',
  chart: 'M2.5 13.5h11M4.5 11V7M8 11V3.5M11.5 11V8.5',
  users: 'M2 13.5V12a3 3 0 013-3h2a3 3 0 013 3v1.5M6 7a2.25 2.25 0 100-4.5A2.25 2.25 0 006 7zM11 9h.5A2.5 2.5 0 0114 11.5v2M10.5 2.6a2.25 2.25 0 010 4.3',
  settings: 'M2.5 4.5h11M2.5 11.5h11M5.5 3v3M10.5 10v3',
  shield: 'M8 2l5 2v4c0 3-2.2 5-5 6-2.8-1-5-3-5-6V4z',
  insert: 'M8 2.5v8M4.5 7L8 10.5 11.5 7M2.5 13.5h11',
  question: 'M6 6a2 2 0 114 0c0 1.5-2 1.7-2 3.2M8 12v.5',
  download: 'M8 2.5v8M4.5 7L8 10.5 11.5 7M2.5 13.5h11',
  test: 'M2.5 4.5h3M2.5 8h3M2.5 11.5h3M8 4.5l1 1 2-2M8 8h5.5M8 11.5h5.5',
  doc: 'M3.5 2.5h6l3 3v8h-9zM9.5 2.5v3h3',
  warn: 'M8 2.5l6 11H2zM8 7v3M8 11.5v.5',
  eye: 'M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8zM8 10a2 2 0 100-4 2 2 0 000 4z',
  stop: 'M4 4h8v8H4z',
  edit: 'M10.5 2.5l3 3-8 8h-3v-3z',
  trash: 'M2.5 4.5h11M6 4.5v-2h4v2M4 4.5l.7 9h6.6l.7-9',
  arrow: 'M3 8h10M9 4l4 4-4 4',
  dot: 'M7 7h2v2H7z',
};
function icon(name, cls = '') {
  return `<svg class="ic ${cls}" viewBox="0 0 16 16" aria-hidden="true"><path d="${ICON_PATHS[name] || ''}"/></svg>`;
}
function aiMx(size = 5, idle = false) {
  return `<span class="ai-mx ${idle ? 'idle' : ''}" style="--s:${size}px" aria-hidden="true">${'<i></i>'.repeat(9)}</span>`;
}
function logoMx() { return `<span class="logo-mx" aria-hidden="true">${'<i></i>'.repeat(9)}</span>`; }
const LOADING = (text = 'Загрузка') => `<div class="empty">${aiMx(7)}<span class="label">${esc(text)}</span></div>`;

// каскадное появление: дети контейнера получают --i (шаг 150 мс)
function stagger(root, max = 8) {
  if (!root) return root;
  root.classList.add('reveal');
  Array.from(root.children).forEach((c, i) => c.style.setProperty('--i', Math.min(i, max)));
  return root;
}
function pad2(n) { return String(n).padStart(2, '0'); }

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

function toast(msg, kind = '') {
  let wrap = $('.toast-wrap');
  if (!wrap) { wrap = h('<div class="toast-wrap"></div>'); document.body.appendChild(wrap); }
  const el = h(`<div class="toast ${kind}"><span>${esc(msg)}</span></div>`);
  wrap.appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 260); }, kind === 'bad' ? 6000 : 3500);
}

// Мини-рендер markdown для ответов агента: блоки кода, `код`, **жирный**, списки, абзацы
function renderMd(text, opts = {}) {
  const parts = [];
  const re = /```[ \t]*([\w+#-]*)[ \t]*\n([\s\S]*?)```/g;
  let last = 0, m, blockIdx = 0;
  while ((m = re.exec(text))) {
    parts.push({ t: 'text', v: text.slice(last, m.index) });
    parts.push({ t: 'code', lang: m[1], v: m[2].replace(/\n$/, ''), idx: blockIdx++ });
    last = m.index + m[0].length;
  }
  parts.push({ t: 'text', v: text.slice(last) });
  let html = '';
  for (const p of parts) {
    if (p.t === 'code') {
      const btn = opts.codeButton ? opts.codeButton(p) : '';
      html += `<div class="codeblock"><pre><code>${esc(p.v)}</code></pre>${btn}</div>`;
    } else {
      html += inlineMd(p.v);
    }
  }
  return html;
}

function inlineMd(s) {
  const lines = s.split('\n');
  let html = '', list = null, para = [];
  const flushPara = () => { if (para.length) { html += '<p>' + para.join('<br>') + '</p>'; para = []; } };
  const flushList = () => { if (list) { html += `<${list.t}>` + list.items.map(i => `<li>${i}</li>`).join('') + `</${list.t}>`; list = null; } };
  const fmt = t => esc(t)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[\s(])\*([^*\s][^*]*)\*(?=[\s).,!?]|$)/g, '$1<i>$2</i>');
  for (const raw of lines) {
    const line = raw.trimEnd();
    let m;
    if ((m = line.match(/^\s*[-*•]\s+(.*)$/))) {
      flushPara(); if (!list || list.t !== 'ul') { flushList(); list = { t: 'ul', items: [] }; } list.items.push(fmt(m[1]));
    } else if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
      flushPara(); if (!list || list.t !== 'ol') { flushList(); list = { t: 'ol', items: [] }; } list.items.push(fmt(m[1]));
    } else if ((m = line.match(/^#{1,4}\s+(.*)$/))) {
      flushPara(); flushList(); html += `<p><b>${fmt(m[1])}</b></p>`;
    } else if (!line.trim()) {
      flushPara(); flushList();
    } else {
      flushList(); para.push(fmt(line));
    }
  }
  flushPara(); flushList();
  return html;
}

function fmtTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
function fmtDateTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts * 1000);
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
function ago(ts) {
  if (!ts) return '—';
  const s = Math.max(0, Date.now() / 1000 - ts);
  if (s < 60) return Math.floor(s) + ' с назад';
  if (s < 3600) return Math.floor(s / 60) + ' мин назад';
  if (s < 86400) return Math.floor(s / 3600) + ' ч назад';
  return fmtDateTime(ts);
}

const MODE_TITLES = { silent: 'Молчание', explain: 'Объяснение', hints: 'Подсказки', fragments: 'Фрагменты', free: 'Свободный' };
// режимы нумеруются по нарастанию свободы агента — номер служит графическим элементом
const MODE_ICONS = { silent: '01', explain: '02', hints: '03', fragments: '04', free: '05' };
const MODE_HELP = {
  silent: 'Агент не отвечает, работа только записывается',
  explain: 'Объясняет понятия и ошибки, код не пишет',
  hints: 'Наводящие вопросы и пошаговые подсказки',
  fragments: 'Пишет небольшие фрагменты кода с проверкой понимания',
  free: 'Пишет код без ограничений',
};
const LANG_TITLES = { python: 'Python', cpp: 'C++' };

function modal(html, { wide = false, closable = true } = {}) {
  const back = h(`<div class="modal-back"><div class="modal ${wide ? 'wide' : ''}">${html}</div></div>`);
  document.body.appendChild(back);
  const close = () => back.remove();
  if (closable) {
    back.addEventListener('mousedown', e => { if (e.target === back) close(); });
    $$('[data-close]', back).forEach(b => b.addEventListener('click', close));
  }
  return { el: back, close };
}

function confirmDialog(title, text, okText = 'Да', danger = false) {
  return new Promise(resolve => {
    const m = modal(`<h2>${esc(title)}</h2><div>${text}</div>
      <div class="actions"><button data-no>Отмена</button><button class="${danger ? 'danger solid' : 'primary'}" data-yes>${esc(okText)}</button></div>`);
    $('[data-no]', m.el).onclick = () => { m.close(); resolve(false); };
    $('[data-yes]', m.el).onclick = () => { m.close(); resolve(true); };
  });
}

async function logout() {
  try { await api('POST', '/api/logout'); } catch (e) { }
  try { sessionStorage.removeItem('aiedu_token'); } catch (e) { }
  location.href = '/';
}

function isDark() { return true; }

// монохромная тема редактора Monaco в цветах платформы
function defineMonoTheme(monaco) {
  monaco.editor.defineTheme('mono', {
    base: 'vs-dark', inherit: false,
    rules: [
      { token: '', foreground: 'D8D8D4' },
      { token: 'comment', foreground: '7E7E84', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'F5F5F2', fontStyle: 'bold' },
      { token: 'string', foreground: 'B4B4B0' },
      { token: 'number', foreground: 'C8C8C4' },
      { token: 'type', foreground: 'F5F5F2' },
      { token: 'delimiter', foreground: '8A8A90' },
      { token: 'operator', foreground: 'A1A1A6' },
    ],
    colors: {
      'editor.background': '#0B0B0C', 'editor.foreground': '#D8D8D4',
      'editorLineNumber.foreground': '#4A4A50', 'editorLineNumber.activeForeground': '#F5F5F2',
      'editor.lineHighlightBackground': '#141416', 'editor.lineHighlightBorder': '#00000000',
      'editor.selectionBackground': '#3A3A40', 'editor.inactiveSelectionBackground': '#26262A',
      'editorCursor.foreground': '#F5F5F2', 'editorIndentGuide.background1': '#1E1E22',
      'editorWhitespace.foreground': '#2A2A2E', 'editorWidget.background': '#111113', 'editorWidget.border': '#2A2A2E',
      'editorSuggestWidget.background': '#111113', 'editorSuggestWidget.border': '#2A2A2E',
      'editorSuggestWidget.selectedBackground': '#F5F5F2', 'editorSuggestWidget.selectedForeground': '#0B0B0C',
      'editorHoverWidget.background': '#111113', 'editorHoverWidget.border': '#2A2A2E',
      'scrollbarSlider.background': '#2A2A2E80', 'scrollbarSlider.hoverBackground': '#3A3A3F',
      'editorBracketMatch.background': '#2A2A2E', 'editorBracketMatch.border': '#5A5A60',
      'focusBorder': '#00000000',
    },
  });
}
