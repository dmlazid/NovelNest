// Advertising for republished fiction is opt-in after a work-specific review.
// A title in the reading catalog or a source-wide importer switch is NOT
// evidence of rights to run Google-served ads alongside that work.
import assert from 'node:assert/strict';
import fs from 'node:fs';

export const MONETIZATION_REVIEW_FILE='scripts/novel-monetization-reviews.json';

export function validateReviewRegistry(input){
  assert(input&&typeof input==='object'&&!Array.isArray(input),'Invalid monetization review registry');
  assert.equal(input.schemaVersion,1,'Unexpected monetization review schema');
  assert(input.approved&&typeof input.approved==='object'&&!Array.isArray(input.approved),
    'Reviewed works must be keyed by exact catalog novel ID');
  for(const [id,entry] of Object.entries(input.approved)){
    assert(/^[a-z0-9-]+$/.test(id),'Invalid reviewed novel ID');
    assert(entry&&typeof entry==='object'&&!Array.isArray(entry),'Invalid approval for '+id);
    for(const field of ['textRights','translationRights','coverRights','commercialAdsRights',
      'originalAddedValueReviewed','contentPolicyReviewed']){
      assert.equal(entry[field],true,'Incomplete '+field+' approval for '+id);
    }
    assert(/^\d{4}-\d{2}-\d{2}$/.test(entry.reviewedOn||''),
      'Missing review date for '+id);
    assert(typeof entry.reviewer==='string'&&entry.reviewer.trim().length>=2,
      'Missing reviewer for '+id);
    // Never put a private contract, email password, or legal ID in this repo.
    // Store evidence in an owner-held private system and put only a reference.
    assert(typeof entry.privateEvidenceReference==='string'&&
      /^[a-zA-Z0-9_-]{6,80}$/.test(entry.privateEvidenceReference),
      'Use a short, non-sensitive private evidence reference for '+id);
  }
  return input;
}
export function loadReviewRegistry(filepath=MONETIZATION_REVIEW_FILE){
  return validateReviewRegistry(JSON.parse(fs.readFileSync(filepath,'utf8')));
}
export function novelMayHaveGoogleAds(id,registry){
  assert(typeof id==='string'&&id.length>0,'Missing novel ID');
  validateReviewRegistry(registry);
  return Object.hasOwn(registry.approved,id);
}
