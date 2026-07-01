import csv, json, os
from datetime import datetime, timezone, timedelta

# ── Column indices (0-based) in Strava's bulk-export activities.csv ──
# Several column names appear twice; we use the second occurrence where
# it gives cleaner values (Distance in plain metres, not "2,000" format).
COL_ID     = 0   # Activity ID
COL_DATE   = 1   # Activity Date  e.g. "Jul 1, 2026, 12:11:02 AM"
COL_NAME   = 2   # Activity Name
COL_TYPE   = 3   # Activity Type  e.g. "Run", "Swim", "Workout"
COL_MOVING = 16  # Moving Time (seconds, float)
COL_DIST   = 17  # Distance (metres, float — no comma separators)

DATE_FMT = '%b %d, %Y, %I:%M:%S %p'

SPORT_MAP = {
    'Run': 'run', 'Trail Run': 'run', 'Virtual Run': 'run', 'Treadmill': 'run',
    'Swim': 'swim', 'Open Water Swim': 'swim',
    'Ride': 'ride', 'Virtual Ride': 'ride', 'E-Bike Ride': 'ride',
    'Mountain Bike Ride': 'ride', 'Gravel Ride': 'ride',
    'Weight Training': 'lift', 'Workout': 'lift',
}

BEST_EFFORT_NAMES = [
    '400m', '1/2 mile', '1k', '1 mile', '2 mile',
    '5k', '10k', '15k', '10 mile', '20k', 'Half-Marathon', '30k', 'Marathon',
]

EFFORT_DISTANCES_M = {
    '400m': 400, '1/2 mile': 805, '1k': 1000, '1 mile': 1609,
    '2 mile': 3219, '5k': 5000, '10k': 10000, '15k': 15000,
    '10 mile': 16093, '20k': 20000, 'Half-Marathon': 21098,
    '30k': 30000, 'Marathon': 42195,
}

SYNTHETIC = [
    ('5k',           5_000,  5000),
    ('10k',         10_000, 10000),
    ('15k',         15_000, 15000),
    ('20k',         20_000, 20000),
    ('30k',         30_000, 30000),
    ('Half-Marathon', 21098, 21098),
    ('Marathon',    42195,  42195),
]


def fmt_time(seconds):
    seconds = int(seconds)
    h, rem = divmod(seconds, 3600)
    m, s   = divmod(rem, 60)
    return f'{h}:{m:02d}:{s:02d}' if h else f'{m}:{s:02d}'


def fmt_pace(elapsed_seconds, distance_meters):
    if not distance_meters:
        return '—'
    sec_per_km = elapsed_seconds / (distance_meters / 1000)
    m, s = divmod(int(sec_per_km), 60)
    return f'{m}:{s:02d} /km'


def fmt_swim_pace(elapsed_seconds, distance_meters):
    if not distance_meters:
        return '—'
    sec_per_100m = elapsed_seconds / (distance_meters / 100)
    m, s = divmod(int(sec_per_100m), 60)
    return f'{m}:{s:02d}/100m'


def fmt_speed(elapsed_seconds, distance_meters):
    if not elapsed_seconds:
        return '—'
    kmh = (distance_meters / 1000) / (elapsed_seconds / 3600)
    return f'{kmh:.1f} km/h'


def main():
    base_dir = os.path.join(os.path.dirname(__file__), '..')
    csv_path = os.path.join(base_dir, 'activities.csv')
    out_path = os.path.join(base_dir, 'strava-data.json')

    # ── Preserve existing best_efforts — API PRs survive even without API ──
    try:
        with open(out_path) as f:
            existing_data = json.load(f)
        best_efforts = {
            k: v for k, v in existing_data.get('best_efforts', {}).items()
            if k in BEST_EFFORT_NAMES
        }
        print(f'Loaded {len(best_efforts)} existing PRs from strava-data.json')
    except (FileNotFoundError, json.JSONDecodeError):
        best_efforts = {}

    # ── Parse activities.csv ──
    all_acts    = []  # run activities — used for PRs and recent runs
    all_tracked = []  # all sports    — used for heatmap

    with open(csv_path, newline='', encoding='utf-8') as f:
        reader = csv.reader(f)
        next(reader)  # skip header row
        for row in reader:
            if len(row) <= COL_DIST:
                continue
            sport = SPORT_MAP.get(row[COL_TYPE].strip())
            if not sport:
                continue
            try:
                dt = datetime.strptime(row[COL_DATE].strip(), DATE_FMT)
            except ValueError:
                print(f'  Skipping unparseable date: {row[COL_DATE]!r}')
                continue

            moving_time = float(row[COL_MOVING] or 0)
            distance_m  = float(row[COL_DIST]   or 0)
            act = {
                'id':          row[COL_ID],
                'name':        row[COL_NAME].strip(),
                'date':        dt.strftime('%Y-%m-%d'),
                'sport':       sport,
                'moving_time': moving_time,
                'distance':    distance_m,
            }
            all_tracked.append(act)
            if sport == 'run':
                all_acts.append(act)

    print(f'Parsed {len(all_tracked)} tracked activities ({len(all_acts)} runs)')

    # ── Synthetic best efforts (proportional splits from full-distance runs) ──
    for key, min_dist, effort_dist in SYNTHETIC:
        for act in all_acts:
            if act['distance'] < min_dist:
                continue
            elapsed = int(act['moving_time'] * (effort_dist / act['distance']))
            if elapsed <= 0:
                continue
            # Reject anything faster than 2:00 /km — corrupted GPS data
            if (elapsed / (effort_dist / 1000)) < 120:
                continue
            if key not in best_efforts or elapsed < best_efforts[key]['elapsed_time']:
                best_efforts[key] = {
                    'elapsed_time': elapsed,
                    'time':         fmt_time(elapsed),
                    'pace':         fmt_pace(elapsed, effort_dist),
                    'activity_id':  act['id'],
                    'date':         act['date'],
                }

    # ── Daily activities map (heatmap) ──
    daily_activities = {}
    daily_km         = {}  # run-only legacy field
    for act in all_tracked:
        date  = act['date']
        sport = act['sport']
        if date not in daily_activities:
            daily_activities[date] = {}
        if sport == 'lift':
            mins = round(act['moving_time'] / 60, 1)
            daily_activities[date]['lift'] = round(
                daily_activities[date].get('lift', 0) + mins, 1)
            continue
        km = round(act['distance'] / 1000, 2)
        daily_activities[date][sport] = round(
            daily_activities[date].get(sport, 0) + km, 2)
        if sport == 'run':
            daily_km[date] = round(daily_km.get(date, 0) + km, 2)

    # ── Totals (rolling 365-day window) ──
    cutoff_365 = (datetime.now(timezone.utc) - timedelta(days=365)).strftime('%Y-%m-%d')
    runs_l365  = [a for a in all_acts if a['date'] >= cutoff_365]

    sport_totals = {}
    for sport in ('run', 'swim', 'ride'):
        acts   = [a for a in all_tracked if a['sport'] == sport]
        l365_s = [a for a in acts       if a['date']  >= cutoff_365]
        sport_totals[sport] = {
            'all_time_km': round(sum(a['distance'] for a in acts)   / 1000, 1),
            'ytd_km':      round(sum(a['distance'] for a in l365_s) / 1000, 1),
            'ytd_count':   len(l365_s),
            'ytd_time':    fmt_time(sum(a['moving_time'] for a in l365_s)),
        }

    # ── Recent activities (last 6 per sport, CSV is newest-first) ──
    recent_activities = {}
    for sport in ('run', 'swim', 'ride'):
        rows = []
        for a in [a for a in all_tracked if a['sport'] == sport][:6]:
            if sport == 'swim':
                perf = fmt_swim_pace(a['moving_time'], a['distance'])
            elif sport == 'ride':
                perf = fmt_speed(a['moving_time'], a['distance'])
            else:
                perf = fmt_pace(a['moving_time'], a['distance'])
            rows.append({
                'id':       a['id'],
                'name':     a['name'],
                'distance': round(a['distance'] / 1000, 2),
                'time':     fmt_time(a['moving_time']),
                'perf':     perf,
                'date':     a['date'],
            })
        recent_activities[sport] = rows

    # ── Top sessions (swim & ride — by distance) ──
    top_sessions = {}
    for sport in ('swim', 'ride'):
        acts = sorted(
            [a for a in all_tracked if a['sport'] == sport],
            key=lambda a: a['distance'], reverse=True
        )[:5]
        rows = []
        for a in acts:
            perf = fmt_swim_pace(a['moving_time'], a['distance']) \
                   if sport == 'swim' else fmt_speed(a['moving_time'], a['distance'])
            rows.append({
                'id':       a['id'],
                'name':     a['name'],
                'distance': round(a['distance'] / 1000, 2),
                'time':     fmt_time(a['moving_time']),
                'perf':     perf,
                'date':     a['date'],
            })
        top_sessions[sport] = rows

    # ── Legacy recent_runs (backward compat) ──
    recent_runs = []
    for a in all_acts[:6]:
        recent_runs.append({
            'id':       a['id'],
            'name':     a['name'],
            'distance': round(a['distance'] / 1000, 2),
            'time':     fmt_time(a['moving_time']),
            'pace':     fmt_pace(a['moving_time'], a['distance']),
            'date':     a['date'],
        })

    output = {
        'updated_at': datetime.now(timezone.utc).strftime('%Y-%m-%d'),
        'totals': {                              # legacy — kept for backward compat
            'all_time_km': round(sum(a['distance'] for a in all_acts) / 1000, 1),
            'ytd_km':      round(sum(a['distance'] for a in runs_l365) / 1000, 1),
            'ytd_runs':    len(runs_l365),
            'ytd_time':    fmt_time(sum(a['moving_time'] for a in runs_l365)),
        },
        'sport_totals':      sport_totals,
        'best_efforts':      best_efforts,
        'recent_runs':       recent_runs,        # legacy
        'recent_activities': recent_activities,
        'top_sessions':      top_sessions,
        'daily_km':          daily_km,           # run-only legacy
        'daily_activities':  daily_activities,
    }

    with open(out_path, 'w') as f:
        json.dump(output, f, indent=2)

    print(f'Done. {len(all_tracked)} activities written to strava-data.json')


if __name__ == '__main__':
    import traceback, sys
    try:
        main()
    except Exception as e:
        print(f'\nFATAL: {type(e).__name__}: {e}', file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)
