import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const context={window:{}};vm.createContext(context);vm.runInContext(fs.readFileSync('dist/catalog.js','utf8'),context);
const ids=new Set();
for(const n of context.window.NOVELS){
 assert.match(n.id,/^[a-z0-9-]+$/);assert(!ids.has(n.id),`Duplicate ID: ${n.id}`);ids.add(n.id);
 for(const field of ['title','author','genre','status','synopsis'])assert(typeof n[field]==='string'&&n[field].trim(),`${n.id}: missing ${field}`);
 assert(['Completed','Ongoing'].includes(n.status));assert(Array.isArray(n.tags)&&n.tags.length>0);
 assert(fs.existsSync('dist/'+n.cover),`${n.id}: missing cover`);
 assert(n.license?.type&&n.license?.note,`${n.id}: document publishing permission`);
 assert(n.chapters.length>0);
 for(const c of n.chapters){assert(c.title&&c.paragraphs?.length);assert(c.paragraphs.every(p=>typeof p==='string'&&p.trim()));}
}
for(const asset of ['app.js','catalog.js','styles.css'])assert(fs.existsSync('dist/'+asset));
new vm.Script(fs.readFileSync('dist/app.js','utf8'));
console.log(`Validated ${ids.size} novels, ${context.window.NOVELS.reduce((sum,n)=>sum+n.chapters.length,0)} chapters, and local assets.`);
