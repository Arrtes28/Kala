'use strict';

(() => {
  const { h, ICONS, MODE_LABEL, MODE_SHORT, fmtTime, deadlineInfo, sortTasks } = NF;
  const $ = (id) => document.getElementById(id);

  const notch = $('notch');
  const quick = $('quickAdd');

  let S = { timer: null, settings: null, tasks: [], stats: null };
  let collapseTimer = null;
  let alertTimer = null;

  // ---------------------------------------------------------------- hover / interaksi

  function setInteractive(value) {
    window.api.setNotchInteractive(value);
  }

  function expand() {
    clearTimeout(collapseTimer);
    clearTimeout(alertTimer);
    notch.classList.remove('alerting');
    if (!notch.classList.contains('expanded')) {
      renderTasks();
      notch.classList.add('expanded');
    }
  }

  function scheduleCollapse() {
    clearTimeout(collapseTimer);
    collapseTimer = setTimeout(() => {
      // Jangan menutup selagi sedang mengetik tugas baru.
      if (document.activeElement === quick && quick.value.trim()) return;
      notch.classList.remove('expanded');
      if (document.activeElement === quick) quick.blur();
    }, 380);
  }

  notch.addEventListener('mouseenter', () => {
    setInteractive(true);
    expand();
  });

  notch.addEventListener('mouseleave', () => {
    // Lepaskan tangkapan mouse segera supaya area transparan tidak menghalangi klik ke aplikasi lain.
    setInteractive(false);
    scheduleCollapse();
  });

  quick.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const title = quick.value.trim();
      if (title) {
        window.api.addTask({ title });
        quick.value = '';
      }
    } else if (e.key === 'Escape') {
      quick.value = '';
      quick.blur();
    }
  });
  quick.addEventListener('blur', () => scheduleCollapse());

  // ---------------------------------------------------------------- render

  function iconInto(id, svg) {
    $(id).innerHTML = svg; // string statis dari NF.ICONS
  }

  function buildStatic() {
    iconInto('iconOpen', ICONS.open);
    iconInto('iconReset', ICONS.reset);
    iconInto('iconSkip', ICONS.skip);

    const modes = $('modes');
    for (const mode of ['focus', 'short', 'long']) {
      modes.append(
        h('button', { class: 'mode-btn', dataset: { mode }, onclick: () => window.api.timer('setMode', mode) }, MODE_SHORT[mode])
      );
    }

    $('btnToggle').addEventListener('click', () => window.api.timer('toggle'));
    $('btnReset').addEventListener('click', () => window.api.timer('reset'));
    $('btnSkip').addEventListener('click', () => window.api.timer('skip'));
    $('btnOpen').addEventListener('click', () => window.api.openMain('focus'));
    $('linkAll').addEventListener('click', (e) => {
      e.preventDefault();
      window.api.openMain('tasks');
    });
  }

  function renderTimer() {
    const t = S.timer;
    if (!t) return;

    notch.classList.remove('focus', 'short', 'long', 'running', 'paused');
    notch.classList.add(t.mode, t.running ? 'running' : 'paused');

    const untouched = t.remaining === t.total;
    $('pillTime').textContent = fmtTime(t.remaining);
    $('pillLabel').textContent = t.running || untouched ? MODE_LABEL[t.mode] : 'Jeda';
    $('bigTime').textContent = fmtTime(t.remaining);
    $('barFill').style.width = `${t.total ? ((t.total - t.remaining) / t.total) * 100 : 0}%`;
    iconInto('iconToggle', t.running ? ICONS.pause : ICONS.play);

    for (const btn of $('modes').children) {
      btn.classList.toggle('active', btn.dataset.mode === t.mode);
    }

    const cycle = $('cycle');
    if (cycle.children.length !== t.longEvery) {
      cycle.replaceChildren(...Array.from({ length: t.longEvery }, () => h('i')));
    }
    Array.from(cycle.children).forEach((dot, i) => dot.classList.toggle('on', i < t.cycleDone));

    const task = t.taskId ? S.tasks.find((x) => x.id === t.taskId) : null;
    const current = $('currentTask');
    current.replaceChildren();
    if (task) current.append('Fokus pada ', h('b', null, task.title));
    else current.append('Belum memilih tugas');
  }

  function renderTasks() {
    const list = $('taskList');
    const pending = sortTasks(S.tasks).filter((t) => !t.done).slice(0, 3);
    list.replaceChildren();

    if (!pending.length) {
      list.append(h('li', { class: 'empty' }, 'Belum ada tugas aktif. Tambahkan lewat kolom di bawah.'));
      return;
    }

    const focusId = S.timer ? S.timer.taskId : null;
    for (const task of pending) {
      const info = deadlineInfo(task.deadline, false);
      const focused = task.id === focusId;
      list.append(
        h(
          'li',
          { class: 'task' + (focused ? ' focused' : '') },
          h('button', {
            class: 'check',
            title: 'Tandai selesai',
            html: ICONS.check,
            onclick: () => window.api.toggleTask(task.id),
          }),
          h(
            'div',
            { class: 'task-main' },
            h('div', { class: 'task-title', title: task.title }, task.title),
            h('div', { class: 'task-due ' + info.level }, info.text)
          ),
          h('button', {
            class: 'focus-btn',
            title: focused ? 'Lepas dari timer' : 'Fokus pada tugas ini',
            html: ICONS.target,
            onclick: () => window.api.timer('setTask', focused ? null : task.id),
          })
        )
      );
    }
  }

  // ---------------------------------------------------------------- banner

  function showAlert({ title, body }) {
    $('alertTitle').textContent = title;
    $('alertBody').textContent = body;
    if (!notch.classList.contains('expanded')) notch.classList.add('alerting');
    clearTimeout(alertTimer);
    alertTimer = setTimeout(() => notch.classList.remove('alerting'), 8000);
  }

  // ---------------------------------------------------------------- init

  buildStatic();

  window.api.onTimer((t) => {
    S.timer = t;
    renderTimer();
  });
  window.api.onData((d) => {
    S = { ...S, ...d };
    renderTasks();
    renderTimer();
  });
  window.api.onSound((kind) => NF.playSound(kind));
  window.api.onFlash(showAlert);

  window.api.getState().then((state) => {
    S = state;
    renderTimer();
    renderTasks();
  });

  // Hitung mundur deadline di daftar ikut diperbarui.
  setInterval(() => {
    if (notch.classList.contains('expanded') && document.activeElement !== quick) renderTasks();
  }, 30000);
})();
