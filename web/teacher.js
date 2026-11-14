// Панель преподавателя
let ME = null, OV = null, liveTimer = null;
const V = () => $('#view');

(async function init() {
  try { ME = (await api('GET', '/api/me')).user; } catch (e) { location.href = '/'; return; }
  if (ME.role === 'student') { location.href = '/student'; return; }
  $('#userName').textContent = ME.name;
  window.addEventListener('hashchange', route);
  route();
})();

async function loadOverview() {
  OV = await api('GET', '/api/teacher/overview');
  const b = $('#llmBadge');
  b.textContent = OV.llm_mock ? 'модель не подключена · демо' : 'модель подключена';
  b.className = 'badge ' + (OV.llm_mock ? 'warn' : 'ok');
  b.style.cursor = 'pointer'; b.onclick = () => location.hash = '#settings';
  return OV;
}

async function route() {
  clearInterval(liveTimer); liveTimer = null;
  const hash = location.hash.replace(/^#/, '') || 'courses';
  const [name, arg, arg2] = hash.split('/');
  $$('.side a').forEach(a => a.classList.toggle('active', a.dataset.nav === (name === 'task' || name === 'session' ? (name === 'task' ? 'courses' : 'live') : name)));
  V().innerHTML = LOADING();
  try {
    await loadOverview();
    const views = { courses: () => viewCourses(), task: () => viewTask(arg, arg2), live: () => viewLive(arg),
      session: () => viewSession(+arg), reports: () => viewReports(arg), groups: () => viewGroups(), settings: () => viewSettings(), agentpolicy: () => viewAgentPolicy() };
    if (!views[name]) { V().innerHTML = '<div class="empty">Страница не найдена</div>'; return; }
    await views[name]();
    stagger(V());
  } catch (e) {
    V().innerHTML = `<div class="empty">${esc(e.message)}</div>`;
  }
}

const modeBadge = m => `<span class="badge agent">${MODE_ICONS[m] || ''} ${MODE_TITLES[m] || m}</span>`;
const allTasks = () => OV.courses.flatMap(c => c.tasks.map(t => ({ ...t, course: c })));

// ================================================================== курсы и задания
function viewCourses() {
  const v = V();
  v.innerHTML = `<div class="view-head"><div><span class="eyebrow">01 · Учебный план</span><h1>Курсы и задания</h1></div><div class="spacer"></div>
    <button class="primary" id="newCourse">${icon('plus')}Новый курс</button></div><div id="list"></div>`;
  $('#newCourse').onclick = () => courseForm(null);
  const list = $('#list');
  if (!OV.courses.length) list.innerHTML = '<div class="card empty">Курсов пока нет — создайте первый.</div>';
  for (const c of OV.courses) {
    const el = h(`<div class="card section">
      <div class="row wrap" style="margin-bottom:6px"><h2 class="grow" style="margin:0">${esc(c.title)}</h2>
        <span class="badge accent">группа: ${esc(c.group_name || '—')}</span>
        <button class="sm" data-edit>Курс и материалы</button>
        <button class="sm" data-report>Отчёт</button>
        <button class="sm primary" data-add>${icon('plus')}Задание</button></div>
      <p class="muted">${esc(c.description || '')}</p>
      <div data-tasks></div></div>`);
    $('[data-edit]', el).onclick = () => courseForm(c.id);
    $('[data-report]', el).onclick = () => location.hash = '#reports/' + c.id;
    $('[data-add]', el).onclick = () => location.hash = `#task/new/${c.id}`;
    const tl = $('[data-tasks]', el);
    if (!c.tasks.length) tl.innerHTML = '<div class="muted small">В курсе нет заданий.</div>';
    for (const [ti, t] of c.tasks.entries()) {
      const row = h(`<div class="task-row">
        <span class="num dim">${pad2(ti + 1)}</span><span class="t">${esc(t.title)}</span>
        <span class="badge">${LANG_TITLES[t.language]}</span>
        ${t.kind === 'control' ? `<span class="badge bad">контрольная${t.control_active ? ' · идёт' : ''}</span>` : ''}
        ${modeBadge(t.live_mode || t.mode)}${t.live_mode ? '<span class="badge warn" title="Режим переключён на паре">на паре</span>' : ''}
        <button class="sm" data-live>${icon('live')}Пара</button><button class="sm" data-edit>Изменить</button></div>`);
      $('[data-live]', row).onclick = () => location.hash = '#live/' + t.id;
      $('[data-edit]', row).onclick = () => location.hash = '#task/' + t.id;
      tl.appendChild(row);
    }
    list.appendChild(el);
  }
}

async function courseForm(id) {
  const c = id ? await api('GET', `/api/teacher/courses/${id}`) : { title: '', description: '', group_id: OV.groups[0]?.id, materials: '' };
  const m = modal(`<h2>${id ? 'Курс' : 'Новый курс'}</h2>
    <div class="col">
      <label class="field"><span>Название</span><input id="cTitle" value="${esc(c.title)}"></label>
      <label class="field"><span>Описание</span><input id="cDesc" value="${esc(c.description)}"></label>
      <label class="field"><span>Группа</span><select id="cGroup">${OV.groups.map(g => `<option value="${g.id}" ${g.id === c.group_id ? 'selected' : ''}>${esc(g.name)} (${g.students} студ.)</option>`).join('')}</select></label>
      <label class="field"><span>Материалы курса — агент опирается на них и использует их терминологию</span>
        <textarea id="cMat" rows="12" placeholder="Конспекты лекций, определения, требования к оформлению кода…">${esc(c.materials)}</textarea></label>
    </div>
    <div class="actions">${id ? '<button class="danger" data-del>Удалить курс</button><span class="spacer"></span>' : ''}<button data-close>Отмена</button><button class="primary" data-save>Сохранить</button></div>`, { wide: true });
  $('[data-save]', m.el).onclick = async () => {
    const body = { title: $('#cTitle').value, description: $('#cDesc').value, group_id: +$('#cGroup').value || null, materials: $('#cMat').value };
    try {
      if (id) await api('PUT', `/api/teacher/courses/${id}`, body); else await api('POST', '/api/teacher/courses', body);
      m.close(); toast('Курс сохранён', 'ok'); route();
    } catch (e) { toast(e.message, 'bad'); }
  };
  const del = $('[data-del]', m.el);
  if (del) del.onclick = async () => {
    if (!await confirmDialog('Удалить курс?', 'Будут удалены все задания курса и сессии студентов по ним. Отменить нельзя.', 'Удалить', true)) return;
    await api('DELETE', `/api/teacher/courses/${id}`); m.close(); route();
  };
}

async function viewTask(id, courseId) {
  const isNew = id === 'new';
  const t = isNew ? {
    course_id: +courseId, title: '', description: '', language: 'python', starter_code: '', mode: 'hints', kind: 'study',
    rules: { forbidden: [], hint_limit: 0, max_fragment_lines: 8, understanding: 'block', solution: '', use_materials: true },
    tests: [{ input: '', expected: '', hidden: false }],
  } : await api('GET', `/api/teacher/tasks/${id}`);
  const course = OV.courses.find(c => c.id === t.course_id);
  const consts = OV.constructs;
  const calls = t.rules.forbidden.filter(f => f.startsWith('call:')).map(f => f.slice(5)).join(', ');
  const v = V();
  v.innerHTML = `
    <a class="back label" href="#courses">${icon('back')}Курсы</a><div class="view-head"><div class="grow"><span class="eyebrow">Задание · ${esc(OV.courses.find(c => c.id === t.course_id)?.title || '')}</span><h1>${isNew ? 'Новое задание' : esc(t.title)}</h1></div>
      ${isNew ? '' : `<button id="btnGuard">${icon('shield')}Проверка защиты</button><button id="btnLive">${icon('live')}Живая пара</button>`}
      <button class="primary" id="btnSave">${icon('check')}Сохранить</button></div>
    <div class="muted" style="margin-top:-8px;margin-bottom:14px">Курс: ${esc(course?.title || '')}</div>
    <div class="grid2">
      <div class="col">
        <div class="card col">
          <h3>Задание</h3>
          <label class="field"><span>Название</span><input id="tTitle" value="${esc(t.title)}"></label>
          <div class="grid3">
            <label class="field"><span>Язык</span><select id="tLang">
              <option value="python" ${t.language === 'python' ? 'selected' : ''}>Python</option>
              <option value="cpp" ${t.language === 'cpp' ? 'selected' : ''}>C++</option></select></label>
            <label class="field"><span>Тип</span><select id="tKind">
              <option value="study" ${t.kind === 'study' ? 'selected' : ''}>Учебное</option>
              <option value="control" ${t.kind === 'control' ? 'selected' : ''}>Контрольное (киоск)</option></select></label>
            <label class="field"><span>Режим агента</span><select id="tMode">${Object.keys(MODE_TITLES).map(m => `<option value="${m}" ${t.mode === m ? 'selected' : ''}>${MODE_ICONS[m]} ${MODE_TITLES[m]}</option>`).join('')}</select></label>
          </div>
          <div class="muted small" id="modeHelp"></div>
          <label class="field"><span>Условие</span><textarea id="tDesc" rows="9">${esc(t.description)}</textarea></label>
          <label class="field"><span>Начальный код (заготовка для студента)</span><textarea id="tStarter" class="mono" rows="6">${esc(t.starter_code)}</textarea></label>
        </div>
        <div class="card col">
          <div class="row"><h3 class="grow" style="margin:0">Тесты для автопроверки</h3><button class="sm" id="addTest">${icon('plus')}Тест</button></div>
          <div class="muted small">Вывод сравнивается построчно без учёта пробелов в конце строк. Скрытые тесты студент не видит.</div>
          <div class="tests-edit" id="tests"></div>
        </div>
      </div>
      <div class="col">
        <div class="card col">
          <h3>Правила агента (поверх режима)</h3>
          <div class="field"><span class="muted small" style="font-weight:500">Какие конструкции агент не пишет (проверяется разбором кода, а не моделью)</span>
            <div class="forb">${Object.entries(consts).map(([k, title]) => `<label class="check"><input type="checkbox" data-forb="${k}" ${t.rules.forbidden.includes(k) ? 'checked' : ''}> ${esc(title)}</label>`).join('')}</div></div>
          <label class="field"><span>Запрещённые функции (через запятую), например: max, sorted, sum</span><input id="tCalls" value="${esc(calls)}"></label>
          <div class="grid3">
            <label class="field"><span>Лимит обращений (0 — без лимита)</span><input id="tLimit" type="number" min="0" value="${t.rules.hint_limit}"></label>
            <label class="field"><span>Макс. строк во фрагменте</span><input id="tMaxLines" type="number" min="1" value="${t.rules.max_fragment_lines}"></label>
            <label class="field"><span>Проверка понимания</span><select id="tUnd">
              <option value="block" ${t.rules.understanding === 'block' ? 'selected' : ''}>Обязательная (блокирует)</option>
              <option value="soft" ${t.rules.understanding === 'soft' ? 'selected' : ''}>Мягкая (метка)</option>
              <option value="off" ${t.rules.understanding === 'off' ? 'selected' : ''}>Выключена</option></select></label>
          </div>
          <label class="check"><input type="checkbox" id="tMat" ${t.rules.use_materials ? 'checked' : ''}> Агент опирается на материалы курса</label>
        </div>
        <div class="card col">
          <div class="row"><h3 class="grow" style="margin:0">Эталонное решение</h3><button class="sm" id="checkSol">${icon('play')}Проверить на тестах</button></div>
          <div class="muted small">Студенты его не видят. Используется, чтобы проверить тесты и чтобы контролёр распознавал выдачу готового решения агентом.</div>
          <textarea id="tSol" class="mono" rows="10">${esc(t.rules.solution || '')}</textarea>
          <div id="solRes"></div>
        </div>
        ${isNew ? '' : '<div><button class="danger" id="btnDel">Удалить задание</button></div>'}
      </div>
    </div>`;
  const help = () => $('#modeHelp').textContent = MODE_HELP[$('#tMode').value];
  $('#tMode').onchange = help; help();

  const testsBox = $('#tests');
  const addTestRow = (x = { input: '', expected: '', hidden: false }) => {
    const r = h(`<div class="trow">
      <textarea class="mono" placeholder="Ввод" data-in>${esc(x.input)}</textarea>
      <textarea class="mono" placeholder="Ожидаемый вывод" data-out>${esc(x.expected)}</textarea>
      <label class="check small"><input type="checkbox" data-hid ${x.hidden ? 'checked' : ''}> скрытый</label>
      <button class="sm ghost danger" title="Удалить">${icon('close')}</button></div>`);
    $('button', r).onclick = () => r.remove();
    testsBox.appendChild(r);
  };
  t.tests.forEach(addTestRow);
  $('#addTest').onclick = () => addTestRow();

  const collect = () => {
    const forbidden = $$('[data-forb]').filter(c => c.checked).map(c => c.dataset.forb);
    $('#tCalls').value.split(/[,;\s]+/).map(s => s.trim().replace(/\(\)$/, '')).filter(Boolean).forEach(f => forbidden.push('call:' + f));
    return {
      course_id: t.course_id, title: $('#tTitle').value, description: $('#tDesc').value, language: $('#tLang').value,
      kind: $('#tKind').value, mode: $('#tMode').value, starter_code: $('#tStarter').value,
      rules: { forbidden, hint_limit: +$('#tLimit').value || 0, max_fragment_lines: +$('#tMaxLines').value || 8,
        understanding: $('#tUnd').value, use_materials: $('#tMat').checked, solution: $('#tSol').value },
      tests: $$('.trow', testsBox).map(r => ({ input: $('[data-in]', r).value, expected: $('[data-out]', r).value, hidden: $('[data-hid]', r).checked })),
    };
  };
  $('#btnSave').onclick = async () => {
    try {
      const body = collect();
      if (isNew) {
        const r = await api('POST', '/api/teacher/tasks', body);
        toast('Задание создано', 'ok'); location.hash = '#task/' + r.id;
      } else {
        await api('PUT', `/api/teacher/tasks/${id}`, body); toast('Сохранено', 'ok');
      }
    } catch (e) { toast(e.message, 'bad'); }
  };
  $('#checkSol').onclick = async () => {
    const body = collect();
    $('#solRes').innerHTML = '<div class="progress"></div>';
    try {
      const r = await api('POST', `/api/teacher/tasks/${isNew ? 0 : id}/check-solution`, { code: body.rules.solution, tests: body.tests, language: body.language });
      $('#solRes').innerHTML = `<div class="badge ${r.passed === r.total ? 'ok' : 'bad'}">Эталон прошёл ${r.passed} из ${r.total} тестов</div>`
        + r.cases.filter(c => !c.ok).map(c => `<pre>Тест ${c.n}: ожидалось ${esc(c.expected)}, получено ${esc(c.actual)}\n${esc(c.stderr || '')}</pre>`).join('');
    } catch (e) { $('#solRes').innerHTML = `<span class="badge bad">${esc(e.message)}</span>`; }
  };
  if (!isNew) {
    $('#btnDel').onclick = async () => {
      if (!await confirmDialog('Удалить задание?', 'Сессии и сдачи студентов по нему будут удалены.', 'Удалить', true)) return;
      await api('DELETE', `/api/teacher/tasks/${id}`); location.hash = '#courses';
    };
    $('#btnLive').onclick = () => location.hash = '#live/' + id;
    $('#btnGuard').onclick = () => guardTest(+id);
  }
}

async function guardTest(taskId) {
  const m = modal(`<span class="eyebrow">Стресс-тест правил</span><h2>Проверка защиты агента</h2>
    <p class="muted">Агенту отправляются три попытки выпросить готовое решение в текущем режиме задания. Видно, удержала ли модель правила сама и поймала ли нарушение отдельная проверка ответа.</p>
    <div id="gRes" class="guard"><div class="row" style="margin-bottom:10px">${aiMx(6)}<span class="label muted">Идёт проверка. С локальной моделью это может занять минуту</span></div><div class="progress"></div></div>
    <div class="actions"><button data-close>Закрыть</button></div>`, { wide: true });
  try {
    const r = await api('POST', '/api/admin/guard-test', { task_id: taskId });
    $('#gRes', m.el).innerHTML = r.results.map(x => x.error ? `<div class="item"><b>${esc(x.probe)}</b><div class="badge bad">${esc(x.error)}</div></div>` : `
      <div class="item">
        <div class="row wrap"><b class="grow">«${esc(x.probe)}»</b>
          ${x.model_held ? '<span class="badge ok">модель удержала правила</span>' : '<span class="badge warn">модель нарушила → проверка ответа заблокировала</span>'}
          <span class="muted small">${x.time} с</span></div>
        ${x.violations.length ? `<div class="small" style="color:var(--text)">${x.violations.map(v => esc(v.text)).join('<br>')}</div>` : ''}
        <details><summary class="muted small">Ответ модели</summary><div class="md">${renderMd(x.answer)}</div></details>
      </div>`).join('');
  } catch (e) { $('#gRes', m.el).innerHTML = `<span class="badge bad">${esc(e.message)}</span>`; }
}

// ================================================================== живая пара
async function viewLive(taskId) {
  const tasks = allTasks();
  if (!tasks.length) { V().innerHTML = '<div class="card empty">Нет заданий. Создайте задание в разделе «Курсы».</div>'; return; }
  taskId = +taskId || tasks[0].id;
  const v = V();
  v.innerHTML = `
    <div class="view-head"><div><span class="eyebrow">02 · Занятие в реальном времени</span><h1>Живая пара</h1></div>
      <select id="taskSel" style="width:auto;max-width:420px">${OV.courses.map(c => `<optgroup label="${esc(c.title)} · ${esc(c.group_name || '')}">${c.tasks.map(t => `<option value="${t.id}" ${t.id === taskId ? 'selected' : ''}>${esc(t.title)}${t.kind === 'control' ? ' (контрольная)' : ''}</option>`).join('')}</optgroup>`).join('')}</select>
      <div class="spacer"></div><span class="muted small" id="liveUpd"></span></div>
    <div class="card section">
      <div class="row wrap"><b>Режим агента для всей группы:</b><div class="seg" id="groupMode"></div></div>
      <div class="muted small" style="margin-top:6px" id="groupModeHelp"></div>
      <div id="controlBox" style="margin-top:10px"></div>
    </div>
    <div class="card" style="padding:0;overflow:auto"><table class="tbl" id="liveTbl"></table></div>`;
  $('#taskSel').onchange = e => location.hash = '#live/' + e.target.value;
  const refresh = async () => {
    let d;
    try { d = await api('GET', `/api/teacher/tasks/${taskId}/live`); } catch (e) { return; }
    if (!$('#liveTbl')) return;
    renderLive(d);
    $('#liveUpd').textContent = 'обновлено ' + new Date().toLocaleTimeString('ru-RU');
  };
  await refresh();
  liveTimer = setInterval(refresh, 3000);
}

function renderLive(d) {
  const t = d.task;
  const cur = t.live_mode || t.mode;
  const seg = $('#groupMode');
  seg.innerHTML = Object.keys(MODE_TITLES).map(m => `<button data-m="${m}" class="${cur === m ? 'active' : ''}" title="${esc(MODE_HELP[m])}"><span class="k">${MODE_ICONS[m]}</span>${MODE_TITLES[m]}</button>`).join('');
  $$('button', seg).forEach(b => b.onclick = async () => {
    const m = b.dataset.m;
    await api('POST', `/api/teacher/tasks/${t.id}/mode`, { mode: m === t.mode ? null : m });
    toast(`Режим для группы: ${MODE_TITLES[m]}`, 'ok');
    renderLive(await api('GET', `/api/teacher/tasks/${t.id}/live`));
  });
  $('#groupModeHelp').innerHTML = `Режим задания по умолчанию: <b>${MODE_TITLES[t.mode]}</b>.` + (t.live_mode ? ` Сейчас переключено на паре → <b>${MODE_TITLES[t.live_mode]}</b>. <a href="#" id="resetMode">Вернуть режим задания</a>` : '')
    + ' Режим можно изменить и для отдельного студента в таблице.';
  const rm = $('#resetMode');
  if (rm) rm.onclick = async e => { e.preventDefault(); await api('POST', `/api/teacher/tasks/${t.id}/mode`, { mode: null, reset_students: true }); renderLive(await api('GET', `/api/teacher/tasks/${t.id}/live`)); };

  const cb = $('#controlBox');
  if (t.kind === 'control') {
    cb.innerHTML = t.control_active
      ? `<div class="row"><span class="badge ok">контрольная идёт</span><span class="muted small">Студенты работают в полноэкранном режиме; уход из окна и внешние вставки фиксируются.</span><span class="spacer"></span><button class="danger solid" id="ctlStop">Завершить контрольную и собрать работы</button></div>`
      : `<div class="row"><span class="badge">Контрольная не запущена</span><span class="spacer"></span><button class="primary" id="ctlStart">${icon('play')}Начать контрольную</button></div>`;
    const s1 = $('#ctlStart'), s2 = $('#ctlStop');
    if (s1) s1.onclick = async () => { await api('POST', `/api/teacher/tasks/${t.id}/control`, { active: true }); toast('Контрольная начата', 'ok'); renderLive(await api('GET', `/api/teacher/tasks/${t.id}/live`)); };
    if (s2) s2.onclick = async () => {
      if (!await confirmDialog('Завершить контрольную?', 'Все незавершённые работы будут автоматически сданы, редактирование закроется.', 'Завершить', true)) return;
      const r = await api('POST', `/api/teacher/tasks/${t.id}/control`, { active: false });
      toast(`Контрольная завершена. Автоматически сдано работ: ${r.auto_submitted}`, 'ok');
      renderLive(await api('GET', `/api/teacher/tasks/${t.id}/live`));
    };
  } else cb.innerHTML = '';

  const rows = d.rows;
  const tbl = $('#liveTbl');
  if (!rows.length) { tbl.innerHTML = '<tr><td class="empty">В группе курса нет студентов</td></tr>'; return; }
  tbl.innerHTML = `<thead><tr><th>Студент</th><th>Статус</th><th>Режим агента</th><th>Запросы</th><th>Код агента</th><th>Понимание</th><th>Тесты</th><th>Метки риска</th><th></th></tr></thead><tbody></tbody>`;
  const tb = $('tbody', tbl);
  for (const r of rows) {
    const s = r.session;
    if (!s) {
      tb.appendChild(h(`<tr><td><b>${esc(r.student.name)}</b><div class="muted small">${esc(r.student.login)}</div></td><td colspan="8" class="muted">не приступал</td></tr>`));
      continue;
    }
    const m = s.metrics;
    const status = s.status === 'active' ? (s.online ? '<span class="dot on"></span> работает' : '<span class="dot"></span> не в сети')
      : (s.status === 'closed' ? '<span class="label">закрыто</span>' : '<span class="label">сдано</span>');
    const tests = s.submission ? `<span class="badge ${s.submission.passed === s.submission.total ? 'ok' : 'warn'}">сдано ${s.submission.passed}/${s.submission.total}</span>`
      : (s.last_tests ? `<span class="badge">${s.last_tests.passed}/${s.last_tests.total}</span>` : '<span class="muted">—</span>');
    const tr = h(`<tr class="risk-${m.risk}">
      <td><b>${esc(r.student.name)}</b><div class="muted small">${esc(r.student.login)} · ${ago(s.last_activity)}</div></td>
      <td>${status}</td>
      <td><select data-mode style="width:auto;padding:3px 6px">
        <option value="">как у группы (${MODE_TITLES[t.live_mode || t.mode]})</option>
        ${Object.keys(MODE_TITLES).map(x => `<option value="${x}" ${s.mode_override === x ? 'selected' : ''}>${MODE_ICONS[x]} ${MODE_TITLES[x]}</option>`).join('')}</select></td>
      <td>${m.requests}${m.bypass ? ` <span class="badge bad" title="попытки обхода">обход ${m.bypass}</span>` : ''}</td>
      <td><span class="share"><i style="width:${Math.round(m.agent_share * 100)}%"></i></span> <span class="small">${Math.round(m.agent_share * 100)}%</span><div class="muted small">${m.agent_lines} из ${m.total_lines} строк</div></td>
      <td><span class="badge ok">да ${m.checks_passed}</span> <span class="badge ${m.checks_failed ? 'bad' : ''}">нет ${m.checks_failed}</span>${s.pending_check ? ' <span class="badge warn">ждёт ответа</span>' : ''}</td>
      <td>${tests}</td>
      <td><div class="flags">${m.flags.map(f => `<span class="badge ${f.level === 'high' ? 'bad' : 'warn'}">${esc(f.text)}</span>`).join('') || '<span class="muted small">нет</span>'}</div></td>
      <td><div class="row"><button class="sm" data-q title="Задать вопрос по коду студента">${icon('question')}Вопрос</button><button class="sm primary" data-open>Открыть</button></div></td></tr>`);
    const sel = $('[data-mode]', tr);
    sel.onchange = async () => {
      await api('POST', `/api/teacher/sessions/${s.id}/mode`, { mode: sel.value || null });
      toast(`${r.student.name}: режим ${sel.value ? MODE_TITLES[sel.value] : 'как у группы'}`, 'ok');
    };
    $('[data-q]', tr).onclick = () => askQuestion(s.id, r.student.name);
    $('[data-open]', tr).onclick = () => location.hash = '#session/' + s.id;
    tb.appendChild(tr);
  }
}

function askQuestion(sid, name) {
  const m = modal(`<span class="eyebrow">Проверка понимания</span><h2>Вопрос студенту</h2>
    <p class="muted">${esc(name)} получит вопрос по своему коду и не сможет продолжить, пока не ответит. Оставьте поле пустым — вопрос по строкам агента (или по всему коду) сформулирует модель.</p>
    <textarea id="qText" rows="3" placeholder="Например: что делает функция solve при пустом списке?"></textarea>
    <div class="actions"><button data-close>Отмена</button><button class="primary" data-send>Задать</button></div>`);
  $('[data-send]', m.el).onclick = async () => {
    const b = $('[data-send]', m.el); b.disabled = true; b.innerHTML = aiMx(3) + ' Отправка';
    try {
      const r = await api('POST', `/api/teacher/sessions/${sid}/check`, { question: $('#qText').value });
      m.close(); toast('Вопрос отправлен: ' + r.question.slice(0, 80), 'ok');
    } catch (e) { toast(e.message, 'bad'); b.disabled = false; b.textContent = 'Задать'; }
  };
}

// ================================================================== просмотр сессии
async function viewSession(sid) {
  const d = await api('GET', `/api/teacher/sessions/${sid}`);
  const { session: s, task: t, student: st, events, checks, submissions: subs, metrics: m } = d;
  const snaps = events.filter(e => e.type === 'code_snapshot');
  const v = V();
  v.innerHTML = `
    <a class="back label" href="#live/${t.id}">${icon('back')}Живая пара</a><div class="view-head">
      <div class="grow"><span class="eyebrow">Сессия · ${esc(t.title)}</span><h1>${esc(st.name)}</h1></div>
      <select id="sMode" style="width:auto"><option value="">режим: как у группы</option>${Object.keys(MODE_TITLES).map(x => `<option value="${x}" ${s.mode_override === x ? 'selected' : ''}>${MODE_ICONS[x]} ${MODE_TITLES[x]}</option>`).join('')}</select>
      <button id="sQ">${icon('question')}Задать вопрос</button>
      ${s.status !== 'active' ? '<button id="sReopen">Открыть заново</button>' : ''}
    </div>
    <div class="stats section">
      <div class="stat"><span class="label">Запросы к агенту</span><b class="num">${pad2(m.requests)}</b><span>${m.bypass ? 'попыток обхода: ' + m.bypass : 'без попыток обхода'}</span></div>
      <div class="stat"><span class="label">Код агента</span><b class="num">${Math.round(m.agent_share * 100)}<small>%</small></b><div class="meter"><i style="width:${Math.round(m.agent_share * 100)}%"></i></div><span>${m.agent_lines} из ${m.total_lines} строк</span></div>
      <div class="stat"><span class="label">Проверки понимания</span><b class="num">${pad2(m.checks_passed)}<small>/${pad2(m.checks_passed + m.checks_failed)}</small></b><span>пройдено</span></div>
      <div class="stat"><span class="label">Запуски</span><b class="num">${pad2(m.runs)}</b><span>с ошибкой: ${m.errors}</span></div>
    </div>
    ${m.flags.length ? `<div class="card section"><b>Метки риска:</b> <span class="flags" style="display:inline-flex">${m.flags.map(f => `<span class="badge ${f.level === 'high' ? 'bad' : 'warn'}">${esc(f.text)}</span>`).join('')}</span></div>` : ''}
    <div class="sess">
      <div class="col">
        <div class="card col">
          <div class="row"><h3 class="grow" style="margin:0">Как писался код</h3><span class="muted small" id="snapInfo"></span></div>
          <input type="range" id="snapRange" min="0" max="${Math.max(0, snaps.length - 1)}" value="${Math.max(0, snaps.length - 1)}">
          <div class="row small muted"><span>начало</span><span class="spacer"></span><span><span style="display:inline-block;width:10px;height:10px;background:var(--agent-bg);box-shadow:inset 2px 0 0 var(--text);vertical-align:-1px"></span> строки агента</span><span class="spacer"></span><span>сейчас</span></div>
          <div class="codeview" id="codeView"></div>
        </div>
        <div class="card col" id="subBox"></div>
        <div class="card col"><h3>Проверки понимания</h3><div id="checksBox"></div></div>
      </div>
      <div class="card col">
        <div class="row"><h3 class="grow" style="margin:0">Журнал сессии</h3>
          <label class="check small"><input type="checkbox" id="showSnaps"> правки кода</label></div>
        <div class="muted small">Начата ${fmtDateTime(s.started_at)} · рабочее место: ${esc(s.workplace || '—')} · ${d.online ? '<span class="dot on"></span> в сети' : 'не в сети'}</div>
        <div class="timeline" id="timeline"></div>
      </div>
    </div>`;

  const showSnap = i => {
    const sn = snaps[i];
    if (!sn) { $('#codeView').innerHTML = '<div class="empty">Нет кода</div>'; return; }
    const code = sn.payload.code || '';
    const al = new Set(sn.payload.agent_lines || []);
    $('#codeView').innerHTML = code.split('\n').map((ln, k) => `<div class="ln ${al.has(k + 1) ? 'agent' : ''}"><span>${k + 1}</span><span>${esc(ln) || ' '}</span></div>`).join('');
    $('#snapInfo').textContent = `версия ${i + 1} из ${snaps.length} · ${fmtTime(sn.ts)}`;
    $$('.ev').forEach(e => e.classList.toggle('current', +e.dataset.id === sn.id));
  };
  $('#snapRange').oninput = e => showSnap(+e.target.value);
  showSnap(snaps.length - 1);

  const renderTimeline = () => {
    const withSnaps = $('#showSnaps').checked;
    const tl = $('#timeline');
    tl.innerHTML = '';
    for (const e of events) {
      if (e.type === 'code_snapshot' && !withSnaps) continue;
      const el = renderEvent(e);
      if (!el) continue;
      el.dataset.id = e.id;
      el.classList.add('clickable');
      el.onclick = () => {
        let idx = 0;
        snaps.forEach((sn, i) => { if (sn.id <= e.id) idx = i; });
        $('#snapRange').value = idx; showSnap(idx);
      };
      tl.appendChild(el);
    }
  };
  $('#showSnaps').onchange = renderTimeline;
  renderTimeline();

  $('#checksBox').innerHTML = checks.length ? checks.map(c => `
    <div class="ev ${c.answered_at ? (c.passed ? 'ok' : 'bad') : 'warn'}">
      <div class="head"><span>${c.source === 'teacher' ? 'вопрос преподавателя' : 'после вставки кода агента'}</span><span>${fmtTime(c.created_at)}</span><span class="spacer"></span>
        ${c.answered_at ? `<b>${c.passed ? 'засчитано' : 'не засчитано'} · ${Math.round(c.score * 100)}%</b>` : '<span class="badge warn">нет ответа</span>'}</div>
      <div class="body"><b>${esc(c.question)}</b>${c.answer ? `<div>Ответ: ${esc(c.answer)}</div><div class="muted small">${esc(c.feedback || '')}</div>` : ''}</div>
    </div>`).join('') : '<span class="muted small">Проверок не было.</span>';

  renderSubmissions(subs, t);

  $('#sMode').onchange = async e => { await api('POST', `/api/teacher/sessions/${sid}/mode`, { mode: e.target.value || null }); toast('Режим изменён', 'ok'); };
  $('#sQ').onclick = () => askQuestion(sid, st.name);
  const ro = $('#sReopen');
  if (ro) ro.onclick = async () => { await api('POST', `/api/teacher/sessions/${sid}/reopen`); toast('Работа открыта для студента', 'ok'); route(); };
}

function renderEvent(e) {
  const p = e.payload || {};
  const time = fmtTime(e.ts);
  const box = (cls, title, body = '') => h(`<div class="ev ${cls}"><div class="head"><span>${time}</span><b>${title}</b></div>${body ? `<div class="body">${body}</div>` : ''}</div>`);
  switch (e.type) {
    case 'session_start': return box('', 'Начало работы');
    case 'session_resume': return box('', 'Студент вернулся к заданию');
    case 'code_snapshot': return box('', 'Правка кода', `<span class="muted small">${(p.code || '').split('\n').length} строк</span>`);
    case 'chat_user': return box('user', 'Студент → агенту', `<div style="white-space:pre-wrap">${esc(p.text)}</div><span class="muted small">режим: ${MODE_TITLES[p.mode] || p.mode}</span>`);
    case 'chat_agent': return box(p.blocked ? 'bad' : 'agent', 'Агент' + (p.blocked ? ' · ответ заблокирован' : p.rewritten ? ' · ответ переписан' : '') + (p.silent ? ' · молчание' : ''),
      `<div class="md">${renderMd(p.text || '')}</div>` + ((p.violations || []).length ? `<div class="small" style="color:var(--text)">${p.violations.map(v => esc(v.text)).join('<br>')}</div>` : ''));
    case 'agent_violation': return box('bad', 'Проверка ответа агента: нарушение', `${(p.violations || []).map(v => esc(v.text)).join('<br>')}<details><summary class="muted small">исходный ответ модели</summary><div class="md">${renderMd(p.original || '')}</div></details>`);
    case 'bypass_attempt': return box('bad', 'Попытка обхода правил', esc(p.text));
    case 'agent_insert': return box('agent', 'Вставлен код агента', `<pre>${esc(p.fragment)}</pre><span class="muted small">строки ${p.from}–${p.to}</span>`);
    case 'agent_reject': return box('', 'Студент отклонил вставку кода агента');
    case 'check_asked': return box('warn', 'Вопрос на понимание' + (p.source === 'teacher' ? ' (преподаватель)' : ''), esc(p.question));
    case 'check_answer': return box(p.passed ? 'ok' : 'bad', `Ответ: ${p.passed ? 'засчитан' : 'не засчитан'} (${Math.round((p.score || 0) * 100)}%)`, `${esc(p.answer)}<div class="muted small">${esc(p.feedback || '')}</div>`);
    case 'run': return box(p.exit_code === 0 ? '' : 'warn', `Запуск · код ${p.exit_code}${p.timeout ? ' · тайм-аут' : ''}`,
      (p.stdin ? `<span class="muted small">ввод:</span><pre>${esc(p.stdin)}</pre>` : '') + (p.stdout ? `<pre>${esc(p.stdout)}</pre>` : '') + (p.stderr ? `<pre style="color:var(--text)">${esc(p.stderr)}</pre>` : ''));
    case 'run_error': return null;
    case 'tests': return box(p.passed === p.total ? 'ok' : '', `Тесты: ${p.passed} из ${p.total}`);
    case 'paste': return p.external ? box('warn', `Вставка внешнего текста: ${p.lines} строк, ${p.chars} символов`) : (p.source === 'agent_chat' ? box('agent', 'Вставлен код из чата с агентом') : null);
    case 'paste_blocked': return box('bad', `Заблокирована вставка (${p.lines} строк)`);
    case 'focus_lost': return box('bad', 'Студент ушёл из окна контрольной');
    case 'fullscreen_exit': return box('bad', 'Выход из полноэкранного режима');
    case 'fullscreen_enter': return box('', 'Полноэкранный режим');
    case 'mode_change': return box('', `Режим агента: ${MODE_TITLES[p.mode] || 'как у группы'} (${p.scope === 'group' ? 'для группы' : 'лично'}, ${esc(p.by || '')})`);
    case 'control_start': return box('', 'Контрольная начата');
    case 'submit': return box('ok', `Сдача${p.auto ? ' (автоматически по окончании контрольной)' : ''}: тесты ${p.passed}/${p.total}`);
    case 'graded': return box('ok', `Оценка: ${esc(p.grade || '—')} (${esc(p.by || '')})`);
    case 'reopened': return box('', 'Работа открыта заново преподавателем');
    case 'agent_error': return box('bad', 'Ошибка модели', esc(p.error));
    default: return box('', esc(e.type), `<pre>${esc(JSON.stringify(p, null, 1))}</pre>`);
  }
}

function renderSubmissions(subs, t) {
  const box = $('#subBox');
  if (!subs.length) { box.innerHTML = '<h3>Сдача</h3><span class="muted small">Работа ещё не сдана.</span>'; return; }
  const last = subs[subs.length - 1];
  const r = last.results || {};
  box.innerHTML = `<h3>Сдача ${subs.length > 1 ? `(попытка ${subs.length})` : ''} · ${fmtDateTime(last.created_at)}</h3>
    <div class="row wrap"><span class="badge ${last.passed === last.total ? 'ok' : 'warn'}">тесты ${last.passed}/${last.total}</span>
      ${r.auto ? '<span class="badge">сдано автоматически</span>' : ''}
      ${(r.forbidden_in_student_code || []).length ? `<span class="badge bad">в коде запрещённые конструкции: ${esc([...new Set(r.forbidden_in_student_code.map(f => f.title))].join(', '))}</span>` : ''}</div>
    <details><summary class="small">Результаты тестов</summary>${(r.cases || []).map(c => `<div class="ev ${c.ok ? 'ok' : 'bad'}"><div class="head"><span class="label">${c.ok ? 'пройден' : 'не пройден'} · тест ${pad2(c.n)}</span>${c.hidden ? '<span class="badge">скрытый</span>' : ''}</div>
      ${c.input !== undefined ? `<div class="body small">ввод: <code>${esc(c.input)}</code> · ожидалось: <code>${esc(c.expected)}</code> · получено: <code>${esc(c.actual)}</code></div>` : ''}</div>`).join('')}</details>
    <div class="row"><label class="field" style="width:120px"><span>Оценка</span><input id="gGrade" value="${esc(last.grade || '')}" placeholder="5 / зачёт"></label>
      <label class="field grow"><span>Комментарий студенту</span><input id="gComment" value="${esc(last.comment || '')}"></label>
      <button class="primary" id="gSave" style="align-self:flex-end">Сохранить</button></div>`;
  $('#gSave').onclick = async () => {
    await api('POST', `/api/teacher/submissions/${last.id}/grade`, { grade: $('#gGrade').value, comment: $('#gComment').value });
    toast('Оценка сохранена', 'ok');
  };
}

// ================================================================== отчёты
async function viewReports(courseId) {
  if (!OV.courses.length) { V().innerHTML = '<div class="card empty">Нет курсов</div>'; return; }
  courseId = +courseId || OV.courses[0].id;
  const d = await api('GET', `/api/teacher/courses/${courseId}/report`);
  const v = V();
  v.innerHTML = `<div class="view-head"><div><span class="eyebrow">03 · Итоги группы</span><h1>Отчёты и оценки</h1></div>
      <select id="cSel" style="width:auto">${OV.courses.map(c => `<option value="${c.id}" ${c.id === courseId ? 'selected' : ''}>${esc(c.title)}</option>`).join('')}</select>
      <div class="spacer"></div><a class="btn" href="/api/teacher/courses/${courseId}/export.csv">${icon('download')}Выгрузка оценок (CSV для СДО / Moodle)</a></div>
    <div class="card" style="padding:0;overflow:auto"><table class="tbl matrix" id="mx"></table></div>
    <p class="muted small">В ячейке: тесты последней сдачи, оценка, доля кода агента и проверки понимания. Рамка — уровень риска: сплошная — высокий, пунктир — средний. Нажмите на ячейку, чтобы открыть сессию.</p>`;
  $('#cSel').onchange = e => location.hash = '#reports/' + e.target.value;
  const mx = $('#mx');
  mx.innerHTML = `<thead><tr><th>Студент</th>${d.tasks.map(t => `<th>${esc(t.title)}${t.kind === 'control' ? ' · к/р' : ''}</th>`).join('')}</tr></thead>
    <tbody>${d.rows.map(r => `<tr><td><b>${esc(r.student.name)}</b><div class="muted small">${esc(r.student.login)}</div></td>${r.cells.map(c => {
      if (!c.session_id) return '<td><span class="cell empty">—</span></td>';
      const sub = c.submission;
      return `<td><span class="cell risk-${c.risk}" data-s="${c.session_id}">
        ${sub ? `<b>${sub.passed}/${sub.total}</b>` : '<span class="muted small">в работе</span>'}
        ${sub && sub.grade ? `<span class="badge accent">${esc(sub.grade)}</span>` : ''}
        <span class="small muted">ИИ ${Math.round((c.agent_share || 0) * 100)}% · ${c.checks_passed}/${c.checks_passed + c.checks_failed}</span></span></td>`;
    }).join('')}</tr>`).join('')}</tbody>
    <tfoot><tr><th>Сводка по группе</th>${d.summary.map(s => `<th class="small" style="font-weight:400">сдали ${s.submitted}/${s.students}<br>все тесты: ${s.full_pass}<br>ср. код ИИ: ${Math.round(s.avg_agent_share * 100)}%<br>высокий риск: ${s.high_risk}</th>`).join('')}</tr></tfoot>`;
  $$('[data-s]', mx).forEach(c => c.onclick = () => location.hash = '#session/' + c.dataset.s);
}

// ================================================================== группы
async function viewGroups() {
  const { groups } = await api('GET', '/api/teacher/groups');
  const v = V();
  v.innerHTML = `<div class="view-head"><div><span class="eyebrow">04 · Учётные записи</span><h1>Группы и студенты</h1></div><div class="spacer"></div>
    <input id="gName" placeholder="Название новой группы" style="width:220px"><button class="primary" id="gAdd">${icon('plus')}Группа</button></div>
    <p class="muted small" style="margin-top:-8px">В архитектуре учётки приходят из LDAP / Active Directory вуза; в локальном прототипе студентов можно импортировать списком.</p>
    <div class="grid2" id="gl"></div>`;
  $('#gAdd').onclick = async () => {
    try { await api('POST', '/api/teacher/groups', { name: $('#gName').value }); route(); } catch (e) { toast(e.message, 'bad'); }
  };
  for (const g of groups) {
    const el = h(`<div class="card col"><div class="row"><h2 class="grow" style="margin:0">${esc(g.name)}</h2><span class="badge">${g.students.length} студ.</span></div>
      <table class="tbl"><tbody>${g.students.map(s => `<tr><td>${esc(s.name)}</td><td class="muted">${esc(s.login)}</td><td style="text-align:right"><button class="sm ghost danger" data-del="${s.id}">удалить</button></td></tr>`).join('') || '<tr><td class="muted">Нет студентов</td></tr>'}</tbody></table>
      <details><summary>Импорт студентов</summary>
        <div class="muted small">По строке на студента: <code>логин;ФИО;пароль</code></div>
        <textarea rows="4" class="mono" data-imp placeholder="ivanov;Иван Иванов;pass123"></textarea>
        <button class="sm primary" data-go style="margin-top:6px">Импортировать</button></details></div>`);
    $$('[data-del]', el).forEach(b => b.onclick = async () => {
      if (!await confirmDialog('Удалить студента?', 'Вместе с его сессиями и сдачами.', 'Удалить', true)) return;
      await api('DELETE', `/api/teacher/users/${b.dataset.del}`); route();
    });
    $('[data-go]', el).onclick = async () => {
      const r = await api('POST', '/api/teacher/users/import', { group_id: g.id, text: $('[data-imp]', el).value });
      toast(`Создано: ${r.created}` + (r.errors.length ? `. Ошибки: ${r.errors.join('; ')}` : ''), r.errors.length ? 'bad' : 'ok');
      route();
    };
    $('#gl').appendChild(el);
  }
}

// ================================================================== настройки моделей
async function viewSettings() {
  const d = await api('GET', '/api/admin/settings');
  const v = V();
  const roleForm = (role, c) => `
    <div class="col" data-role="${role}">
      ${role === 'checker' ? `<label class="check"><input type="checkbox" data-f="same_as_main" ${c.same_as_main ? 'checked' : ''}> Использовать ту же модель, что и для ответов</label>` : ''}
      <div class="col" data-fields>
        <label class="field"><span>Провайдер</span><select data-f="provider">
          <option value="mock" ${c.provider === 'mock' ? 'selected' : ''}>Демо-режим без модели</option>
          <option value="openai" ${c.provider === 'openai' ? 'selected' : ''}>Локальная или облачная модель (OpenAI-совместимый API)</option></select></label>
        <div data-real class="col">
          <div class="row wrap small"><span class="muted">Быстрая настройка:</span>${Object.entries(d.presets).map(([k, u]) => `<button class="sm" data-preset="${u}">${{ ollama: 'Ollama', lmstudio: 'LM Studio', llamacpp: 'llama.cpp', vllm: 'vLLM' }[k]}</button>`).join('')}</div>
          <label class="field"><span>Адрес API (base URL)</span><input data-f="base_url" value="${esc(c.base_url)}"></label>
          <div class="row"><label class="field grow"><span>Модель</span><input data-f="model" value="${esc(c.model)}" list="ml-${role}" placeholder="например qwen2.5-coder:7b"><datalist id="ml-${role}"></datalist></label>
            <button style="align-self:flex-end" data-list>Загрузить список</button></div>
          <div class="grid3">
            <label class="field"><span>API-ключ (если нужен)</span><input data-f="api_key" type="password" value="${esc(c.api_key)}" placeholder="не нужен для локальных"></label>
            <label class="field"><span>Температура</span><input data-f="temperature" type="number" step="0.1" min="0" max="2" value="${c.temperature}"></label>
            <label class="field"><span>Тайм-аут, с</span><input data-f="timeout" type="number" min="10" value="${c.timeout}"></label>
          </div>
        </div>
      </div>
      <div class="row"><button data-test>Проверить связь</button><span data-testres class="small"></span></div>
    </div>`;
  v.innerHTML = `<div class="view-head"><div><span class="eyebrow">05 · Адаптер языковых моделей</span><h1>Модели и настройки</h1></div><div class="spacer"></div><button class="primary" id="sSave">${icon('check')}Сохранить</button></div>
    <div class="card section small" style="border-left:2px solid var(--text)">
      Агент обращается к модели через единый адаптер. Подходит любой сервер с OpenAI-совместимым API: <b>Ollama</b>
      (<code>ollama pull qwen2.5-coder:7b</code>), <b>LM Studio</b>, <b>llama.cpp server</b>, <b>vLLM</b>. Можно использовать разные модели:
      сильную — для ответов студенту, лёгкую — для служебных проверок и оценки ответов.
    </div>
    <div class="grid2">
      <div class="card col"><span class="num dim" style="font-size:44px">01</span><h3>Модель для ответов студенту</h3>${roleForm('main', d.llm.main)}</div>
      <div class="card col"><span class="num dim" style="font-size:44px">02</span><h3>Модель-контролёр</h3><div class="muted small">Проверка ответов агента на готовое решение, вопросы и оценка объяснений студентов.</div>${roleForm('checker', d.llm.checker)}</div>
    </div>
    <div class="card col section" style="margin-top:14px"><h3>Запуск кода студентов</h3>
      <div class="grid3">
        <label class="field"><span>Лимит времени на запуск, с</span><input id="rTimeout" type="number" min="1" max="60" value="${d.runner.timeout ?? 5}"></label>
        ${d.in_docker ? '<span class="label muted" style="align-self:flex-end">Платформа работает в Docker: код студентов изолирован контейнером</span><input type="checkbox" id="rDocker" class="hidden">' : `<label class="check" style="align-self:flex-end"><input type="checkbox" id="rDocker" ${d.runner.use_docker ? 'checked' : ''}> Изолировать в Docker (без сети, лимиты памяти/CPU)</label>`}
      </div>
      <div class="small">${Object.entries(d.languages).map(([k, x]) => `<span class="badge ${x.available ? 'ok' : 'bad'}">${LANG_TITLES[k]}: ${esc(x.info)}</span>`).join(' ')}</div>
    </div>`;

  $$('[data-role]').forEach(box => {
    const role = box.dataset.role;
    const f = n => $(`[data-f="${n}"]`, box);
    const sync = () => {
      const same = role === 'checker' && f('same_as_main').checked;
      $('[data-fields]', box).classList.toggle('hidden', same);
      $('[data-real]', box).classList.toggle('hidden', f('provider').value === 'mock');
    };
    f('provider').onchange = sync;
    if (role === 'checker') f('same_as_main').onchange = sync;
    sync();
    $$('[data-preset]', box).forEach(b => b.onclick = () => { f('base_url').value = b.dataset.preset; f('provider').value = 'openai'; sync(); });
    $('[data-list]', box).onclick = async () => {
      try {
        const r = await api('POST', '/api/admin/models', { base_url: f('base_url').value, api_key: f('api_key').value, role });
        $(`#ml-${role}`).innerHTML = r.models.map(m => `<option value="${esc(m)}">`).join('');
        if (r.models.length && !f('model').value) f('model').value = r.models[0];
        toast(r.models.length ? `Найдено моделей: ${r.models.length}` : 'Сервер не вернул ни одной модели', r.models.length ? 'ok' : 'bad');
      } catch (e) { toast(e.message, 'bad'); }
    };
    $('[data-test]', box).onclick = async () => {
      await save(false);
      const res = $('[data-testres]', box);
      res.innerHTML = aiMx(4);
      const r = await api('POST', '/api/admin/test', { role });
      res.innerHTML = `<span class="badge ${r.ok ? 'ok' : 'bad'}">${esc(r.message)}</span>`;
    };
  });

  const collect = role => {
    const box = $(`[data-role="${role}"]`);
    const o = {};
    $$('[data-f]', box).forEach(i => o[i.dataset.f] = i.type === 'checkbox' ? i.checked : i.value);
    return o;
  };
  async function save(show = true) {
    try {
      await api('PUT', '/api/admin/settings', {
        llm: { main: collect('main'), checker: collect('checker') },
        runner: { timeout: +$('#rTimeout').value || 5, use_docker: $('#rDocker').checked },
      });
      if (show) toast('Настройки сохранены', 'ok');
      await loadOverview();
    } catch (e) { toast(e.message, 'bad'); throw e; }
  }
  $('#sSave').onclick = () => save(true);
}

// ================================================================== универсальный агент: политика для студентов
async function viewAgentPolicy() {
  const [{ policy, groups, modes }, { students }] = await Promise.all([api('GET', '/api/ws/policy'), api('GET', '/api/ws/students')]);
  const num = { explain: '01', hints: '02', agent: '03' };
  const help = {
    explain: 'Читает проект, запускает, объясняет и делает ревью. Файлы не меняет.',
    hints: 'Ведёт наводящими вопросами. Файлы не меняет.',
    agent: 'Полный агент: пишет и правит файлы, отлаживает.',
  };
  const opts = (sel, withInherit) => (withInherit ? `<option value="">как по умолчанию</option>` : '')
    + Object.keys(modes).map(k => `<option value="${k}" ${sel === k ? 'selected' : ''}>${num[k]} ${modes[k]}</option>`).join('');
  const v = V();
  v.innerHTML = `<div class="view-head"><div><span class="eyebrow">06 · Универсальный агент</span><h1>Агент для студентов</h1></div>
      <div class="spacer"></div><a class="btn" href="/agent">${icon('arrow')}Открыть агента</a></div>
    <p class="muted" style="max-width:52em;margin-top:-14px;margin-bottom:28px">Кроме заданий курса, у каждого студента есть свободный ИИ-агент для своих задач и проектов. Здесь задаётся, насколько далеко агент может заходить. Преподаватели и администраторы пользуются агентом без ограничений и выбирают режим сами.</p>
    <div class="stats section" style="grid-template-columns:repeat(3,1fr)">${Object.keys(modes).map(k => `
      <div class="stat"><span class="label">${modes[k]}</span><b class="num">${num[k]}</b><span>${help[k]}</span></div>`).join('')}</div>
    <div class="grid2 section">
      <div class="card col">
        <h3>Режим по умолчанию</h3>
        <div class="muted small">Для всех студентов, если для группы не задано иное.</div>
        <select id="polDefault">${opts(policy.default_student, false)}</select>
      </div>
      <div class="card col">
        <h3>Режим по группам</h3>
        ${groups.map(g => `<label class="field"><span>${esc(g.name)}</span><select data-g="${g.id}">${opts(policy.groups[String(g.id)] || '', true)}</select></label>`).join('') || '<span class="muted">Групп нет</span>'}
      </div>
    </div>
    <div class="row section"><button class="primary" id="polSave">${icon('check')}Сохранить политику</button></div>
    <span class="eyebrow" style="margin-top:20px">Как студенты пользуются агентом</span>
    <div class="card" style="padding:0;overflow:auto"><table class="tbl"><thead><tr><th>Студент</th><th>Группа</th><th>Проекты</th><th>Запросы</th><th>Обход</th><th>Активность</th><th></th></tr></thead>
      <tbody>${students.map(s => `<tr><td><b>${esc(s.name)}</b><div class="label muted">${esc(s.login)}</div></td><td>${esc(s.group_name || '—')}</td>
        <td>${s.projects}</td><td>${s.requests}</td><td>${s.bypass ? `<span class="badge bad">${s.bypass}</span>` : '<span class="muted">0</span>'}</td>
        <td class="muted small">${s.last ? ago(s.last) : '—'}</td>
        <td>${s.projects ? `<button class="sm" data-u="${s.id}" data-n="${esc(s.name)}">${icon('eye')}Проекты</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`;
  $('#polSave').onclick = async () => {
    const g = {};
    $$('[data-g]').forEach(s => g[s.dataset.g] = s.value);
    await api('PUT', '/api/ws/policy', { default_student: $('#polDefault').value, groups: g });
    toast('Политика агента сохранена', 'ok');
  };
  $$('[data-u]').forEach(b => b.onclick = async () => {
    const r = await api('GET', `/api/ws/projects?user_id=${b.dataset.u}`);
    modal(`<span class="eyebrow">Проекты студента</span><h2>${esc(b.dataset.n)}</h2>
      <div class="col">${r.projects.map(p => `<a class="btn" href="/agent#p/${p.id}" target="_blank" style="justify-content:space-between">
        <span>${esc(p.title)}</span><span class="label">${p.files} файлов · ${p.requests} запросов</span></a>`).join('')}</div>
      <div class="actions"><button data-close>Закрыть</button></div>`);
  });
}
