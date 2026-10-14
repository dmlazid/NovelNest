// Read-only inventory for review by the site owner. It does not scrape outside
// sites, certify permission, change novels, or contact AdSense/Cloudflare.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {loadNovelCatalog,readableChapterCount} from './export-d1-batch.mjs';
import {loadReviewRegistry,novelMayHaveGoogleAds} from './novel-ad-policy.mjs';

export function makeRightsReviewInventory(novels,registry){
  assert(Array.isArray(novels)&&novels.length>0,'No published novels');
  const seen=new Set();
  const books=novels.map(n=>{
    assert(!seen.has(n.id),'Duplicate novel ID: '+n.id);seen.add(n.id);
    const commercialAdsReviewed=novelMayHaveGoogleAds(n.id,registry);
    return {
      id:n.id,title:n.title,author:n.author||'',
      source:n.source||'Unspecified',
      readable_chapters:readableChapterCount(n),
      commercial_ads_review:commercialAdsReviewed?'review_recorded':'awaiting_work_specific_evidence',
      copyright_and_translation_evidence:'not_independently_verified_by_this_audit',
      cover_art_rights:'needs_owner_review',
      added_editorial_value:'needs_individual_page_review',
      content_policy_review:'needs_human_review',
      novel_pages_serve_google_ads:commercialAdsReviewed
    };
  });
  const reviewed=books.filter(n=>n.commercial_ads_review==='review_recorded').length;
  return {schemaVersion:1,generatedAt:new Date().toISOString(),novels:books.length,
    readableChapters:books.reduce((a,n)=>a+n.readable_chapters,0),
    novelAdApprovals:reviewed,novelAdHolds:books.length-reviewed,
    note:'Review queue only, not independent permission verification, not a Google approval.',
    titles:books};
}
export function main(){
  const report=makeRightsReviewInventory(loadNovelCatalog('dist'),loadReviewRegistry());
  if(process.env.POLICY_AUDIT_REPORT_PATH)
    fs.writeFileSync(process.env.POLICY_AUDIT_REPORT_PATH,JSON.stringify(report,null,2)+'\n');
  if(process.env.GITHUB_STEP_SUMMARY)
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      '### NovelHaven rights review queue\n\n'+report.novels+' titles / '+
      report.readableChapters+' readable chapter slots; '+report.novelAdHolds+
      ' titles held from Google advertising pending individual rights and content review. No contracts verified.\n');
  console.log('Novel monetization audit:',JSON.stringify({
    novels:report.novels,readableChapters:report.readableChapters,
    novelAdApprovals:report.novelAdApprovals,novelAdHolds:report.novelAdHolds
  }));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main();
