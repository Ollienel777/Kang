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
// dailyActivities: { "YYYY-MM-DD": { run?: km, swim?: km, ride?: km } }
// Falls back gracefully if only legacy daily_km is available.

// Module-level state used by both buildHeatmap and switchSport
let _activeSport    = 'run';
let _heatmapRerender = null;
const SPORT_LABEL   = { run: 'running', swim: 'swimming', ride: 'cycling' };

function buildHeatmap(dailyActivities) {
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

  // ── Sport colour palettes (index = level 0–5) ──
  // Lift is binary (did/didn't) rather than intensity-graded, so it only has 2 entries.
  const COLORS = {
    run:  ['#1e1e1e', '#4d0f17', '#7a1a24', '#a32230', '#bf2c3a', '#de4355'],
    swim: ['#1e1e1e', '#0a2240', '#0f3a6e', '#1a57a0', '#1a75cc', '#2a96e8'],
    ride: ['#1e1e1e', '#0d2b1a', '#1a4d2e', '#256e3f', '#2d8a50', '#3aab64'],
    lift: ['#1e1e1e', '#8b3fd1'],
  };

  const levelFn = {
    run:  km   => !km ? 0 : km < 5  ? 1 : km < 10 ? 2 : km < 15 ? 3 : km < 20 ? 4 : 5,
    swim: km   => !km ? 0 : km < 1  ? 1 : km < 2  ? 2 : km < 3  ? 3 : km < 4  ? 4 : 5,
    ride: km   => !km ? 0 : km < 20 ? 1 : km < 40 ? 2 : km < 60 ? 3 : km < 90 ? 4 : 5,
    lift: mins => mins > 0 ? 1 : 0,
  };

  function fmtMins(mins) {
    if (mins < 60) return `${Math.round(mins)} min`;
    const h = Math.floor(mins / 60), m = Math.round(mins % 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }

  function sportColor(sport, km) {
    return COLORS[sport][levelFn[sport](km)];
  }

  // Background for a day's activities — diagonal gradient for multi-sport
  function cellBackground(acts) {
    const active = ['run', 'swim', 'ride', 'lift'].filter(s => (acts[s] || 0) > 0);
    if (active.length === 0) return COLORS.run[0];
    if (active.length === 1) return sportColor(active[0], acts[active[0]]);
    const cols = active.map(s => sportColor(s, acts[s]));
    if (cols.length === 2)
      return `linear-gradient(135deg, ${cols[0]} 50%, ${cols[1]} 50%)`;
    if (cols.length === 3)
      return `linear-gradient(135deg, ${cols[0]} 33%, ${cols[1]} 33% 66%, ${cols[2]} 66%)`;
    return `linear-gradient(135deg, ${cols[0]} 25%, ${cols[1]} 25% 50%, ${cols[2]} 50% 75%, ${cols[3]} 75%)`;
  }

  // Tooltip text — separate line per sport
  function cellLabel(acts) {
    const parts = [];
    if (acts.run  > 0) parts.push(`Run ${acts.run} km`);
    if (acts.swim > 0) parts.push(`Swim ${acts.swim} km`);
    if (acts.ride > 0) parts.push(`Ride ${acts.ride} km`);
    if (acts.lift > 0) parts.push(`Lift ${fmtMins(acts.lift)}`);
    return parts.length ? parts.join(' · ') : 'Rest day';
  }

  // ── Collect available years ──
  const yearSet = new Set(Object.keys(dailyActivities).map(d => parseInt(d.slice(0, 4))));
  yearSet.add(currentYear);
  const years = [...yearSet].sort((a, b) => b - a);

  function getYearSportKm(year) {
    return Object.entries(dailyActivities)
      .filter(([d]) => d.startsWith(year + '-'))
      .reduce((sum, [, acts]) => sum + (acts[_activeSport] || 0), 0);
  }

  // ── Render grid ──
  function renderGrid(year) {
    grid.innerHTML     = '';
    monthsEl.innerHTML = '';

    let start, yearEnd, yearStart;

    if (year === 'rolling') {
      yearStart = null;
      yearEnd   = today;
      start     = new Date(today);
      start.setDate(start.getDate() - 52 * 7);
      start.setDate(start.getDate() - start.getDay());

      const cutStr    = start.toISOString().slice(0, 10);
      const rollingKm = Object.entries(dailyActivities)
        .filter(([d]) => d >= cutStr)
        .reduce((sum, [, acts]) => sum + (acts[_activeSport] || 0), 0);
      if (ytdLabel) ytdLabel.textContent = `${Math.round(rollingKm * 10) / 10} km ${SPORT_LABEL[_activeSport]} in the last 365 days`;
    } else {
      yearStart = new Date(year, 0, 1);
      yearEnd   = year === currentYear ? today : new Date(year, 11, 31);
      start     = new Date(yearStart);
      start.setDate(start.getDate() - start.getDay());

      const km = Math.round(getYearSportKm(year) * 10) / 10;
      if (ytdLabel) ytdLabel.textContent = `${km.toLocaleString()} km ${SPORT_LABEL[_activeSport]} in ${year}`;
    }

    let cursor = new Date(start), weekIdx = 0, prevMonth = -1;
    let lastLabel = null, lastLabelCol = -99;

    while (cursor <= yearEnd) {
      const mo = cursor.getMonth();
      if (mo !== prevMonth) {
        if (lastLabel && weekIdx - lastLabelCol < MIN_GAP_COLS) lastLabel.remove();
        const lbl = document.createElement('span');
        lbl.className   = 'heatmap-month-label';
        lbl.textContent = cursor.toLocaleString('en-US', { month: 'short' }).toUpperCase();
        lbl.style.left  = (weekIdx * WEEK_W) + 'px';
        monthsEl.appendChild(lbl);
        lastLabel = lbl; lastLabelCol = weekIdx; prevMonth = mo;
      }

      const weekEl = document.createElement('div');
      weekEl.className = 'heatmap-week';

      for (let d = 0; d < 7; d++) {
        const dateStr = cursor.toISOString().slice(0, 10);
        const acts    = dailyActivities[dateStr] || {};
        const future  = cursor > today;
        const outside = yearStart && cursor < yearStart;

        const cell = document.createElement('div');
        cell.className = 'heatmap-cell';

        if (future || outside) {
          cell.classList.add('level-x');
        } else {
          cell.style.background = cellBackground(acts);

          if (tooltip) {
            const snap    = new Date(cursor);
            const fmtDate = snap.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            const label   = cellLabel(acts);
            cell.addEventListener('mouseenter', () => {
              tooltip.textContent = `${label} — ${fmtDate}`;
              tooltip.classList.add('is-visible');
            });
            cell.addEventListener('mousemove', e => {
              tooltip.style.left = (e.clientX + 14) + 'px';
              tooltip.style.top  = (e.clientY - 36) + 'px';
            });
            cell.addEventListener('mouseleave', () => tooltip.classList.remove('is-visible'));
          }
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

  _heatmapRerender = () => setActive(activeYear);
  renderGrid('rolling');
}

// ── STRAVA DATA ──
const BEST_EFFORT_ORDER = ['5k', '10k', '15k', '10 mile', '20k', 'Half-Marathon', '30k', 'Marathon'];
const BEST_EFFORT_LABELS = {
  '5k': '5 km', '10k': '10 km', '15k': '15 km', '10 mile': '10 Mile',
  '20k': '20 km', 'Half-Marathon': 'Half Marathon', '30k': '30 km', 'Marathon': 'Marathon',
};

const SPORT_CONFIG = {
  run:  { sectionTitle: 'RUNNING',  countLabel: 'Runs',  bestsTitle: 'PERSONAL BESTS', recentTitle: 'RECENT RUNS',  accentColor: '#de4355' },
  swim: { sectionTitle: 'SWIMMING', countLabel: 'Swims', bestsTitle: 'TOP SWIMS',       recentTitle: 'RECENT SWIMS', accentColor: '#2a96e8' },
  ride: { sectionTitle: 'CYCLING',  countLabel: 'Rides', bestsTitle: 'LONGEST RIDES',   recentTitle: 'RECENT RIDES', accentColor: '#3aab64' },
};

let _stravaData = null;

function renderStats(sport) {
  const t = _stravaData.sport_totals?.[sport];
  if (!t) return;
  document.getElementById('stat-alltime').textContent     = t.all_time_km.toLocaleString() + ' km';
  document.getElementById('stat-ytd-km').textContent      = t.ytd_km.toLocaleString() + ' km';
  document.getElementById('stat-ytd-runs').textContent    = t.ytd_count;
  document.getElementById('stat-ytd-time').textContent    = t.ytd_time;
  document.getElementById('stat-count-label').textContent = SPORT_CONFIG[sport].countLabel + ' (365 Days)';
}

function renderBests(sport) {
  const bestsEl = document.getElementById('strava-bests');
  bestsEl.dataset.sport = sport;
  document.getElementById('bests-title').textContent = SPORT_CONFIG[sport].bestsTitle;

  if (sport === 'run') {
    const bests    = _stravaData.best_efforts;
    const bestKeys = BEST_EFFORT_ORDER.filter(k => bests[k]);
    if (bestKeys.length === 0) {
      bestsEl.innerHTML = '<div class="hobby-best-empty">No PRs synced yet.</div>';
    } else {
      bestsEl.innerHTML = bestKeys.map(k => {
        const e = bests[k];
        return `<a class="hobby-best-row" href="https://www.strava.com/activities/${e.activity_id}" target="_blank" rel="noopener">
          <span class="hobby-best-dist">${BEST_EFFORT_LABELS[k]}</span>
          <span class="hobby-best-time">${e.time}</span>
          <span class="hobby-best-pace">${e.pace}</span>
          <span class="hobby-best-date">${e.date}</span>
        </a>`;
      }).join('');
    }
    if (!bests['Marathon']) {
      bestsEl.innerHTML += `<div class="hobby-best-row">
        <span class="hobby-best-dist">Marathon</span>
        <span class="hobby-best-time">working on it 🫩</span>
        <span class="hobby-best-pace"></span>
        <span class="hobby-best-date"></span>
      </div>`;
    }
    return;
  }

  // Swim / Ride — top sessions by distance
  const sessions = _stravaData.top_sessions?.[sport] ?? [];
  if (sessions.length === 0) {
    bestsEl.innerHTML = `<div class="hobby-best-empty">No ${sport} sessions recorded yet.</div>`;
    return;
  }
  bestsEl.innerHTML = sessions.map(s => `
    <a class="hobby-run-row" href="https://www.strava.com/activities/${s.id}" target="_blank" rel="noopener">
      <span class="hobby-run-name">${s.name}</span>
      <span class="hobby-run-dist">${s.distance} km</span>
      <span class="hobby-run-pace">${s.perf}</span>
      <span class="hobby-run-time">${s.time}</span>
      <span class="hobby-run-date">${s.date}</span>
    </a>`).join('');
}

function renderRecent(sport) {
  const recentEl = document.getElementById('strava-recent');
  recentEl.dataset.sport = sport;
  document.getElementById('recent-title').textContent = SPORT_CONFIG[sport].recentTitle;

  // Fall back to legacy recent_runs for run when new field not yet in JSON
  const activities = _stravaData.recent_activities?.[sport]
    ?? (sport === 'run'
        ? (_stravaData.recent_runs ?? []).map(r => ({ ...r, perf: r.pace }))
        : []);

  if (activities.length === 0) {
    recentEl.innerHTML = `<div class="hobby-best-empty">No recent ${sport} activities.</div>`;
    return;
  }
  recentEl.innerHTML = activities.map(a => `
    <a class="hobby-run-row" href="https://www.strava.com/activities/${a.id}" target="_blank" rel="noopener">
      <span class="hobby-run-name">${a.name}</span>
      <span class="hobby-run-dist">${a.distance} km</span>
      <span class="hobby-run-pace">${a.perf}</span>
      <span class="hobby-run-time">${a.time}</span>
      <span class="hobby-run-date">${a.date}</span>
    </a>`).join('');
}

function switchSport(sport) {
  _activeSport = sport;
  document.querySelectorAll('.sport-pill').forEach(p =>
    p.classList.toggle('is-active', p.dataset.sport === sport));
  const titleEl = document.getElementById('sport-section-title');
  if (titleEl) titleEl.textContent = SPORT_CONFIG[sport].sectionTitle;
  renderStats(sport);
  renderBests(sport);
  renderRecent(sport);
  _heatmapRerender?.();
}

fetch('strava-data.json')
  .then(r => r.json())
  .then(data => {
    _stravaData = data;
    document.getElementById('strava-updated').textContent = data.updated_at;

    // Build dailyActivities for heatmap
    const dailyActivities = {};
    if (data.daily_activities) {
      Object.assign(dailyActivities, data.daily_activities);
    } else {
      for (const [date, km] of Object.entries(data.daily_km || {}))
        dailyActivities[date] = { run: km };
    }
    buildHeatmap(dailyActivities);

    // Backward compat: synthesise sport_totals from old flat totals if not present
    if (!data.sport_totals) {
      const _t      = new Date(); _t.setHours(0, 0, 0, 0);
      const _cut    = new Date(_t);
      _cut.setDate(_cut.getDate() - 52 * 7);
      _cut.setDate(_cut.getDate() - _cut.getDay());
      const cutStr  = _cut.toISOString().slice(0, 10);
      const rolling = Object.entries(dailyActivities)
        .filter(([d]) => d >= cutStr)
        .reduce((s, [, a]) => s + (a.run || 0), 0);
      _stravaData.sport_totals = {
        run:  { all_time_km: data.totals.all_time_km, ytd_km: Math.round(rolling * 10) / 10,
                ytd_count: data.totals.ytd_runs, ytd_time: data.totals.ytd_time },
        swim: { all_time_km: 0, ytd_km: 0, ytd_count: 0, ytd_time: '—' },
        ride: { all_time_km: 0, ytd_km: 0, ytd_count: 0, ytd_time: '—' },
      };
    }

    document.querySelectorAll('.sport-pill').forEach(pill =>
      pill.addEventListener('click', () => switchSport(pill.dataset.sport)));

    switchSport('run');
  })
  .catch(() => {
    ['strava-bests', 'strava-recent'].forEach(id => {
      document.getElementById(id).innerHTML =
        '<div class="hobby-best-empty">Could not load Strava data.</div>';
    });
  });
