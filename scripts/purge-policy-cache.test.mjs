import test from 'node:test';
import assert from 'node:assert/strict';
import {DOMAIN,TARGETS,targetedPolicyPurge} from './purge-policy-cache.mjs';

const token='test-token',accountId='known-account',zoneId='a'.repeat(32);
function stub({staleContact=false,staleNovel=false,otherAccount=false}={}){
  const calls=[];
  const fn=async(url,options={})=>{
    calls.push({url,method:options.method||'GET',body:options.body});
    if(url.startsWith('https://'+DOMAIN+'/')){
      const pathname=new URL(url).pathname;
      const html=pathname==='/contact.html'&&staleContact?'<html>Old contact form</html>':
        pathname==='/novel/shadow-slave/'&&staleNovel?'<script src="pagead2.googlesyndication.com"></script>':
        '<html><a href="mailto:novelhaven15@gmail.com">Email rights</a></html>';
      return new Response(html,{status:200});
    }
    if(url.endsWith('/zones?name='+DOMAIN))
      return Response.json({success:true,result:[{name:DOMAIN,id:zoneId,
        account:{id:otherAccount?'wrong-account':accountId}}]});
    if(url.endsWith('/zones/'+zoneId+'/purge_cache'))
      return Response.json({success:true,result:{id:zoneId}});
    throw Error('Unexpected API request '+url);
  };
  return {fn,calls};
}

test('fresh production URLs require no Cloudflare purge or additional API permissions',async()=>{
  const mock=stub();
  const result=await targetedPolicyPurge({token,accountId,fetchFn:mock.fn});
  assert.equal(result.status,'fresh');
  assert.equal(result.checked,TARGETS.length);
  assert.equal(mock.calls.length,TARGETS.length);
  assert(mock.calls.every(c=>c.method==='GET'));
});

test('only stale URL files can be purged; all other site caches remain intact',async()=>{
  const mock=stub({staleContact:true,staleNovel:true});
  const result=await targetedPolicyPurge({token,accountId,fetchFn:mock.fn});
  assert.equal(result.status,'purge_requested');
  const target=mock.calls.find(c=>c.method==='POST');
  assert(target,'Missing targeted purge request');
  assert.deepEqual(JSON.parse(target.body),{files:[
    'https://novelhaven.top/contact.html','https://novelhaven.top/novel/shadow-slave/'
  ]});
  assert(!target.body.includes('purge_everything'),'Never invalidate the entire domain');
});

test('never purge a Cloudflare zone from a different account',async()=>{
  const mock=stub({staleContact:true,otherAccount:true});
  await assert.rejects(targetedPolicyPurge({token,accountId,fetchFn:mock.fn}),
    /correct|expected account/);
  assert(!mock.calls.some(c=>c.method==='POST'));
});
test('never purge a foreign host or origin',async()=>{
  const mock=stub({staleContact:true});
  await assert.rejects(targetedPolicyPurge({
    token,accountId,fetchFn:mock.fn,origin:'https://example.com'
  }),/Only the exact approved/);
  assert.equal(mock.calls.length,0);
});
