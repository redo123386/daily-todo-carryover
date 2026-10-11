// Minimal static server for the built plugin (dist/), so RemNote can load it from
// http://localhost:8080 via Settings > Plugins > Build > Develop from localhost.
// No dependencies, no hot reload, nothing that can drift out of date.
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 8080;
const ROOT = path.join(__dirname, 'dist');

const MIME = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'application/javascript; charset=utf-8',
	'.mjs': 'application/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.png': 'image/png',
	'.svg': 'image/svg+xml',
	'.ico': 'image/x-icon',
	'.map': 'application/json; charset=utf-8',
	'.md': 'text/markdown; charset=utf-8',
	'.txt': 'text/plain; charset=utf-8',
};

if (!fs.existsSync(path.join(ROOT, 'manifest.json'))) {
	console.error('[ERROR] dist/manifest.json not found. Build the plugin first (npm run build:dist).');
	process.exit(1);
}

function setCors(res) {
	res.setHeader('Access-Control-Allow-Origin', '*');
	res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
	res.setHeader('Access-Control-Allow-Headers', '*');
	res.setHeader('Access-Control-Allow-Private-Network', 'true');
	res.setHeader('Cache-Control', 'no-cache');
}

function handler(req, res) {
	setCors(res);
	if (req.method === 'OPTIONS') {
		res.writeHead(204);
		return res.end();
	}
	if (req.method !== 'GET' && req.method !== 'HEAD') {
		res.writeHead(405);
		return res.end();
	}

	let urlPath;
	try {
		urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
	} catch {
		res.writeHead(400);
		return res.end('Bad request');
	}
	if (urlPath.endsWith('/')) urlPath += 'index.html';

	const filePath = path.normalize(path.join(ROOT, urlPath));
	if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
		res.writeHead(403);
		return res.end('Forbidden');
	}

	fs.stat(filePath, (err, stat) => {
		if (err || !stat.isFile()) {
			res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
			return res.end('Not found');
		}
		res.writeHead(200, {
			'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
			'Content-Length': stat.size,
		});
		if (req.method === 'HEAD') return res.end();
		fs.createReadStream(filePath).pipe(res);
	});
}

// Listen on loopback only (IPv4 + IPv6), so nothing is exposed to your network.
let listening = 0;
let failed = 0;
for (const host of ['127.0.0.1', '::1']) {
	const server = http.createServer(handler);
	server.on('error', (err) => {
		failed++;
		if (err.code === 'EADDRINUSE') {
			console.error(
				`[ERROR] Port ${PORT} on ${host} is already in use. Is another start.bat window already running?`
			);
		} else if (host === '::1') {
			// IPv6 loopback not available on this machine; IPv4 is enough.
		} else {
			console.error(`[ERROR] Could not listen on ${host}:${PORT}:`, err.message);
		}
		if (listening === 0 && failed === 2) process.exit(1);
	});
	server.listen(PORT, host, () => {
		listening++;
		if (listening === 1) {
			console.log(`Daily Todo Carryover is being served at http://localhost:${PORT}`);
		}
	});
}
