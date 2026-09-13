# Daymark

Daymark is a static personal status dashboard for GitHub Pages. Weather is fetched in the browser through Open-Meteo. Sports, YouTube, and Reddit are normalized into static JSON snapshots by GitHub Actions.

## GitHub Pages setup

1. Push the repository to GitHub and set Pages to use GitHub Actions.
2. Add these repository secrets if live snapshots are desired:
   - `YOUTUBE_API_KEY`
   - `REDDIT_CLIENT_ID`
   - `REDDIT_CLIENT_SECRET`
   - `REDDIT_REFRESH_TOKEN`
   - Optional: `REDDIT_USER_AGENT`
3. Run **Build and deploy Daymark** manually once. The workflow also runs every two hours.

Without secrets, the workflow publishes the included fallback fixtures and marks those feeds as stale in the UI.

To preview locally, serve the repository over HTTP so the browser allows JSON and weather requests:

```sh
python3 -m http.server 8080
```
