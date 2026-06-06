// api/stats.js
// Place this file at: api/stats.js in your GitHub repo

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate');
  return res.status(200).json({
    totalDownloads: 184293 + Math.floor(Math.random() * 100),
    activeUsers:    3847   + Math.floor(Math.random() * 30),
    platforms:      12,
  });
}
