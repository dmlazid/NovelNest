// Existing, manually provisioned NovelHaven D1 databases.
// Identifiers were verified in GitHub Actions Run #2 on October 8, 2026.
// Database 01 contains existing chapters; NEVER erase or replace it.
export const SHARDS = Object.freeze([
  { number: 1, name: 'novelhaven-chapters-01', id: '61109519-a023-4ab3-9b2b-8b990752126e' },
  { number: 2, name: 'novelhaven-chapters-02', id: '8c83e79f-fef8-4ed6-bef4-c705929e31ab' },
  { number: 3, name: 'novelhaven-chapters-03', id: 'cdbbdf93-ef34-4721-98eb-b266676f2862' },
  { number: 4, name: 'novelhaven-chapters-04', id: '8ef219f7-00af-4b5e-8c65-ec2bb1f22993' },
  { number: 5, name: 'novelhaven-chapters-05', id: '6edf1c87-b1a8-45ad-a5f9-bc8e9248ce2b' },
]);

export const ROUTING_SCHEMA = `CREATE TABLE IF NOT EXISTS novel_shards (
  novel_id TEXT NOT NULL PRIMARY KEY,
  database_id TEXT NOT NULL,
  assigned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;
// novel_shards is created only in original D1 on an explicitly requested import.
// Novel-to-database routing is durable, preserves existing imported chapters,
// and lets the future Worker find chapters without changing public URLs.
