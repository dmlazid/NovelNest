// Source-code preflight for NovelHaven. Does not access the user's AdSense account.
// Passing checks are not an approval guarantee or a verification of live site availability.
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=join(dirname(fileURLToPath(import.meta.url)),'..','dist');
const read=(p)=>readFileSync(join(root,p),'utf8');
const required=['index.html','ads.txt','robots.txt','sitemap.xml','about.html','privacy.html','privacy-choices.html','terms.html','contact.html','copyright.html','editorial-policy.html','content-licensing.html','advertising-disclosure.html','reading-desk.html'];
for(const file of required)assert(existsSync(join(root,file)),`Missing ${file}`);

const home=read('index.html');
const ads=read('ads.txt');
const pub='9356195452195758';
assert(home.includes('ca-pub-'+pub),'Homepage lacks AdSense publisher verification code');
assert(ads.includes('google.com, pub-'+pub+', DIRECT'),'ads.txt publisher differs from the site publisher');
assert(/<head\b[\s\S]*?pagead2\.googlesyndication\.com[\s\S]*?<\/head>/i.test(home),'AdSense code not located in the document head');
assert(/<meta\s+name="robots"\s+content="index,follow/i.test(home),'Homepage indexing tag missing');
assert(read('robots.txt').includes('Sitemap: https://novelhaven.top/sitemap.xml'),'robots.txt sitemap not declared');

const sitemap=read('sitemap.xml');
const urls=[...sitemap.matchAll(/<loc>(https:\/\/novelhaven\.top\/[^<]*)<\/loc>/g)].map(x=>x[1]);
assert(urls.length>=12,'Sitemap has too few registered pages');
const unique=new Set(urls);
assert(unique.size===urls.length,'Sitemap includes duplicate URLs');
for(const url of urls){
 const path=new URL(url).pathname;
 const filename=path==='/'?'index.html':decodeURIComponent(path.slice(1));
 assert(!filename.includes('..'),'Unexpected sitemap path');
 assert(existsSync(join(root,filename)),`Sitemap points to missing file ${filename}`);
 const page=read(filename);
 assert(/<title>[^<]+<\/title>/i.test(page),`Missing title on ${filename}`);
 assert(/name="description"/i.test(page),`Missing description on ${filename}`);
 assert(/rel="canonical"/i.test(page),`Missing canonical on ${filename}`);
}
const guides=urls.filter(x=>x.includes('/guide-'));
assert(guides.length>=7,'Expected original editorial guides are missing from sitemap');
for(const url of guides){
 const filename=new URL(url).pathname.slice(1);
 const page=read(filename);
 const visible=page.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ')
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ')
  .replace(/<[^>]+>/g,' ').replace(/&\w+;/g,' ');
 const words=visible.trim().split(/\s+/).filter(Boolean).length;
 assert(words>=200,`Original guide ${filename} has only ${words} visible words; editorial review recommended`);
}
for(const name of ['author-studio.html','author-admin.html']){
 const page=read(name);
 assert(page.includes('content="noindex,follow"'),`${name} should not be indexed`);
 assert(!/pagead2\.googlesyndication|adsbygoogle/i.test(page),`Ad code found in private author tool ${name}`);
}
assert(home.includes('href="/reading-desk.html"'),'Original guides are not linked from the homepage');
console.log('Source preflight passed:',urls.length,'sitemap URLs,',guides.length,'editorial guides; AdSense tag and ads.txt match.');
console.log('Not verified: live HTTP delivery, AdSense account status, commercial rights documents, or Google approval.');
