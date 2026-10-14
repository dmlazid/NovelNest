// Deterministic triage, never a plagiarism detector or a content-safety classifier.
// Reports contain counts/reasons only. Do not persist private manuscript text.
export function screenStory(story, chapters, {complete=true}={}){
  const reasons=[], warnings=[];
  const text=v=>typeof v==='string'?v:'';
  const wordCount=v=>text(v).trim().split(/\s+/).filter(Boolean).length;
  const bad=(label)=>{if(reasons.length<12) reasons.push(label);};
  const caution=(label)=>{if(warnings.length<12) warnings.push(label);};
  const saved=Array.isArray(chapters)?chapters:[];
  const title=text(story?.title), summary=text(story?.summary), penName=text(story?.penName);
  if(title.trim().length<3||title.length>120)bad('Story title is missing or invalid.');
  if(summary.trim().length<30||summary.length>2000)bad('Story summary needs 30–2,000 characters.');
  if(penName.trim().length<2||penName.length>60)bad('Author pen name is missing or invalid.');
  if(!['Fantasy','Romance','Adventure','Mystery','Science Fiction','Historical','Slice of Life','Other'].includes(story?.genre))
    bad('Choose one of the supported story genres.');
  if(story?.copyrightConfirmed!==true||story?.guidelinesAccepted!==true)
    bad('Author must confirm ownership or permission and accept guidelines.');
  if(!saved.length)bad('Add at least one saved chapter.');
  if(!complete)caution('Chapter count exceeded scanning limit; owner must check the full manuscript.');
  const seenNumbers=new Set(), seenBodies=new Set();
  let words=0, links=0, duplicates=0;
  for(const chapter of saved){
    const body=text(chapter.body), number=chapter.number, heading=text(chapter.title);
    words+=wordCount(body);
    if(!Number.isInteger(number)||number<1||number>9999||seenNumbers.has(number))
      bad('Chapter number is invalid or repeated.');
    seenNumbers.add(number);
    if(heading.trim().length<3||heading.length>120||body.trim().length<100||body.length>45000)
      bad('A chapter title or body does not meet the writing requirements.');
    const normalized=body.toLowerCase().replace(/\s+/g,' ').trim();
    if(normalized.length>140 && seenBodies.has(normalized))duplicates++;
    seenBodies.add(normalized);
    links+=(body.match(/https?:\/\/|www\./gi)||[]).length;
  }
  if(words<300)bad('At least 300 saved chapter words are required for submission.');
  if(duplicates)caution('Identical chapter texts found; check for duplicate uploads.');
  if(links>=3)caution('Several outside links appear in the chapters; check for spam or phishing.');
  if(saved.length && !seenNumbers.has(1))caution('Chapter 1 was not found; check reading order.');
  // Automated screening cannot establish copyright, consent, or contextual safety.
  const level=reasons.length?'action-required':warnings.length?'needs-review':'basic-checks-passed';
  return {level,reasons,warnings,chapterCount:saved.length,wordCount:words,
    fullyScanned:!!complete,copyrightVerified:false,
    manualReviewRecommended:level!=='basic-checks-passed'};
}
