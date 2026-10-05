import process from 'node:process';

const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '';
if (!raw.trim()) {
  console.log('Firebase notification secret is not configured; skipping push notifications.');
  process.exit(0);
}

const novelId = process.env.NOVEL_ID || '';
const novelTitle = process.env.NOVEL_TITLE || 'NovelNest';
const siteUrl = (process.env.SITE_URL || 'https://dmlazid.github.io/NovelNest/').replace(/\/?$/, '/');
if (!novelId) throw new Error('NOVEL_ID is required.');

const admin = await import('firebase-admin');
const serviceAccount = JSON.parse(raw);
if (!admin.apps?.length) {
  admin.initializeApp({credential: admin.credential.cert(serviceAccount)});
}

const db = admin.firestore();
const snapshot = await db.collection('users').where('notificationsEnabled', '==', true).get();
const targets = [];

for (const userDoc of snapshot.docs) {
  const data = userDoc.data() || {};
  const saved = Array.isArray(data.saved) ? data.saved : [];
  if (!saved.includes(novelId)) continue;
  const tokens = Array.isArray(data.fcmTokens) ? [...new Set(data.fcmTokens.filter(Boolean))] : [];
  for (const token of tokens) targets.push({token, ref:userDoc.ref});
}

if (!targets.length) {
  console.log(`No notification subscribers currently follow ${novelTitle}.`);
  process.exit(0);
}

let success = 0;
let failed = 0;
const invalidByRef = new Map();

for (let offset = 0; offset < targets.length; offset += 500) {
  const batch = targets.slice(offset, offset + 500);
  const response = await admin.messaging().sendEachForMulticast({
    tokens: batch.map(x => x.token),
    notification: {
      title: `${novelTitle} updated`,
      body: 'New chapter content is now available on NovelNest.'
    },
    webpush: {
      fcmOptions: {link: `${siteUrl}#/novel/${novelId}`}
    }
  });
  success += response.successCount;
  failed += response.failureCount;
  response.responses.forEach((result, i) => {
    if (result.success) return;
    const code = result.error?.code || '';
    if (code.includes('registration-token-not-registered') || code.includes('invalid-registration-token')) {
      const target = batch[i];
      const list = invalidByRef.get(target.ref.path) || {ref:target.ref,tokens:[]};
      list.tokens.push(target.token);
      invalidByRef.set(target.ref.path, list);
    }
  });
}

for (const {ref,tokens} of invalidByRef.values()) {
  await ref.set({fcmTokens: admin.firestore.FieldValue.arrayRemove(...tokens)}, {merge:true});
}

console.log(`Push notification result for ${novelTitle}: ${success} sent, ${failed} failed.`);
