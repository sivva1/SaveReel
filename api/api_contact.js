// api/contact.js
// Place this file at: api/contact.js in your GitHub repo

function clean(s) {
  return String(s || '').trim().replace(/[<>"'&]/g, c =>
    ({ '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;', '&':'&amp;' }[c])
  );
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ success: false, error: 'Method not allowed.' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }

  const name    = clean(body?.name);
  const email   = clean(body?.email);
  const subject = clean(body?.subject);
  const message = clean(body?.message);

  if (!name || !email || !message)
    return res.status(400).json({ success: false, error: 'Name, email and message are required.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return res.status(400).json({ success: false, error: 'Invalid email address.' });

  // Log to Vercel console (add Resend/SendGrid here for real emails)
  console.log('Contact form:', { name, email, subject, ts: new Date().toISOString() });

  return res.status(200).json({
    success: true,
    message: "Thanks! We'll get back to you within 24 hours."
  });
}
