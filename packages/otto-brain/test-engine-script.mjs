/** Shared synthetic HTTP engine source; writing this string does not launch it. */
export function engineFixtureSource() {
  return `
    import http from 'node:http';
    const args = process.argv.slice(2);
    const port = Number(args[args.indexOf('--port') + 1]);
    const pending = new Set();
    const history = [];
    const server = http.createServer((req, res) => {
      if (req.url === '/health') { res.end('{}'); return; }
      if (req.url === '/slots') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify([{ id: 0, is_processing: pending.size > 0, n_decoded: pending.size ? 2 : 0, n_ctx: 2048 }])); return;
      }
      if (req.url === '/slots/0?action=erase') { history.push('erase'); res.end('{}'); return; }
      if (req.url === '/fixture/history') { res.end(JSON.stringify(history)); return; }
      if (req.url === '/fixture/release') { for (const response of pending) response.end('data: [DONE]\\n\\n'); pending.clear(); res.end('{}'); return; }
      let text = '';
      req.on('data', chunk => { text += chunk; });
      req.on('end', () => {
        const body = JSON.parse(text || '{}');
        history.push({ body, headers: req.headers });
        if (body.stream) {
          pending.add(res);
          res.on('close', () => { pending.delete(res); });
          res.writeHead(200, { 'content-type': 'text/event-stream' });
          res.write('data: '+JSON.stringify({choices:[{delta:{reasoning_content:'fixture reasoning'}}]})+'\\n\\n'); return;
        }
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ choices:[{message:{content:JSON.stringify({body,headers:req.headers})}}] }));
      });
    });
    server.listen(port, '127.0.0.1');
  `;
}
