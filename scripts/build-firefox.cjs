// Makes the Firefox version from the normal build:  npm run build:firefox   ->   dist-firefox/
// Same code. Only the manifest differs: Firefox runs the background script as an event page (not a service worker), wants an add-on id, and on Android the mobile site (m.youtube.com) is where videos play.
const fs = require('fs'); const path = require('path');
const root = path.join(__dirname, '..');
const src = path.join(root, 'dist'); const out = path.join(root, 'dist-firefox');
if (!fs.existsSync(path.join(src, 'manifest.json'))) { console.error('Run "npm run build" first.'); process.exit(1); }
fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(src, out, { recursive: true });
const m = JSON.parse(fs.readFileSync(path.join(src, 'manifest.json'), 'utf8'));
const MOBILE = 'https://m.youtube.com/*';
m.background = { scripts: ['background.js'], type: 'module' };
m.permissions = (m.permissions || []).filter((p) => p !== 'alarms');
m.host_permissions = [...new Set([...(m.host_permissions || []), MOBILE])];
m.content_scripts = (m.content_scripts || []).map((c) => ({ ...c, matches: [...new Set([...(c.matches || []), MOBILE])] }));
m.browser_specific_settings = {
  gecko: { id: '{61f05bb4-e513-457c-adae-127be9d17631}', strict_min_version: '140.0', data_collection_permissions: { required: ['none'] } }, // 140 added the data-collection declaration Mozilla now asks for; page scripts in the page's own world need 128
  gecko_android: { strict_min_version: '142.0' },
};
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(m, null, 2) + '\n');
console.log('dist-firefox ready: ' + m.name + ' ' + m.version + ', runs on ' + m.host_permissions.join(', '));
