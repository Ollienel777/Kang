// ── MODALS ──
const openModal = id => document.getElementById(id)?.classList.add('is-open');

document.querySelectorAll('[data-modal]').forEach(btn => {
  btn.addEventListener('click', () => openModal(btn.dataset.modal));
});
document.querySelectorAll('.modal-close').forEach(btn => {
  btn.addEventListener('click', () => btn.closest('.modal').classList.remove('is-open'));
});
document.querySelectorAll('.modal').forEach(modal => {
  modal.addEventListener('click', e => {
    if (e.target === modal) modal.classList.remove('is-open');
  });
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape')
    document.querySelectorAll('.modal.is-open').forEach(m => m.classList.remove('is-open'));
});

// ── TAB SWITCHING ──
document.querySelectorAll('.hobby-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const target = tab.dataset.tab;

    // Update tab buttons
    document.querySelectorAll('.hobby-tab').forEach(t => t.classList.remove('is-active'));
    tab.classList.add('is-active');

    // Update panels
    document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.remove('is-active'));
    const panel = document.getElementById(`tab-${target}`);
    if (panel) panel.classList.add('is-active');
  });
});

// ── HEATMAP ──
function buildHeatmap(dailyKm, ytdKm) {
  const grid     = document.getElementById('run-heatmap');
  const monthsEl = document.getElementById('heatmap-months');
  const tooltip  = document.getElementById('heatmap-tooltip');
  const ytdLabel = document.getElementById('heatmap-ytd-label');
  if (!grid || !monthsEl) return;

  if (ytdLabel && ytdKm != null) {
    ytdLabel.textContent = `${ytdKm.toLocaleString()} km in the last 365 days`;
  }

  const CELL = 13, GAP = 3, WEEK_W = CELL + GAP;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Snap to the Sunday ≥ 52 weeks ago
  const start = new Date(today);
  start.setDate(start.getDate() - 52 * 7);
  start.setDate(start.getDate() - start.getDay());

  const getLevel = km => {
    if (!km) return 0;
    if (km < 5)  return 1;
    if (km < 10) return 2;
    if (km < 15) return 3;
    return 4;
  };

  let cursor        = new Date(start);
  let weekIdx       = 0;
  let prevMonth     = -1;
  let lastLabel     = null;   // DOM element of the most-recently placed month label
  let lastLabelCol  = -99;    // column index where it was placed
  const MIN_GAP_COLS = 3;     // minimum columns between labels before they'd visually overlap

  while (cursor <= today) {
    // Month label at first week of each new month
    const mo = cursor.getMonth();
    if (mo !== prevMonth) {
      // If the previous label is too close, remove it — the new month wins
      if (lastLabel && weekIdx - lastLabelCol < MIN_GAP_COLS) {
        lastLabel.remove();
      }
      const lbl = document.createElement('span');
      lbl.className = 'heatmap-month-label';
      lbl.textContent = cursor.toLocaleString('en-US', { month: 'short' }).toUpperCase();
      lbl.style.left = (weekIdx * WEEK_W) + 'px';
      monthsEl.appendChild(lbl);
      lastLabel    = lbl;
      lastLabelCol = weekIdx;
      prevMonth    = mo;
    }

    const weekEl = document.createElement('div');
    weekEl.className = 'heatmap-week';

    for (let d = 0; d < 7; d++) {
      const dateStr = cursor.toISOString().slice(0, 10);
      const km      = dailyKm[dateStr] || 0;
      const future  = cursor > today;

      const cell = document.createElement('div');
      cell.className = `heatmap-cell level-${future ? 'x' : getLevel(km)}`;

      if (!future && tooltip) {
        const snap = new Date(cursor); // capture for closure
        const fmtDate = snap.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        const kmText  = km > 0 ? `${km} km` : 'Rest day';

        cell.addEventListener('mouseenter', () => {
          tooltip.textContent = `${kmText} — ${fmtDate}`;
          tooltip.classList.add('is-visible');
        });
        cell.addEventListener('mousemove', e => {
          tooltip.style.left = (e.clientX + 14) + 'px';
          tooltip.style.top  = (e.clientY - 36) + 'px';
        });
        cell.addEventListener('mouseleave', () => {
          tooltip.classList.remove('is-visible');
        });
      }

      weekEl.appendChild(cell);
      cursor.setDate(cursor.getDate() + 1);
    }

    grid.appendChild(weekEl);
    weekIdx++;
  }
}

// ── STRAVA DATA ──
const BEST_EFFORT_ORDER = ['400m', '1/2 mile', '1k', '1 mile', '2 mile', '5k', '10k', '15k', '10 mile', '20k', 'Half-Marathon', '30k', 'Marathon'];
const BEST_EFFORT_LABELS = {
  '400m':          '400m',
  '1/2 mile':      '½ Mile',
  '1k':            '1 km',
  '1 mile':        '1 Mile',
  '2 mile':        '2 Mile',
  '5k':            '5 km',
  '10k':           '10 km',
  '15k':           '15 km',
  '10 mile':       '10 Mile',
  '20k':           '20 km',
  'Half-Marathon': 'Half Marathon',
  '30k':           '30 km',
  'Marathon':      'Marathon',
};

fetch('strava-data.json')
  .then(r => r.json())
  .then(data => {
    // Totals
    document.getElementById('stat-alltime').textContent  = data.totals.all_time_km.toLocaleString() + ' km';
    document.getElementById('stat-ytd-km').textContent   = data.totals.ytd_km.toLocaleString() + ' km';
    document.getElementById('stat-ytd-runs').textContent = data.totals.ytd_runs;
    document.getElementById('stat-ytd-time').textContent = data.totals.ytd_time;
    document.getElementById('strava-updated').textContent = data.updated_at;

    // Heatmap
    buildHeatmap(data.daily_km || {}, data.totals.ytd_km);

    // Best efforts
    const bestsEl = document.getElementById('strava-bests');
    const bests = data.best_efforts;
    const bestKeys = BEST_EFFORT_ORDER.filter(k => bests[k]);

    if (bestKeys.length === 0) {
      bestsEl.innerHTML = '<div class="hobby-best-empty">No PRs synced yet.</div>';
    } else {
      bestsEl.innerHTML = bestKeys.map(k => {
        const e = bests[k];
        return `
          <a class="hobby-best-row" href="https://www.strava.com/activities/${e.activity_id}" target="_blank" rel="noopener">
            <span class="hobby-best-dist">${BEST_EFFORT_LABELS[k]}</span>
            <span class="hobby-best-time">${e.time}</span>
            <span class="hobby-best-pace">${e.pace}</span>
            <span class="hobby-best-date">${e.date}</span>
          </a>`;
      }).join('');
    }

    // Recent runs
    const recentEl = document.getElementById('strava-recent');
    const runs = data.recent_runs;

    if (runs.length === 0) {
      recentEl.innerHTML = '<div class="hobby-best-empty">No runs synced yet.</div>';
    } else {
      recentEl.innerHTML = runs.map(r => `
        <a class="hobby-run-row" href="https://www.strava.com/activities/${r.id}" target="_blank" rel="noopener">
          <span class="hobby-run-name">${r.name}</span>
          <span class="hobby-run-dist">${r.distance} km</span>
          <span class="hobby-run-pace">${r.pace}</span>
          <span class="hobby-run-time">${r.time}</span>
          <span class="hobby-run-date">${r.date}</span>
        </a>`).join('');
    }
  })
  .catch(() => {
    ['strava-bests', 'strava-recent'].forEach(id => {
      document.getElementById(id).innerHTML =
        '<div class="hobby-best-empty">Could not load Strava data.</div>';
    });
  });
