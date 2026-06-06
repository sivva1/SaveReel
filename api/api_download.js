// api/download.js
// RapidAPI: instagram-reels-downloader2
// Set RAPIDAPI_KEY in Vercel Environment Variables

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
    ({ '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;', '&':'&amp;' }[c])
  );
}

function validateIG(url) {
  try {
    const u = new URL(url.trim());
    const h = u.hostname.replace('www.', '');
    if (!['instagram.com', 'instagr.am'].includes(h))
      return { valid: false, error: 'Only Instagram URLs are supported.' };
    const p = u.pathname;
    let type = 'post';
    if (/\/reel(s)?\//.test(p))     type = 'reel';
    else if (/\/tv\//.test(p))      type = 'video';
    else if (/\/stories\//.test(p)) type = 'story';
    const m = p.match(/\/(?:p|reel|tv|reels)\/([A-Za-z0-9_-]+)/);
    if (!m?.[1]) return { valid: false, error: 'Could not extract media ID.' };
    return { valid: true, url: u.href, type, shortcode: m[1] };
  } catch (e) {
    return { valid: false, error: 'Invalid URL: ' + e.message };
  }
}

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ success: false, error: 'Method not allowed.' });

  // Rate limit
  const ip = req.headers['x-forwarded-for']?.split(',')[0] || '0.0.0.0';
  if (!rateLimit(ip)) return res.status(429).json({ success: false, error: 'Too many requests. Please wait.' });

  // Parse body
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }

  const raw = clean(body?.url || '');
  if (!raw) return res.status(400).json({ success: false, error: 'Please provide an Instagram URL.' });

  const v = validateIG(raw);
  if (!v.valid) return res.status(400).json({ success: false, error: v.error });

  const { shortcode, type, url } = v;

  // Check API key
  const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;
  if (!RAPIDAPI_KEY) {
    return res.status(500).json({ success: false, error: 'RAPIDAPI_KEY not configured in environment variables.' });
  }

  try {
    // ── Call RapidAPI ──────────────────────────────────────────
    const apiUrl = 'https://instagram-reels-downloader2.p.rapidapi.com/.netlify/functions/api/getLink?url=' +
      encodeURIComponent(url);

    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'Content-Type':   'application/json',
        'x-rapidapi-host': 'instagram-reels-downloader2.p.rapidapi.com',
        'x-rapidapi-key':  RAPIDAPI_KEY,
      },
      signal: AbortSignal.timeout(12000),
    });

    if (!response.ok) {
      throw new Error('RapidAPI returned status ' + response.status);
    }

    const data = await response.json();
    console.log('RapidAPI raw response:', JSON.stringify(data));

    // ── Parse response ─────────────────────────────────────────
    // This API typically returns: { url: "...", thumbnail: "...", ... }
    // or { data: { url, thumbnail } } — handle both shapes
    let mediaUrl  = null;
    let thumbUrl  = null;
    let title     = '';
    let author    = '';

    // Shape 1: direct fields
    if (data?.url)       mediaUrl = data.url;
    if (data?.video)     mediaUrl = mediaUrl || data.video;
    if (data?.thumbnail) thumbUrl = data.thumbnail;
    if (data?.thumb)     thumbUrl = thumbUrl  || data.thumb;
    if (data?.title)     title    = data.title;
    if (data?.author)    author   = data.author;

    // Shape 2: nested under data
    if (data?.data?.url)       mediaUrl = mediaUrl || data.data.url;
    if (data?.data?.video)     mediaUrl = mediaUrl || data.data.video;
    if (data?.data?.thumbnail) thumbUrl = thumbUrl  || data.data.thumbnail;
    if (data?.data?.title)     title    = title     || data.data.title;
    if (data?.data?.author)    author   = author    || data.data.author;

    // Shape 3: links array
    if (!mediaUrl && Array.isArray(data?.links)) {
      const best = data.links.find(l => l.quality === 'hd') || data.links[0];
      if (best?.url) mediaUrl = best.url;
    }
    if (!mediaUrl && Array.isArray(data?.data?.links)) {
      const best = data.data.links.find(l => l.quality === 'hd') || data.data.links[0];
      if (best?.url) mediaUrl = best.url;
    }

    // Shape 4: result field
    if (!mediaUrl && data?.result?.url) mediaUrl = data.result.url;

    if (!mediaUrl) {
      throw new Error('No download URL in API response. Raw: ' + JSON.stringify(data).slice(0, 200));
    }

    // Build quality list
    const qualities = [
      { label: 'HD Video',   ext: 'mp4', size: '', icon: '🎬', url: mediaUrl },
      { label: 'SD Video',   ext: 'mp4', size: '', icon: '📹', url: mediaUrl },
      { label: 'Audio Only', ext: 'mp3', size: '', icon: '🎵', url: mediaUrl },
    ];

    return res.status(200).json({
      success:    true,
      shortcode,
      type,
      title:      title || ('Instagram ' + type.charAt(0).toUpperCase() + type.slice(1)),
      author:     author || '',
      thumbnail:  thumbUrl || '',
      embed_url:  `https://www.instagram.com/p/${shortcode}/embed/captioned/`,
      source_url: url,
      media_url:  mediaUrl,
      qualities,
      note: 'Tap Download Now to save. On mobile: use the Download button.',
    });

  } catch (err) {
    console.error('Download error:', err.message);
    // Return embed fallback — still useful
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
      note:       'API error: ' + err.message + '. Use the download services below.',
    });
  }
}
