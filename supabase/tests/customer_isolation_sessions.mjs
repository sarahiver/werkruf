import { createClient } from '@supabase/supabase-js';
import assert from 'node:assert/strict';

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anonKey || !serviceKey) {
  throw new Error('SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are required');
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
const suffix = crypto.randomUUID();
const password = `Isolation-${crypto.randomUUID()}!`;
const users = [];

async function createSession(label) {
  const email = `isolation-${label}-${suffix}@example.invalid`;
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
  });
  assert.ifError(createError);
  users.push(created.user.id);
  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  assert.ifError(error);
  assert.ok(data.session?.access_token);
  return { client, user: created.user, token: data.session.access_token };
}

async function edge(session, path, body, functionName = 'google-business') {
  return fetch(`${url}/functions/v1/${functionName}/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.token}`,
      apikey: anonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

const ids = {
  accountA: crypto.randomUUID(), accountB: crypto.randomUUID(),
  locationA: crypto.randomUUID(), locationB: crypto.randomUUID(),
  reviewA: crypto.randomUUID(), reviewB: crypto.randomUUID(),
  replyA: crypto.randomUUID(), replyB: crypto.randomUUID(),
};

try {
  const [a, b] = await Promise.all([createSession('a'), createSession('b')]);
  assert.ifError((await admin.from('user_profiles').upsert([
    { id: a.user.id, plan: 'pro', setup_fee_paid: true },
    { id: b.user.id, plan: 'pro', setup_fee_paid: true },
  ])).error);
  assert.ifError((await admin.from('google_accounts').insert([
    { id: ids.accountA, user_id: a.user.id, provider_account_id: `a-${suffix}`, status: 'active' },
    { id: ids.accountB, user_id: b.user.id, provider_account_id: `b-${suffix}`, status: 'active' },
  ])).error);
  assert.ifError((await admin.from('google_locations').insert([
    { id: ids.locationA, account_id: ids.accountA, user_id: a.user.id, account_resource_name: 'accounts/a', location_resource_name: 'locations/a', title: 'A' },
    { id: ids.locationB, account_id: ids.accountB, user_id: b.user.id, account_resource_name: 'accounts/b', location_resource_name: 'locations/b', title: 'B' },
  ])).error);
  assert.ifError((await admin.from('google_reviews').insert([
    { id: ids.reviewA, location_id: ids.locationA, account_id: ids.accountA, user_id: a.user.id, review_resource_name: 'reviews/a', star_rating: 5, google_created_at: new Date().toISOString() },
    { id: ids.reviewB, location_id: ids.locationB, account_id: ids.accountB, user_id: b.user.id, review_resource_name: 'reviews/b', star_rating: 4, google_created_at: new Date().toISOString() },
  ])).error);
  assert.ifError((await admin.from('review_replies').insert([
    { id: ids.replyA, review_id: ids.reviewA, location_id: ids.locationA, user_id: a.user.id, body: 'A', status: 'draft' },
    { id: ids.replyB, review_id: ids.reviewB, location_id: ids.locationB, user_id: b.user.id, body: 'B', status: 'draft' },
  ])).error);
  assert.ifError((await admin.from('oauth_tokens').insert({ account_id: ids.accountA, user_id: a.user.id })).error);

  for (const [actor, ownerLabel, foreign] of [
    [a, 'B', { account: ids.accountB, location: ids.locationB, review: ids.reviewB, reply: ids.replyB }],
    [b, 'A', { account: ids.accountA, location: ids.locationA, review: ids.reviewA, reply: ids.replyA }],
  ]) {
    for (const [table, foreignId] of [
      ['google_accounts', foreign.account], ['google_locations', foreign.location],
      ['google_reviews', foreign.review], ['review_replies', foreign.reply],
    ]) {
      const read = await actor.client.from(table).select('id').eq('id', foreignId);
      assert.ifError(read.error);
      assert.equal(read.data.length, 0, `${actor.user.id} read ${ownerLabel} row in ${table}`);
      const changed = await actor.client.from(table).update({ user_id: actor.user.id }).eq('id', foreignId).select('id');
      assert.ok(changed.error || changed.data.length === 0,
        `${actor.user.id} changed ${ownerLabel} row in ${table}`);
    }
  }

  assert.ok((await a.client.from('oauth_tokens').select('*')).error, 'OAuth tokens were client-readable');
  assert.ok((await a.client.from('user_profiles').update({ plan: 'free' }).eq('id', a.user.id)).error,
    'Customer changed own plan');
  assert.ok((await a.client.from('user_profiles').update({ setup_fee_paid: false }).eq('id', a.user.id)).error,
    'Customer changed own billing flag');

  for (const [path, body] of [
    ['disconnect', { connectionId: ids.accountB }],
    ['location/select', { locationId: ids.locationB }],
    ['sync/trigger', { locationId: ids.locationB }],
    ['replies/update', { replyId: ids.replyB, body: 'tampered' }],
  ]) {
    const response = await edge(a, path, body);
    assert.equal(response.status, 404, `${path} leaked or accepted a foreign id (${response.status})`);
  }
  const foreignReview = await edge(a, '', {
    reviewId: ids.reviewB, reviewText: 'foreign', reviewerName: 'foreign', rating: 4,
  }, 'generate-review-reply');
  assert.equal(foreignReview.status, 404,
    `generate-review-reply leaked or accepted a foreign review id (${foreignReview.status})`);

  console.log('Two authenticated sessions remained isolated across REST and Edge routes.');
} finally {
  await admin.from('review_replies').delete().in('id', [ids.replyA, ids.replyB]);
  await admin.from('google_reviews').delete().in('id', [ids.reviewA, ids.reviewB]);
  await admin.from('oauth_tokens').delete().eq('account_id', ids.accountA);
  await admin.from('google_locations').delete().in('id', [ids.locationA, ids.locationB]);
  await admin.from('google_accounts').delete().in('id', [ids.accountA, ids.accountB]);
  for (const id of users) await admin.auth.admin.deleteUser(id);
}
