import requests
import json
import os
from datetime import datetime, timezone

CLIENT_ID     = os.environ['STRAVA_CLIENT_ID']
CLIENT_SECRET = os.environ['STRAVA_CLIENT_SECRET']
REFRESH_TOKEN = os.environ['STRAVA_REFRESH_TOKEN']

BEST_EFFORT_NAMES = ['1k', '5k', '10k', 'Half-Marathon', 'Marathon']
MAX_ACTIVITIES    = 50  # how many recent runs to scan for PRs


def get_access_token():
    r = requests.post('https://www.strava.com/oauth/token', data={
        'client_id':     CLIENT_ID,
        'client_secret': CLIENT_SECRET,
        'grant_type':    'refresh_token',
        'refresh_token': REFRESH_TOKEN,
    })
    r.raise_for_status()
    return r.json()['access_token']


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

    # ── All-time stats ──
    stats_r = requests.get(
        f'https://www.strava.com/api/v3/athletes/{athlete_id}/stats',
        headers=headers
    )
    stats_r.raise_for_status()
    stats = stats_r.json()

    # ── Recent running activities ──
    acts_r = requests.get(
        'https://www.strava.com/api/v3/athlete/activities',
        headers=headers,
        params={'per_page': MAX_ACTIVITIES}
    )
    acts_r.raise_for_status()
    all_acts = [a for a in acts_r.json() if a.get('sport_type') == 'Run' or a.get('type') == 'Run']

    # ── Scan for best efforts ──
    best_efforts = {}
    recent_runs  = []

    for act in all_acts:
        # Collect recent runs (first 6)
        if len(recent_runs) < 6:
            recent_runs.append({
                'id':       act['id'],
                'name':     act['name'],
                'distance': round(act['distance'] / 1000, 2),
                'time':     fmt_time(act['moving_time']),
                'pace':     fmt_pace(act['moving_time'], act['distance']),
                'date':     act['start_date_local'][:10],
            })

        # Fetch detail for best_efforts
        det_r = requests.get(
            f'https://www.strava.com/api/v3/activities/{act["id"]}',
            headers=headers
        )
        if not det_r.ok:
            continue
        detail = det_r.json()

        for effort in detail.get('best_efforts', []):
            name = effort['name']
            if name not in BEST_EFFORT_NAMES:
                continue
            elapsed = effort['elapsed_time']
            if name not in best_efforts or elapsed < best_efforts[name]['elapsed_time']:
                best_efforts[name] = {
                    'elapsed_time': elapsed,
                    'time':         fmt_time(elapsed),
                    'pace':         fmt_pace(elapsed, effort['distance']),
                    'activity_id':  act['id'],
                    'date':         act['start_date_local'][:10],
                }

    output = {
        'updated_at': datetime.now(timezone.utc).strftime('%Y-%m-%d'),
        'totals': {
            'all_time_km':  round(stats['all_time_totals']['distance'] / 1000, 1),
            'ytd_km':       round(stats['ytd_run_totals']['distance'] / 1000, 1),
            'ytd_runs':     stats['ytd_run_totals']['count'],
            'ytd_time':     fmt_time(stats['ytd_run_totals']['moving_time']),
        },
        'best_efforts': best_efforts,
        'recent_runs':  recent_runs,
    }

    out_path = os.path.join(os.path.dirname(__file__), '..', 'strava-data.json')
    with open(out_path, 'w') as f:
        json.dump(output, f, indent=2)

    print(f"Done. {len(recent_runs)} recent runs, {len(best_efforts)} PRs found.")


if __name__ == '__main__':
    main()
