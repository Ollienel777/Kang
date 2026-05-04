// ── NAV SCROLL FADE ──
// NKANG logo + Connect stay sticky; ← Back + Resume fade when scrolled down.
(function () {
  const THRESHOLD = 60;
  function update() {
    document.body.classList.toggle('is-scrolled', window.scrollY > THRESHOLD);
  }
  window.addEventListener('scroll', update, { passive: true });
  update();
}());

// ── MOBILE NAV ──
(function () {
  const hamburger  = document.getElementById('nav-hamburger');
  const mobileMenu = document.getElementById('nav-mobile-menu');
  if (!hamburger || !mobileMenu) return;

  hamburger.addEventListener('click', () => {
    const opening = mobileMenu.classList.toggle('is-open');
    hamburger.classList.toggle('is-open', opening);
  });

  mobileMenu.querySelectorAll('.nav-mobile-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      mobileMenu.classList.remove('is-open');
      hamburger.classList.remove('is-open');
    });
  });
}());

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
function buildHeatmap(dailyKm) {
  const grid     = document.getElementById('run-heatmap');
  const monthsEl = document.getElementById('heatmap-months');
  const tooltip  = document.getElementById('heatmap-tooltip');
  const ytdLabel = document.getElementById('heatmap-ytd-label');
  const yearsEl  = document.getElementById('heatmap-years');
  if (!grid || !monthsEl) return;

  const CELL = 13, GAP = 3, WEEK_W = CELL + GAP;
  const MIN_GAP_COLS = 3;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const currentYear = today.getFullYear();

  // ── Collect available years from data ──
  const yearSet = new Set(Object.keys(dailyKm).map(d => parseInt(d.slice(0, 4))));
  yearSet.add(currentYear);
  const years = [...yearSet].sort((a, b) => b - a); // newest first

  const getLevel = km => {
    if (!km) return 0;
    if (km < 5)  return 1;
    if (km < 10) return 2;
    if (km < 15) return 3;
    if (km < 20) return 4;
    return 5;
  };

  function getYearKm(year) {
    return Object.entries(dailyKm)
      .filter(([d]) => d.startsWith(year + '-'))
      .reduce((sum, [, km]) => sum + km, 0);
  }

  // ── Render grid ──
  // year = number (calendar year) or 'rolling' (last 365 days)
  function renderGrid(year) {
    grid.innerHTML     = '';
    monthsEl.innerHTML = '';

    let start, yearEnd, yearStart;

    if (year === 'rolling') {
      // Last 52 weeks ending today
      yearStart = null; // no hard boundary — all cells are valid
      yearEnd   = today;
      start     = new Date(today);
      start.setDate(start.getDate() - 52 * 7);
      start.setDate(start.getDate() - start.getDay());

      const rollingKm = Object.entries(dailyKm)
        .filter(([d]) => d >= start.toISOString().slice(0, 10))
        .reduce((sum, [, km]) => sum + km, 0);
      if (ytdLabel) ytdLabel.textContent = `${Math.round(rollingKm * 10) / 10} km in the last 365 days`;
    } else {
      yearStart = new Date(year, 0, 1);
      yearEnd   = year === currentYear ? today : new Date(year, 11, 31);
      start     = new Date(yearStart);
      start.setDate(start.getDate() - start.getDay()); // snap to Sunday

      const km = Math.round(getYearKm(year) * 10) / 10;
      if (ytdLabel) ytdLabel.textContent = `${km.toLocaleString()} km in ${year}`;
    }

    let cursor       = new Date(start);
    let weekIdx      = 0;
    let prevMonth    = -1;
    let lastLabel    = null;
    let lastLabelCol = -99;

    while (cursor <= yearEnd) {
      const mo = cursor.getMonth();
      if (mo !== prevMonth) {
        if (lastLabel && weekIdx - lastLabelCol < MIN_GAP_COLS) lastLabel.remove();
        const lbl = document.createElement('span');
        lbl.className   = 'heatmap-month-label';
        lbl.textContent = cursor.toLocaleString('en-US', { month: 'short' }).toUpperCase();
        lbl.style.left  = (weekIdx * WEEK_W) + 'px';
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
        const outside = yearStart && cursor < yearStart; // pre-Jan padding in calendar mode

        const cell = document.createElement('div');
        cell.className = `heatmap-cell level-${(future || outside) ? 'x' : getLevel(km)}`;

        if (!future && !outside && tooltip) {
          const snap    = new Date(cursor);
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
          cell.addEventListener('mouseleave', () => tooltip.classList.remove('is-visible'));
        }

        weekEl.appendChild(cell);
        cursor.setDate(cursor.getDate() + 1);
      }

      grid.appendChild(weekEl);
      weekIdx++;
    }
  }

  // ── Build year buttons ──
  let activeYear = 'rolling';

  function setActive(selected) {
    activeYear = selected;
    yearsEl.querySelectorAll('.heatmap-year-btn').forEach(b => b.classList.remove('is-active'));
    yearsEl.querySelector(`[data-year="${selected}"]`)?.classList.add('is-active');
    renderGrid(selected);
  }

  if (yearsEl) {
    // "Last 365 days" pill at the top
    const rollingBtn = document.createElement('button');
    rollingBtn.className      = 'heatmap-year-btn is-active';
    rollingBtn.dataset.year   = 'rolling';
    rollingBtn.textContent    = '365 DAYS';
    rollingBtn.addEventListener('click', () => setActive('rolling'));
    yearsEl.appendChild(rollingBtn);

    // Individual year buttons
    years.forEach(year => {
      const btn = document.createElement('button');
      btn.className      = 'heatmap-year-btn';
      btn.dataset.year   = year;
      btn.textContent    = year;
      btn.addEventListener('click', () => setActive(year));
      yearsEl.appendChild(btn);
    });
  }

  renderGrid('rolling');
}

// ── STRAVA DATA ──
const BEST_EFFORT_ORDER = ['2 mile', '5k', '10k', '15k', '10 mile', '20k', 'Half-Marathon', '30k', 'Marathon'];
const BEST_EFFORT_LABELS = {
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
    document.getElementById('stat-ytd-runs').textContent = data.totals.ytd_runs;
    document.getElementById('stat-ytd-time').textContent = data.totals.ytd_time;
    document.getElementById('strava-updated').textContent = data.updated_at;

    // Rolling 365-day km — calculated from daily_km so it matches the heatmap
    const dailyKm  = data.daily_km || {};
    const cutoff   = new Date();
    cutoff.setDate(cutoff.getDate() - 365);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    const rolling365 = Object.entries(dailyKm)
      .filter(([d]) => d >= cutoffStr)
      .reduce((sum, [, km]) => sum + km, 0);
    document.getElementById('stat-ytd-km').textContent = (Math.round(rolling365 * 10) / 10).toLocaleString() + ' km';

    // Heatmap
    buildHeatmap(dailyKm);

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

    // Always append Marathon as a goal row if no real PR exists
    if (!bests['Marathon']) {
      bestsEl.innerHTML += `
        <div class="hobby-best-row">
          <span class="hobby-best-dist">Marathon</span>
          <span class="hobby-best-time">working on it 🫩</span>
          <span class="hobby-best-pace"></span>
          <span class="hobby-best-date"></span>
        </div>`;
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
