// Checks public/manifest.json for the mistakes RemNote rejects at load time
// (e.g. "repoUrl: Invalid url"), so start.bat stops with a clear message
// instead of RemNote failing with "Failed to load manifest".
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'public', 'manifest.json');
const errors = [];

let m;
try {
	m = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch (e) {
	console.error(`[manifest] public/manifest.json is not valid JSON: ${e.message}`);
	process.exit(1);
}

const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;
const isHttpUrl = (v) => {
	if (!isNonEmptyString(v)) return false;
	try {
		const u = new URL(v);
		return (u.protocol === 'https:' || u.protocol === 'http:') && u.hostname.includes('.');
	} catch {
		return false;
	}
};
const isWholeNumber = (v) => Number.isInteger(v) && v >= 0;

if (m.manifestVersion !== 1) errors.push('manifestVersion must be 1');
if (!isNonEmptyString(m.id) || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(m.id))
	errors.push('id must be lowercase letters/numbers separated by single hyphens, e.g. "daily-todo-carryover"');
if (!isNonEmptyString(m.name)) errors.push('name must not be empty');
if (!isNonEmptyString(m.author)) errors.push('author must not be empty');
if (!isHttpUrl(m.repoUrl))
	errors.push(`repoUrl must be a full web address like "https://github.com/you/repo" (got ${JSON.stringify(m.repoUrl)})`);
if (!isNonEmptyString(m.description)) errors.push('description must not be empty');
if (!m.version || !isWholeNumber(m.version.major) || !isWholeNumber(m.version.minor) || !isWholeNumber(m.version.patch))
	errors.push('version must be { "major": n, "minor": n, "patch": n } with whole numbers');
if (!Array.isArray(m.theme)) errors.push('theme must be an array (use [] for none)');
if (typeof m.enableOnMobile !== 'boolean') errors.push('enableOnMobile must be true or false');
if (typeof m.requestNative !== 'boolean') errors.push('requestNative must be true or false');
if (!Array.isArray(m.requiredScopes) || m.requiredScopes.length === 0) {
	errors.push('requiredScopes must be a non-empty array');
} else {
	m.requiredScopes.forEach((s, i) => {
		if (!s || !isNonEmptyString(s.type) || !isNonEmptyString(s.level))
			errors.push(`requiredScopes[${i}] needs a "type" and a "level"`);
	});
}

if (errors.length) {
	console.error('[manifest] public/manifest.json has problems RemNote will reject:');
	for (const e of errors) console.error(`  - ${e}`);
	process.exit(1);
}
console.log(`[manifest] OK: ${m.name} v${m.version.major}.${m.version.minor}.${m.version.patch}`);
