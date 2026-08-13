"""Shared activity model + site-JSON builder.

Two independent sources feed the site:
  * Garmin Connect  (scripts/fetch_garmin.py)  — automatic, daily
  * Strava CSV export (scripts/parse_export.py) — manual, for activities that
    were uploaded straight to Strava and never touched the watch

Each fetcher writes a *normalized* activity cache to data/. build_data.py then
merges the caches, de-duplicates, and writes strava-data.json for the site.

Normalized activity:
    {
      "id":          str,    # source-prefixed, e.g. "garmin-1234"
      "source":      str,    # "garmin" | "strava"
      "name":        str,
      "date":        str,    # YYYY-MM-DD (local)
      "start":       str,    # YYYY-MM-DD HH:MM:SS (local) — "" if unknown
      "sport":       str,    # run | swim | ride | lift
      "moving_time": float,  # seconds
      "distance":    float,  # meters (0 for lift)
    }
"""

import json
import os
from datetime import datetime, timezone, timedelta

REPO_ROOT = os.path.join(os.path.dirname(__file__), '..')
DATA_DIR  = os.path.join(REPO_ROOT, 'data')
OUT_PATH  = os.path.join(REPO_ROOT, 'strava-data.json')

SPORTS = ('run', 'swim', 'ride', 'lift')

BEST_EFFORT_NAMES = [
    '400m', '1/2 mile', '1k', '1 mile', '2 mile',
    '5k', '10k', '15k', '10 mile', '20k', 'Half-Marathon', '30k', 'Marathon',
]

# Distances we can synthesise from a longer run via proportional splits.
SYNTHETIC = [
    ('5k',            5_000,  5_000),
    ('10k',          10_000, 10_000),
    ('15k',          15_000, 15_000),
    ('20k',          20_000, 20_000),
    ('30k',          30_000, 30_000),
    ('Half-Marathon', 21_098, 21_098),
    ('Marathon',      42_195, 42_195),
]


# ── formatting ────────────────────────────────────────────────────────────
def fmt_time(seconds):
    seconds = int(seconds)
    h, rem = divmod(seconds, 3600)
    m, s   = divmod(rem, 60)
    return f'{h}:{m:02d}:{s:02d}' if h else f'{m}:{s:02d}'


def fmt_pace(elapsed_seconds, distance_meters):
    if not distance_meters:
        return '—'
    m, s = divmod(int(elapsed_seconds / (distance_meters / 1000)), 60)
    return f'{m}:{s:02d} /km'


def fmt_swim_pace(elapsed_seconds, distance_meters):
    if not distance_meters:
        return '—'
    m, s = divmod(int(elapsed_seconds / (distance_meters / 100)), 60)
    return f'{m}:{s:02d}/100m'


def fmt_speed(elapsed_seconds, distance_meters):
    if not elapsed_seconds:
        return '—'
    return f'{(distance_meters / 1000) / (elapsed_seconds / 3600):.1f} km/h'


def perf_for(sport, moving_time, distance):
    if sport == 'swim':
        return fmt_swim_pace(moving_time, distance)
    if sport == 'ride':
        return fmt_speed(moving_time, distance)
    return fmt_pace(moving_time, distance)


# ── sport mapping ─────────────────────────────────────────────────────────
def classify_sport(type_key):
    """Map a source's activity-type string onto our four buckets.

    Substring matching keeps this working when Garmin/Strava add new variants
    (gravel_cycling, virtual_run, indoor_running, …) without a code change.
    """
    if not type_key:
        return None
    k = str(type_key).strip().lower().replace(' ', '_')

    if 'swim' in k:
        return 'swim'
    if 'cycl' in k or 'bik' in k or k.endswith('ride') or k == 'ride':
        return 'ride'
    if 'run' in k or k == 'treadmill':
        return 'run'
    if 'strength' in k or 'weight' in k or k == 'workout':
        return 'lift'
    return None


# ── cache helpers ─────────────────────────────────────────────────────────
def cache_path(source):
    return os.path.join(DATA_DIR, f'{source}_activities.json')


def save_cache(source, activities):
    os.makedirs(DATA_DIR, exist_ok=True)
    activities = sorted(activities, key=lambda a: a['start'] or a['date'], reverse=True)
    with open(cache_path(source), 'w', encoding='utf-8') as f:
        json.dump({
            'source':      source,
            'fetched_at':  datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S'),
            'count':       len(activities),
            'activities':  activities,
        }, f, indent=2)
    print(f'  wrote {len(activities)} activities -> {os.path.relpath(cache_path(source), REPO_ROOT)}')


def load_cache(source):
    try:
        with open(cache_path(source), encoding='utf-8') as f:
            return json.load(f).get('activities', [])
    except (FileNotFoundError, json.JSONDecodeError):
        return []


# ── de-duplication ────────────────────────────────────────────────────────
def _start_dt(act):
    for fmt in ('%Y-%m-%d %H:%M:%S', '%Y-%m-%dT%H:%M:%S'):
        try:
            return datetime.strptime(act['start'], fmt)
        except (ValueError, KeyError, TypeError):
            continue
    return None


def is_duplicate(a, b):
    """Same real-world session recorded by both sources?

    Strava auto-imports from Garmin, so a manual CSV drop will usually overlap
    with what Garmin already gave us. Match on sport + start time proximity,
    falling back to same-day + similar duration when a start time is missing.
    """
    if a['sport'] != b['sport']:
        return False

    # Shape: same session should agree closely on duration and distance.
    dur_close  = abs(a['moving_time'] - b['moving_time']) <= max(120, 0.05 * max(a['moving_time'], b['moving_time'], 1))
    dist_close = abs(a['distance'] - b['distance']) <= max(200, 0.05 * max(a['distance'], b['distance'], 1))
    same_shape = dur_close and dist_close

    da, db = _start_dt(a), _start_dt(b)
    if da and db:
        delta = abs((da - db).total_seconds())
        if delta <= 600:                    # within 10 minutes
            return True
        # Timezone artifact: sources disagreeing by a near-whole number of
        # hours on an otherwise identical session (e.g. an activity recorded
        # in another timezone). Guarded by same_shape so genuinely distinct
        # sessions on nearby days don't collapse into one.
        if same_shape and delta <= 14 * 3600:
            off_by_hours = delta % 3600
            if min(off_by_hours, 3600 - off_by_hours) <= 180:
                return True
        if da.date() != db.date():
            return False
    elif a['date'] != b['date']:
        return False

    return same_shape


def merge_sources(primary, secondary):
    """Merge two normalized lists, preferring `primary` on conflicts.

    Garmin is the device of record, so it wins; Strava-only activities
    (manual uploads that never hit the watch) are appended.

    Candidates are compared against `primary` only — never against each other.
    A single source is trusted to be internally distinct, and back-to-back
    sessions of the same sport (a split recording, a two-part workout) are
    legitimately separate activities.
    """
    merged = [dict(p) for p in primary]
    added  = []
    for cand in secondary:
        match = next((p for p in merged if is_duplicate(cand, p)), None)
        if match is None:
            added.append(cand)
            continue
        # Overlap: keep the primary's metrics (device of record) but take the
        # secondary's title. Garmin auto-names everything ("Ottawa Running");
        # Strava is where activities actually get named by hand, and those
        # titles are what the site surfaces under RECENT RUNS.
        if cand.get('name'):
            match['name'] = cand['name']
        # Remember the Strava id too. Garmin Connect activities are private by
        # default, so a visitor clicking through would hit a login wall —
        # link these to the public Strava copy instead.
        match['alt_id'] = cand['id']

    merged += added
    merged.sort(key=lambda a: a['start'] or a['date'], reverse=True)
    return merged, len(added)


# ── site JSON ─────────────────────────────────────────────────────────────
def load_existing_best_efforts():
    """Real PRs recorded back when the Strava API was reachable.

    The API is subscriber-only now, so these can never be re-fetched — they are
    carried forward and only ever replaced by something genuinely faster.
    """
    try:
        with open(OUT_PATH, encoding='utf-8') as f:
            existing = json.load(f).get('best_efforts', {})
        return {k: v for k, v in existing.items() if k in BEST_EFFORT_NAMES}
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def build_output(activities):
    runs = [a for a in activities if a['sport'] == 'run']

    # ── best efforts: keep saved PRs, improve via proportional splits ──
    best_efforts = load_existing_best_efforts()
    for key, min_dist, effort_dist in SYNTHETIC:
        for act in runs:
            if act['distance'] < min_dist or not act['moving_time']:
                continue
            elapsed = int(act['moving_time'] * (effort_dist / act['distance']))
            if elapsed <= 0 or (elapsed / (effort_dist / 1000)) < 120:
                continue    # reject sub-2:00/km — corrupt GPS
            if key not in best_efforts or elapsed < best_efforts[key]['elapsed_time']:
                best_efforts[key] = {
                    'elapsed_time': elapsed,
                    'time':         fmt_time(elapsed),
                    'pace':         fmt_pace(elapsed, effort_dist),
                    'activity_id':  act.get('alt_id') or act['id'],
                    'date':         act['date'],
                }

    # ── heatmap ──
    daily_activities, daily_km = {}, {}
    for act in activities:
        day   = daily_activities.setdefault(act['date'], {})
        sport = act['sport']
        if sport == 'lift':
            day['lift'] = round(day.get('lift', 0) + act['moving_time'] / 60, 1)
            continue
        km = round(act['distance'] / 1000, 2)
        day[sport] = round(day.get(sport, 0) + km, 2)
        if sport == 'run':
            daily_km[act['date']] = round(daily_km.get(act['date'], 0) + km, 2)

    # ── totals (rolling 365 days) ──
    cutoff = (datetime.now(timezone.utc) - timedelta(days=365)).strftime('%Y-%m-%d')
    sport_totals = {}
    for sport in ('run', 'swim', 'ride'):
        acts = [a for a in activities if a['sport'] == sport]
        l365 = [a for a in acts if a['date'] >= cutoff]
        sport_totals[sport] = {
            'all_time_km': round(sum(a['distance'] for a in acts) / 1000, 1),
            'ytd_km':      round(sum(a['distance'] for a in l365) / 1000, 1),
            'ytd_count':   len(l365),
            'ytd_time':    fmt_time(sum(a['moving_time'] for a in l365)),
        }

    def row(a):
        return {
            # alt_id (the public Strava copy) wins when we have it — see
            # merge_sources. Falls back to the source-prefixed id.
            'id':       a.get('alt_id') or a['id'],
            'name':     a['name'],
            'distance': round(a['distance'] / 1000, 2),
            'time':     fmt_time(a['moving_time']),
            'perf':     perf_for(a['sport'], a['moving_time'], a['distance']),
            'date':     a['date'],
        }

    recent_activities = {
        s: [row(a) for a in [x for x in activities if x['sport'] == s][:6]]
        for s in ('run', 'swim', 'ride')
    }
    top_sessions = {
        s: [row(a) for a in sorted(
                [x for x in activities if x['sport'] == s],
                key=lambda x: x['distance'], reverse=True)[:5]]
        for s in ('swim', 'ride')
    }

    runs_l365 = [a for a in runs if a['date'] >= cutoff]
    return {
        'updated_at': datetime.now(timezone.utc).strftime('%Y-%m-%d'),
        'totals': {                                    # legacy — kept for back-compat
            'all_time_km': round(sum(a['distance'] for a in runs) / 1000, 1),
            'ytd_km':      round(sum(a['distance'] for a in runs_l365) / 1000, 1),
            'ytd_runs':    len(runs_l365),
            'ytd_time':    fmt_time(sum(a['moving_time'] for a in runs_l365)),
        },
        'sport_totals':      sport_totals,
        'best_efforts':      best_efforts,
        'recent_runs':       [                          # legacy
            {**row(a), 'pace': perf_for('run', a['moving_time'], a['distance'])}
            for a in runs[:6]
        ],
        'recent_activities': recent_activities,
        'top_sessions':      top_sessions,
        'daily_km':          daily_km,                  # legacy (run only)
        'daily_activities':  daily_activities,
    }


def write_output(data):
    with open(OUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2)
    print(f'Wrote {os.path.relpath(OUT_PATH, REPO_ROOT)}')
