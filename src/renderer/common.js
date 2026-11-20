'use strict';



const NF = (() => {
  const MODE_LABEL = {
    focus: 'Fokus',
    short: 'Istirahat pendek',
    long: 'Istirahat panjang',
  };

  const MODE_SHORT = { focus: 'Fokus', short: 'Pendek', long: 'Panjang' };

  const PRIORITY_LABEL = { low: 'Rendah', medium: 'Sedang', high: 'Tinggi' };

  const ICONS = {
    play: '<svg viewBox="0 0 24 24"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" fill="currentColor"/></svg>',
    pause:
      '<svg viewBox="0 0 24 24"><rect x="6" y="5" width="4.2" height="14" rx="1.2" fill="currentColor"/><rect x="13.8" y="5" width="4.2" height="14" rx="1.2" fill="currentColor"/></svg>',
    skip: '<svg viewBox="0 0 24 24"><path d="M6 6.2v11.6a.8.8 0 0 0 1.25.66l8.2-5.8a.8.8 0 0 0 0-1.32l-8.2-5.8A.8.8 0 0 0 6 6.2Z" fill="currentColor"/><rect x="16.6" y="5.4" width="2.4" height="13.2" rx="1.1" fill="currentColor"/></svg>',
    reset:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12a8 8 0 1 0 2.5-5.8"/><path d="M4 4v4.5h4.5"/></svg>',
    open: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6"/><path d="M20 4l-8 8"/><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/></svg>',
    target:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.2" fill="currentColor"/></svg>',
    check:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  };

  const pad = (n) => String(n).padStart(2, '0');

    function fmtTime(sec) {
      sec = Math.max(0, Math.floor(sec));
      const h = Math.floor(sec / 3600);
      const m = Math.floor((sec % 3600) / 60);
      const s = sec % 60;
      return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
    }

  function fmtMinutes(min) {
    if (min < 60) return `${min} mnt`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m ? `${h} j ${m} mnt` : `${h} j`;
  }

  function plural(ms) {
    const abs = Math.abs(ms);
    const min = Math.round(abs / 60000);
    if (min < 1) return 'kurang dari 1 menit';
    if (min < 60) return `${min} menit`;
    const hours = Math.round(abs / 3600000);
    if (hours < 48) return `${hours} jam`;
    return `${Math.round(abs / 86400000)} hari`;
  }

  /** Teks hitung mundur deadline + level (overdue | soon | ok | none). */
  function deadlineInfo(iso, done, now = Date.now()) {
    if (!iso) return { text: 'Tanpa deadline', level: 'none' };
    const diff = new Date(iso).getTime() - now;
    if (done) return { text: fmtDate(iso), level: 'ok' };
    if (diff < 0) return { text: `Terlambat ${plural(diff)}`, level: 'overdue' };
    return { text: `${plural(diff)} lagi`, level: diff < 24 * 3600000 ? 'soon' : 'ok' };
  }

  function fmtDate(iso) {
    if (!iso) return '';
    return new Intl.DateTimeFormat('id-ID', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(iso));
  }

  function fmtDayLabel(key) {
    const [y, m, d] = key.split('-').map(Number);
    return new Intl.DateTimeFormat('id-ID', { weekday: 'short' }).format(new Date(y, m - 1, d));
  }

  function toLocalInput(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function fromLocalInput(value) {
    if (!value) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }

    function sortTasks(tasks) {
      return [...tasks].sort((a, b) => {
        if (a.done !== b.done) return a.done ? 1 : -1;
        const da = a.deadline ? new Date(a.deadline).getTime() : Infinity;
        const db = b.deadline ? new Date(b.deadline).getTime() : Infinity;
        if (da !== db) return da - db;
        return new Date(a.createdAt) - new Date(b.createdAt);
      });
    }


  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v === false || v === null || v === undefined) continue;
        if (k === 'class') el.className = v;
        else if (k === 'html') el.innerHTML = v; // hanya untuk string statis (ikon)
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (k === 'dataset') Object.assign(el.dataset, v);
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const c of children.flat()) {
      if (c === null || c === undefined || c === false) continue;
      el.append(c.nodeType ? c : document.createTextNode(String(c)));
    }
    return el;
  }



  let audioCtx = null;

  function tone(freq, start, dur, gain = 0.18) {
    const ctx = audioCtx;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    amp.gain.setValueAtTime(0.0001, ctx.currentTime + start);
    amp.gain.exponentialRampToValueAtTime(gain, ctx.currentTime + start + 0.02);
    amp.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + dur);
    osc.connect(amp).connect(ctx.destination);
    osc.start(ctx.currentTime + start);
    osc.stop(ctx.currentTime + start + dur + 0.05);
  }

  function playSound(kind) {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      if (kind === 'focus-end') {
        tone(659.25, 0, 0.35);
        tone(783.99, 0.18, 0.35);
        tone(1046.5, 0.36, 0.7);
      } else if (kind === 'break-end') {
        tone(880, 0, 0.3);
        tone(659.25, 0.2, 0.5);
      } else {
        tone(987.77, 0, 0.6, 0.15);
      }
    } catch (_) {

    }
  }

  return {
    MODE_LABEL,
    MODE_SHORT,
    PRIORITY_LABEL,
    ICONS,
    fmtTime,
    fmtMinutes,
    deadlineInfo,
    fmtDate,
    fmtDayLabel,
    toLocalInput,
    fromLocalInput,
    sortTasks,
    h,
    playSound,
  };
})();
