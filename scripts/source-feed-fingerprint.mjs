// Fingerprint each hourly source-activity snapshot by its actual contents.
// A new filename is a fresh Cloudflare/browser cache key even when a zone
// cache rule overrides Pages _headers and caches JavaScript for hours.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

export function sourceFeedFilename(source) {
  assert(typeof source === 'string' && source.includes('const reports = '),
    'Missing original source observation payload');
  const digest=createHash('sha256').update(source).digest('hex').slice(0,16);
  return 'source-activity.'+digest+'.js';
}

export function fingerprintSourceActivity(root='dist') {
  const original=fs.readFileSync(path.join(root,'source-activity.js'),'utf8');
  const filename=sourceFeedFilename(original);
  const index=path.join(root,'index.html');
  const markup=fs.readFileSync(index,'utf8');
  const pattern=/src="source-activity(?:\.[0-9a-f]{16})?\.js(?:\?[^"]*)?"/g;
  const matches=[...markup.matchAll(pattern)];
  assert.equal(matches.length,1,'Expected one source-activity script in the original reader');
  const updated=markup.replace(pattern,'src="'+filename+'"');
  const target=path.join(root,filename);
  fs.writeFileSync(target,original);
  if(updated!==markup)fs.writeFileSync(index,updated);
  return {filename,digest:filename.slice('source-activity.'.length,-'.js'.length)};
}
