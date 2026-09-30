'use strict';
// Local diagnostics only; the production dist never loads frame-profile.js.
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..'), dist = path.join(root, 'dist');
const baseline = process.argv[2];
if (baseline && !/^[a-f\d]{40}$/.test(baseline)) throw new Error('Use a full baseline commit SHA');
const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.png':'image/png' };
http.createServer((request,response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (pathname === '/_profile.js') {
      response.setHeader('Content-Type',types['.js']);
      response.end(fs.readFileSync(path.join(__dirname, 'frame-profile.js'))); return;
    }
    const before = pathname.startsWith('/before/');
    const relative = pathname.replace(/^\/(?:before\/|after\/)?/, '') || 'index.html';
    const target = path.resolve(dist,relative);
    if (!target.startsWith(dist + path.sep)) throw new Error('Invalid asset path');
    let data;
    if (before) {
      if (!baseline) throw new Error('No baseline selected');
      const result = spawnSync('git',['show',`${baseline}:dist/${relative}`],{ cwd:root });
      if (result.status !== 0) throw new Error('Baseline asset missing');
      data = result.stdout;
    } else data = fs.readFileSync(target);
    const extension = path.extname(relative);
    if (extension === '.html') data = data.toString().replace('</body>', '<script src="/_profile.js"></script></body>');
    response.setHeader('Content-Type',types[extension] || 'application/octet-stream');
    response.setHeader('Cache-Control','no-store');
    response.end(data);
  } catch (_) { response.writeHead(404); response.end('Not found'); }
}).listen(4173,'127.0.0.1',() => console.log('Profile: http://127.0.0.1:4173/after/ (optional /before/)'));
