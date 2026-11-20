'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Engine } = require('../src/main/engine');

function setup(data) {
  const clock = { t: new Date('2026-11-19T08:00:00').getTime() };
  const events = [];
  const engine = new Engine(data, {
    now: () => clock.t,
    emit: (type, payload) => events.push({ type, payload }),
  });
  const advance = (sec) => {
    clock.t += sec * 1000;
    engine.tick();
  };
  return { engine, clock, events, advance };
}

const ofType = (events, type) => events.filter((e) => e.type === type);

test('timer default 25 menit dan bisa start/pause', () => {
  const { engine, advance } = setup();
  assert.equal(engine.timer.remaining, 25 * 60);
  engine.start();
  advance(10);
  assert.equal(engine.timer.remaining, 25 * 60 - 10);
  engine.pause();
  advance(100);
  assert.equal(engine.timer.remaining, 25 * 60 - 10, 'tidak berkurang saat pause');
  engine.start();
  advance(5);
  assert.equal(engine.timer.remaining, 25 * 60 - 15);
});

test('selesai fokus -> istirahat pendek, sesi tercatat, auto start istirahat', () => {
  const { engine, events, advance } = setup();
  const task = engine.addTask({ title: 'Laporan BST' });
  engine.setTask(task.id);
  engine.start();
  advance(25 * 60);
  assert.equal(engine.timer.mode, 'short');
  assert.equal(engine.timer.running, true, 'autoStartBreak aktif secara default');
  assert.equal(engine.timer.remaining, 5 * 60);
  assert.equal(engine.getStats().todaySessions, 1);
  assert.equal(engine.getStats().todayMinutes, 25);
  assert.equal(engine.data.tasks[0].pomodoros, 1);
  const done = ofType(events, 'session-complete');
  assert.equal(done.length, 1);
  assert.equal(done[0].payload.finished, 'focus');
  assert.equal(done[0].payload.next, 'short');
});

test('istirahat panjang setelah 4 sesi fokus, lalu siklus reset', () => {
  const { engine, advance } = setup({ settings: { autoStartFocus: true } });
  engine.start();
  for (let i = 0; i < 3; i++) {
    advance(25 * 60); // fokus
    assert.equal(engine.timer.mode, 'short');
    advance(5 * 60); // istirahat pendek
    assert.equal(engine.timer.mode, 'focus');
  }
  advance(25 * 60); // fokus ke-4
  assert.equal(engine.timer.mode, 'long');
  assert.equal(engine.timer.remaining, 15 * 60);
  assert.equal(engine.timerSnapshot().cycleDone, 4);
  advance(15 * 60);
  assert.equal(engine.timer.mode, 'focus');
  assert.equal(engine.timer.cycle, 0);
});

test('skip tidak menghitung sesi', () => {
  const { engine } = setup();
  engine.start();
  engine.skip();
  assert.equal(engine.timer.mode, 'short');
  assert.equal(engine.timer.running, false);
  assert.equal(engine.getStats().todaySessions, 0);
});

test('pengaturan durasi mengikuti saat timer belum dipakai', () => {
  const { engine } = setup();
  engine.updateSettings({ focusMin: 50, shortMin: 10 });
  assert.equal(engine.timer.remaining, 50 * 60);
  engine.setMode('short');
  assert.equal(engine.timer.remaining, 10 * 60);
});

test('pengaturan divalidasi (batas dan tipe)', () => {
  const { engine } = setup();
  engine.updateSettings({ focusMin: 99999, shortMin: 'abc', longEvery: 1 });
  const s = engine.data.settings;
  assert.equal(s.focusMin, 180);
  assert.equal(s.shortMin, 5);
  assert.equal(s.longEvery, 2);
});

test('tugas: tambah, ubah, selesai, hapus', () => {
  const { engine } = setup();
  assert.equal(engine.addTask({ title: '   ' }), null, 'judul kosong ditolak');
  const t = engine.addTask({ title: 'Tugas Basis Data', course: 'Basdat', priority: 'high' });
  assert.equal(t.priority, 'high');
  engine.updateTask(t.id, { title: 'Tugas Basis Data 2', priority: 'tidak-valid' });
  assert.equal(engine.data.tasks[0].title, 'Tugas Basis Data 2');
  assert.equal(engine.data.tasks[0].priority, 'high');
  engine.toggleTask(t.id);
  assert.equal(engine.data.tasks[0].done, true);
  assert.ok(engine.data.tasks[0].doneAt);
  assert.equal(engine.getStats().completionPct, 100);
  assert.equal(engine.deleteTask(t.id), true);
  assert.equal(engine.data.tasks.length, 0);
});

test('menyelesaikan tugas yang sedang difokuskan melepas tugas dari timer', () => {
  const { engine } = setup();
  const t = engine.addTask({ title: 'A' });
  engine.setTask(t.id);
  assert.equal(engine.timer.taskId, t.id);
  engine.toggleTask(t.id);
  assert.equal(engine.timer.taskId, null);
  engine.setTask(t.id);
  assert.equal(engine.timer.taskId, null, 'tugas selesai tidak bisa difokuskan');
});

test('pengingat deadline: 24 jam, 1 jam, lewat - masing-masing sekali', () => {
  const { engine, clock, events } = setup();
  const dl = new Date(clock.t + 20 * 3600 * 1000).toISOString();
  engine.addTask({ title: 'Kuis', deadline: dl });

  engine.checkDeadlines();
  engine.checkDeadlines();
  let d = ofType(events, 'deadline');
  assert.equal(d.length, 1);
  assert.equal(d[0].payload.kind, 'd24');

  clock.t += 19.5 * 3600 * 1000;
  engine.checkDeadlines();
  d = ofType(events, 'deadline');
  assert.equal(d.length, 2);
  assert.equal(d[1].payload.kind, 'h1');

  clock.t += 1 * 3600 * 1000;
  engine.checkDeadlines();
  d = ofType(events, 'deadline');
  assert.equal(d.length, 3);
  assert.equal(d[2].payload.kind, 'over');
  assert.equal(engine.getStats().overdueTasks, 1);
});

test('tugas yang sudah lama lewat tidak memicu notifikasi', () => {
  const { engine, clock, events } = setup();
  engine.addTask({ title: 'Lama', deadline: new Date(clock.t - 5 * 24 * 3600 * 1000).toISOString() });
  engine.checkDeadlines();
  assert.equal(ofType(events, 'deadline').length, 0);
});

test('mengubah deadline mengaktifkan kembali pengingat', () => {
  const { engine, clock, events } = setup();
  const t = engine.addTask({ title: 'X', deadline: new Date(clock.t + 2 * 3600 * 1000).toISOString() });
  engine.checkDeadlines();
  assert.equal(ofType(events, 'deadline').length, 1);
  engine.updateTask(t.id, { deadline: new Date(clock.t + 3 * 3600 * 1000).toISOString() });
  engine.checkDeadlines();
  assert.equal(ofType(events, 'deadline').length, 2);
});

test('statistik 7 hari dan streak', () => {
  const { engine, clock } = setup();
  const day = 24 * 3600 * 1000;
  const mk = (offset, sessions) => {
    const d = new Date(clock.t - offset * day);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    engine.data.days[key] = { sessions, minutes: sessions * 25 };
  };
  mk(0, 2);
  mk(1, 1);
  mk(2, 3);
  mk(4, 1); // bolong di hari ke-3, streak berhenti
  const s = engine.getStats();
  assert.equal(s.streak, 3);
  assert.equal(s.last7.length, 7);
  assert.equal(s.last7[6].sessions, 2);
  assert.equal(s.totalSessions, 7);
  assert.equal(s.totalMinutes, 175);
});

test('data rusak dinormalkan tanpa melempar error', () => {
  const { engine } = setup({
    settings: { focusMin: 'x' },
    tasks: [null, { title: '' }, { title: 'ok', deadline: 'bukan-tanggal' }],
    timerState: { mode: 'ngawur', taskId: 'tidak-ada' },
  });
  assert.equal(engine.data.tasks.length, 1);
  assert.equal(engine.data.tasks[0].deadline, null);
  assert.equal(engine.timer.mode, 'focus');
  assert.equal(engine.timer.taskId, null);
});
