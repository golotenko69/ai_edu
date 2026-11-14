// Клиент студента: редактор + панель агента + запись сессии
let ME = null;
let S = null;            // { session, task, languages }
let STATE = null;        // последнее состояние с сервера
let editor = null, monacoRef = null, agentDecor = null;
let dirty = false, saving = false, pollTimer = null, saveTimer = null;
let lastCopy = { text: '', source: '' };
let pendingPasteSource = null;
let checkModal = null, checkModalId = null;
let controlEntered = false, lastBlurLog = 0;
const codeStore = new Map(); let codeSeq = 0;

// ------------------------------------------------------------------ старт
(async function init() {
  try {
    ME = (await api('GET', '/api/me')).user;
  } catch (e) { location.href = '/'; return; }
  if (ME.role !== 'student') { location.href = '/teacher'; return; }
  $('#userName').textContent = ME.name + (ME.group ? ' · ' + ME.group : '');
  $('#toList').onclick = e => { e.preventDefault(); location.hash = ''; };
  $('#toHome').onclick = e => { e.preventDefault(); location.hash = ''; };
  window.addEventListener('hashchange', route);
  route();
})();

function route() {
  const m = location.hash.match(/^#task\/(\d+)/);
  if (m) openTask(+m[1]); else showList();
}

// ------------------------------------------------------------------ список заданий
async function showList() {
  stopTimers();
  if (dirty) await saveCode();
  S = null;
  $('#workView').classList.add('hidden');
  $('#listView').classList.remove('hidden');
  $('#crumbTask').textContent = '';
  $('#modeBadge').classList.add('hidden');
  $('#controlOverlay').classList.add('hidden');
  const box = $('#courses');
  box.innerHTML = LOADING('Загрузка заданий');
  const { courses } = await api('GET', '/api/student/tasks');
  if (!courses.length) { box.innerHTML = '<div class="empty">Для вашей группы пока нет курсов.</div>'; return; }
  box.innerHTML = '';
  for (const c of courses) {
    const done = c.tasks.filter(t => t.submission).length;
    const head = stagger(h(`<div class="course-head">
      <div class="t"><span class="eyebrow">Курс · ${esc(ME.group || '')}</span><h1>${esc(c.title)}</h1></div>
      <div class="meta"><span class="num">${pad2(done)}<span class="num dim">/${pad2(c.tasks.length)}</span></span>заданий сдано. ${esc(c.description || '')}</div></div>`));
    const list = h('<div class="task-list"></div>');
    c.tasks.forEach((t, i) => {
      const sub = t.submission;
      let status = t.started ? '<span class="badge warn">в работе</span>' : '<span class="badge">не начато</span>';
      if (sub) status = `<span class="badge ${sub.passed === sub.total ? 'ok' : 'warn'}">сдано ${sub.passed}/${sub.total}</span>`
        + (sub.grade ? `<span class="badge bad">оценка ${esc(sub.grade)}</span>` : '');
      const kind = t.kind === 'control' ? `<span class="badge bad">контрольная${t.control_active ? ' · идёт' : ''}</span>` : '';
      const row = h(`<div class="task-row">
        <span class="num">${pad2(i + 1)}</span>
        <div><div class="title">${esc(t.title)}</div><div class="sub"><span class="badge">${LANG_TITLES[t.language] || t.language}</span>${kind}</div></div>
        <div class="mode"><span class="label muted">агент</span><div>${MODE_ICONS[t.mode]} · ${MODE_TITLES[t.mode]}</div></div>
        <div class="status">${status}</div>
        <span class="go">${icon('arrow')}</span></div>`);
      row.onclick = () => location.hash = '#task/' + t.id;
      list.appendChild(row);
    });
    stagger(list);
    box.appendChild(head);
    box.appendChild(list);
  }
}

// ------------------------------------------------------------------ рабочее место
async function openTask(taskId) {
  stopTimers();
  $('#listView').classList.add('hidden');
  $('#workView').classList.remove('hidden');
  let data;
  try {
    data = await api('POST', `/api/student/tasks/${taskId}/session`, { workplace: navigator.platform || '' });
  } catch (e) { toast(e.message, 'bad'); location.hash = ''; return; }
  S = data;
  controlEntered = false;
  const t = S.task;
  $('#crumbTask').textContent = t.title;
  $('#taskTitle').textContent = t.title;
  $('#taskMeta').textContent = LANG_TITLES[t.language] + (t.kind === 'control' ? ' · контрольная' : ' · учебное задание');
  $('#taskDesc').textContent = t.description;
  const r = t.rules;
  const rule = (k, v) => `<div class="r"><span class="label">${k}</span><span>${v}</span></div>`;
  let rules = '';
  if (r.forbidden.length) rules += rule('Агенту запрещено', r.forbidden.map(f => esc(f.title)).join(', '));
  if (r.hint_limit) rules += rule('Лимит обращений', r.hint_limit);
  rules += rule('Фрагменты агента', `до ${r.max_fragment_lines} строк`);
  rules += rule('Проверка понимания', { block: 'обязательная, без ответа работа блокируется', soft: 'мягкая, можно ответить позже', off: 'выключена' }[r.understanding]);
  $('#taskRules').innerHTML = `<span class="eyebrow">Правила</span><div class="rules">${rules}</div>`;
  $('#taskTests').innerHTML = t.tests_public.map((x, i) => `<div class="test-ex">
      <div><span class="label">Ввод ${pad2(i + 1)}</span><pre>${esc(x.input)}</pre></div>
      <div><span class="label">Вывод</span><pre>${esc(x.expected)}</pre></div></div>`).join('')
    + (t.tests_hidden ? `<span class="label muted">+ скрытых тестов: ${t.tests_hidden}</span>` : '')
    + (!S.languages[t.language]?.available ? `<div class="badge bad" style="white-space:normal">${esc(S.languages[t.language]?.info || '')}</div>` : '');
  stagger($('#taskPane'));
  if (t.tests_public[0]) $('#stdin').value = t.tests_public[0].input;

  // чат
  $('#chat').innerHTML = '';
  if (!S.messages.length) addSystemMsg('Начните работу. Агент поможет в рамках правил преподавателя.');
  S.messages.forEach(m => addMsg(m.role, m.text, { blocked: m.blocked, rewritten: m.rewritten, ts: m.ts }));
  $('#output').textContent = 'Нажмите «Запустить», чтобы выполнить программу.';
  $('#output').className = 'console muted';
  $('#testResults').innerHTML = '<span class="muted">Тесты ещё не запускались.</span>';

  await ensureEditor();
  monacoRef.editor.setModelLanguage(editor.getModel(), t.language === 'cpp' ? 'cpp' : 'python');
  editor.setValue(S.session.code || '');
  setAgentLines(S.session.agent_lines || []);
  dirty = false;
  setSaveState('сохранено');
  editor.focus();

  await poll();
  pollTimer = setInterval(poll, 3000);
  saveTimer = setInterval(() => { if (dirty) saveCode(); }, 2500);
}

function stopTimers() {
  clearInterval(pollTimer); clearInterval(saveTimer);
  pollTimer = saveTimer = null;
  if (checkModal) { checkModal.close(); checkModal = null; checkModalId = null; }
}

function ensureEditor() {
  if (editor) return Promise.resolve();
  return new Promise(resolve => {
    require.config({ paths: { vs: '/vendor/vs' } });
    require(['vs/editor/editor.main'], () => {
      monacoRef = monaco;
      defineMonoTheme(monaco);
      editor = monaco.editor.create($('#editor'), {
        value: '', language: 'python', theme: 'mono',
        fontFamily: '"JetBrains Mono", Consolas, monospace', fontLigatures: false, lineHeight: 22,
        cursorStyle: 'block', cursorBlinking: 'phase', padding: { top: 14 },
        automaticLayout: true, fontSize: 14, minimap: { enabled: false }, tabSize: 4,
        scrollBeyondLastLine: false, renderWhitespace: 'selection', glyphMargin: false,
        lineDecorationsWidth: 8,
      });
      agentDecor = editor.createDecorationsCollection([]);
      editor.onDidChangeModelContent(() => { dirty = true; setSaveState('изменено'); });
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => runCode());
      setupClipboardTracking();
      resolve();
    });
  });
}

function setSaveState(s) { $('#saveState').textContent = s; }

// ------------------------------------------------------------------ пометка строк агента
const AGENT_DECO = () => ({
  isWholeLine: true, className: 'agent-line-bg', linesDecorationsClassName: 'agent-line-gutter',
  stickiness: monacoRef.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
  hoverMessage: { value: 'Строка написана ИИ-агентом' },
});

function getAgentLines() {
  if (!agentDecor) return [];
  const set = new Set();
  for (const r of agentDecor.getRanges()) {
    if (r.isEmpty() && editor.getModel().getLineContent(r.startLineNumber).trim() === '') continue;
    for (let l = r.startLineNumber; l <= r.endLineNumber; l++) set.add(l);
  }
  return [...set].sort((a, b) => a - b);
}

function setAgentLines(lines) {
  const model = editor.getModel();
  const max = model.getLineCount();
  const decos = [];
  const sorted = [...new Set(lines)].filter(l => l >= 1 && l <= max).sort((a, b) => a - b);
  let start = null, prev = null;
  const flush = () => { if (start !== null) decos.push({ range: new monacoRef.Range(start, 1, prev, model.getLineMaxColumn(prev)), options: AGENT_DECO() }); };
  for (const l of sorted) {
    if (start === null) { start = prev = l; continue; }
    if (l === prev + 1) { prev = l; continue; }
    flush(); start = prev = l;
  }
  flush();
  agentDecor.set(decos);
}

function addAgentRange(from, to) {
  setAgentLines([...getAgentLines(), ...Array.from({ length: to - from + 1 }, (_, i) => from + i)]);
}

// ------------------------------------------------------------------ буфер обмена: внешний код и код из чата
function setupClipboardTracking() {
  const container = $('#editor');
  document.addEventListener('copy', onCopy, true);
  document.addEventListener('cut', onCopy, true);
  function onCopy() {
    const inEditor = container.contains(document.activeElement);
    const inChat = $('#chat').contains(window.getSelection()?.anchorNode || null);
    if (inEditor) {
      const sel = editor.getSelection();
      lastCopy = { text: editor.getModel().getValueInRange(sel), source: 'editor' };
    } else if (inChat) {
      lastCopy = { text: String(window.getSelection()), source: 'agent_chat' };
    } else {
      lastCopy = { text: String(window.getSelection() || ''), source: 'page' };
    }
  }
  container.addEventListener('paste', e => {
    const text = (e.clipboardData || window.clipboardData)?.getData('text') || '';
    const norm = s => s.replace(/\r\n/g, '\n').trim();
    let source = 'external';
    if (lastCopy.text && norm(lastCopy.text) === norm(text)) source = lastCopy.source;
    const lines = text.split('\n').length;
    if (S && S.task.kind === 'control' && source !== 'editor') {
      e.preventDefault(); e.stopPropagation();
      sendEvent('paste_blocked', { lines, chars: text.length, source });
      toast('На контрольной вставка из внешних источников запрещена', 'bad');
      return;
    }
    if (source === 'agent_chat' && !['fragments', 'free'].includes(STATE?.mode)) {
      e.preventDefault(); e.stopPropagation();
      toast('В текущем режиме код агента вставлять нельзя', 'bad');
      return;
    }
    pendingPasteSource = { source, text, lines };
    sendEvent('paste', { lines, chars: text.length, external: source === 'external' || source === 'page', source });
  }, true);
  editor.onDidPaste(e => {
    const p = pendingPasteSource; pendingPasteSource = null;
    if (p && p.source === 'agent_chat') {
      // код агента, скопированный из чата вручную, — та же вставка с пометкой и проверкой
      addAgentRange(e.range.startLineNumber, e.range.endLineNumber);
      afterInsert(p.text, e.range.startLineNumber, e.range.endLineNumber);
    }
  });
}

function sendEvent(type, payload) {
  if (!S) return;
  api('POST', `/api/sessions/${S.session.id}/event`, { type, payload }).catch(() => { });
}

// ------------------------------------------------------------------ сохранение, запуск, тесты
function codePayload() {
  return { code: editor.getValue(), agent_lines: getAgentLines() };
}

async function saveCode() {
  if (!S || saving || STATE?.readonly) return;
  saving = true; dirty = false;
  setSaveState('сохранение…');
  try {
    await api('POST', `/api/sessions/${S.session.id}/code`, codePayload());
    setSaveState('сохранено ' + new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }));
  } catch (e) {
    dirty = true; setSaveState('не сохранено: ' + e.message);
  } finally { saving = false; }
}

function showTab(name) {
  $$('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  $$('.tab-body').forEach(b => b.classList.toggle('hidden', b.dataset.body !== name));
}
$$('.tab').forEach(b => b.onclick = () => showTab(b.dataset.tab));

async function runCode() {
  if (!S || STATE?.readonly) return;
  const btn = $('#btnRun'); btn.disabled = true;
  showTab('out');
  const out = $('#output');
  out.className = 'console muted'; out.innerHTML = 'Выполняется<span class="caret"></span>';
  $('#runProgress').classList.remove('hidden');
  try {
    dirty = false;
    const r = await api('POST', `/api/sessions/${S.session.id}/run`, { ...codePayload(), stdin: $('#stdin').value });
    setSaveState('сохранено');
    out.className = 'console';
    out.innerHTML = (r.stdout ? esc(r.stdout) : '') + (r.stderr ? `<span class="err">${esc(r.stderr)}</span>` : '')
      + `\n<span class="${r.exit_code === 0 ? 'ok' : 'err'}">— завершено с кодом ${r.exit_code} за ${r.time} с</span>`;
    if (!r.stdout && !r.stderr && r.exit_code === 0) out.innerHTML = '<span class="muted">(программа ничего не вывела)</span>\n' + out.innerHTML;
  } catch (e) {
    out.className = 'console'; out.innerHTML = `<span class="err">${esc(e.message)}</span>`;
  } finally { btn.disabled = false; $('#runProgress').classList.add('hidden'); }
}

function renderCases(res, box) {
  const pct = res.total ? Math.round(res.passed / res.total * 100) : 0;
  box.innerHTML = `<div class="row" style="margin-bottom:12px;align-items:baseline;gap:14px"><span class="num" style="font-size:38px">${pad2(res.passed)}<span class="num dim">/${pad2(res.total)}</span></span><span class="label muted">тестов пройдено</span></div>
    <div class="meter" style="margin-bottom:14px"><i style="width:${pct}%"></i></div>` + res.cases.map((c, i) => `
    <div class="tcase ${c.ok ? 'ok' : 'bad'} rv" style="--i:${Math.min(i, 6)}">
      <div class="row"><span class="label">${c.ok ? 'пройден' : 'не пройден'} · тест ${pad2(c.n)}</span>${c.hidden ? '<span class="badge">скрытый</span>' : ''}
        ${c.timeout ? '<span class="badge bad">тайм-аут</span>' : ''}<span class="spacer"></span><span class="label muted">${c.time ?? ''} с</span></div>
      ${c.input !== undefined ? `<div class="grid3">
        <div><span class="label muted">Ввод</span><pre>${esc(c.input)}</pre></div>
        <div><span class="label muted">Ожидалось</span><pre>${esc(c.expected)}</pre></div>
        <div><span class="label muted">Получено</span><pre>${esc(c.actual)}</pre></div></div>` : ''}
      ${c.stderr ? `<pre>${esc(c.stderr)}</pre>` : ''}
    </div>`).join('');
}

async function runTests() {
  if (!S || STATE?.readonly) return;
  const btn = $('#btnTest'); btn.disabled = true;
  showTab('tests');
  $('#testResults').innerHTML = `<div class="row">${aiMx(4)}<span class="label muted">Тесты выполняются</span></div>`;
  $('#runProgress').classList.remove('hidden');
  try {
    dirty = false;
    const res = await api('POST', `/api/sessions/${S.session.id}/test`, codePayload());
    renderCases(res, $('#testResults'));
  } catch (e) {
    $('#testResults').innerHTML = `<span class="err">${esc(e.message)}</span>`;
  } finally { btn.disabled = false; $('#runProgress').classList.add('hidden'); }
}

async function submitWork() {
  if (!S) return;
  const control = S.task.kind === 'control';
  const ok = await confirmDialog('Сдать работу?',
    'Код будет проверен на всех тестах, включая скрытые. Вместе с кодом преподаватель увидит историю сессии: правки, диалог с агентом и проверки понимания.'
    + (control ? '<br><br><b>После сдачи контрольной изменить код будет нельзя.</b>' : '<br><br>После сдачи можно продолжить работу и сдать снова.'),
    'Сдать');
  if (!ok) return;
  try {
    dirty = false;
    const res = await api('POST', `/api/sessions/${S.session.id}/submit`, codePayload());
    const m = modal(`<span class="eyebrow">Сдача принята</span><h2>Работа сдана</h2>
      <p class="muted">Оценку выставит преподаватель. Вместе с кодом он увидит историю сессии.</p>
      ${res.forbidden?.length ? `<p class="badge warn" style="white-space:normal">В коде есть конструкции, запрещённые в задании: ${esc([...new Set(res.forbidden.map(f => f.title))].join(', '))}</p>` : ''}
      <div id="subCases" style="max-height:340px;overflow:auto"></div>
      <div class="actions"><button data-close>Продолжить работу</button><button class="primary" data-list>К списку заданий</button></div>`, { wide: true });
    renderCases(res, $('#subCases', m.el));
    $('[data-list]', m.el).onclick = () => { m.close(); location.hash = ''; };
    poll();
  } catch (e) { toast(e.message, 'bad'); }
}

$('#btnRun').onclick = runCode;
$('#btnTest').onclick = runTests;
$('#btnSubmit').onclick = submitWork;

// ------------------------------------------------------------------ чат с агентом
function addSystemMsg(text) {
  const el = h(`<div class="msg system">${esc(text)}</div>`);
  $('#chat').appendChild(el); scrollChat();
}

function addMsg(role, text, opts = {}) {
  let el;
  if (role === 'user') {
    el = h(`<div class="msg user">${esc(text)}</div>`);
  } else {
    const canInsert = !opts.blocked && ['fragments', 'free'].includes(opts.mode || STATE?.mode || '');
    const html = renderMd(text, {
      codeButton: p => {
        const id = ++codeSeq; codeStore.set(id, p.v);
        return `<button class="sm insert ${canInsert ? '' : 'hidden'}" data-code="${id}">${icon('insert')}Вставить в редактор</button>`;
      },
    });
    let note = '';
    if (opts.blocked) note = '<div class="note badge bad">ответ заблокирован проверкой правил</div>';
    else if (opts.rewritten) note = '<div class="note badge warn">ответ переписан проверкой правил</div>';
    el = h(`<div class="msg agent md"><div class="who label">${aiMx(3, true)}агент</div>${html}${note}</div>`);
    $$('[data-code]', el).forEach(b => b.onclick = () => confirmInsert(codeStore.get(+b.dataset.code)));
  }
  $('#chat').appendChild(el); scrollChat();
  return el;
}
function scrollChat() { const c = $('#chat'); c.scrollTop = c.scrollHeight; }

function refreshInsertButtons() {
  const can = ['fragments', 'free'].includes(STATE?.mode);
  $$('#chat .msg.agent').forEach(m => {
    if (m.querySelector('.note.bad')) return;
    $$('.insert', m).forEach(b => b.classList.toggle('hidden', !can));
  });
}

async function ask(kind = 'ask') {
  if (!S || STATE?.readonly) return;
  const input = $('#askInput');
  const text = input.value.trim();
  if (kind === 'ask' && !text) return;
  if (STATE?.pending_check?.blocking) { openCheck(STATE.pending_check); return; }
  input.value = '';
  addMsg('user', kind === 'explain_error' ? (text || 'Объясни ошибку последнего запуска') : text);
  const typing = h(`<div class="thinking fade">${aiMx(5)}<span class="label">агент думает<span class="caret"></span></span></div>`);
  $('#chat').appendChild(typing); scrollChat();
  $('#askBtn').disabled = true;
  $('#agentMx').classList.remove('idle');
  try {
    dirty = false;
    const r = await api('POST', `/api/sessions/${S.session.id}/agent`, { message: text, kind, ...codePayload() });
    typing.remove();
    addMsg('agent', r.text, { blocked: r.blocked, rewritten: r.rewritten, mode: r.mode });
    if (r.bypass) addSystemMsg('Попытка обойти правила записана в журнал сессии.');
    poll();
  } catch (e) {
    typing.remove();
    addSystemMsg(e.message);
  } finally { $('#askBtn').disabled = false; $('#agentMx').classList.add('idle'); }
}

$('#askForm').addEventListener('submit', e => { e.preventDefault(); ask('ask'); });
$('#askInput').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask('ask'); }
});
$('#btnExplainErr').onclick = () => ask('explain_error');

// ------------------------------------------------------------------ вставка кода агента
async function confirmInsert(code) {
  if (!['fragments', 'free'].includes(STATE?.mode)) { toast('В текущем режиме вставка кода агента недоступна', 'bad'); return; }
  if (STATE?.readonly) return;
  const und = S.task.rules.understanding;
  const ok = await confirmDialog('Вставить код агента?',
    `<pre>${esc(code)}</pre><p class="muted small">Фрагмент будет вставлен в позицию курсора, а его строки помечены как написанные агентом.`
    + (und !== 'off' ? ' После вставки агент задаст вопрос по этому коду' + (und === 'block' ? ' — без ответа работу продолжить нельзя.' : '.') : '') + '</p>',
    'Вставить');
  if (!ok) { sendEvent('agent_reject', { lines: code.split('\n').length }); return; }
  const model = editor.getModel();
  const pos = editor.getPosition() || { lineNumber: model.getLineCount(), column: 1 };
  const line = pos.lineNumber;
  const content = model.getLineContent(line);
  const n = code.split('\n').length;
  let from, edit;
  if (content.trim() === '') {
    const indent = content;
    const text = code.split('\n').map(l => (l ? indent + l : l)).join('\n');
    edit = { range: new monacoRef.Range(line, 1, line, model.getLineMaxColumn(line)), text };
    from = line;
  } else {
    const indent = (content.match(/^\s*/) || [''])[0];
    const text = '\n' + code.split('\n').map(l => (l ? indent + l : l)).join('\n');
    edit = { range: new monacoRef.Range(line, model.getLineMaxColumn(line), line, model.getLineMaxColumn(line)), text };
    from = line + 1;
  }
  editor.executeEdits('agent', [edit]);
  editor.pushUndoStop();
  addAgentRange(from, from + n - 1);
  editor.revealLineInCenter(from);
  afterInsert(code, from, from + n - 1);
}

async function afterInsert(fragment, from, to) {
  dirty = false;
  try {
    const r = await api('POST', `/api/sessions/${S.session.id}/insert`, { fragment, from_line: from, to_line: to, ...codePayload() });
    setSaveState('сохранено');
    if (r.check) openCheck(r.check);
  } catch (e) { toast(e.message, 'bad'); }
}

// ------------------------------------------------------------------ проверка понимания
function openCheck(check) {
  if (checkModal && checkModalId === check.id) return;
  if (checkModal) checkModal.close();
  checkModalId = check.id;
  if (check.blocking) editor.updateOptions({ readOnly: true });
  const from = check.source === 'teacher' ? 'Вопрос от преподавателя' : 'Проверка понимания';
  checkModal = modal(`
    <div class="row">${aiMx(5, true)}<span class="label muted">${from}</span></div>
    <p class="muted small">${check.blocking ? 'Чтобы продолжить работу, ответьте на вопрос своими словами.' : 'Ответьте своими словами — ответ увидит преподаватель.'}</p>
    ${check.fragment ? `<pre style="max-height:180px">${esc(check.fragment)}</pre>` : ''}
    <div class="check-q md">${inlineMd(check.question)}</div>
    <textarea id="checkAnswer" rows="4" placeholder="Мой ответ…"></textarea>
    <div id="checkResult"></div>
    <div class="actions">
      ${check.blocking ? '' : '<button data-later>Ответить позже</button>'}
      <button class="primary" id="checkSend">Ответить</button>
    </div>`, { closable: false });
  const el = checkModal.el;
  setTimeout(() => $('#checkAnswer', el)?.focus(), 50);
  const later = $('[data-later]', el);
  if (later) later.onclick = () => { checkModal.close(); checkModal = null; checkModalId = null; renderPending(); };
  $('#checkSend', el).onclick = async () => {
    const answer = $('#checkAnswer', el).value.trim();
    if (!answer) { toast('Напишите ответ'); return; }
    const btn = $('#checkSend', el); btn.disabled = true; btn.innerHTML = `${aiMx(3)} Оценка`;
    try {
      const g = await api('POST', `/api/checks/${check.id}/answer`, { answer });
      $('#checkAnswer', el).disabled = true;
      $('#checkResult', el).innerHTML = `<div class="check-result ${g.passed ? 'ok' : 'bad'}">
        <div class="row" style="margin-bottom:6px"><span class="label">${g.passed ? 'засчитано' : 'не засчитано'}</span><span class="spacer"></span><span class="num" style="font-size:28px;color:inherit">${Math.round(g.score * 100)}%</span></div>${esc(g.feedback)}
        ${g.passed ? '' : '<div class="small muted" style="margin-top:6px">Результат увидит преподаватель. Разберитесь с этим фрагментом — можно спросить агента.</div>'}</div>`;
      btn.remove();
      if (later) later.remove();
      const cont = h('<button class="primary">Продолжить</button>');
      $('.actions', el).appendChild(cont);
      cont.onclick = () => {
        checkModal.close(); checkModal = null; checkModalId = null;
        if (!STATE?.readonly) editor.updateOptions({ readOnly: false });
        editor.focus();
        poll();
      };
      addSystemMsg(`Проверка понимания: ${g.passed ? 'засчитано' : 'не засчитано'}`);
    } catch (e) {
      toast(e.message, 'bad'); btn.disabled = false; btn.textContent = 'Ответить';
    }
  };
}

function renderPending() {
  const pc = STATE?.pending_check;
  const b = $('#pendingBanner');
  if (pc && !checkModal) {
    b.innerHTML = `${aiMx(4)}<span>Вас ждёт вопрос по коду</span><span class="spacer"></span><button class="sm primary">Ответить</button>`;
    $('button', b).onclick = () => openCheck(pc);
    b.classList.remove('hidden');
  } else b.classList.add('hidden');
}

// ------------------------------------------------------------------ опрос состояния (живое управление с пары)
async function poll() {
  if (!S) return;
  let st;
  try { st = await api('GET', `/api/sessions/${S.session.id}/state`); } catch (e) { return; }
  const prevMode = STATE?.mode;
  STATE = st;
  // режим агента
  $('#modeBadge').textContent = `агент ${MODE_ICONS[st.mode]} · ${st.mode_title}`;
  $('#modeBadge').classList.remove('hidden');
  const src = { student: 'изменён лично для вас', live: 'переключён преподавателем на паре', task: 'режим задания' }[st.mode_source];
  if (prevMode !== st.mode || !$('#modeInfo').innerHTML) {
    $('#modeInfo').innerHTML = `<span class="num">${MODE_ICONS[st.mode]}</span><div><b>${st.mode_title}</b>${esc(MODE_HELP[st.mode])}<span class="label">${src}</span></div>`;
  }
  if (prevMode && prevMode !== st.mode) {
    const mi = $('#modeInfo'); mi.classList.remove('changed'); void mi.offsetWidth; mi.classList.add('changed');
    addSystemMsg(`Режим агента изменён: ${MODE_TITLES[st.mode]}`);
    toast(`Режим агента: ${MODE_TITLES[st.mode]}`);
  }
  refreshInsertButtons();
  $('#hintCounter').textContent = st.hint_limit ? `обращений: ${st.hints_used}/${st.hint_limit}` : `обращений: ${st.hints_used}`;
  $('#hintCounter').className = 'badge' + (st.hint_limit && st.hints_used >= st.hint_limit ? ' bad' : '');
  const silent = st.mode === 'silent';
  $('#askInput').placeholder = silent ? 'Агент в режиме «Молчание»' : 'Вопрос агенту. Enter — отправить, Shift+Enter — новая строка';
  // проверка понимания
  if (st.pending_check) {
    if (st.pending_check.blocking && checkModalId !== st.pending_check.id) openCheck(st.pending_check);
  }
  renderPending();
  // только чтение
  const ro = st.readonly;
  if (!checkModal) editor.updateOptions({ readOnly: ro });
  ['#btnRun', '#btnTest', '#askBtn', '#btnExplainErr'].forEach(s => $(s).disabled = ro);
  $('#btnSubmit').disabled = ro || (S.task.kind === 'control' && st.status !== 'active');
  updateControl(st);
}

// ------------------------------------------------------------------ контрольный режим (киоск в браузере)
function updateControl(st) {
  const ov = $('#controlOverlay');
  if (S.task.kind !== 'control') { ov.classList.add('hidden'); return; }
  if (st.status === 'closed' || st.status === 'submitted') {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => { });
    const sub = st.submission;
    ov.innerHTML = `<div class="box"><span class="eyebrow">Контрольная работа</span><h1>Работа сдана</h1>
      <p>${sub ? `Тесты: ${sub.passed} из ${sub.total}. ` : ''}Результат объявит преподаватель.</p>
      <button class="primary" id="ovList">К списку заданий ${icon('arrow')}</button></div>`;
    $('#ovList').onclick = () => location.hash = '';
    ov.classList.remove('hidden'); return;
  }
  if (!st.control_active) {
    ov.innerHTML = `<div class="box"><span class="eyebrow">Контрольная работа · ${esc(S.task.title)}</span><h1>Ожидание старта<span class="caret"></span></h1>
      <p>Дождитесь, когда преподаватель запустит контрольную. Страница обновится сама.</p>
      <div class="progress"></div>
      <button id="ovList">${icon('back')} К списку заданий</button></div>`;
    $('#ovList').onclick = () => location.hash = '';
    ov.classList.remove('hidden'); controlEntered = false; return;
  }
  if (!document.fullscreenElement) {
    ov.innerHTML = controlEntered
      ? `<div class="box"><span class="eyebrow">Нарушение записано в журнал</span><h1>Вы вышли из полноэкранного режима</h1>
         <p>Вернитесь, чтобы продолжить работу.</p>
         <button class="primary" id="ovFs">Вернуться к контрольной ${icon('arrow')}</button></div>`
      : `<div class="box"><span class="eyebrow">Контрольная работа · агент: ${esc(st.mode_title)}</span><h1>${esc(S.task.title)}</h1>
         <p>Работа идёт в полноэкранном режиме. Выход из него, переключение на другие окна и вставка внешнего текста записываются и видны преподавателю.</p>
         <button class="primary" id="ovFs">Начать ${icon('arrow')}</button></div>`;
    $('#ovFs').onclick = async () => {
      try { await document.documentElement.requestFullscreen(); } catch (e) { toast('Браузер не разрешил полноэкранный режим', 'bad'); }
    };
    ov.classList.remove('hidden');
  } else ov.classList.add('hidden');
}

document.addEventListener('fullscreenchange', () => {
  if (!S || S.task.kind !== 'control') return;
  if (document.fullscreenElement) {
    controlEntered = true; sendEvent('fullscreen_enter', {});
  } else if (controlEntered && STATE?.control_active && STATE?.status === 'active') {
    sendEvent('fullscreen_exit', {});
  }
  if (STATE) updateControl(STATE);
});
window.addEventListener('blur', () => {
  if (!S || S.task.kind !== 'control' || !STATE?.control_active || STATE?.status !== 'active') return;
  if (Date.now() - lastBlurLog < 2000) return;
  lastBlurLog = Date.now();
  sendEvent('focus_lost', {});
});
window.addEventListener('beforeunload', () => {
  if (S && dirty) navigator.sendBeacon && saveCode();
});
