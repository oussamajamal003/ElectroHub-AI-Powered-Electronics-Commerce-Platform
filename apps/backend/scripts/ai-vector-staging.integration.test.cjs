'use strict';
/** Opt-in, local-only real PostgreSQL acceptance. Creates/drops a NEW random database;
 * the launcher's catalog and index are never changed. No shared environment fallback. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const tls = require('node:tls');
const { spawnSync } = require('node:child_process');
const { Client } = require('pg');
const { devConnectionConfig, DEV_REF } = require('./lib/ai-vector-dev-security.cjs');
const backend = path.resolve(__dirname, '..');

test('real disposable vector staging, activation, cascades, privileges and TLS', {
  skip: process.env.AI_VECTOR_CLOSURE_QA !== '1', timeout: 120_000,
}, async t => {
  const home = path.join(backend, '.isolated-docker');
  const env = JSON.parse(fs.readFileSync(path.join(home, 'env.json')));
  const raw = new URL(env.DATABASE_URL);
  assert.equal(raw.hostname, 'localhost'); assert.equal(raw.port, '55434');
  assert.equal(raw.pathname, '/electrohub_disposable');
  const password = fs.readFileSync(path.join(home, 'password.txt'), 'utf8').trim();
  assert.equal(decodeURIComponent(raw.password), password);
  const rolePasswords = JSON.parse(fs.readFileSync(path.join(home, 'ai-vector-roles.json')));
  const ca = fs.readFileSync(env.DB_SSL_CA_CERT_PATH, 'utf8');
  const database = `electrohub_vector_closure_${crypto.randomBytes(5).toString('hex')}`;
  const connections = [];
  const config = (name, user = 'postgres') => ({ host: 'localhost', port: 55434, database: name, user,
    password: user === 'postgres' ? password : rolePasswords[user], ssl: { ca, rejectUnauthorized: true, servername: 'localhost' },
    connectionTimeoutMillis: 5000, statement_timeout: 8000 });
  const connect = async (user = 'postgres') => {
    const client = new Client(config(database, user)); await client.connect(); connections.push(client); return client;
  };
  const cluster = new Client(config('electrohub_disposable')); await cluster.connect();
  const identity = await cluster.query("SELECT current_database() db, inet_server_port() port, ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()");
  assert.deepEqual(identity.rows[0], { db: 'electrohub_disposable', port: 55434, ssl: true });
  await cluster.query(`CREATE DATABASE ${database}`);
  try {
    await t.test('complete canonical migrations apply to a new database', async () => {
      const cleanUrl = new URL(raw); cleanUrl.pathname = `/${database}`; cleanUrl.search = '?sslmode=disable';
      // Prisma CLI runs solely over verified launcher loopback; app/pg clients retain verified TLS.
      const run = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['prisma', 'migrate', 'deploy'], {
        cwd: backend, encoding: 'utf8', shell: process.platform === 'win32', timeout: 60_000,
        env: { ...process.env, DATABASE_URL: cleanUrl.toString(), DIRECT_URL: cleanUrl.toString() },
      });
      assert.equal(run.status, 0, 'clean disposable migrate deploy must pass');
    });
    const admin = await connect(); const ingest = await connect('ai_vector_ingest'); const reader = await connect('ai_vector_reader');
    const cat = crypto.randomUUID(), product = crypto.randomUUID(), image = crypto.randomUUID(), image2 = crypto.randomUUID();
    await admin.query('INSERT INTO categories(id,name,slug,"updatedAt") VALUES($1,$2,$2,now())', [cat, database]);
    await admin.query('INSERT INTO products(id,"categoryId",sku,name,slug,price,"updatedAt") VALUES($1,$2,$3,$3,$3,1,now())', [product, cat, database]);
    for (const id of [image,image2]) await admin.query('INSERT INTO product_images(id,"productId",url,"updatedAt") VALUES($1,$2,$3,now())', [id, product, `/images/${id}.png`]);
    const vector = `[1,${Array(255).fill('0').join(',')}]`;
    const version = async name => admin.query("INSERT INTO ai.model_versions(embedding_version,model_version,preprocess_version,embedding_dimension,artifact_format,artifact_sha256,expected_images) VALUES($1,'test','test',256,'safetensors',$2,1)", [name,'a'.repeat(64)]);
    const insert = (client, v, id=image) => client.query('INSERT INTO ai.product_image_embeddings(product_image_id,product_id,embedding_version,image_sha256,embedding) VALUES($1,$2,$3,$4,$5::extensions.vector)', [id,product,v,'b'.repeat(64),vector]);
    await version('stage'); await version('other');
    await t.test('staging INSERT, UPDATE and DELETE are allowed', async () => {
      await insert(ingest,'stage');
      await ingest.query("UPDATE ai.product_image_embeddings SET image_sha256=$1 WHERE embedding_version='stage'",['c'.repeat(64)]);
      await ingest.query("DELETE FROM ai.product_image_embeddings WHERE embedding_version='stage'");
      await insert(ingest,'stage');
    });
    await t.test('embedding version reassignment is denied', async () => {
      await assert.rejects(ingest.query("UPDATE ai.product_image_embeddings SET embedding_version='other' WHERE embedding_version='stage'"), {code:'42501'});
    });
    await t.test('ineligible catalog images cannot enter staging', async () => {
      await admin.query('UPDATE products SET "storefrontVisible"=false WHERE id=$1',[product]);
      try { await assert.rejects(insert(ingest,'other',image2),{code:'42501'}); }
      finally { await admin.query('UPDATE products SET "storefrontVisible"=true WHERE id=$1',[product]); }
    });
    for (const status of ['VERIFIED','ACTIVE','RETIRED','FAILED']) {
      await t.test(`${status} INSERT, UPDATE and DELETE are denied`, async () => {
        await admin.query('UPDATE ai.model_versions SET status=$1 WHERE embedding_version=$2',[status,'stage']);
        await assert.rejects(insert(ingest,'stage',image2),{code:'42501'});
        await assert.rejects(ingest.query("UPDATE ai.product_image_embeddings SET image_sha256=$1 WHERE embedding_version='stage'",['d'.repeat(64)]),{code:'42501'});
        await assert.rejects(ingest.query("DELETE FROM ai.product_image_embeddings WHERE embedding_version='stage'"),{code:'42501'});
      });
    }
    await t.test('reader and ingestion roles cannot mutate commerce or DDL', async () => {
      for(const client of [reader,ingest]) {
        await assert.rejects(client.query('UPDATE public.products SET name=name'),{code:'42501'});
        await assert.rejects(client.query('CREATE TABLE ai.forbidden(id int)'),{code:'42501'});
        await assert.rejects(client.query('SELECT count(*) FROM public.users'),{code:'42501'});
      }
      await assert.rejects(reader.query('DELETE FROM ai.product_image_embeddings'),{code:'42501'});
      await assert.rejects(ingest.query("UPDATE ai.model_versions SET status='ACTIVE'"),{code:'42501'});
    });
    const waitBlocked = async (waiter, blocker) => {
      const end = Date.now()+4000;
      while(Date.now()<end) {
        const result=await cluster.query('SELECT $1::int = ANY(pg_blocking_pids($2::int)) blocked',[blocker.processID,waiter.processID]);
        if(result.rows[0].blocked) return;
        await new Promise(resolve=>setTimeout(resolve,20));
      }
      assert.fail('expected database lock interleaving was not observed');
    };
    await t.test('activation waits for an admitted staging transaction', async () => {
      await version('race-before'); await ingest.query('BEGIN'); await insert(ingest,'race-before');
      const activation=admin.query("UPDATE ai.model_versions SET status='ACTIVE' WHERE embedding_version='race-before'");
      await waitBlocked(admin,ingest); await ingest.query('COMMIT'); await activation;
      await assert.rejects(ingest.query("DELETE FROM ai.product_image_embeddings WHERE embedding_version='race-before'"),{code:'42501'});
    });
    await t.test('a writer waiting behind activation is denied after commit', async () => {
      await version('race-after'); await admin.query('BEGIN');
      await admin.query("SELECT 1 FROM ai.model_versions WHERE embedding_version='race-after' FOR UPDATE");
      const pending=insert(ingest,'race-after').then(()=>null,error=>error.code);
      await waitBlocked(ingest,admin);
      await admin.query("UPDATE ai.model_versions SET status='ACTIVE' WHERE embedding_version='race-after'");
      await admin.query('COMMIT'); assert.equal(await pending,'42501');
    });
    await t.test('atomic pointer activation and rollback preserve vector immutability', async () => {
      await admin.query("UPDATE ai.model_versions SET status='ACTIVE' WHERE embedding_version='stage'");
      await admin.query("INSERT INTO ai.active_index(embedding_version,previous_version) VALUES('stage','race-before')");
      await admin.query('BEGIN');
      await admin.query("UPDATE ai.model_versions SET status='RETIRED' WHERE embedding_version='stage'");
      await admin.query("UPDATE ai.model_versions SET status='ACTIVE' WHERE embedding_version='race-before'");
      await admin.query("UPDATE ai.active_index SET embedding_version='race-before',previous_version='stage'");
      await admin.query('COMMIT');
      assert.equal((await reader.query('SELECT embedding_version FROM ai.active_index')).rows[0].embedding_version,'race-before');
    });
    await t.test('legitimate image and product deletion cascades retain commerce authority', async () => {
      await admin.query('DELETE FROM product_images WHERE id=$1',[image]);
      assert.equal((await admin.query('SELECT count(*)::int n FROM ai.product_image_embeddings')).rows[0].n,0);
      await insert(admin,'stage',image2); await admin.query('DELETE FROM products WHERE id=$1',[product]);
      assert.equal((await admin.query('SELECT count(*)::int n FROM ai.product_image_embeddings')).rows[0].n,0);
    });
    await t.test('verified TLS accepts the QA CA and rejects untrusted CA or hostname', async () => {
      const approved = devConnectionConfig({DIRECT_URL:`postgresql://postgres.${DEV_REF}:test@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres`},DEV_REF);
      const trusted = new Client({...config(database),ssl:{...approved.ssl,ca,servername:'localhost'}});
      await trusted.connect(); await trusted.end();
      // pg pins SNI to its actual host. Exercise a rejected chain and an actual
      // handshake identity callback, rather than changing SNI that pg replaces.
      for(const ssl of [{...approved.ssl,ca:tls.rootCertificates[0],servername:'localhost'},
        {...approved.ssl,ca,servername:'localhost',checkServerIdentity:(_host,cert)=>approved.ssl.checkServerIdentity('wrong.example',cert)}]) {
        const bad = new Client({...config(database),ssl});
        bad.on('error',()=>{});
        try { await assert.rejects(bad.connect()); } finally { await bad.end().catch(()=>{}); }
      }
    });
  } finally {
    for(const client of connections) { await client.query('ROLLBACK').catch(()=>{}); await client.end().catch(()=>{}); }
    await cluster.query(`DROP DATABASE ${database} WITH (FORCE)`); await cluster.end();
  }
});
