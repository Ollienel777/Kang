"""Fetch activities from Garmin Connect into data/garmin_activities.json.

AUTH
----
CI uses a saved token blob so no password ever touches the workflow:

    1. Run locally:   python scripts/fetch_garmin.py --login
       (prompts for your Garmin email / password / MFA code)
    2. It prints a token string. Store it as the GARMINTOKENS repo secret.
    3. The workflow passes GARMINTOKENS through and login() resumes the session.

Tokens last roughly a year; re-run --login when the workflow reports an auth
failure. As a fallback the script also accepts GARMIN_EMAIL / GARMIN_PASSWORD,
but that path breaks under MFA and is more likely to trip bot detection.

Note: Garmin Connect has no official public API. garminconnect is a community
library talking to Garmin's private mobile endpoints, so it can break when
Garmin changes them — that's why the Strava CSV path is kept as a fallback.
"""

import os
import sys
import traceback

from garminconnect import Garmin

import activity_common as common

# Full history, fetched in pages. Cheap enough (a few hundred activities) and
# self-healing: renamed or deleted activities correct themselves each run.
PAGE_SIZE = 100
MAX_PAGES = 40


def _login():
    """Resume from GARMINTOKENS if present, else fall back to email/password."""
    tokens = os.environ.get('GARMINTOKENS', '').strip()
    if tokens:
        print(f'Resuming Garmin session from GARMINTOKENS ({len(tokens)} chars)')
        api = Garmin()
        api.login(tokenstore=tokens)
        return api

    email    = os.environ.get('GARMIN_EMAIL', '').strip()
    password = os.environ.get('GARMIN_PASSWORD', '').strip()
    if not (email and password):
        raise SystemExit(
            'No Garmin credentials found. Set the GARMINTOKENS secret '
            '(run "python scripts/fetch_garmin.py --login" locally to mint one), '
            'or set GARMIN_EMAIL / GARMIN_PASSWORD.'
        )
    print(f'Logging in to Garmin as {email[:3]}***')
    api = Garmin(email, password)
    api.login()
    return api


def normalize(raw):
    """Garmin activity payload -> our normalized shape (None if not tracked)."""
    type_key = (raw.get('activityType') or {}).get('typeKey')
    sport    = common.classify_sport(type_key)
    if sport is None:
        return None

    # startTimeLocal looks like "2026-07-13 13:48:20"
    start = (raw.get('startTimeLocal') or raw.get('startTimeGMT') or '').strip()
    date  = start[:10]
    if not date:
        return None

    # movingDuration is absent on some activity types (e.g. strength training)
    moving = raw.get('movingDuration') or raw.get('duration') or raw.get('elapsedDuration') or 0

    return {
        'id':          f'garmin-{raw.get("activityId")}',
        'source':      'garmin',
        'name':        (raw.get('activityName') or type_key or 'Activity').strip(),
        'date':        date,
        'start':       start,
        'sport':       sport,
        'moving_time': float(moving or 0),
        'distance':    float(raw.get('distance') or 0),
    }


def fetch_all(api):
    activities, skipped = [], {}
    for page in range(MAX_PAGES):
        batch = api.get_activities(page * PAGE_SIZE, PAGE_SIZE) or []
        print(f'  page {page + 1}: {len(batch)} activities')
        for raw in batch:
            act = normalize(raw)
            if act:
                activities.append(act)
            else:
                key = (raw.get('activityType') or {}).get('typeKey', 'unknown')
                skipped[key] = skipped.get(key, 0) + 1
        if len(batch) < PAGE_SIZE:
            break
    if skipped:
        print(f'  ignored untracked types: {skipped}')
    return activities


def login_helper():
    """Interactive: mint a token blob for the GARMINTOKENS secret."""
    import getpass
    from garminconnect import (
        GarminConnectAuthenticationError,
        GarminConnectTooManyRequestsError,
    )

    print('Garmin Connect login — credentials are sent to Garmin only, never stored.\n')
    email    = input('Garmin email: ').strip()
    password = getpass.getpass('Garmin password: ')

    api = Garmin(email, password, prompt_mfa=lambda: input('MFA code: ').strip())
    try:
        api.login()
    except GarminConnectAuthenticationError:
        # garminconnect raises this only when Garmin's own response says
        # INVALID_USERNAME_PASSWORD — it is a real credential rejection, not a
        # rate-limit misfire (429s raise GarminConnectTooManyRequestsError).
        print('\nGarmin rejected the email/password combination.\n', file=sys.stderr)
        print('Worth checking, in rough order of likelihood:', file=sys.stderr)
        print('  1. Does this account sign in with "Continue with Google/Apple"?', file=sys.stderr)
        print('     Those accounts have no Garmin password until you set one:', file=sys.stderr)
        print('     Garmin Connect -> Account Settings -> Sign-In Information.', file=sys.stderr)
        print('  2. Is this the email the Garmin account is actually registered', file=sys.stderr)
        print('     under? (It need not match the one you use elsewhere.)', file=sys.stderr)
        print('  3. Confirm the same credentials work at https://connect.garmin.com', file=sys.stderr)
        print('\nAvoid retrying in a loop — repeated failures tighten Garmin\'s', file=sys.stderr)
        print('IP rate limiting and can temporarily lock the account.', file=sys.stderr)
        sys.exit(2)
    except GarminConnectTooManyRequestsError:
        print('\nGarmin is rate limiting this IP (HTTP 429).', file=sys.stderr)
        print('Wait 30-60 minutes and try again — this is not a credential problem.', file=sys.stderr)
        sys.exit(3)

    tokens = api.client.dumps()

    out = os.path.join(common.REPO_ROOT, 'garmin_tokens.txt')
    with open(out, 'w', encoding='utf-8') as f:
        f.write(tokens)

    print('\nLogin OK.')
    print(f'Token written to {out} ({len(tokens)} chars).')
    print('\nNext: copy the whole contents of that file into a repo secret named')
    print('GARMINTOKENS  (Settings -> Secrets and variables -> Actions -> New secret),')
    print('then DELETE the local file — it grants access to your Garmin account.')


def save_rotated_token(api):
    """Write the session back out if Garmin rotated it during this run.

    Garmin issues a NEW refresh token every time the access token is refreshed
    and invalidates the previous one. Running from a secret means that rotated
    value is lost when the job ends, so the next run presents a consumed token
    and gets a 401. The workflow pushes this file back into the GARMINTOKENS
    secret to close the loop.
    """
    out_path = os.environ.get('GARMIN_TOKEN_OUT')
    if not out_path:
        return
    try:
        current = api.client.dumps()
    except Exception as e:
        print(f'  could not serialise session ({e}) — leaving stored token alone')
        return

    if current.strip() == os.environ.get('GARMINTOKENS', '').strip():
        print('  token unchanged this run — no secret update needed')
        return

    with open(out_path, 'w', encoding='utf-8') as f:
        f.write(current)
    print(f'  token was rotated by Garmin — wrote refreshed session ({len(current)} chars)')


def main():
    if '--login' in sys.argv:
        login_helper()
        return

    api = _login()
    print('Fetching activities...')
    activities = fetch_all(api)

    if not activities:
        raise SystemExit('Garmin returned zero tracked activities — refusing to '
                         'overwrite the cache with an empty result.')

    by_sport = {}
    for a in activities:
        by_sport[a['sport']] = by_sport.get(a['sport'], 0) + 1
    print(f'Normalized {len(activities)} activities: {by_sport}')
    common.save_cache('garmin', activities)
    save_rotated_token(api)


if __name__ == '__main__':
    try:
        main()
    except SystemExit:
        raise
    except Exception as e:
        print(f'\nFATAL: {type(e).__name__}: {e}', file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)
