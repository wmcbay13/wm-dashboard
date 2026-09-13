import { mkdir, readFile, writeFile } from 'node:fs/promises';

const DATA_DIR = new URL('../data/', import.meta.url);
const FALLBACK_DIR = new URL('../data/fallback/', import.meta.url);
const now = new Date().toISOString();

const sportsConfig = [
  { league: 'NFL', sport: 'football', path: 'nfl', team: 'Buffalo Bills', aliases: ['BUF', 'Buffalo Bills'] },
  { league: 'MLB', sport: 'baseball', path: 'mlb', team: 'Atlanta Braves', aliases: ['ATL', 'Atlanta Braves'] },
  { league: 'NHL', sport: 'hockey', path: 'nhl', team: 'New Jersey Devils', aliases: ['NJD', 'New Jersey Devils'] },
  { league: 'CFB', sport: 'football', path: 'college-football', team: 'Georgia Bulldogs', aliases: ['UGA', 'Georgia Bulldogs'] },
];
const redditCommunities = ['technology', 'hardware', 'LocalLLaMA', 'artificial', 'Cooking', 'yoga', 'kettlebell', 'PS5', 'PlayStation', 'buffalobills', 'Braves', 'devils', 'georgiabulldogs'];
const youtubeTopics = [
  ['Technology', 'technology tools workflow'],
  ['AI', 'practical artificial intelligence workflow'],
  ['Cooking', 'best weeknight cooking recipes'],
  ['Yoga + kettlebells', 'yoga kettlebell mobility workout'],
  ['PlayStation', 'PlayStation gaming releases'],
];

const readFallback = async (name) => JSON.parse(await readFile(new URL(`${name}.json`, FALLBACK_DIR), 'utf8'));
const writeJson = async (name, payload) => writeFile(new URL(`${name}.json`, DATA_DIR), `${JSON.stringify(payload, null, 2)}\n`);
const getJson = async (url, options = {}) => { const response = await fetch(url, options); if (!response.ok) throw new Error(`${response.status} ${response.statusText}`); return response.json(); };
const dateKey = (date) => date.toISOString().slice(0, 10).replaceAll('-', '');

async function fetchSports() {
  const start = new Date(Date.now() - 86400000);
  const end = new Date(Date.now() + 14 * 86400000);
  const events = [];
  for (const config of sportsConfig) {
    try {
      const url = `https://site.api.espn.com/apis/site/v2/sports/${config.sport}/${config.path}/scoreboard?limit=200&dates=${dateKey(start)}-${dateKey(end)}`;
      const data = await getJson(url);
      for (const event of data.events || []) {
        const competition = event.competitions?.[0];
        const competitors = competition?.competitors || [];
        const relevant = competitors.some((item) => config.aliases.includes(item.team?.abbreviation) || config.aliases.includes(item.team?.displayName));
        if (!relevant) continue;
        const away = competitors.find((item) => item.homeAway === 'away') || competitors[0] || {};
        const home = competitors.find((item) => item.homeAway === 'home') || competitors[1] || {};
        const status = event.status?.type;
        events.push({ id: `${config.league}-${event.id}`, league: config.league, team: config.team, shortName: event.shortName || `${away.team?.shortDisplayName || 'Away'} at ${home.team?.shortDisplayName || 'Home'}`, away: away.team?.displayName || 'Away', awayAbbr: away.team?.abbreviation || 'AWAY', home: home.team?.displayName || 'Home', homeAbbr: home.team?.abbreviation || 'HOME', awayScore: away.score != null ? Number(away.score) : null, homeScore: home.score != null ? Number(home.score) : null, date: event.date, status: status?.state === 'in' ? 'in' : status?.completed ? 'post' : 'pre', detail: status?.detail || status?.shortDetail || '', venue: competition?.venue?.fullName || '', source: `https://www.espn.com/${config.path}/scoreboard` });
      }
    } catch (error) { console.warn(`Sports source failed for ${config.league}: ${error.message}`); }
  }
  if (!events.length) throw new Error('No sports events were returned');
  const unique = [...new Map(events.map((event) => [event.id, event])).values()];
  unique.sort((a, b) => new Date(a.date) - new Date(b.date));
  return { generatedAt: now, source: 'ESPN scoreboard', stale: false, items: unique };
}

async function fetchYoutube() {
  if (!process.env.YOUTUBE_API_KEY) throw new Error('YOUTUBE_API_KEY is not configured');
  const items = [];
  for (const [topic, query] of youtubeTopics) {
    const params = new URLSearchParams({ part: 'snippet', type: 'video', maxResults: '3', order: 'relevance', safeSearch: 'moderate', q: query, key: process.env.YOUTUBE_API_KEY });
    const data = await getJson(`https://www.googleapis.com/youtube/v3/search?${params}`);
    for (const item of data.items || []) if (item.id?.videoId) items.push({ topic: topic.toUpperCase(), title: item.snippet?.title || 'Untitled video', channel: item.snippet?.channelTitle || 'YouTube', publishedAt: item.snippet?.publishedAt || now, thumbnail: item.snippet?.thumbnails?.medium?.url || item.snippet?.thumbnails?.default?.url || '', url: `https://www.youtube.com/watch?v=${item.id.videoId}` });
  }
  return { generatedAt: now, source: 'YouTube Data API', stale: false, topics: youtubeTopics.map(([topic]) => topic), items };
}

async function getRedditToken() {
  if (process.env.REDDIT_ACCESS_TOKEN) return process.env.REDDIT_ACCESS_TOKEN;
  if (!process.env.REDDIT_CLIENT_ID || !process.env.REDDIT_CLIENT_SECRET || !process.env.REDDIT_REFRESH_TOKEN) throw new Error('Reddit OAuth secrets are not configured');
  const credentials = Buffer.from(`${process.env.REDDIT_CLIENT_ID}:${process.env.REDDIT_CLIENT_SECRET}`).toString('base64');
  const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: process.env.REDDIT_REFRESH_TOKEN });
  const token = await getJson('https://www.reddit.com/api/v1/access_token', { method: 'POST', headers: { Authorization: `Basic ${credentials}`, 'User-Agent': process.env.REDDIT_USER_AGENT || 'daymark-personal-dashboard/1.0' }, body });
  return token.access_token;
}

async function fetchReddit() {
  const token = await getRedditToken();
  const headers = { Authorization: `Bearer ${token}`, 'User-Agent': process.env.REDDIT_USER_AGENT || 'daymark-personal-dashboard/1.0' };
  const listings = { hot: [], new: [] };
  for (const sort of ['hot', 'new']) {
    const responses = await Promise.all(redditCommunities.map(async (subreddit) => {
      try {
        const data = await getJson(`https://oauth.reddit.com/r/${encodeURIComponent(subreddit)}/${sort}?limit=4&raw_json=1`, { headers });
        return (data.data?.children || []).map(({ data: post }) => ({ subreddit, title: post.title, score: post.score, comments: post.num_comments, createdAt: new Date(post.created_utc * 1000).toISOString(), url: post.permalink ? `https://www.reddit.com${post.permalink}` : `https://www.reddit.com/r/${subreddit}/` }));
      } catch (error) { console.warn(`Reddit source failed for r/${subreddit}/${sort}: ${error.message}`); return []; }
    }));
    listings[sort] = responses.flat().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 24);
  }
  if (!listings.hot.length && !listings.new.length) throw new Error('No Reddit listings were returned');
  return { generatedAt: now, source: 'Reddit Data API', stale: false, topics: ['Tech', 'AI', 'Cooking', 'Movement', 'PlayStation', 'Teams'], ...listings };
}

async function run(name, fetcher) {
  try { await writeJson(name, await fetcher()); console.log(`${name}: live data written`); }
  catch (error) { const fallback = await readFallback(name); await writeJson(name, { ...fallback, generatedAt: now, stale: true, error: error.message }); console.warn(`${name}: fallback written (${error.message})`); }
}

await mkdir(DATA_DIR, { recursive: true });
await run('sports', fetchSports);
await run('youtube', fetchYoutube);
await run('reddit', fetchReddit);
await writeJson('status', { generatedAt: now, source: 'GitHub Actions', stale: false });
