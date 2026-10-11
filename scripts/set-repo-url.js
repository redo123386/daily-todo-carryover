// Usage:
//   node scripts/set-repo-url.js --get          -> prints the current GitHub repoUrl (or nothing)
//   node scripts/set-repo-url.js <github-url>   -> validates and saves it into public/manifest.json
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'public', 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
const arg = (process.argv[2] || '').trim();

if (arg === '--get') {
	const current = String(manifest.repoUrl || '');
	if (/^https:\/\/github\.com\/[^/]+\/[^/]+$/.test(current)) process.stdout.write(current);
	process.exit(0);
}

let url = arg.replace(/^"|"$/g, '').replace(/\/+$/, '').replace(/\.git$/i, '');
if (/^git@github\.com:/i.test(url)) url = url.replace(/^git@github\.com:/i, 'https://github.com/');
if (/^github\.com\//i.test(url)) url = 'https://' + url;

if (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(url)) {
	console.error(`[ERROR] "${arg}" doesn't look like a GitHub repo URL.`);
	console.error('        Expected something like: https://github.com/your-name/daily-todo-carryover');
	process.exit(1);
}

manifest.repoUrl = url;
fs.writeFileSync(file, JSON.stringify(manifest, null, '\t') + '\n');
console.log(`repoUrl set to ${url}`);
