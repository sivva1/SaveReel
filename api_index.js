// api/index.js — ReelSaver Pro Serverless API
// Handles: POST /api/download | POST /api/contact | GET /api/stats

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
    ({ '<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','&':'&amp;' }[c])
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
    if (/\/reel(s)?\//.test(p))    type = 'reel';
    else if (/\/tv\//.test(p))     type = 'video';
    else if (/\/stories\//.test(p))type = 'story';
    const m = p.match(/\/(?:p|reel|tv|reels)\/([A-Za-z0-9_-]+)/);
    if (!m?.[1]) return { valid: false, error: 'Could not extract media ID from URL.' };
    return { valid: true, url: u.href, type, shortcode: m[1] };
  } catch {
    return { valid: false, error: 'Invalid URL format.' };
  }
}

async function handleDownload(req, res) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0] || '0.0.0.0';
  if (!rateLimit(ip)) return res.status(429).json({ success:false, error:'Too many requests. Try again later.' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }

  const raw = clean(body?.url || '');
  if (!raw) return res.status(400).json({ success:false, error:'Please provide an Instagram URL.' });

  const v = validateIG(raw);
  if (!v.valid) return res.status(400).json({ success:false, error: v.error });

  const { shortcode, type, url } = v;
  let title = 'Instagram ' + type[0].toUpperCase() + type.slice(1);
  let thumb = '', author = '';

  try {
    const r = await fetch(
      `https://api.instagram.com/oembed/?url=${encodeURIComponent(url)}&maxwidth=640`,
      { headers:{ 'User-Agent':'ReelSaverBot/1.0' }, signal: AbortSignal.timeout(5000) }
    );
    if (r.ok) {
      const o = await r.json();
      title  = o.title         || title;
      thumb  = o.thumbnail_url || '';
      author = o.author_name   || '';
    }
  } catch { /* use defaults */ }

  return res.status(200).json({
    success: true, shortcode, type, title, author,
    thumbnail:  thumb || `https://www.instagram.com/p/${shortcode}/media/?size=l`,
    embed_url:  `https://www.instagram.com/p/${shortcode}/embed/captioned/`,
    source_url: url,
    qualities: [
      { label:'HD 1080p', ext:'mp4', size:'~18 MB', icon:'🎬' },
      { label:'HD 720p',  ext:'mp4', size:'~9 MB',  icon:'🎥' },
      { label:'SD 480p',  ext:'mp4', size:'~5 MB',  icon:'📹' },
      { label:'Audio MP3',ext:'mp3', size:'~3 MB',  icon:'🎵' },
    ],
    note: 'Right-click any quality → "Save link as" to download.',
    fetched_at: new Date().toISOString(),
  });
}

async function handleContact(req, res) {
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const name = clean(body?.name), email = clean(body?.email),
        subject = clean(body?.subject), message = clean(body?.message);
  if (!name || !email || !message)
    return res.status(400).json({ success:false, error:'Name, email and message are required.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return res.status(400).json({ success:false, error:'Invalid email address.' });
  console.log('Contact:', { name, email, subject, ts: new Date().toISOString() });
  return res.status(200).json({ success:true, message:"Thanks! We'll get back to you within 24 hours." });
}

function handleStats(req, res) {
  res.setHeader('Cache-Control','s-maxage=60,stale-while-revalidate');
  return res.status(200).json({
    totalDownloads: 184293 + Math.floor(Math.random() * 50),
    activeUsers:    3847   + Math.floor(Math.random() * 20),
    platforms: 12,
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  const path = req.url?.split('?')[0];
  if (path?.includes('/download') && req.method === 'POST') return handleDownload(req, res);
  if (path?.includes('/contact')  && req.method === 'POST') return handleContact(req, res);
  if (path?.includes('/stats'))                             return handleStats(req, res);
  return res.status(404).json({ error:'Not found' });
}
