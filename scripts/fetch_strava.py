import requests
import json
import os
import time
from datetime import datetime, timezone, timedelta

CLIENT_ID     = os.environ['STRAVA_CLIENT_ID']
CLIENT_SECRET = os.environ['STRAVA_CLIENT_SECRET']
REFRESH_TOKEN = os.environ['STRAVA_REFRESH_TOKEN']

BEST_EFFORT_NAMES = ['400m', '1/2 mile', '1k', '1 mile', '2 mile', '5k', '10k', '15k', '10 mile', '20k', 'Half-Marathon', '30k', 'Marathon']
# Strava's API inconsistently capitalises distance names (e.g. "30K" vs "30k").
# Build a case-insensitive lookup so we never miss a segment.
BEST_EFFORT_LOOKUP = {n.lower(): n for n in BEST_EFFORT_NAMES}

# Known distances (meters) — fallback when Strava returns distance=0
EFFORT_DISTANCES_M = {
    '400m': 400, '1/2 mile': 805, '1k': 1000, '1 mile': 1609,
    '2 mile': 3219, '5k': 5000, '10k': 10000, '15k': 15000,
    '10 mile': 16093, '20k': 20000, 'Half-Marathon': 21098,
    '30k': 30000, 'Marathon': 42195,
}

# Only fetch individual activity details for this many recent days.
# Older PRs are preserved from the previous strava-data.json.
# This keeps each run well under Strava's 1000 req/day limit.
DETAIL_WINDOW_DAYS = 60


def get_access_token():
    r = requests.post('https://www.strava.com/oauth/token', data={
        'client_id':     CLIENT_ID,
        'client_secret': CLIENT_SECRET,
        'grant_type':    'refresh_token',
        'refresh_token': REFRESH_TOKEN,
    })
    data = r.json()
    print(f'Token response status: {r.status_code}')
    if 'access_token' not in data:
        print(f'Token error: {data}')
        r.raise_for_status()
        raise Exception(f'No access_token in response: {data}')
    return data['access_token']


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


def main():
    token   = get_access_token()
    headers = {'Authorization': f'Bearer {token}'}

    # ── Athlete ID ──
    athlete = requests.get('https://www.strava.com/api/v3/athlete', headers=headers)
    athlete.raise_for_status()
    athlete_id = athlete.json()['id']

    # ── All activities (paginated) — run / swim / ride ──
    SPORT_MAP = {}
    for sport, types in {
        'run':  {'Run', 'TrailRun', 'VirtualRun', 'Treadmill'},
        'swim': {'Swim', 'OpenWaterSwim'},
        'ride': {'Ride', 'VirtualRide', 'EBikeRide', 'MountainBikeRide', 'GravelRide'},
    }.items():
        for t in types:
            SPORT_MAP[t] = sport

    all_acts    = []   # runs only — used for PRs / recent runs
    all_tracked = []   # all run+swim+ride — used for heatmap

    page = 1
    while True:
        acts_r = requests.get(
            'https://www.strava.com/api/v3/athlete/activities',
            headers=headers,
            params={'per_page': 200, 'page': page}
        )
        print(f'Activities page {page} status: {acts_r.status_code}')
        if not acts_r.ok:
            print(f'Activities error: {acts_r.json()}')
        acts_r.raise_for_status()
        batch = acts_r.json()
        if not batch:
            break
        for a in batch:
            sport = SPORT_MAP.get(a.get('sport_type') or a.get('type', ''))
            if sport == 'run':
                all_acts.append(a)
                all_tracked.append(('run', a))
            elif sport in ('swim', 'ride'):
                all_tracked.append((sport, a))
        if len(batch) < 200:
            break
        page += 1
    print(f'Total runs: {len(all_acts)}  |  Total tracked: {len(all_tracked)}')

    # ── Load existing PRs as baseline ──
    # Only activity details for the last DETAIL_WINDOW_DAYS are re-fetched.
    # Any PR set before that window is preserved from the saved JSON so we
    # don't need to re-fetch hundreds of old activities every day.
    out_path = os.path.join(os.path.dirname(__file__), '..', 'strava-data.json')
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

    # ── Fetch detail only for recent activities ──
    detail_cutoff = (datetime.now(timezone.utc) - timedelta(days=DETAIL_WINDOW_DAYS)).strftime('%Y-%m-%d')
    recent_acts   = [a for a in all_acts if a['start_date_local'][:10] >= detail_cutoff]
    print(f'Fetching details for {len(recent_acts)} activities (last {DETAIL_WINDOW_DAYS} days)')

    recent_runs = []
    for act in all_acts[:6]:   # recent_runs always from full sorted list
        recent_runs.append({
            'id':       act['id'],
            'name':     act['name'],
            'distance': round(act['distance'] / 1000, 2),
            'time':     fmt_time(act['moving_time']),
            'pace':     fmt_pace(act['moving_time'], act['distance']),
            'date':     act['start_date_local'][:10],
        })

    for act in recent_acts:
        time.sleep(0.3)   # stay well under the 100-req/15-min burst limit
        det_r = requests.get(
            f'https://www.strava.com/api/v3/activities/{act["id"]}',
            headers=headers
        )
        if not det_r.ok:
            print(f'  Detail fetch failed for {act["id"]}: {det_r.status_code}')
            continue
        detail = det_r.json()

        for effort in detail.get('best_efforts', []):
            name = BEST_EFFORT_LOOKUP.get(effort['name'].lower())
            if name is None:
                continue
            elapsed = effort['elapsed_time']
            dist    = effort.get('distance', 0) or EFFORT_DISTANCES_M.get(name, 0)
            # Reject pace faster than 2:00 /km — catches corrupt GPS data
            if dist > 0 and (elapsed / (dist / 1000)) < 120:
                print(f'  Skipping bogus effort {name} on {act["id"]}: {elapsed}s')
                continue
            if name not in best_efforts or elapsed < best_efforts[name]['elapsed_time']:
                best_efforts[name] = {
                    'elapsed_time': elapsed,
                    'time':         fmt_time(elapsed),
                    'pace':         fmt_pace(elapsed, dist),
                    'activity_id':  act['id'],
                    'date':         act['start_date_local'][:10],
                }

    # ── Synthetic bests (proportional splits) for gaps Strava doesn't track ──
    # Note: we do NOT skip keys that already exist — a later (longer) run can
    # produce a faster proportional split. The "elapsed < existing" guard below
    # prevents any synthetic from replacing a genuinely better real PR.
    SYNTHETIC = [
        ('5k',  5_000,  5000),
        ('10k', 10_000, 10000),
        ('15k', 15_000, 15000),
        ('20k', 20_000, 20000),
        ('30k', 30_000, 30000),
    ]
    for key, min_dist, effort_dist in SYNTHETIC:
        for act in all_acts:
            if act['distance'] < min_dist:
                continue
            elapsed = int(act['moving_time'] * (effort_dist / act['distance']))
            if key not in best_efforts or elapsed < best_efforts[key]['elapsed_time']:
                best_efforts[key] = {
                    'elapsed_time': elapsed,
                    'time':         fmt_time(elapsed),
                    'pace':         fmt_pace(elapsed, effort_dist),
                    'activity_id':  act['id'],
                    'date':         act['start_date_local'][:10],
                }

    # ── Daily activities map (heatmap) — keyed by sport ──
    daily_activities = {}
    daily_km = {}   # run-only legacy field for backward compat
    for sport, act in all_tracked:
        date = act['start_date_local'][:10]
        km   = round(act['distance'] / 1000, 2)
        if date not in daily_activities:
            daily_activities[date] = {}
        prev = daily_activities[date].get(sport, 0)
        daily_activities[date][sport] = round(prev + km, 2)
        if sport == 'run':
            daily_km[date] = round(daily_km.get(date, 0) + km, 2)

    # ── Totals (rolling 365-day window) ──
    cutoff_365    = (datetime.now(timezone.utc) - timedelta(days=365)).strftime('%Y-%m-%d')
    all_time_dist = sum(a['distance'] for a in all_acts)
    l365_acts     = [a for a in all_acts if a['start_date_local'][:10] >= cutoff_365]
    l365_dist     = sum(a['distance'] for a in l365_acts)
    l365_time     = sum(a['moving_time'] for a in l365_acts)

    output = {
        'updated_at': datetime.now(timezone.utc).strftime('%Y-%m-%d'),
        'totals': {
            'all_time_km': round(all_time_dist / 1000, 1),
            'ytd_km':      round(l365_dist / 1000, 1),
            'ytd_runs':    len(l365_acts),
            'ytd_time':    fmt_time(l365_time),
        },
        'best_efforts':      best_efforts,
        'recent_runs':       recent_runs,
        'daily_km':          daily_km,          # run-only legacy
        'daily_activities':  daily_activities,  # run + swim + ride
    }

    with open(out_path, 'w') as f:
        json.dump(output, f, indent=2)

    total_reqs = 2 + page + len(recent_acts)  # token + athlete + pages + details
    print(f'Done. {len(recent_runs)} recent runs, {len(best_efforts)} PRs. ~{total_reqs} API requests used.')


if __name__ == '__main__':
    main()
