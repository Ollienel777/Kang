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
