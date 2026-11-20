'use strict';

/**
 * Engine: seluruh logika Pomodoro, tugas, deadline, dan statistik.
 * Modul ini TIDAK bergantung pada Electron sehingga bisa diuji dengan `npm test`.
 */

const MODES = ['focus', 'short', 'long'];
const PRIORITIES = ['low', 'medium', 'high'];

const DEFAULT_SETTINGS = {
  focusMin: 25,
  shortMin: 5,
  longMin: 15,
  longEvery: 4,
  autoStartBreak: true,
  autoStartFocus: false,
  sound: true,
  notifications: true,
  closeToTray: true,
  launchAtStartup: false,
  showNotch: true,
};

const HOUR = 3600 * 1000;

const pad = (n) => String(n).padStart(2, '0');

function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function clampInt(value, lo, hi, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

function cleanText(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function cleanDeadline(value) {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function sanitizeSettings(raw) {
  const s = { ...DEFAULT_SETTINGS, ...(raw || {}) };
  return {
    focusMin: clampInt(s.focusMin, 1, 180, DEFAULT_SETTINGS.focusMin),
    shortMin: clampInt(s.shortMin, 1, 60, DEFAULT_SETTINGS.shortMin),
    longMin: clampInt(s.longMin, 1, 90, DEFAULT_SETTINGS.longMin),
    longEvery: clampInt(s.longEvery, 2, 12, DEFAULT_SETTINGS.longEvery),
    autoStartBreak: Boolean(s.autoStartBreak),
    autoStartFocus: Boolean(s.autoStartFocus),
    sound: Boolean(s.sound),
    notifications: Boolean(s.notifications),
    closeToTray: Boolean(s.closeToTray),
    launchAtStartup: Boolean(s.launchAtStartup),
    showNotch: Boolean(s.showNotch),
  };
}

function sanitizeTask(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const title = cleanText(raw.title, 120);
  if (!title) return null;
  const notified = raw.notified && typeof raw.notified === 'object' ? raw.notified : {};
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : newId(),
    title,
    course: cleanText(raw.course, 60),
    notes: cleanText(raw.notes, 300),
    deadline: cleanDeadline(raw.deadline),
    priority: PRIORITIES.includes(raw.priority) ? raw.priority : 'medium',
    done: Boolean(raw.done),
    doneAt: raw.done ? cleanDeadline(raw.doneAt) : null,
    createdAt: cleanDeadline(raw.createdAt) || new Date().toISOString(),
    pomodoros: clampInt(raw.pomodoros, 0, 100000, 0),
    notified: { d24: Boolean(notified.d24), h1: Boolean(notified.h1), over: Boolean(notified.over) },
  };
}

function normalizeData(raw) {
  const d = raw && typeof raw === 'object' ? raw : {};
  const ts = d.timerState && typeof d.timerState === 'object' ? d.timerState : {};
  return {
    version: 1,
    settings: sanitizeSettings(d.settings),
    tasks: Array.isArray(d.tasks) ? d.tasks.map(sanitizeTask).filter(Boolean) : [],
    days: d.days && typeof d.days === 'object' ? d.days : {},
    timerState: {
      mode: MODES.includes(ts.mode) ? ts.mode : 'focus',
      cycle: clampInt(ts.cycle, 0, 1000, 0),
      taskId: typeof ts.taskId === 'string' ? ts.taskId : null,
    },
  };
}

class Engine {
  /**
   * @param {object} rawData data hasil muat dari disk (boleh kosong)
   * @param {{now?: () => number, emit?: (type: string, payload?: any) => void}} opts
   */
  constructor(rawData, opts = {}) {
    this.now = opts.now || Date.now;
    this._emit = opts.emit || (() => {});
    this.data = normalizeData(rawData);

    const ts = this.data.timerState;
    this.timer = {
      mode: ts.mode,
      running: false,
      remaining: 0,
      total: 0,
      endAt: null,
      cycle: ts.cycle,
      taskId: ts.taskId,
    };
    if (this.timer.taskId && !this._task(this.timer.taskId)) this.timer.taskId = null;
    this._applyDuration();
  }

  // ---------- util ----------

  emit(type, payload) {
    this._emit(type, payload);
  }

  _task(id) {
    return this.data.tasks.find((t) => t.id === id) || null;
  }

  durationSec(mode) {
    const s = this.data.settings;
    const min = mode === 'focus' ? s.focusMin : mode === 'short' ? s.shortMin : s.longMin;
    return min * 60;
  }

  _applyDuration() {
    this.timer.total = this.durationSec(this.timer.mode);
    this.timer.remaining = this.timer.total;
  }

  _persistTimerState() {
    this.data.timerState = {
      mode: this.timer.mode,
      cycle: this.timer.cycle,
      taskId: this.timer.taskId,
    };
    this.emit('data');
  }

  // ---------- timer ----------

  timerSnapshot() {
    const t = this.timer;
    const every = this.data.settings.longEvery;
    return {
      mode: t.mode,
      running: t.running,
      remaining: t.remaining,
      total: t.total,
      cycle: t.cycle,
      cycleDone: t.mode === 'long' ? every : t.cycle % every,
      longEvery: every,
      taskId: t.taskId,
    };
  }

  start() {
    const t = this.timer;
    if (t.running) return;
    if (t.remaining <= 0) this._applyDuration();
    t.endAt = this.now() + t.remaining * 1000;
    t.running = true;
    this.emit('timer', this.timerSnapshot());
  }

  pause() {
    const t = this.timer;
    if (!t.running) return;
    t.remaining = Math.max(0, Math.ceil((t.endAt - this.now()) / 1000));
    t.running = false;
    t.endAt = null;
    this.emit('timer', this.timerSnapshot());
  }

  toggle() {
    if (this.timer.running) this.pause();
    else this.start();
  }

  reset() {
    const t = this.timer;
    t.running = false;
    t.endAt = null;
    this._applyDuration();
    this.emit('timer', this.timerSnapshot());
  }

  setMode(mode) {
    if (!MODES.includes(mode)) return;
    this.timer.mode = mode;
    this.reset();
    this._persistTimerState();
  }

  /** Lewati sesi saat ini tanpa dihitung sebagai sesi fokus yang selesai. */
  skip() {
    const t = this.timer;
    if (t.mode === 'focus') {
      t.mode = 'short';
    } else {
      if (t.mode === 'long') t.cycle = 0;
      t.mode = 'focus';
    }
    this.reset();
    this._persistTimerState();
  }

  setTask(id) {
    const task = id ? this._task(id) : null;
    this.timer.taskId = task && !task.done ? task.id : null;
    this._persistTimerState();
    this.emit('timer', this.timerSnapshot());
  }

  /** Dipanggil berkala oleh main process (mis. tiap 250 ms). */
  tick() {
    const t = this.timer;
    if (!t.running) return;
    const msLeft = t.endAt - this.now();
    if (msLeft <= 0) {
      this._complete();
      return;
    }
    const left = Math.ceil(msLeft / 1000);
    if (left !== t.remaining) {
      t.remaining = left;
      this.emit('timer', this.timerSnapshot());
    }
  }

  _complete() {
    const t = this.timer;
    const s = this.data.settings;
    const finished = t.mode;
    const finishedMinutes = Math.round(t.total / 60);
    let taskTitle = null;

    if (finished === 'focus') {
      const key = dayKey(this.now());
      const day = this.data.days[key] || { sessions: 0, minutes: 0 };
      day.sessions += 1;
      day.minutes += finishedMinutes;
      this.data.days[key] = day;

      const task = t.taskId ? this._task(t.taskId) : null;
      if (task) {
        task.pomodoros += 1;
        taskTitle = task.title;
      }
      t.cycle += 1;
      t.mode = t.cycle % s.longEvery === 0 ? 'long' : 'short';
    } else {
      if (finished === 'long') t.cycle = 0;
      t.mode = 'focus';
    }

    this._applyDuration();
    t.endAt = null;
    t.running = false;

    const autoStart = t.mode === 'focus' ? s.autoStartFocus : s.autoStartBreak;
    this._persistTimerState();
    if (autoStart) this.start();
    else this.emit('timer', this.timerSnapshot());

    this.emit('session-complete', {
      finished,
      next: t.mode,
      nextMinutes: Math.round(t.total / 60),
      autoStarted: autoStart,
      taskTitle,
    });
  }

  // ---------- tugas ----------

  addTask(fields) {
    const task = sanitizeTask({
      ...fields,
      id: newId(),
      done: false,
      doneAt: null,
      createdAt: new Date(this.now()).toISOString(),
      pomodoros: 0,
      notified: {},
    });
    if (!task) return null;
    this.data.tasks.push(task);
    this.emit('data');
    return task;
  }

  updateTask(id, patch) {
    const task = this._task(id);
    if (!task || !patch || typeof patch !== 'object') return null;
    if ('title' in patch) {
      const title = cleanText(patch.title, 120);
      if (title) task.title = title;
    }
    if ('course' in patch) task.course = cleanText(patch.course, 60);
    if ('notes' in patch) task.notes = cleanText(patch.notes, 300);
    if ('priority' in patch && PRIORITIES.includes(patch.priority)) task.priority = patch.priority;
    if ('deadline' in patch) {
      task.deadline = cleanDeadline(patch.deadline);
      task.notified = { d24: false, h1: false, over: false };
    }
    this.emit('data');
    return task;
  }

  toggleTask(id) {
    const task = this._task(id);
    if (!task) return null;
    task.done = !task.done;
    task.doneAt = task.done ? new Date(this.now()).toISOString() : null;
    if (task.done && this.timer.taskId === task.id) {
      this.timer.taskId = null;
      this._persistTimerState();
      this.emit('timer', this.timerSnapshot());
    }
    this.emit('data');
    return task;
  }

  deleteTask(id) {
    const before = this.data.tasks.length;
    this.data.tasks = this.data.tasks.filter((t) => t.id !== id);
    if (this.data.tasks.length === before) return false;
    if (this.timer.taskId === id) {
      this.timer.taskId = null;
      this._persistTimerState();
      this.emit('timer', this.timerSnapshot());
    }
    this.emit('data');
    return true;
  }

  // ---------- pengaturan ----------

  updateSettings(patch) {
    const before = this.data.settings;
    this.data.settings = sanitizeSettings({ ...before, ...(patch || {}) });
    // Kalau timer belum berjalan dan belum terpakai, ikuti durasi baru.
    const t = this.timer;
    if (!t.running && t.remaining === t.total) {
      this._applyDuration();
      this.emit('timer', this.timerSnapshot());
    } else {
      this.emit('timer', this.timerSnapshot());
    }
    this.emit('data');
    return this.data.settings;
  }

  // ---------- deadline ----------

  /** Cek tugas yang mendekati / melewati deadline dan kirim event 'deadline'. */
  checkDeadlines() {
    const now = this.now();
    let changed = false;
    for (const task of this.data.tasks) {
      if (task.done || !task.deadline) continue;
      const left = new Date(task.deadline).getTime() - now;
      const n = task.notified;

      if (left <= 0) {
        if (!n.over) {
          n.over = n.h1 = n.d24 = true;
          changed = true;
          // Jangan spam notifikasi untuk tugas yang sudah lama lewat.
          if (left > -24 * HOUR) this.emit('deadline', { task, kind: 'over' });
        }
      } else if (left <= HOUR) {
        if (!n.h1) {
          n.h1 = n.d24 = true;
          changed = true;
          this.emit('deadline', { task, kind: 'h1' });
        }
      } else if (left <= 24 * HOUR) {
        if (!n.d24) {
          n.d24 = true;
          changed = true;
          this.emit('deadline', { task, kind: 'd24' });
        }
      }
    }
    if (changed) this.emit('data');
  }

  // ---------- statistik ----------

  getStats() {
    const now = this.now();
    const tasks = this.data.tasks;
    const done = tasks.filter((t) => t.done).length;
    const overdue = tasks.filter(
      (t) => !t.done && t.deadline && new Date(t.deadline).getTime() < now
    ).length;

    const last7 = [];
    for (let i = 6; i >= 0; i--) {
      const ts = now - i * 24 * HOUR;
      const key = dayKey(ts);
      const day = this.data.days[key] || { sessions: 0, minutes: 0 };
      last7.push({ date: key, sessions: day.sessions, minutes: day.minutes });
    }

    const today = this.data.days[dayKey(now)] || { sessions: 0, minutes: 0 };
    const all = Object.values(this.data.days);
    const totalSessions = all.reduce((a, d) => a + (d.sessions || 0), 0);
    const totalMinutes = all.reduce((a, d) => a + (d.minutes || 0), 0);

    // Streak: hari berturut-turut yang punya sesi fokus (hari ini boleh belum ada).
    let streak = 0;
    let offset = today.sessions > 0 ? 0 : 1;
    for (;;) {
      const day = this.data.days[dayKey(now - offset * 24 * HOUR)];
      if (day && day.sessions > 0) {
        streak += 1;
        offset += 1;
      } else break;
      if (streak > 3650) break;
    }

    return {
      totalTasks: tasks.length,
      doneTasks: done,
      pendingTasks: tasks.length - done,
      overdueTasks: overdue,
      completionPct: tasks.length ? Math.round((done / tasks.length) * 100) : 0,
      todaySessions: today.sessions,
      todayMinutes: today.minutes,
      totalSessions,
      totalMinutes,
      streak,
      last7,
    };
  }

  snapshot() {
    return {
      timer: this.timerSnapshot(),
      settings: this.data.settings,
      tasks: this.data.tasks,
      stats: this.getStats(),
    };
  }
}

module.exports = { Engine, DEFAULT_SETTINGS, MODES, PRIORITIES, dayKey, normalizeData };
