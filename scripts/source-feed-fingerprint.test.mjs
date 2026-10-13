import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {sourceFeedFilename,fingerprintSourceActivity} from './source-feed-fingerprint.mjs';

const template='<html><script defer src="source-activity.js?v=20261014-1"></script><script defer src="app.js?v=keep"></script></html>';
const payload=n=>'// observed results\n(() => { const reports = {"book":{"sourceActivityChapter":'+n+'}}; })();';
test('source observations always get a unique filename when chapters change',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'novelhaven-source-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.writeFileSync(path.join(root,'index.html'),template);
  fs.writeFileSync(path.join(root,'source-activity.js'),payload(12));
  const old=fingerprintSourceActivity(root);
  assert.match(old.filename,/^source-activity\.[0-9a-f]{16}\.js$/);
  assert.equal(fs.readFileSync(path.join(root,old.filename),'utf8'),payload(12));
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  assert(html.includes('src="'+old.filename+'"'));
  assert(html.includes('app.js?v=keep'),'Reader version changed unexpectedly');
  assert.equal(fingerprintSourceActivity(root).filename,old.filename,'Build should be repeatable');
  fs.writeFileSync(path.join(root,'source-activity.js'),payload(13));
  const next=fingerprintSourceActivity(root);
  assert.notEqual(next.filename,old.filename);
  assert.equal(fs.readFileSync(path.join(root,next.filename),'utf8'),payload(13));
  assert.equal(fs.readFileSync(path.join(root,old.filename),'utf8'),payload(12),
    'Older snapshots must not be overwritten with new contents');
  assert(!fs.readFileSync(path.join(root,'index.html'),'utf8').includes(old.filename));
  assert.equal(next.filename,sourceFeedFilename(payload(13)));
});
test('missing source script fails the publishing build instead of hiding stale content',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'novelhaven-source-missing-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.writeFileSync(path.join(root,'index.html'),'<script src="app.js"></script>');
  fs.writeFileSync(path.join(root,'source-activity.js'),payload(1));
  assert.throws(()=>fingerprintSourceActivity(root),/Expected one source-activity script/);
});
