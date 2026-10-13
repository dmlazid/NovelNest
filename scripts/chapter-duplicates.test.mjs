import test from 'node:test';
import assert from 'node:assert/strict';
import { repeatedChapterBodies, unexpectedRepeatedBodies } from './check.mjs';

const original = 'A detailed chapter paragraph about reading and the story. '.repeat(9);
test('flags an exactly repeated substantial chapter body even if spacing differs', () => {
  const chapters = [
    { number: 1, paragraphs: [original] },
    { number: 2, paragraphs: [original.replaceAll('  ', ' ').replace('reading', 'reading')] },
    { number: 3, paragraphs: [original + 'A different ending.'] },
  ];
  const duplicates = repeatedChapterBodies('sample', chapters);
  assert.equal(duplicates.length, 1);
  assert.equal(duplicates[0].novel_id, 'sample');
  assert.equal(duplicates[0].first_chapter, 1);
  assert.equal(duplicates[0].repeated_chapter, 2);
});
test('ignores very short standard disclaimers and differing bodies', () => {
  assert.deepEqual(repeatedChapterBodies('sample', [
    {number:1,paragraphs:['Chapter opening']},
    {number:2,paragraphs:['Chapter opening']},
    {number:3,paragraphs:[original]},
    {number:4,paragraphs:[original+' extra unique text']},
  ]), []);
});

test('reviewed exact duplicate is tolerated but any newly duplicated or edited body blocks publishing',()=>{
 const known=[{novel_id:'sample',first_chapter:1,repeated_chapter:2,digest:'abc'}];
 assert.deepEqual(unexpectedRepeatedBodies([known[0]],known),[]);
 assert.equal(unexpectedRepeatedBodies([{...known[0],repeated_chapter:3}],known).length,1);
 assert.equal(unexpectedRepeatedBodies([{...known[0],digest:'new'}],known).length,1);
});
