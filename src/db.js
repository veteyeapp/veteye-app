import * as SQLite from 'expo-sqlite';

export const norm = s => (s||'').toString().toLowerCase()
  .replace(/[\u064B-\u0652\u0640]/g,'').replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي')
  .replace(/[^a-z0-9\u0600-\u06FF]+/g,' ').trim();

let db;
export async function getDb() {
  if (db) return db;
  db = await SQLite.openDatabaseAsync('veteye.db');
  await db.execAsync(`
    PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS drugs(id INTEGER PRIMARY KEY, key TEXT UNIQUE, search TEXT, name TEXT, name_ar TEXT, active TEXT, category TEXT, mg_per_ml REAL, mg_per_tab REAL, max_mgkg REAL, contra TEXT, side_effects TEXT, source TEXT);
    CREATE TABLE IF NOT EXISTS doses(id INTEGER PRIMARY KEY, drug_id INTEGER, species TEXT, min REAL, max REAL, route TEXT, freq TEXT, UNIQUE(drug_id,species,route));
    CREATE TABLE IF NOT EXISTS cases(id INTEGER PRIMARY KEY, created TEXT, owner TEXT, animal TEXT, species TEXT, weight REAL, symptoms TEXT, diagnosis TEXT);
    CREATE TABLE IF NOT EXISTS refs(id INTEGER PRIMARY KEY, title TEXT UNIQUE, category TEXT, body TEXT);
    CREATE TABLE IF NOT EXISTS kv(k TEXT PRIMARY KEY, v TEXT);
  `);
  return db;
}

export async function getKV(k) {
  const d = await getDb();
  const r = await d.getFirstAsync('SELECT v FROM kv WHERE k=?', [k]);
  return r ? r.v : '';
}

export async function setKV(k, v) {
  const d = await getDb();
  await d.runAsync('INSERT OR REPLACE INTO kv(k,v) VALUES(?,?)', [k, String(v)]);
}

export async function importDrugs(rows) {
  const d = await getDb();
  let drugsN = 0, dup = 0, doseN = 0;
  await d.withTransactionAsync(async () => {
    for (const r of rows) {
      const key = norm(r.name || r.name_ar);
      if (!key) continue;
      const res = await d.runAsync(
        'INSERT OR IGNORE INTO drugs(key,search,name,name_ar,active,category,mg_per_ml,mg_per_tab,max_mgkg,contra,side_effects,source) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
        [key, norm([r.name, r.name_ar, r.active].join(' ')), r.name||'', r.name_ar||'', r.active||'', r.category||'', parseFloat(r.mg_per_ml)||null, parseFloat(r.mg_per_tab)||null, parseFloat(r.max_mgkg)||null, r.contra||'', r.side_effects||'', r.source||'']
      );
      if (res.changes) drugsN++; else {
        dup++;
        await d.runAsync("UPDATE drugs SET name=COALESCE(NULLIF(name,''),?),name_ar=COALESCE(NULLIF(name_ar,''),?),active=COALESCE(NULLIF(active,''),?),category=COALESCE(NULLIF(category,''),?),mg_per_ml=COALESCE(mg_per_ml,?),mg_per_tab=COALESCE(mg_per_tab,?),max_mgkg=COALESCE(max_mgkg,?),contra=COALESCE(NULLIF(contra,''),?),side_effects=COALESCE(NULLIF(side_effects,''),?),source=COALESCE(NULLIF(source,''),?) WHERE key=?",
          [r.name||'',r.name_ar||'',r.active||'',r.category||'',parseFloat(r.mg_per_ml)||null,parseFloat(r.mg_per_tab)||null,parseFloat(r.max_mgkg)||null,r.contra||'',r.side_effects||'',r.source||'',key]);
      }
      const row = await d.getFirstAsync('SELECT id FROM drugs WHERE key=?', [key]);
      if (r.species && (r.min || r.max)) {
        await d.runAsync('INSERT OR REPLACE INTO doses(drug_id,species,min,max,route,freq) VALUES(?,?,?,?,?,?)',
          [row.id, r.species, parseFloat(r.min)||0, parseFloat(r.max)||0, r.route||'', r.freq||'']);
        doseN++;
      }
    }
  });
  return {drugsN, dup, doseN};
}

export async function searchDrugs(q) {
  const d = await getDb();
  const s = '%' + norm(q) + '%';
  return d.getAllAsync('SELECT * FROM drugs WHERE search LIKE ? ORDER BY key LIMIT 100', [s]);
}

export async function dosesOf(id) {
  const d = await getDb();
  return d.getAllAsync('SELECT * FROM doses WHERE drug_id=?', [id]);
}

export async function importRefs(items) {
  const d = await getDb();
  let n = 0;
  for (const it of items) {
    if (!it.title || !it.body) continue;
    await d.runAsync('INSERT OR REPLACE INTO refs(title,category,body) VALUES(?,?,?)', [it.title, it.category||'عام', it.body]);
    n++;
  }
  return n;
}

export async function searchRefs(q) {
  const d = await getDb();
  const s = '%' + q + '%';
  return d.getAllAsync('SELECT * FROM refs WHERE title LIKE ? OR body LIKE ? LIMIT 50', [s, s]);
}

export async function saveCase(c) {
  const d = await getDb();
  await d.runAsync('INSERT INTO cases(created,owner,animal,species,weight,symptoms,diagnosis) VALUES(?,?,?,?,?,?,?)',
    [new Date().toISOString().slice(0,16).replace('T',' '), c.owner||'', c.animal||'', c.species||'', parseFloat(c.weight)||null, c.symptoms||'', c.diagnosis||'']);
}

export async function listCases() {
  const d = await getDb();
  return d.getAllAsync('SELECT * FROM cases ORDER BY id DESC LIMIT 200');
}
