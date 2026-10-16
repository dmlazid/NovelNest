// Read-only ads.txt diagnostics from GitHub Actions. Does not alter AdSense.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const domain='novelhaven.top';
const expected=fs.readFileSync('dist/ads.txt','utf8').trim();
assert.match(expected,/^google\.com, pub-\d{16}, DIRECT, f08c47fec0942fa0$/);
const html=fs.readFileSync('dist/index.html','utf8');
const pub=expected.match(/pub-(\d{16})/)[1];
assert(html.includes('ca-pub-'+pub),'Site script and ads.txt differ');

for(const protocol of ['https:','http:']){
 const address=protocol+'//'+domain+'/ads.txt';
 const response=await fetch(address,{redirect:'follow',signal:AbortSignal.timeout(20000),
   headers:{'User-Agent':'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)','Accept':'text/plain,*/*'}});
 const body=await response.text();
 const end=new URL(response.url);
 console.log(JSON.stringify({requestedProtocol:protocol,code:response.status,finalHost:end.hostname,
   finalProtocol:end.protocol,contentType:response.headers.get('content-type'),
   matchesPublisher:body.trim()===expected}));
 assert.equal(response.status,200,'ads.txt must return HTTP 200 after redirects');
 assert.equal(end.hostname,domain,'ads.txt must stay on the verified domain');
 assert.equal(body.trim(),expected,'Live ads.txt does not match the valid AdSense seller record');
 assert(!/<html|<!doctype html/i.test(body),'ads.txt was served as an HTML page');
}
const robots=await fetch('https://'+domain+'/robots.txt',{signal:AbortSignal.timeout(15000)});
assert.equal(robots.status,200,'robots.txt must be available');
const rules=await robots.text();
assert(rules.includes('Allow: /'),'Crawler access must be allowed');
assert(!/Disallow:\s*\/ads\.txt/.test(rules),'Crawler cannot be blocked from ads.txt');
console.log('Verified: seller record is reachable from HTTP and HTTPS, with Googlebot user agent; account crawl status cannot be checked here.');
