// api/download.js
// RapidAPI - Instagram Downloader API (Free: 500 req/month)
// Sign up: https://rapidapi.com/search/instagram%20downloader
// Recommended API: "Instagram Downloader" by hieu-dep-trai-1999
// API Host: instagram-downloader-download-instagram-videos-stories.p.rapidapi.com

const RATE = new Map();

function rateLimit(ip) {
  const now = Date.now();
  const e = RATE.get(ip) || { c: 0, t: now };
  if (now - e.t > 3_600_000) { e.c = 0; e.t = now; }
  e.c++;
  RATE.set(ip, e);
  return e.c <= 30;
}

function clean(s) {
  return String(s || '').trim().replace(/[<>"'&]/g, c =>
    ({'<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','&':'&amp;'}[c])
  );
}

function validateIG(url) {
  try {
    const u = new URL(url.trim());
    const h = u.hostname.replace('www.', '');
    if (!['instagram.com','instagr.am'].includes(h))
      return { valid: false, error: 'Only Instagram URLs are supported.' };
    const p = u.pathname;
    let type = 'post';
    if (/\/reel(s)?\//.test(p))     type = 'reel';
    else if (/\/tv\//.test(p))      type = 'video';
    else if (/\/stories\//.test(p)) type = 'story';
    const m = p.match(/\/(?:p|reel|tv|reels)\/([A-Za-z0-9_-]+)/);
    if (!m?.[1]) return { valid: false, error: 'Could not extract media ID. Please check the URL is a public post or reel.' };
    return { valid: true, url: u.href, type, shortcode: m[1] };
  } catch (e) {
    return { valid: false, error: 'Invalid URL: ' + e.message };
  }
}

// ─── Main RapidAPI fetch ────────────────────────────────────────
async function fetchFromRapidAPI(url) {
  const RAPID_KEY = process.env.RAPIDAPI_KEY;

  if (!RAPID_KEY) {
    throw new Error('RAPIDAPI_KEY environment variable not set.');
  }

  // Primary API: Instagram Downloader (most popular on RapidAPI)
  const response = await fetch(
    `https://instagram-downloader-download-instagram-videos-stories.p.rapidapi.com/index?url=${encodeURIComponent(url)}`,
    {
      method: 'GET',
      headers: {
        'x-rapidapi-key':  RAPID_KEY,
        'x-rapidapi-host': 'instagram-downloader-download-instagram-videos-stories.p.rapidapi.com',
      },
      signal: AbortSignal.timeout(10000),
    }
  );

  if (!response.ok) {
    throw new Error(`RapidAPI returned ${response.status}`);
  }

  const data = await response.json();

  // Parse response — different APIs return different shapes
  // This handles the most common formats
  let mediaUrl  = null;
  let thumbUrl  = null;
  let title     = '';
  let author    = '';
  let mediaType = 'video';

  // Format 1: { media: "url", thumbnail: "url" }
  if (data?.media)     mediaUrl = data.media;
  if (data?.thumbnail) thumbUrl = data.thumbnail;

  // Format 2: { result: { download: [{ url, quality }] } }
  if (data?.result?.download?.[0]?.url) mediaUrl = data.result.download[0].url;
  if (data?.result?.thumbnail)          thumbUrl  = data.result.thumbnail;
  if (data?.result?.title)              title     = data.result.title;
  if (data?.result?.author?.name)       author    = data.result.author.name;

  // Format 3: { url: "...", image: "..." }
  if (!mediaUrl && data?.url)   mediaUrl = data.url;
  if (!thumbUrl  && data?.image) thumbUrl  = data.image;

  // Format 4: array of medias
  if (!mediaUrl && Array.isArray(data?.medias)) {
    const best = data.medias.find(m => m.quality === 'hd') || data.medias[0];
    if (best?.url) mediaUrl = best.url;
  }

  // Format 5: { data: { video_url, thumbnail_url } }
  if (!mediaUrl && data?.data?.video_url)     mediaUrl = data.data.video_url;
  if (!thumbUrl  && data?.data?.thumbnail_url) thumbUrl  = data.data.thumbnail_url;
  if (!title     && data?.data?.title)         title     = data.data.title;

  // Check if it's a photo
  if (data?.data?.is_video === false || data?.type === 'image') mediaType = 'image';

  return { mediaUrl, thumbUrl, title, author, mediaType, raw: data };
}

// ─── Fallback: second RapidAPI (Instagram API v2 by RangVid) ───
async function fetchFromRapidAPIv2(url) {
  const RAPID_KEY = process.env.RAPIDAPI_KEY;
  if (!RAPID_KEY) throw new Error('No API key');

  const response = await fetch(
    `https://instagram-api-v2.p.rapidapi.com/ig/post_info/?url=${encodeURIComponent(url)}`,
    {
      headers: {
        'x-rapidapi-key':  RAPID_KEY,
        'x-rapidapi-host': 'instagram-api-v2.p.rapidapi.com',
      },
      signal: AbortSignal.timeout(8000),
    }
  );

  if (!response.ok) throw new Error('v2 API failed');
  const data = await response.json();

  let mediaUrl = data?.data?.video_url || data?.video_url || null;
  let thumbUrl = data?.data?.thumbnail_url || data?.thumbnail_url || null;
  let title    = data?.data?.caption || '';
  let author   = data?.data?.owner?.username || '';

  return { mediaUrl, thumbUrl, title, author, mediaType: 'video', raw: data };
}

// ─── Handler ───────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ success: false, error: 'Method not allowed.' });

  const ip = req.headers['x-forwarded-for']?.split(',')[0] || '0.0.0.0';
  if (!rateLimit(ip)) return res.status(429).json({ success: false, error: 'Too many requests. Please wait.' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }

  const raw = clean(body?.url || '');
  if (!raw) return res.status(400).json({ success: false, error: 'Please provide an Instagram URL.' });

  const v = validateIG(raw);
  if (!v.valid) return res.status(400).json({ success: false, error: v.error });

  const { shortcode, type, url } = v;

  try {
    // Try primary RapidAPI
    let result;
    try {
      result = await fetchFromRapidAPI(url);
    } catch (e1) {
      // Try fallback API
      try {
        result = await fetchFromRapidAPIv2(url);
      } catch (e2) {
        throw new Error('All download APIs failed: ' + e1.message);
      }
    }

    const { mediaUrl, thumbUrl, title, author, mediaType } = result;

    // Build quality options
    const qualities = [];
    if (mediaUrl) {
      if (mediaType === 'image') {
        qualities.push({ label: 'Full Resolution', ext: 'jpg', size: '~2 MB', icon: '🖼', url: mediaUrl });
      } else {
        qualities.push({ label: 'HD Video',   ext: 'mp4', size: '~15 MB', icon: '🎬', url: mediaUrl });
        qualities.push({ label: 'SD Video',   ext: 'mp4', size: '~5 MB',  icon: '📹', url: mediaUrl });
      }
    }
    // Always add audio option (same url, browser handles)
    if (mediaUrl && mediaType !== 'image') {
      qualities.push({ label: 'Audio MP3', ext: 'mp3', size: '~3 MB', icon: '🎵', url: mediaUrl });
    }

    return res.status(200).json({
      success:    true,
      shortcode,
      type,
      title:      title || ('Instagram ' + type.charAt(0).toUpperCase() + type.slice(1)),
      author:     author || '',
      thumbnail:  thumbUrl || '',
      embed_url:  `https://www.instagram.com/p/${shortcode}/embed/captioned/`,
      source_url: url,
      media_url:  mediaUrl || null,
      qualities,
      note: mediaUrl
        ? 'Tap a quality button to download directly. On mobile: long-press → Save.'
        : 'Could not extract direct download link. Try opening the embed below.',
    });

  } catch (err) {
    console.error('Download error:', err.message);

    // Return graceful fallback with embed
    return res.status(200).json({
      success:    true,
      shortcode,
      type,
      title:      'Instagram ' + type.charAt(0).toUpperCase() + type.slice(1),
      author:     '',
      thumbnail:  '',
      embed_url:  `https://www.instagram.com/p/${shortcode}/embed/captioned/`,
      source_url: url,
      media_url:  null,
      qualities:  [],
      note:       'Direct download unavailable. View the embedded post below and use your browser\'s save option.',
      error_hint: err.message,
    });
  }
}
