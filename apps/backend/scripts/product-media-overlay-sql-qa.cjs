'use strict';

// Disposable-only SQL guards for Task 04.3. No real image inference or hosted DB access.
// This script intentionally requires a fresh electrohub_disposable_media_* database with an empty active_index
// and catalog_media_events. It does not run automatically as part of the normal backend QA command.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Client } = require('pg');

const backend = path.resolve(__dirname, '..');
const configPath = path.join(backend, '.isolated-docker', 'media-qa.json');
const asciiCa = path.join(os.homedir(), '.electrohub-isolated', 'ca.crt');
const vectorSource = fs.readFileSync(path.join(backend, '..', 'ai-service', 'app', 'integrations', 'pgvector_gateway.py'), 'utf8');
const nearestSql = vectorSource.match(/_NEAREST_SQL: Final = """([\s\S]*?)"""/);
const expectNearestSql = () => assert.ok(nearestSql, 'production nearest SQL source was found');
let currentPhase = 'startup';
function postgresNearestSql() {
  expectNearestSql();
  let index = 0;
  return nearestSql[1].replace(/%s/g, () => `$${++index}`);
}

function need(ok, code) {
  if (!ok) throw new Error(code);
}

function readTarget() {
  need(fs.existsSync(configPath), 'QA_CONFIG_MISSING');
  need(fs.realpathSync(path.dirname(configPath)) === fs.realpathSync(path.join(backend, '.isolated-docker')),
    'QA_CONFIG_PATH_REFUSED');
  const state = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const url = new URL(state.DATABASE_URL);
  const database = url.pathname.slice(1);
  need(['postgres:', 'postgresql:'].includes(url.protocol), 'QA_DATABASE_PROTOCOL_REFUSED');
  need(['localhost', '127.0.0.1', '::1'].includes(url.hostname.toLowerCase()) && url.port === '55434',
    'QA_DATABASE_ORIGIN_REFUSED');
  need(/^electrohub_disposable_media_[a-z0-9]+$/.test(database) && database === state.PRODUCT_MEDIA_QA_RUN,
    'QA_DATABASE_RUN_TAG_REFUSED');
  need(fs.existsSync(state.DB_SSL_CA_CERT_PATH) && fs.existsSync(asciiCa), 'QA_TLS_CA_MISSING');
  need(crypto.createHash('sha256').update(fs.readFileSync(state.DB_SSL_CA_CERT_PATH)).digest('hex') ===
    crypto.createHash('sha256').update(fs.readFileSync(asciiCa)).digest('hex'), 'QA_TLS_CA_MISMATCH');
  url.search = '';
  return {
    database,
    client: new Client({ connectionString: url.toString(), ssl: {
      ca: fs.readFileSync(asciiCa, 'utf8'), rejectUnauthorized: true,
    }, connectionTimeoutMillis: 5000, application_name: 'product-media-overlay-sql-qa' }),
  };
}

async function roleTransaction(client, role, action) {
  await client.query('BEGIN');
  try {
    await client.query(`SET LOCAL ROLE ${role}`);
    // Match the production Python connection's pinned type resolution for pgvector's `::vector` cast.
    await client.query('SET LOCAL search_path = ai, extensions, public');
    assert.equal((await client.query('SELECT current_user')).rows[0].current_user, role);
    const result = await action();
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function searchPathTransaction(client, action) {
  await client.query('BEGIN');
  try {
    await client.query('SET LOCAL search_path = ai, extensions, public');
    const result = await action();
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function main() {
  currentPhase = 'target-preflight';
  const target = readTarget();
  const { client, database } = target;
  const fixture = {
    suffix: crypto.randomUUID().replaceAll('-', '').slice(0, 12),
    category: crypto.randomUUID(), product: crypto.randomUUID(), image: crypto.randomUUID(),
    revision: crypto.randomUUID(),
  };
  fixture.version = `sql-guard-${fixture.suffix}`;
  fixture.digest = crypto.createHash('sha256').update(`source-${fixture.suffix}`).digest('hex');
  fixture.model = `sql-guard-model-${fixture.suffix}`;
  fixture.preprocess = `sql-guard-pre-${fixture.suffix}`;
  fixture.artifact = crypto.createHash('sha256').update(`artifact-${fixture.suffix}`).digest('hex');
  let fixtureCreated = false;
  let completed = false;
  let evidence = null;

  try {
    await client.connect();
    const preflight = (await client.query(`
      SELECT current_database() AS database, ssl,
        (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AS is_superuser,
        (SELECT count(*) FROM ai.active_index) AS active_count,
        (SELECT count(*) FROM public.catalog_media_events) AS event_count,
        to_regprocedure('ai.enqueue_missing_media_events(integer)') IS NOT NULL AS reconcile_installed,
        to_regprocedure('ai.publish_media_embedding(uuid,uuid,character varying,character varying,character varying,character,uuid,uuid,uuid,character,extensions.vector)') IS NOT NULL AS publish_installed
      FROM pg_stat_ssl WHERE pid=pg_backend_pid()`)).rows[0];
    need(preflight && preflight.database === database && preflight.ssl && preflight.is_superuser,
      'QA_DATABASE_TLS_IDENTITY_REFUSED');
    need(Number(preflight.active_count) === 0, 'QA_ACTIVE_POINTER_NOT_EMPTY');
    need(Number(preflight.event_count) === 0, 'QA_MEDIA_EVENTS_NOT_EMPTY');
    need(preflight.reconcile_installed && preflight.publish_installed, 'QA_FINAL_OVERLAY_MIGRATION_MISSING');
    need(Number((await client.query('SELECT count(*) FROM ai.model_versions WHERE embedding_version=$1', [fixture.version])).rows[0].count) === 0,
      'QA_FIXTURE_MODEL_COLLISION');

    const roleRows = (await client.query("SELECT rolname FROM pg_roles WHERE rolname IN ('ai_media_worker','ai_vector_reader')")).rows;
    need(roleRows.length === 2, 'QA_NARROW_ROLES_MISSING');
    expectNearestSql();

    await client.query('BEGIN');
    currentPhase = 'create-own-fixture';
    await client.query(`
      INSERT INTO public.categories (id,name,slug,"isActive","createdAt","updatedAt")
      VALUES ($1,$2,$3,true,now(),now())`, [fixture.category, `Overlay QA ${fixture.suffix}`, `overlay-qa-${fixture.suffix}`]);
    await client.query(`
      INSERT INTO public.products (id,"categoryId",sku,name,slug,price,status,"isTestFixture","storefrontVisible","createdAt","updatedAt")
      VALUES ($1,$2,$3,$4,$5,1.00,'ACTIVE',false,true,now(),now())`, [fixture.product, fixture.category,
      `OVERLAY-QA-${fixture.suffix}`, `Overlay SQL QA ${fixture.suffix}`, `overlay-sql-qa-${fixture.suffix}`]);
    await client.query(`
      INSERT INTO public.product_images (id,"productId",url,"position","isPrimary","storageProvider","storageBucket","storagePath",
        "sourceRevision","sourceSha256","sourceMimeType","width","height","byteSize","mediaState","createdAt","updatedAt")
      VALUES ($1,$2,$3,0,true,'SUPABASE_STORAGE','product-media',$4,$5,$6,'image/webp',256,256,512,'PUBLISHED',now(),now())`,
    [fixture.image, fixture.product, `https://pzxekjybdiulzmssalfo.supabase.co/storage/v1/object/public/product-media/products/${fixture.product}/${fixture.image}/${fixture.revision}/original.webp`,
      `products/${fixture.product}/${fixture.image}/${fixture.revision}/original.webp`, fixture.revision, fixture.digest]);
    await client.query(`INSERT INTO ai.model_versions
      (embedding_version,model_version,preprocess_version,embedding_dimension,artifact_format,artifact_sha256,expected_images)
      VALUES ($1,$2,$3,256,'safetensors',$4,0)`, [fixture.version, fixture.model, fixture.preprocess, fixture.artifact]);
    await client.query("UPDATE ai.model_versions SET status='VERIFIED', verified_at=now() WHERE embedding_version=$1", [fixture.version]);
    await client.query("UPDATE ai.model_versions SET status='ACTIVE', activated_at=now() WHERE embedding_version=$1", [fixture.version]);
    await client.query('INSERT INTO ai.active_index (singleton,embedding_version) VALUES (true,$1)', [fixture.version]);
    await client.query('COMMIT');
    fixtureCreated = true;

    currentPhase = 'reconciliation';
    const enqueue = async () => roleTransaction(client, 'ai_media_worker', async () =>
      Number((await client.query('SELECT ai.enqueue_missing_media_events(100) AS count')).rows[0].count));
    assert.equal(await enqueue(), 1, 'first bounded reconciliation enqueues the missing current revision');
    const original = (await client.query(`SELECT id,"idempotencyKey",state FROM public.catalog_media_events
      WHERE "productImageId"=$1`, [fixture.image])).rows[0];
    assert.ok(original && original.idempotencyKey === `reconcile:${fixture.version}:${fixture.image}:${fixture.revision}`);
    assert.equal(await enqueue(), 0, 'reconciliation does not duplicate a READY event');

    await client.query('UPDATE public.products SET "storefrontVisible"=false WHERE id=$1', [fixture.product]);
    await client.query(`UPDATE public.catalog_media_events SET state='SUPERSEDED',"completedAt"=now(),
      "claimedUntil"=NULL,"leaseToken"=NULL WHERE id=$1`, [original.id]);
    assert.equal(await enqueue(), 0, 'hidden source is not reconciled');
    await client.query('UPDATE public.products SET "storefrontVisible"=true WHERE id=$1', [fixture.product]);
    assert.equal(await enqueue(), 1, 'visible source re-enables the same superseded reconciliation key');
    const reenabled = (await client.query('SELECT id,"idempotencyKey",state FROM public.catalog_media_events WHERE id=$1', [original.id])).rows[0];
    assert.equal(reenabled.id, original.id);
    assert.equal(reenabled.idempotencyKey, original.idempotencyKey);
    assert.equal(reenabled.state, 'READY');
    assert.equal(await enqueue(), 0, 're-enabled event remains unique');

    await client.query(`UPDATE public.catalog_media_events SET state='PERMANENT_FAILURE',"attemptCount"=12,
      "lastErrorCode"='QA_DEAD_LETTER',"completedAt"=now() WHERE id=$1`, [original.id]);
    assert.equal(await enqueue(), 0, 'reconciliation does not reset permanent failures');
    assert.equal((await client.query('SELECT state FROM public.catalog_media_events WHERE id=$1', [original.id])).rows[0].state,
      'PERMANENT_FAILURE');

    // Prepare one current event for guarded publication. Vector is synthetic and proves SQL constraints only.
    const vector = `[1,${Array(255).fill('0').join(',')}]`;
    const alternateVector = `[0,1,${Array(254).fill('0').join(',')}]`;
    const publishId = crypto.randomUUID();
    await client.query(`UPDATE public.catalog_media_events SET state='READY',"attemptCount"=0,"completedAt"=NULL,
      "lastErrorCode"=NULL,"nextAttemptAt"=now() WHERE id=$1`, [original.id]);
    await roleTransaction(client, 'ai_media_worker', async () => {
      await client.query(`WITH selected AS (
        SELECT id FROM public.catalog_media_events WHERE id=$1 AND state='READY' FOR UPDATE SKIP LOCKED
      ) UPDATE public.catalog_media_events event SET state='CLAIMED',"attemptCount"=1,
        "claimedUntil"=clock_timestamp()+interval '120 seconds',"leaseToken"=$2,"updatedAt"=now()
        FROM selected WHERE event.id=selected.id`, [original.id, publishId]);
      const ok = (await client.query(`SELECT ai.publish_media_embedding($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::extensions.vector) AS ok`,
        [original.id, publishId, fixture.version, fixture.model, fixture.preprocess, fixture.artifact,
          fixture.image, fixture.product, fixture.revision, fixture.digest, vector])).rows[0].ok;
      assert.equal(ok, true, 'current source and exact active descriptor publish');
      assert.equal((await client.query(`UPDATE public.catalog_media_events SET state='COMPLETED',"completedAt"=now(),
        "claimedUntil"=NULL,"leaseToken"=NULL WHERE id=$1 AND state='CLAIMED' AND "leaseToken"=$2
        AND "claimedUntil">clock_timestamp()`, [original.id, publishId])).rowCount, 1);
    });
    currentPhase = 'publish-current-and-reconcile-completed-overlay';
    const overlay = (await client.query(`SELECT source_revision,source_sha256 FROM ai.media_image_embeddings
      WHERE embedding_version=$1 AND product_image_id=$2`, [fixture.version, fixture.image])).rows[0];
    assert.deepEqual([overlay.source_revision, overlay.source_sha256.trim()], [fixture.revision, fixture.digest]);

    // A completed reconcile row is reusable only after the exact active overlay is missing.
    await client.query('DELETE FROM ai.media_image_embeddings WHERE embedding_version=$1 AND product_image_id=$2',
      [fixture.version, fixture.image]);
    assert.equal(await enqueue(), 1, 'missing completed overlay is reconciled again');
    assert.equal(await enqueue(), 0, 'completed-overlay repair is still idempotent');
    const repairToken = crypto.randomUUID();
    await roleTransaction(client, 'ai_media_worker', async () => {
      const claimed = await client.query(`WITH selected AS (
        SELECT id FROM public.catalog_media_events WHERE id=$1 AND state='READY' FOR UPDATE SKIP LOCKED
      ) UPDATE public.catalog_media_events event SET state='CLAIMED',"attemptCount"=event."attemptCount"+1,
        "claimedUntil"=clock_timestamp()+interval '120 seconds',"leaseToken"=$2,"updatedAt"=now()
        FROM selected WHERE event.id=selected.id RETURNING event.id`, [original.id, repairToken]);
      assert.equal(claimed.rowCount, 1);
      assert.equal((await client.query(`SELECT ai.publish_media_embedding($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::extensions.vector) AS ok`,
        [original.id, repairToken, fixture.version, fixture.model, fixture.preprocess, fixture.artifact,
          fixture.image, fixture.product, fixture.revision, fixture.digest, vector])).rows[0].ok, true);
      await client.query(`UPDATE public.catalog_media_events SET state='COMPLETED',"completedAt"=now(),
        "claimedUntil"=NULL,"leaseToken"=NULL WHERE id=$1 AND "leaseToken"=$2`, [original.id, repairToken]);
    });

    currentPhase = 'reader-visibility';
    const nearest = async () => roleTransaction(client, 'ai_vector_reader', async () =>
      (await client.query(postgresNearestSql(), [fixture.version, fixture.version, vector, 5])).rows);
    assert.ok((await nearest()).some(row => row.product_id === fixture.product), 'reader sees exact current overlay');
    await client.query('UPDATE public.products SET "storefrontVisible"=false WHERE id=$1', [fixture.product]);
    assert.ok(!(await nearest()).some(row => row.product_id === fixture.product), 'reader excludes hidden source immediately');
    await client.query('UPDATE public.products SET "storefrontVisible"=true WHERE id=$1', [fixture.product]);

    const callPublish = async (args) => roleTransaction(client, 'ai_media_worker', async () =>
      (await client.query(`SELECT ai.publish_media_embedding($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::extensions.vector) AS ok`, args)).rows[0].ok);
    const probeEvent = async ({ revision = fixture.revision, digest = fixture.digest, token = crypto.randomUUID(), lease = true } = {}) => {
      const id = crypto.randomUUID();
      await client.query(`INSERT INTO public.catalog_media_events (id,"idempotencyKey","requestSha256","productId","productImageId",
        operation,"sourceRevision","sourceSha256",state,"attemptCount","nextAttemptAt","claimedUntil","leaseToken","createdAt","updatedAt")
        VALUES ($1,$2,$3,$4,$5,'RECONCILE',$6,$7,'CLAIMED',1,now(),
          CASE WHEN $8 THEN clock_timestamp()+interval '120 seconds' ELSE clock_timestamp()-interval '1 second' END,
          $9,now(),now())`,
      [id, `probe:${fixture.suffix}:${id}`, fixture.digest, fixture.product, fixture.image, revision, digest, lease, token]);
      if (!lease) {
        const expired = (await client.query('SELECT "claimedUntil"<=clock_timestamp() AS expired FROM public.catalog_media_events WHERE id=$1', [id])).rows[0].expired;
        assert.equal(expired, true, 'QA expired-lease fixture is older than the database clock');
      }
      return { id, token, revision, digest };
    };
    const expectFalse = async (label, args) => assert.equal(await callPublish(args), false, label);

    currentPhase = 'publication-rejections';
    const staleRevision = await probeEvent({ revision: crypto.randomUUID() });
    await expectFalse('stale source revision rejected', [staleRevision.id, staleRevision.token, fixture.version, fixture.model,
      fixture.preprocess, fixture.artifact, fixture.image, fixture.product, staleRevision.revision, staleRevision.digest, alternateVector]);
    const staleDigest = await probeEvent({ digest: 'b'.repeat(64) });
    await expectFalse('stale source digest rejected', [staleDigest.id, staleDigest.token, fixture.version, fixture.model,
      fixture.preprocess, fixture.artifact, fixture.image, fixture.product, staleDigest.revision, staleDigest.digest, alternateVector]);
    const expired = await probeEvent({ lease: false });
    await expectFalse('expired lease rejected', [expired.id, expired.token, fixture.version, fixture.model,
      fixture.preprocess, fixture.artifact, fixture.image, fixture.product, fixture.revision, fixture.digest, alternateVector]);
    const exchanged = await probeEvent();
    const replacementToken = crypto.randomUUID();
    await client.query('UPDATE public.catalog_media_events SET "leaseToken"=$1 WHERE id=$2', [replacementToken, exchanged.id]);
    await expectFalse('exchanged lease rejected', [exchanged.id, exchanged.token, fixture.version, fixture.model,
      fixture.preprocess, fixture.artifact, fixture.image, fixture.product, fixture.revision, fixture.digest, alternateVector]);

    const rejectedDescriptor = await probeEvent();
    await assert.rejects(callPublish([rejectedDescriptor.id, rejectedDescriptor.token, fixture.version, null,
      fixture.preprocess, fixture.artifact, fixture.image, fixture.product, fixture.revision, fixture.digest, alternateVector]),
    error => error.code === '40001');
    const wrongModel = await probeEvent();
    await assert.rejects(callPublish([wrongModel.id, wrongModel.token, fixture.version, `${fixture.model}-wrong`,
      fixture.preprocess, fixture.artifact, fixture.image, fixture.product, fixture.revision, fixture.digest, alternateVector]),
    error => error.code === '40001');
    const nonUnit = await probeEvent();
    const badVector = `[2,${Array(255).fill('0').join(',')}]`;
    await assert.rejects(callPublish([nonUnit.id, nonUnit.token, fixture.version, fixture.model, fixture.preprocess,
      fixture.artifact, fixture.image, fixture.product, fixture.revision, fixture.digest, badVector]),
    error => error.code === '23514');

    currentPhase = 'wrong-dimension-rejection';
    const wrongDimension = await probeEvent();
    await assert.rejects(roleTransaction(client, 'ai_media_worker', async () => client.query(
      `SELECT ai.publish_media_embedding($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::extensions.vector(255))`,
      [wrongDimension.id, wrongDimension.token, fixture.version, fixture.model, fixture.preprocess, fixture.artifact,
        fixture.image, fixture.product, fixture.revision, fixture.digest, `[1,${Array(254).fill('0').join(',')}]`])),
    error => ['22000', '42804'].includes(error.code));

    const preserved = await searchPathTransaction(client, async () => (await client.query(`
      SELECT source_revision,source_sha256,embedding <=> $3::vector AS distance
      FROM ai.media_image_embeddings WHERE embedding_version=$1 AND product_image_id=$2`,
    [fixture.version, fixture.image, vector])).rows[0]);
    assert.deepEqual([preserved.source_revision, preserved.source_sha256.trim()], [fixture.revision, fixture.digest]);
    assert.ok(Number(preserved.distance) < 0.001, 'rejected publications do not overwrite the current overlay vector');

    // Expired claims must be reclaimable under RLS, while exhausted crashes are bounded dead letters.
    currentPhase = 'worker-claim-policy';
    const expiredClaim = await probeEvent({ lease: false });
    const reclaimedToken = crypto.randomUUID();
    await roleTransaction(client, 'ai_media_worker', async () => {
      const result = await client.query(`WITH candidate AS (
          SELECT id FROM public.catalog_media_events WHERE id=$1 AND state='CLAIMED'
            AND "claimedUntil"<=clock_timestamp() FOR UPDATE SKIP LOCKED LIMIT 1
        ) UPDATE public.catalog_media_events event SET "attemptCount"=event."attemptCount"+1,
          "claimedUntil"=clock_timestamp()+interval '120 seconds',"leaseToken"=$2,"updatedAt"=now()
          FROM candidate WHERE event.id=candidate.id RETURNING event.id`, [expiredClaim.id, reclaimedToken]);
      assert.equal(result.rowCount, 1, 'worker policy allows expired CLAIMED lease reclaim');
    });
    const exhausted = await probeEvent({ lease: false });
    await client.query('UPDATE public.catalog_media_events SET "attemptCount"=12 WHERE id=$1', [exhausted.id]);
    await roleTransaction(client, 'ai_media_worker', async () => {
      await client.query(`WITH exhausted AS (
        SELECT id FROM public.catalog_media_events WHERE id=$1 AND state='CLAIMED'
          AND "claimedUntil"<=clock_timestamp() AND "attemptCount">=12
        FOR UPDATE SKIP LOCKED LIMIT 100
      ) UPDATE public.catalog_media_events event SET state='PERMANENT_FAILURE',"completedAt"=clock_timestamp(),
        "claimedUntil"=NULL,"leaseToken"=NULL,"lastErrorCode"='LEASE_EXHAUSTED',"updatedAt"=clock_timestamp()
        FROM exhausted WHERE event.id=exhausted.id`, [exhausted.id]);
    });
    assert.equal((await client.query('SELECT state,"lastErrorCode" FROM public.catalog_media_events WHERE id=$1', [exhausted.id])).rows[0].lastErrorCode,
      'LEASE_EXHAUSTED', 'expired max-attempt event transitions to a bounded terminal state');

    currentPhase = 'retirement-and-role-denials';
    await client.query('UPDATE public.product_images SET "mediaState"=\'RETIRED\',"retiredAt"=now(),"isPrimary"=false WHERE id=$1', [fixture.image]);
    assert.ok(!(await nearest()).some(row => row.product_id === fixture.product), 'reader excludes retired source immediately');

    await assert.rejects(roleTransaction(client, 'ai_media_worker', async () => client.query(
      'UPDATE ai.product_image_embeddings SET image_sha256=image_sha256 WHERE embedding_version=$1', [fixture.version])),
    error => error.code === '42501');
    await assert.rejects(roleTransaction(client, 'ai_media_worker', async () => client.query(
      'SELECT id FROM public.products LIMIT 0')), error => error.code === '42501');
    await assert.rejects(roleTransaction(client, 'ai_media_worker', async () => client.query(
      'UPDATE ai.active_index SET embedding_version=embedding_version WHERE singleton')), error => error.code === '42501');
    await assert.rejects(roleTransaction(client, 'ai_media_worker', async () => client.query(`
      INSERT INTO public.catalog_media_events (id,"idempotencyKey","requestSha256","productId","productImageId",operation,"updatedAt")
      VALUES (gen_random_uuid(),'forbidden-worker-insert',repeat('0',64),$1,$2,'RECONCILE',now())`,
    [fixture.product, fixture.image])), error => error.code === '42501');
    const baseCount = Number((await client.query('SELECT count(*) FROM ai.product_image_embeddings WHERE embedding_version=$1', [fixture.version])).rows[0].count);
    assert.equal(baseCount, 0, 'active base snapshot remains unchanged');

    completed = true;
    evidence = { result: 'PASS', database, tls: 'verify-full', evidence: 'synthetic 256D SQL guard vectors only; no inference',
      reconciliation: 'bounded/idempotent/hidden-reenabled/permanent-failure-preserved', publication: 'current-allowed/stale-lease-source-descriptor-vector-rejected',
      reader: 'hidden-and-retired-excluded', workerPolicy: 'expired-reclaim-and-max-attempt-dead-letter', baseSnapshot: 'unchanged' };
  } finally {
    if (fixtureCreated) {
      try {
        await client.query('BEGIN');
        await client.query('DELETE FROM public.catalog_media_events WHERE "productId"=$1', [fixture.product]);
        await client.query('DELETE FROM ai.media_image_embeddings WHERE product_id=$1 AND embedding_version=$2', [fixture.product, fixture.version]);
        await client.query('DELETE FROM ai.product_image_embeddings WHERE product_id=$1 AND embedding_version=$2', [fixture.product, fixture.version]);
        await client.query('DELETE FROM public.product_images WHERE id=$1 AND "productId"=$2', [fixture.image, fixture.product]);
        await client.query('DELETE FROM public.products WHERE id=$1 AND "categoryId"=$2', [fixture.product, fixture.category]);
        await client.query('DELETE FROM public.categories WHERE id=$1 AND slug=$2', [fixture.category, `overlay-qa-${fixture.suffix}`]);
        await client.query('DELETE FROM ai.active_index WHERE singleton AND embedding_version=$1', [fixture.version]);
        await client.query('DELETE FROM ai.model_versions WHERE embedding_version=$1 AND status IN (\'ACTIVE\',\'RETIRED\',\'VERIFIED\',\'STAGING\')', [fixture.version]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        if (!completed) throw new Error(`QA_FIXTURE_CLEANUP_FAILED (${error.code || error.name})`);
        throw error;
      }
    }
    await client.end().catch(() => {});
  }
  console.log(JSON.stringify(evidence));
}

main().catch(error => {
  const code = typeof error?.code === 'string' ? error.code : 'QA_FAILURE';
  const detail = typeof error?.message === 'string'
    ? error.message.replace(/postgres(?:ql)?:\/\/\S+/gi, '<redacted-url>').replace(/[\r\n]+/g, ' ').slice(0, 180)
    : 'unexpected error';
  const location = typeof error?.stack === 'string' ? error.stack.split('\n').slice(1, 3).join(' ').slice(0, 180) : '';
  console.error(`product-media-overlay-sql-qa: FAIL phase=${currentPhase} ${code}: ${detail}${location ? ` (${location})` : ''}`);
  process.exitCode = 1;
});
