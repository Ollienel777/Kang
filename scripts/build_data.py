"""Merge the per-source activity caches and write strava-data.json.

Garmin is the device of record so it wins any overlap; Strava contributes only
the activities Garmin never saw (manual uploads). Run after either fetcher —
whichever source just refreshed, the other's cache is still on disk, so the
site JSON always reflects both.

    python scripts/fetch_garmin.py   &&  python scripts/build_data.py
    python scripts/parse_export.py   &&  python scripts/build_data.py
"""

import sys
import traceback

import activity_common as common


def main():
    garmin = common.load_cache('garmin')
    strava = common.load_cache('strava')
    print(f'garmin cache: {len(garmin)} activities')
    print(f'strava cache: {len(strava)} activities')

    if not garmin and not strava:
        raise SystemExit('Both caches are empty — run fetch_garmin.py or '
                         'parse_export.py first.')

    merged, added = common.merge_sources(garmin, strava)
    overlap = len(strava) - added
    print(f'merged -> {len(merged)} activities '
          f'({added} strava-only added, {overlap} duplicates dropped)')

    by_sport = {}
    for a in merged:
        by_sport[a['sport']] = by_sport.get(a['sport'], 0) + 1
    print(f'by sport: {by_sport}')

    data = common.build_output(merged)
    common.write_output(data)

    t = data['sport_totals']
    print(f"  run  {t['run']['all_time_km']} km all-time, {t['run']['ytd_count']} in last 365d")
    print(f"  swim {t['swim']['all_time_km']} km  |  ride {t['ride']['all_time_km']} km")
    print(f"  {len(data['best_efforts'])} PRs, {len(data['daily_activities'])} active days")


if __name__ == '__main__':
    try:
        main()
    except SystemExit:
        raise
    except Exception as e:
        print(f'\nFATAL: {type(e).__name__}: {e}', file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)
