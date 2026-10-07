// Vercel function: every /api/* request is routed here (see vercel.json).
// If the app cannot start, answer with the reason instead of crashing, so the site can show it.
let app;
try {
  app = require('../lib/app');
} catch (e) {
  console.error('Crossy failed to start:', e);
  const message = `The server failed to start: ${String(e && e.message || e).split('\n')[0]}`;
  app = (req, res) => {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: message }));
  };
}
module.exports = app;
