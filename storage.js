const fs = require('node:fs');
const path = require('node:path');

let pool = null;
let filePath = null;
let seedFactory = null;

function normalize(db) {
  const fresh = seedFactory();
  for (const key of ['users','rides','transactions','overtimeRecords','contracts','notifications','ratings','incidents','audit','journeys']) db[key] = db[key] || [];
  db.settings = {...fresh.settings, ...(db.settings || {}), services:{...fresh.settings.services, ...(db.settings?.services || {})}};
  return db;
}

async function initStorage({seed, dbFile}) {
  seedFactory = seed;
  filePath = dbFile;
  if (process.env.DATABASE_URL) {
    const { Pool } = require('pg');
    pool = new Pool({connectionString:process.env.DATABASE_URL, ssl: process.env.PGSSL === 'disable' ? false : {rejectUnauthorized:false}, max:Number(process.env.PGPOOL_MAX || 10), idleTimeoutMillis:30000, connectionTimeoutMillis:10000});
    await pool.query(`CREATE TABLE IF NOT EXISTS app_state (id SMALLINT PRIMARY KEY CHECK (id=1), data JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    const found = await pool.query('SELECT data FROM app_state WHERE id=1');
    if (!found.rowCount) await pool.query('INSERT INTO app_state(id,data) VALUES(1,$1::jsonb)', [JSON.stringify(seed())]);
    console.log('[storage] PostgreSQL conectado');
  } else {
    console.warn('[storage] DATABASE_URL ausente: usando arquivo local (somente desenvolvimento)');
    if (!fs.existsSync(filePath)) await save(seed());
  }
}

async function load() {
  if (pool) {
    const result = await pool.query('SELECT data FROM app_state WHERE id=1');
    return normalize(result.rows[0]?.data || seedFactory());
  }
  try { return normalize(JSON.parse(fs.readFileSync(filePath,'utf8'))); }
  catch { const db=seedFactory(); await save(db); return db; }
}

async function save(db) {
  if (pool) {
    await pool.query(`INSERT INTO app_state(id,data,updated_at) VALUES(1,$1::jsonb,NOW()) ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data, updated_at=NOW()`, [JSON.stringify(db)]);
    return;
  }
  const temp = `${filePath}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(db,null,2));
  fs.renameSync(temp,filePath);
}

async function health() {
  if (!pool) return {ok:true, driver:'file', productionReady:false};
  await pool.query('SELECT 1');
  return {ok:true, driver:'postgresql', productionReady:true};
}

async function close() { if (pool) await pool.end(); }
module.exports={initStorage,load,save,health,close};
