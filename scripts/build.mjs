import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { validateSite } from './check.mjs';

validateSite('dist');
const output = '_site';
fs.rmSync(output, { recursive: true, force: true });
fs.cpSync('dist', output, { recursive: true });
const assets = {};
function fingerprint(directory = '') {
  for (const entry of fs.readdirSync(path.join('dist', directory), { withFileTypes: true })) {
    const name = path.posix.join(directory, entry.name);
    if (entry.isDirectory()) { fingerprint(name); continue; }
    if (!/\.(?:js|css)$/.test(name)) continue;
    const bytes = fs.readFileSync(path.join('dist', name));
    const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
    const versioned = name.replace(/(\.[^.]+)$/, `.${hash}$1`);
    fs.writeFileSync(path.join(output, versioned), bytes);
    assets[name] = versioned;
  }
}
fingerprint();
let html = fs.readFileSync('dist/index.html', 'utf8');
html = html.replace(/\b(src|href)="([^"]+)"/g, (match, attr, value) => {
  const versioned = assets[value.split('?')[0]];
  return versioned ? `${attr}="${versioned}"` : match;
});
const manifest = `<script>window.NOVELNEST_ASSETS=${JSON.stringify(assets)};</script>`;
html = html.replace(/<script\b/, `${manifest}<script`);
fs.writeFileSync(path.join(output, 'index.html'), html);
fs.writeFileSync(path.join(output, '.nojekyll'), '');
for (const file of Object.values(assets)) {
  if (!fs.existsSync(path.join(output, file))) throw new Error(`Missing versioned asset: ${file}`);
}
console.log(`Built ${output}/ with ${Object.keys(assets).length} versioned assets.`);
