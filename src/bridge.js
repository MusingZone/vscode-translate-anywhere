'use strict';
const http = require('node:http');
const { timingSafeEqual } = require('node:crypto');

const PORT = 17865;
function allowedOrigin(origin) {
  return origin === 'vscode-file://vscode-app' ||
    /^vscode-webview:\/\/[a-z0-9-]+$/i.test(origin || '');
}

function createBridge({ token, dictionary, translate, vocabulary, isEnabled, getStatus = () => ({}), onError, port = PORT }) {
  // Last mouse press in any VS Code page (workbench or webview), so a popup open in one page closes on a click in another.
  let lastPointer = { time: 0, source: '' };
  const server = http.createServer(async (req, res) => {
    const origin = req.headers.origin;
    const cors = () => allowedOrigin(origin) ? { 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin' } : {};
    const reply = (status, data) => {
      if (res.destroyed) return;
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        ...cors()
      });
      res.end(JSON.stringify(data));
    };
    if (!allowedOrigin(origin)) return reply(403, { error: 'Origin rejected' });
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Content-Type, X-Immersive-Token',
        'Access-Control-Max-Age': '600',
        'Vary': 'Origin'
      });
      return res.end();
    }
    const supplied = Buffer.from(String(req.headers['x-immersive-token'] || ''));
    const expected = Buffer.from(token);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      return reply(401, { error: 'Invalid bridge token' });
    }
    if (req.method !== 'POST' || !['/lookup', '/ai', '/status', '/vocab', '/pointer'].includes(req.url)) {
      return reply(404, { error: 'Unknown route' });
    }
    if (req.url === '/status') return reply(200, { ...getStatus(), service: 'immersive-translate-vscode', enabled: isEnabled() });
    if (!isEnabled()) return reply(409, { error: 'Translation integration is disabled' });
    let size = 0;
    const chunks = [];
    try {
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 8192) {
          reply(413, { error: 'Request exceeds 8192 bytes' });
          req.destroy();
          return;
        }
        chunks.push(chunk);
      }
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { return reply(400, { error: 'Invalid JSON' }); }
      if (req.url === '/pointer') {
        if (body.action === 'down' && typeof body.source === 'string' && body.source) {
          lastPointer = { time: Date.now(), source: body.source.slice(0, 64) };
        }
        return reply(200, lastPointer);
      }
      if (typeof body.text !== 'string' || !body.text.trim() || body.text.length > 1200) {
        return reply(400, { error: 'Select between 1 and 1200 characters' });
      }
      if (req.url === '/lookup') return reply(200, await dictionary.lookup(body.text, body.lang === 'de' ? 'de' : 'en'));
      if (req.url === '/vocab') {
        if (!vocabulary) return reply(404, { error: 'Vocabulary unavailable' });
        if (!['has', 'toggle'].includes(body.action)) return reply(400, { error: 'Unknown vocabulary action' });
        const field = value => typeof value === 'string' ? value.slice(0, 2000) : '';
        const entry = { text: body.text.trim(), translation: field(body.translation), phonetic: field(body.phonetic) };
        return reply(200, { saved: body.action === 'has' ? vocabulary.has(entry.text) : vocabulary.toggle(entry) });
      }
      const mode = body.mode === 'paragraph' ? 'paragraph' : 'selection';
      // AI responses stream as NDJSON ({delta} lines, then {done,...} or {error}) once the model starts producing text.
      const abort = new AbortController();
      res.on('close', () => { if (!res.writableFinished) abort.abort(); });
      let streaming = false;
      const onDelta = delta => {
        if (res.destroyed) return;
        if (!streaming) {
          streaming = true;
          res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', ...cors() });
        }
        res.write(JSON.stringify({ delta }) + '\n');
      };
      try {
        const result = await translate(body.text, onDelta, abort.signal, mode);
        if (!streaming) return reply(200, result);
        if (!res.destroyed) res.end(JSON.stringify({ done: true, ...result }) + '\n');
      } catch (error) {
        if (!streaming) throw error;
        if (!abort.signal.aborted) onError(error);
        if (!res.destroyed) res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) + '\n');
      }
      return;
    } catch (error) {
      onError(error);
      reply(500, { error: error instanceof Error ? error.message : String(error) });
    }
  });
  server.requestTimeout = 65000;
  server.headersTimeout = 10000;
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', reject);
      server.on('error', onError);
      resolve(server);
    });
  });
}
module.exports = { PORT, allowedOrigin, createBridge };
