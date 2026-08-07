"""Parse a Strava bulk export (activities.csv) into data/strava_activities.json.

Kept alongside the Garmin sync for activities that were uploaded straight to
Strava and never recorded on the watch. build_data.py merges the two and drops
anything that appears in both.

Usage:
    1. Strava -> Settings -> Download or Delete Your Data -> request archive
    2. Copy activities.csv from the zip into the repo root
    3. Commit + push — the strava-sync workflow reparses and rebuilds
"""

import csv
import os
import sys
import traceback
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import activity_common as common

# Strava's bulk export stores "Activity Date" in UTC, even though the activity
# *names* it generates ("Evening Run") come from local time. Left unconverted,
# every activity after ~20:00 local lands on the following day — wrong day in
# the heatmap, and it breaks de-duplication against Garmin's local timestamps.
# Change this if you relocate; DST is handled automatically.
LOCAL_TZ = ZoneInfo('America/Toronto')

# Column indices in Strava's bulk-export activities.csv. Several headers repeat;
# the later occurrences hold clean numeric values (plain metres / seconds)
# rather than the display-formatted ones ("2,000").
COL_ID     = 0    # Activity ID
COL_DATE   = 1    # "Jul 1, 2026, 12:11:02 AM"
COL_NAME   = 2    # Activity Name
COL_TYPE   = 3    # Activity Type
COL_MOVING = 16   # Moving Time (seconds)
COL_DIST   = 17   # Distance (metres)

DATE_FMT = '%b %d, %Y, %I:%M:%S %p'


def main():
    csv_path = os.path.join(common.REPO_ROOT, 'activities.csv')
    if not os.path.exists(csv_path):
        raise SystemExit(f'No activities.csv found at {csv_path}. '
                         'Export it from Strava and place it in the repo root.')

    activities, skipped, bad_dates = [], {}, 0

    with open(csv_path, newline='', encoding='utf-8') as f:
        reader = csv.reader(f)
        next(reader, None)                       # header
        for row in reader:
            if len(row) <= COL_DIST:
                continue

            sport = common.classify_sport(row[COL_TYPE])
            if sport is None:
                key = row[COL_TYPE].strip() or 'unknown'
                skipped[key] = skipped.get(key, 0) + 1
                continue

            try:
                dt = (datetime.strptime(row[COL_DATE].strip(), DATE_FMT)
                      .replace(tzinfo=timezone.utc)      # column is UTC
                      .astimezone(LOCAL_TZ))             # -> local wall clock
            except ValueError:
                bad_dates += 1
                continue

            activities.append({
                'id':          f'strava-{row[COL_ID].strip()}',
                'source':      'strava',
                'name':        row[COL_NAME].strip() or sport.title(),
                'date':        dt.strftime('%Y-%m-%d'),
                'start':       dt.strftime('%Y-%m-%d %H:%M:%S'),
                'sport':       sport,
                'moving_time': float(row[COL_MOVING] or 0),
                'distance':    float(row[COL_DIST] or 0),
            })

    if bad_dates:
        print(f'  skipped {bad_dates} rows with unparseable dates')
    if skipped:
        print(f'  ignored untracked types: {skipped}')

    if not activities:
        raise SystemExit('activities.csv produced zero tracked activities — '
                         'refusing to overwrite the cache with an empty result.')

    by_sport = {}
    for a in activities:
        by_sport[a['sport']] = by_sport.get(a['sport'], 0) + 1
    print(f'Parsed {len(activities)} activities: {by_sport}')
    common.save_cache('strava', activities)


if __name__ == '__main__':
    try:
        main()
    except SystemExit:
        raise
    except Exception as e:
        print(f'\nFATAL: {type(e).__name__}: {e}', file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)
