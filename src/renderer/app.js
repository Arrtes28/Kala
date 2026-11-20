'use strict';

(() => {
  const {
    h,
    ICONS,
    MODE_LABEL,
    MODE_SHORT,
    PRIORITY_LABEL,
    fmtTime,
    fmtMinutes,
    deadlineInfo,
    fmtDate,
    fmtDayLabel,
    toLocalInput,
    fromLocalInput,
    sortTasks,
  } = NF;

  const api = window.api;
  const $ = (id) => document.getElementById(id);

  const RING_C = 2 * Math.PI * 116;
  const DONUT_C = 2 * Math.PI * 48;

  let S = { timer: null, settings: null, tasks: [], stats: null };
  let filter = 'all';
  let query = '';
  let editingId = null;
  let selectKey = '';


  function switchTab(tab) {
    if (!document.getElementById('tab-' + tab)) return;
    document.querySelectorAll('.tab').forEach((el) => el.classList.toggle('active', el.id === 'tab-' + tab));
    document.querySelectorAll('.nav-btn').forEach((el) => el.classList.toggle('active', el.dataset.tab === tab));
  }

  $('nav').addEventListener('click', (e) => {
    const btn = e.target.closest('.nav-btn');
    if (btn) switchTab(btn.dataset.tab);
  });
  api.onNav(switchTab);



  function buildStatic() {
    $('btnReset').innerHTML = ICONS.reset;
    $('btnSkip').innerHTML = ICONS.skip;
    $('btnReset').addEventListener('click', () => api.timer('reset'));
    $('btnSkip').addEventListener('click', () => api.timer('skip'));
    $('btnToggle').addEventListener('click', () => api.timer('toggle'));
    $('btnQuit').addEventListener('click', () => api.quit());

    for (const mode of ['focus', 'short', 'long']) {
      $('segModes').append(
        h('button', { dataset: { mode }, onclick: () => api.timer('setMode', mode) }, MODE_LABEL[mode])
      );
    }

    $('ringFg').style.strokeDasharray = String(RING_C);

    $('taskSelect').addEventListener('change', (e) => api.timer('setTask', e.target.value || null));

    $('btnTestSound').addEventListener('click', () => NF.playSound('focus-end'));
  }



  function renderTimer() {
    const t = S.timer;
    if (!t) return;

    document.body.dataset.mode = t.mode;
    $('time').textContent = fmtTime(t.remaining);
    $('modeLabel').textContent = MODE_LABEL[t.mode];
    const progress = t.total ? (t.total - t.remaining) / t.total : 0;
    $('ringFg').style.strokeDashoffset = String(RING_C * progress);
    $('btnToggle').innerHTML = t.running ? ICONS.pause : ICONS.play;

    for (const btn of $('segModes').children) btn.classList.toggle('active', btn.dataset.mode === t.mode);

    const dots = $('dots');
    if (dots.children.length !== t.longEvery) {
      dots.replaceChildren(...Array.from({ length: t.longEvery }, () => h('i')));
    }
    Array.from(dots.children).forEach((d, i) => d.classList.toggle('on', i < t.cycleDone));

    $('mini').classList.toggle('running', t.running);
    $('miniTime').textContent = fmtTime(t.remaining);
    $('miniMode').textContent = MODE_SHORT[t.mode];
    document.title = t.running ? `${fmtTime(t.remaining)} - ${MODE_LABEL[t.mode]}` : 'Kala';

    let sub = 'Pilih tugas, lalu tekan mulai.';
    if (t.running) sub = t.mode === 'focus' ? 'Tetap fokus, sebentar lagi selesai.' : 'Waktunya istirahat sejenak.';
    else if (t.remaining !== t.total) sub = 'Timer dijeda. Lanjutkan kapan saja.';
    $('focusSub').textContent = sub;

    const sel = $('taskSelect');
    const want = t.taskId || '';
    if (sel.value !== want) sel.value = want;
    renderTaskMeta();
  }

  function renderTaskMeta() {
    const t = S.timer;
    const task = t && t.taskId ? S.tasks.find((x) => x.id === t.taskId) : null;
    const el = $('taskMeta');
    if (!task) {
      el.textContent = 'Setiap sesi fokus yang selesai akan dihitung ke tugas yang dipilih.';
      return;
    }
    const info = deadlineInfo(task.deadline, false);
    el.textContent = `${task.pomodoros} sesi fokus tercatat. ${info.level === 'none' ? '' : 'Deadline: ' + info.text + '.'}`;
  }

  function renderTaskSelect() {
    const pending = sortTasks(S.tasks).filter((t) => !t.done);
    const key = pending.map((t) => t.id + '|' + t.title).join('~');
    if (key === selectKey) return;
    selectKey = key;
    const sel = $('taskSelect');
    sel.replaceChildren(
      h('option', { value: '' }, 'Tanpa tugas tertentu'),
      ...pending.map((t) => h('option', { value: t.id }, t.course ? `${t.title} (${t.course})` : t.title))
    );
    sel.value = S.timer && S.timer.taskId ? S.timer.taskId : '';
  }

    function renderUpcoming() {
      const list = $('upcoming');
      const items = sortTasks(S.tasks)
        .filter((t) => !t.done && t.deadline)
        .slice(0, 4);
      list.replaceChildren();
      if (!items.length) {
        list.append(h('li', null, h('span', { class: 't muted' }, 'Belum ada tugas dengan deadline.')));
        return;
      }
      for (const t of items) {
        const info = deadlineInfo(t.deadline, false);
        list.append(h('li', null, h('span', { class: 't' }, t.title), h('span', { class: 'd ' + info.level }, info.text)));
      }
    }

  function renderSideStats() {
    const st = S.stats;
    if (!st) return;
    $('todaySessions').textContent = st.todaySessions;
    $('todayMinutes').textContent = st.todayMinutes;
    $('streakNum').textContent = st.streak;
  }


  function renderBadge() {
    const pending = S.tasks.filter((t) => !t.done).length;
    const badge = $('badge');
    badge.hidden = pending === 0;
    badge.textContent = pending;
  }

    function matchesFilter(task, now) {
      if (filter === 'open') return !task.done;
      if (filter === 'done') return task.done;
      if (filter === 'overdue') return !task.done && task.deadline && new Date(task.deadline).getTime() < now;
      return true;
    }

  function renderFilters() {
    const now = Date.now();
    const defs = [
      ['all', 'Semua'],
      ['open', 'Belum'],
      ['done', 'Selesai'],
      ['overdue', 'Terlambat'],
    ];
    $('segFilter').replaceChildren(
      ...defs.map(([key, label]) =>
        h(
          'button',
          { class: filter === key ? 'active' : '', onclick: () => setFilter(key) },
          label,
          h('span', { class: 'count' }, S.tasks.filter((t) => filterCount(t, key, now)).length)
        )
      )
    );
  }

    function filterCount(task, key, now) {
      if (key === 'open') return !task.done;
      if (key === 'done') return task.done;
      if (key === 'overdue') return !task.done && task.deadline && new Date(task.deadline).getTime() < now;
      return true;
    }

  function setFilter(key) {
    filter = key;
    renderFilters();
    renderTasks();
  }

  function renderTasks() {
    const now = Date.now();
    const q = query.trim().toLowerCase();
    const items = sortTasks(S.tasks).filter(
      (t) => matchesFilter(t, now) && (!q || t.title.toLowerCase().includes(q) || t.course.toLowerCase().includes(q))
    );
    const list = $('taskList');
    list.replaceChildren();

    if (!items.length) {
      const msg = S.tasks.length
        ? 'Tidak ada tugas yang cocok dengan filter ini.'
        : 'Belum ada tugas. Tambahkan tugas pertamamu lewat formulir di atas.';
      list.append(h('li', { class: 'empty-state' }, msg));
      return;
    }

    const focusId = S.timer ? S.timer.taskId : null;
    for (const task of items) {
      const info = deadlineInfo(task.deadline, task.done, now);
      const focused = task.id === focusId;
      const cls = ['task-row'];
      if (task.done) cls.push('done');
      else if (info.level === 'overdue' || info.level === 'soon') cls.push(info.level);
      if (focused) cls.push('focused');

      const dueText = task.done
        ? task.doneAt
          ? 'Selesai ' + fmtDate(task.doneAt)
          : 'Selesai'
        : info.level === 'none'
          ? ''
          : info.text;

      list.append(
        h(
          'li',
          { class: cls.join(' ') },
          h('button', {
            class: 'check',
            title: task.done ? 'Tandai belum selesai' : 'Tandai selesai',
            html: ICONS.check,
            onclick: () => api.toggleTask(task.id),
          }),
          h(
            'div',
            null,
            h('div', { class: 't-title' }, task.title),
            h(
              'div',
              { class: 't-meta' },
              task.course ? h('span', { class: 'tag' }, task.course) : null,
              h('span', { class: 'tag p-' + task.priority }, 'Prioritas ' + PRIORITY_LABEL[task.priority].toLowerCase()),
              task.pomodoros > 0 ? h('span', null, `${task.pomodoros} sesi fokus`) : null,
              task.deadline ? h('span', null, fmtDate(task.deadline)) : null
            ),
            task.notes ? h('div', { class: 't-notes' }, task.notes) : null
          ),
          h(
            'div',
            { class: 't-side' },
            h('div', { class: 't-due ' + (task.done ? '' : info.level) }, dueText),
            h(
              'div',
              { class: 't-actions' },
              task.done
                ? null
                : h(
                    'button',
                    { class: focused ? 'on' : '', onclick: () => api.timer('setTask', focused ? null : task.id) },
                    focused ? 'Difokuskan' : 'Fokus'
                  ),
              h('button', { onclick: () => startEdit(task) }, 'Edit'),
              h(
                'button',
                {
                  class: 'danger',
                  onclick: () => {
                    if (confirm(`Hapus tugas "${task.title}"?`)) {
                      if (editingId === task.id) cancelEdit();
                      api.deleteTask(task.id);
                    }
                  },
                },
                'Hapus'
              )
            )
          )
        )
      );
    }
  }


  const form = $('taskForm');

  function resetForm() {
    editingId = null;
    form.reset();
    $('fPriority').value = 'medium';
    $('fSubmit').textContent = 'Tambah tugas';
    $('fCancel').hidden = true;
    form.classList.remove('editing');
  }

  function cancelEdit() {
    resetForm();
  }

  function startEdit(task) {
    editingId = task.id;
    $('fTitle').value = task.title;
    $('fCourse').value = task.course;
    $('fPriority').value = task.priority;
    $('fDeadline').value = toLocalInput(task.deadline);
    $('fNotes').value = task.notes;
    $('fSubmit').textContent = 'Simpan perubahan';
    $('fCancel').hidden = false;
    form.classList.add('editing');
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('fTitle').focus();
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = $('fTitle').value.trim();
    if (!title) {
      $('fTitle').focus();
      return;
    }
    const fields = {
      title,
      course: $('fCourse').value.trim(),
      priority: $('fPriority').value,
      deadline: fromLocalInput($('fDeadline').value),
      notes: $('fNotes').value.trim(),
    };
    if (editingId) await api.updateTask(editingId, fields);
    else await api.addTask(fields);
    resetForm();
    $('fTitle').focus();
  });

  $('fCancel').addEventListener('click', cancelEdit);

  form.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    const kind = chip.dataset.quick;
    const d = new Date();
    d.setSeconds(0, 0);
    if (kind === 'clear') {
      $('fDeadline').value = '';
      return;
    }
    d.setHours(23, 59, 0, 0);
    if (kind === 'tomorrow') d.setDate(d.getDate() + 1);
    if (kind === 'week') d.setDate(d.getDate() + 7);
    $('fDeadline').value = toLocalInput(d.toISOString());
  });

  $('search').addEventListener('input', (e) => {
    query = e.target.value;
    renderTasks();
  });


  function renderStats() {
    const st = S.stats;
    if (!st) return;

    const cards = [
      { v: `${st.doneTasks}/${st.totalTasks}`, l: 'Tugas selesai' },
      { v: st.pendingTasks, l: 'Tugas belum selesai' },
      { v: st.overdueTasks, l: 'Tugas terlambat', cls: st.overdueTasks > 0 ? 'bad' : '' },
      { v: st.todaySessions, l: 'Sesi fokus hari ini' },
      { v: fmtMinutes(st.totalMinutes), l: 'Total waktu fokus' },
      { v: st.totalSessions, l: 'Total sesi fokus' },
      { v: st.streak, l: 'Hari beruntun' },
    ];
    $('statCards').replaceChildren(
      ...cards.map((c) => h('div', { class: 'stat-card ' + (c.cls || '') }, h('b', null, c.v), h('span', null, c.l)))
    );

    $('donutFg').style.strokeDasharray = String(DONUT_C);
    $('donutFg').style.strokeDashoffset = String(DONUT_C * (1 - st.completionPct / 100));
    $('donutPct').textContent = st.completionPct + '%';
    $('donutText').textContent = st.totalTasks
      ? `${st.doneTasks} dari ${st.totalTasks} tugas selesai`
      : 'Belum ada tugas yang dicatat';

    const max = Math.max(1, ...st.last7.map((d) => d.minutes));
    $('bars').replaceChildren(
      ...st.last7.map((d, i) =>
        h(
          'div',
          { class: 'bar-col' + (i === st.last7.length - 1 ? ' today' : ''), title: `${d.sessions} sesi, ${d.minutes} menit` },
          h('span', { class: 'bar-val' }, d.minutes > 0 ? String(d.minutes) : ''),
          h('div', { class: 'bar-track' }, h('div', { class: 'bar-fill', style: `height:${(d.minutes / max) * 100}%` })),
          h('span', { class: 'bar-day' }, fmtDayLabel(d.date))
        )
      )
    );
  }


  function renderSettings() {
    if (!S.settings) return;
    document.querySelectorAll('[data-setting]').forEach((el) => {
      if (document.activeElement === el) return;
      const v = S.settings[el.dataset.setting];
      if (el.type === 'checkbox') el.checked = Boolean(v);
      else el.value = v;
    });
  }

  document.querySelectorAll('[data-setting]').forEach((el) => {
    el.addEventListener('change', async () => {
      const key = el.dataset.setting;
      const value = el.type === 'checkbox' ? el.checked : Number(el.value);
      const result = await api.updateSettings({ [key]: value });
      // Tampilkan nilai yang sudah divalidasi (mis. dibatasi minimum/maksimum).
      if (result && el.type !== 'checkbox') el.value = result[key];
    });
  });


  function renderAll() {
    renderBadge();
    renderTaskSelect();
    renderTimer();
    renderUpcoming();
    renderSideStats();
    renderFilters();
    renderTasks();
    renderStats();
    renderSettings();
  }

  buildStatic();
  resetForm();

  api.onTimer((t) => {
    S.timer = t;
    renderTimer();
  });
  api.onData((d) => {
    S = { ...S, ...d };
    renderAll();
  });

  api.getState().then((state) => {
    S = state;
    renderAll();
  });

  setInterval(() => {
    renderUpcoming();
    renderTasks();
    renderTaskMeta();
  }, 30000);
})();
