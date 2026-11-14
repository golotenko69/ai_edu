// Универсальный ИИ-агент: проекты, файлы, запуск, агент с инструментами
let ME = null, P = null, LIST = null;
let editor = null, monacoRef = null, curPath = null, dirty = false, loadingFile = false;
let run = null, runTimer = null, stepsEl = null, changedFiles = new Set();

const WS_HELP = {
  explain: 'Читает проект, запускает код, объясняет и делает ревью. Файлы не меняет, готовый код не пишет.',
  hints: 'Читает проект и запускает код, ведёт наводящими вопросами. Файлы не меняет.',
  agent: 'Полноценный агент: создаёт и правит файлы, запускает, отлаживает, доводит задачу до конца.',
};
const WS_NUM = { explain: '01', hints: '02', agent: '03' };
const TOOL_RU = { list_files: 'файлы', read_file: 'чтение', search: 'поиск', run_file: 'запуск',
  write_file: 'запись', replace_in_file: 'правка', delete_file: 'удаление' };
const TOOL_IC = { list_files: 'doc', read_file: 'eye', search: 'eye', run_file: 'play', write_file: 'edit',
  replace_in_file: 'edit', delete_file: 'trash' };

(async function init() {
  try { ME = (await api('GET', '/api/me')).user; } catch (e) { location.href = '/'; return; }
  $('#userName').textContent = ME.name + (ME.group ? ' · ' + ME.group : '');
  const back = ME.role === 'student' ? '<a href="/student">Задания</a>' : '<a href="/teacher">Панель</a>';
  $('#topnav').innerHTML = `<a href="/agent" class="active">Агент</a>${back}`;
  $('#btnNewFile').innerHTML = icon('plus') + 'Файл';
  $('#btnSave').innerHTML = icon('check') + 'Сохранить';
  $('#btnRun').innerHTML = icon('play') + 'Запустить';
  $('#askBtn').innerHTML = 'Отправить' + icon('send');
  $('#btnStop').innerHTML = icon('stop') + 'Стоп';
  window.addEventListener('hashchange', route);
  route();
})();

function route() {
  const m = location.hash.match(/^#p\/(\d+)/);
  if (m) openProject(+m[1]); else showHome();
}

// ================================================================== главная
async function showHome() {
  stopRunPoll();
  P = null;
  $('#ideView').classList.add('hidden');
  const home = $('#homeView');
  home.classList.remove('hidden');
  $('#modeBadge').classList.add('hidden');
  home.innerHTML = LOADING('Загрузка проектов');
  LIST = await api('GET', '/api/ws/projects');
  const cap = LIST.max_mode;
  const isStudent = ME.role === 'student';
  home.innerHTML = `<div class="wrap">
    <section class="hero">
      <div class="t"><span class="eyebrow">Универсальный ИИ-агент</span>
        <h1>Любая задача по коду: от вопроса до проекта<span class="caret"></span></h1>
        <p>Агент работает с файлами проекта: читает, запускает, ищет ошибки${cap === 'agent' ? ', пишет и правит код' : ''}. ${isStudent ? 'Границы его помощи задаёт преподаватель.' : 'Режим агента вы выбираете сами для каждого проекта.'}</p></div>
      <div class="side"><span class="num">${pad2(LIST.projects.length)}</span><span class="label muted">проектов</span></div>
    </section>
    <div class="modes-strip">${Object.keys(WS_NUM).map(m => `
      <div class="${(isStudent ? m === cap : true) ? 'on' : ''}"><span class="num">${WS_NUM[m]}</span><b>${LIST.modes[m]}</b><p>${WS_HELP[m]}</p>
        ${isStudent && m === cap ? '<span class="badge ok lock">ваш режим</span>' : ''}
        ${isStudent && m !== cap ? '<span class="badge lock">задаёт преподаватель</span>' : ''}</div>`).join('')}
    </div>
    <span class="eyebrow">Новый проект</span>
    <form class="new-proj" id="newProj">
      <input id="npTitle" placeholder="Название: например, «Парсер расписания» или «Курсовая: банк»" required>
      <select id="npLang"><option value="python">Python</option><option value="cpp">C++</option><option value="empty">Пустой</option></select>
      <button class="primary" type="submit">${icon('plus')}Создать</button>
    </form>
    <div class="proj-list" id="projList"></div>
    <span class="eyebrow" style="margin-top:56px;display:block">С чего начать</span>
    <div class="ideas" id="ideas"></div>
  </div>`;
  const list = $('#projList');
  if (!LIST.projects.length) list.innerHTML = '<div class="empty">Проектов пока нет. Создайте первый — агент поможет с любой задачей.</div>';
  LIST.projects.forEach((p, i) => {
    const row = h(`<div class="proj-row">
      <span class="num">${pad2(i + 1)}</span>
      <div><div class="title">${esc(p.title)}</div><div class="label muted">${LANG_TITLES[p.language] || p.language} · ${p.files} файлов</div></div>
      <div class="meta label muted">${p.requests} запросов<br>${ago(p.updated_at)}</div>
      <div class="mode"><span class="badge">${esc(LIST.modes[p.mode || cap] || '')}</span></div>
      <span class="go">${icon('arrow')}</span></div>`);
    row.onclick = () => location.hash = '#p/' + p.id;
    list.appendChild(row);
  });
  stagger(list);
  $('#newProj').onsubmit = async e => {
    e.preventDefault();
    const r = await api('POST', '/api/ws/projects', { title: $('#npTitle').value, language: $('#npLang').value });
    location.hash = '#p/' + r.id;
  };
  const ideas = [
    ['Разобраться', 'Объясни, как работает рекурсия, на примере обхода папок'],
    ['Отладка', 'Программа падает с ошибкой — найди причину и объясни'],
    ['Проект', 'Сделай консольный трекер задач с сохранением в файл'],
    ['Ревью', 'Проверь мой код: стиль, ошибки, что можно улучшить'],
    ['Алгоритмы', 'Сравни сортировку пузырьком и быструю сортировку на тестах'],
    ['Курсовая', 'Помоги спланировать структуру курсового проекта'],
  ];
  const box = $('#ideas');
  ideas.forEach(([k, t], i) => {
    const b = h(`<button><span class="label">${pad2(i + 1)} · ${k}</span>${esc(t)}</button>`);
    b.onclick = async () => {
      const r = await api('POST', '/api/ws/projects', { title: k + ': ' + t.slice(0, 40), language: 'python' });
      sessionStorage.setItem('aiedu_firstmsg', t);
      location.hash = '#p/' + r.id;
    };
    box.appendChild(b);
  });
  stagger(home.firstElementChild, 6);
}

// ================================================================== проект
async function openProject(id) {
  stopRunPoll();
  $('#homeView').classList.add('hidden');
  $('#ideView').classList.remove('hidden');
  try { P = await api('GET', `/api/ws/projects/${id}`); } catch (e) { toast(e.message, 'bad'); location.hash = ''; return; }
  changedFiles = new Set();
  $('#projTitle').textContent = P.title;
  $('#projOwner').textContent = P.readonly ? `Проект студента · ${P.owner.name}` : `Проект · ${LANG_TITLES[P.language] || P.language}`;
  $('#langInfo').innerHTML = Object.entries(P.languages).map(([k, x]) => `<span class="badge ${x.available ? '' : 'warn'}">${LANG_TITLES[k]}${x.available ? '' : ': нет компилятора'}</span>`).join(' ');
  renderMode();
  renderTree();
  renderChat();
  renderQuick();
  await ensureEditor();
  const first = P.files.find(f => /\.(py|cpp)$/.test(f.path)) || P.files[0];
  curPath = null;
  if (first) await openFile(first.path); else { editor.setValue(''); $('#curFile').textContent = 'нет файлов'; }
  const ro = P.readonly;
  ['#askInput', '#askBtn', '#btnSave', '#btnRun', '#btnNewFile'].forEach(s => $(s).disabled = ro);
  editor.updateOptions({ readOnly: ro });
  $('#askHint').textContent = ro ? 'Просмотр: проект принадлежит студенту' : 'Агент видит все файлы проекта';
  if (P.active_run) attachRun(P.active_run);
  const first_msg = sessionStorage.getItem('aiedu_firstmsg');
  if (first_msg && !ro) { sessionStorage.removeItem('aiedu_firstmsg'); $('#askInput').value = first_msg; }
}

function renderMode() {
  const m = P.effective_mode;
  $('#modeBadge').textContent = `агент ${WS_NUM[m]} · ${P.modes[m]}`;
  $('#modeBadge').classList.remove('hidden');
  $('#modeInfo').innerHTML = `<span class="num">${WS_NUM[m]}</span><div><b>${P.modes[m]}</b>${esc(WS_HELP[m])}${!P.can_choose && !P.readonly ? '<div class="label" style="margin-top:4px">режим задаёт преподаватель</div>' : ''}</div>`;
  const box = $('#modeBox');
  if (P.can_choose) {
    box.innerHTML = `<select id="modeSel" title="Режим агента для проекта">${Object.keys(P.modes).map(k => `<option value="${k}" ${k === m ? 'selected' : ''}>${WS_NUM[k]} ${P.modes[k]}</option>`).join('')}</select>`;
    $('#modeSel').onchange = async e => {
      await api('PUT', `/api/ws/projects/${P.id}`, { mode: e.target.value });
      P.effective_mode = e.target.value; P.mode = e.target.value;
      renderMode(); renderQuick();
      const mi = $('#modeInfo'); mi.style.animation = 'none'; void mi.offsetWidth; mi.style.animation = 'flash 700ms var(--ease)';
      toast('Режим агента: ' + P.modes[e.target.value]);
    };
  } else box.innerHTML = '';
}

function renderTree() {
  const tree = $('#fileTree');
  tree.innerHTML = '';
  let lastDir = '';
  for (const f of P.files) {
    const dir = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '';
    if (dir !== lastDir && dir) tree.appendChild(h(`<div class="dir label">${esc(dir)}/</div>`));
    lastDir = dir;
    const name = dir ? f.path.slice(dir.length + 1) : f.path;
    const el = h(`<div class="f ${f.path === curPath ? 'active' : ''}" title="${esc(f.path)} · ${f.size} байт">
      <span class="nm">${esc(name)}</span>${changedFiles.has(f.path) ? '<span class="chg" title="изменён агентом"></span>' : ''}
      ${P.readonly ? '' : `<button class="del sm" title="Удалить">${icon('close')}</button>`}</div>`);
    el.onclick = e => { if (!e.target.closest('.del')) openFile(f.path); };
    const del = $('.del', el);
    if (del) del.onclick = async () => {
      if (!await confirmDialog('Удалить файл?', `<code>${esc(f.path)}</code> будет удалён из проекта.`, 'Удалить', true)) return;
      await api('POST', `/api/ws/projects/${P.id}/file/delete`, { path: f.path });
      if (curPath === f.path) { curPath = null; editor.setValue(''); }
      await refreshFiles();
    };
    tree.appendChild(el);
  }
  if (!P.files.length) tree.innerHTML = '<div class="empty small">Файлов нет</div>';
}

async function refreshFiles() {
  const fresh = await api('GET', `/api/ws/projects/${P.id}`);
  P.files = fresh.files;
  renderTree();
}

function langFor(path) {
  if (/\.py$/.test(path)) return 'python';
  if (/\.(cpp|cc|cxx|h|hpp)$/.test(path)) return 'cpp';
  if (/\.md$/.test(path)) return 'markdown';
  if (/\.json$/.test(path)) return 'json';
  if (/\.(js|mjs)$/.test(path)) return 'javascript';
  if (/\.html?$/.test(path)) return 'html';
  if (/\.css$/.test(path)) return 'css';
  return 'plaintext';
}

async function openFile(path, force = false) {
  if (dirty && curPath && !force && path !== curPath) await saveFile(true);
  const r = await api('GET', `/api/ws/projects/${P.id}/file?path=${encodeURIComponent(path)}`);
  loadingFile = true;
  monacoRef.editor.setModelLanguage(editor.getModel(), langFor(path));
  const pos = path === curPath ? editor.getPosition() : null;
  editor.setValue(r.content);
  if (pos) editor.setPosition(pos);
  loadingFile = false;
  curPath = path; dirty = false;
  $('#curFile').textContent = path;
  $('#dirtyMark').textContent = '';
  $('#btnRun').disabled = P.readonly || !/\.(py|cpp|cc|cxx)$/.test(path);
  renderTree();
}

async function saveFile(silent = false) {
  if (!curPath || P.readonly) return;
  await api('PUT', `/api/ws/projects/${P.id}/file`, { path: curPath, content: editor.getValue() });
  dirty = false; $('#dirtyMark').textContent = '';
  if (!silent) toast('Сохранено: ' + curPath);
}

function ensureEditor() {
  if (editor) return Promise.resolve();
  return new Promise(resolve => {
    require.config({ paths: { vs: '/vendor/vs' } });
    require(['vs/editor/editor.main'], () => {
      monacoRef = monaco;
      defineMonoTheme(monaco);
      editor = monaco.editor.create($('#editor'), {
        value: '', language: 'python', theme: 'mono', automaticLayout: true, fontSize: 14, lineHeight: 22,
        fontFamily: '"JetBrains Mono", Consolas, monospace', minimap: { enabled: false }, tabSize: 4,
        cursorStyle: 'block', cursorBlinking: 'phase', padding: { top: 14 }, scrollBeyondLastLine: false,
      });
      editor.onDidChangeModelContent(() => { if (!loadingFile) { dirty = true; $('#dirtyMark').textContent = '· изменён'; } });
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => saveFile());
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => runCurrent());
      resolve();
    });
  });
}

$('#btnSave').onclick = () => saveFile();
$('#btnRun').onclick = () => runCurrent();
$('#btnNewFile').onclick = async () => {
  const m = modal(`<span class="eyebrow">Новый файл</span><h2>Имя файла</h2>
    <input id="nfName" placeholder="например utils.py или data/input.txt">
    <div class="actions"><button data-close>Отмена</button><button class="primary" id="nfOk">Создать</button></div>`);
  $('#nfName', m.el).focus();
  const go = async () => {
    const name = $('#nfName', m.el).value.trim();
    if (!name) return;
    try {
      await api('PUT', `/api/ws/projects/${P.id}/file`, { path: name, content: '' });
      m.close(); await refreshFiles(); await openFile(name);
    } catch (e) { toast(e.message, 'bad'); }
  };
  $('#nfOk', m.el).onclick = go;
  $('#nfName', m.el).onkeydown = e => { if (e.key === 'Enter') go(); };
};

function showTab(name) {
  $$('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  $$('.tab-body').forEach(b => b.classList.toggle('hidden', b.dataset.body !== name));
}
$$('.tab').forEach(b => b.onclick = () => showTab(b.dataset.tab));

async function runCurrent() {
  if (!curPath || P.readonly) return;
  if (dirty) await saveFile(true);
  showTab('out');
  const out = $('#output');
  out.className = 'console muted'; out.innerHTML = 'Выполняется<span class="caret"></span>';
  $('#runProgress').classList.remove('hidden');
  try {
    const r = await api('POST', `/api/ws/projects/${P.id}/run`, { path: curPath, stdin: $('#stdin').value });
    out.className = 'console';
    out.innerHTML = (r.stdout ? esc(r.stdout) : '') + (r.stderr ? `<span class="err">${esc(r.stderr)}</span>` : '')
      + `\n<span class="muted">— код ${r.exit_code} · ${r.time} с</span>`;
  } catch (e) { out.innerHTML = `<span class="err">${esc(e.message)}</span>`; }
  finally { $('#runProgress').classList.add('hidden'); }
}

// ================================================================== чат и шаги агента
function addMsg(role, text, extra = '') {
  const el = role === 'user'
    ? h(`<div class="msg user">${esc(text)}</div>`)
    : h(`<div class="msg agent md"><div class="who label">${aiMx(3, true)}агент${extra}</div>${renderMd(text)}</div>`);
  $('#chat').appendChild(el); scrollChat();
  return el;
}
function addSystem(text) { $('#chat').appendChild(h(`<div class="msg system">${esc(text)}</div>`)); scrollChat(); }
function scrollChat() { const c = $('#chat'); c.scrollTop = c.scrollHeight; }

function stepEl(s) {
  if (s.kind === 'tool_call') {
    const args = Object.entries(s.args || {}).filter(([k]) => k !== 'content').map(([k, v]) => `${k}=${String(v).slice(0, 80)}`).join(' ');
    return h(`<div class="step ${['write_file', 'replace_in_file', 'delete_file'].includes(s.name) ? 'write' : ''}">${icon(TOOL_IC[s.name] || 'dot')}<div><span class="k">${TOOL_RU[s.name] || esc(s.name)}</span> <span class="s">${esc(args)}</span></div></div>`);
  }
  if (s.kind === 'tool_result') {
    return h(`<div class="step">${icon('check')}<div><span class="s">${esc(s.summary || '')}</span>${s.preview ? `<details><summary>результат</summary><pre>${esc(s.preview)}</pre></details>` : ''}</div></div>`);
  }
  if (s.kind === 'note') return h(`<div class="step note">${icon('warn')}<div class="s">${esc(s.text)}</div></div>`);
  if (s.kind === 'error') return h(`<div class="step err">${icon('warn')}<div class="s">${esc(s.text)}</div></div>`);
  if (s.kind === 'say') return h(`<div class="step note">${icon('dot')}<div>${esc(s.text)}</div></div>`);
  return null;
}

function renderChat() {
  const chat = $('#chat');
  chat.innerHTML = '';
  if (!P.chat.length) {
    addSystem(P.readonly ? 'Студент ещё не обращался к агенту в этом проекте.' : 'Опишите задачу — агент сам изучит проект и возьмётся за дело.');
    return;
  }
  let steps = null;
  for (const e of P.chat) {
    if (e.type === 'chat_user') { addMsg('user', e.text); steps = null; }
    else if (e.type === 'tool') {
      if (!steps) { steps = h('<div class="steps"></div>'); chat.appendChild(steps); }
      const el = stepEl({ kind: 'tool_call', name: e.name, args: e.args });
      steps.appendChild(el);
      steps.appendChild(h(`<div class="step"><span></span><span class="s">${esc(e.summary || '')}</span></div>`));
    } else if (e.type === 'chat_agent') { addMsg('agent', e.text, ` · ${esc(P.modes[e.mode] || '')}`); steps = null; }
    else if (e.type === 'bypass_attempt') addSystem('Попытка обойти режим агента записана.');
    else if (e.type === 'agent_violation') addSystem('Проверка ответа скрыла код, недопустимый в этом режиме.');
  }
  scrollChat();
}

function renderQuick() {
  const q = $('#quick');
  if (P.readonly) { q.innerHTML = ''; return; }
  const m = P.effective_mode;
  const items = m === 'agent'
    ? ['Изучи проект и предложи план', 'Запусти и исправь ошибки', 'Добавь тесты', 'Объясни, что ты изменил']
    : ['Объясни, как устроен проект', 'Почему программа падает?', 'Сделай ревью кода', 'С чего мне начать?'];
  q.innerHTML = items.map(t => `<button type="button">${esc(t)}</button>`).join('');
  $$('button', q).forEach(b => b.onclick = () => { $('#askInput').value = b.textContent; $('#askInput').focus(); });
}

async function ask() {
  if (!P || P.readonly || run) return;
  const text = $('#askInput').value.trim();
  if (!text) return;
  if (dirty) await saveFile(true);
  $('#askInput').value = '';
  addMsg('user', text);
  try {
    const r = await api('POST', `/api/ws/projects/${P.id}/agent`, { message: text });
    attachRun(r.run_id);
  } catch (e) { addSystem(e.message); }
}

function attachRun(runId) {
  run = { id: runId, after: 0 };
  stepsEl = h('<div class="steps"></div>');
  $('#chat').appendChild(stepsEl);
  const thinking = h(`<div class="thinking fade" id="thinking">${aiMx(5)}<span class="label">агент работает<span class="caret"></span></span></div>`);
  $('#chat').appendChild(thinking);
  scrollChat();
  $('#agentMx').classList.remove('idle');
  $('#askBtn').disabled = true;
  $('#btnStop').classList.remove('hidden');
  runTimer = setInterval(pollRun, 700);
  pollRun();
}

async function pollRun() {
  if (!run) return;
  let r;
  try { r = await api('GET', `/api/ws/runs/${run.id}?after=${run.after}`); } catch (e) { stopRunPoll(); return; }
  run.after = r.total;
  let filesChanged = false;
  for (const s of r.steps) {
    if (s.kind === 'message') {
      $('#thinking')?.remove();
      addMsg('agent', s.text, ` · ${esc(P.modes[r.mode] || '')}`);
      continue;
    }
    if (s.kind === 'tool_result' && s.changed) filesChanged = true;
    if (s.kind === 'tool_call' && ['write_file', 'replace_in_file', 'delete_file'].includes(s.name) && s.args?.path) changedFiles.add(s.args.path);
    const el = stepEl(s);
    if (el) { stepsEl.appendChild(el); }
    const th = $('#thinking'); if (th) $('#chat').appendChild(th);
    scrollChat();
  }
  if (filesChanged) {
    await refreshFiles();
    if (curPath && changedFiles.has(curPath)) {
      if (!dirty) await openFile(curPath, true);
      else toast('Агент изменил открытый файл. Сохраните свои правки или откройте файл заново.', 'bad');
    }
  }
  if (r.status !== 'running') {
    $('#thinking')?.remove();
    stopRunPoll();
    if (r.changed) toast('Агент изменил файлы проекта');
  }
}

function stopRunPoll() {
  clearInterval(runTimer); runTimer = null; run = null;
  $('#agentMx')?.classList.add('idle');
  if ($('#askBtn') && P && !P.readonly) $('#askBtn').disabled = false;
  $('#btnStop')?.classList.add('hidden');
}

$('#askForm').addEventListener('submit', e => { e.preventDefault(); ask(); });
$('#askInput').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(); } });
$('#btnStop').onclick = async () => { if (run) await api('POST', `/api/ws/runs/${run.id}/cancel`); };
window.addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
