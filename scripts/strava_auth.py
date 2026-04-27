"""
Run this ONCE locally to get your Strava refresh token.
Usage:
  python scripts/strava_auth.py
"""
import webbrowser
import requests

CLIENT_ID     = input('Enter your Strava Client ID: ').strip()
CLIENT_SECRET = input('Enter your Strava Client Secret: ').strip()

AUTH_URL = (
    f'https://www.strava.com/oauth/authorize'
    f'?client_id={CLIENT_ID}'
    f'&redirect_uri=http://localhost'
    f'&response_type=code'
    f'&scope=activity:read_all'
)

print('\nOpening Strava in your browser. Authorize the app.')
webbrowser.open(AUTH_URL)

redirected = input('\nPaste the full redirect URL here (http://localhost?code=...): ').strip()
code = redirected.split('code=')[1].split('&')[0]

r = requests.post('https://www.strava.com/oauth/token', data={
    'client_id':     CLIENT_ID,
    'client_secret': CLIENT_SECRET,
    'code':          code,
    'grant_type':    'authorization_code',
})
data = r.json()

print('\n✓ Add these to your GitHub repository secrets:')
print(f'  STRAVA_CLIENT_ID     = {CLIENT_ID}')
print(f'  STRAVA_CLIENT_SECRET = {CLIENT_SECRET}')
print(f'  STRAVA_REFRESH_TOKEN = {data["refresh_token"]}')
