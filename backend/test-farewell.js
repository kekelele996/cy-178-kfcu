// End-to-end check for farewell/sealed-thread behavior.
// Uses a throwaway SQLite file and a live Express server over HTTP.
process.env.SQLITE_PATH = require('path').join(__dirname, 'test-tmp', 'farewell_test.db');
process.env.PORT = '9199';

const http = require('http');

function request(port, method, path, body, token) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        port,
        method,
        path,
        headers: {
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        }
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode, body: data ? JSON.parse(data) : {} }));
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const assert = (cond, msg) => {
  if (!cond) {
    console.error(`✗ ${msg}`);
    process.exitCode = 1;
    throw new Error(msg);
  }
  console.log(`✓ ${msg}`);
};

// Deliver a random letter from A until one lands in B's inbox; return its id.
async function deliverFromAtoB(ta, tb, content) {
  for (let i = 0; i < 20; i++) {
    const r = await request(PORT, 'POST', '/api/letters', { content: content || `信 ${i}` }, ta);
    const inboxB = await request(PORT, 'GET', '/api/inbox', null, tb);
    if (inboxB.body.received.find((x) => x.id === r.body.id)) return r.body.id;
  }
  return null;
}

const PORT = 9199;

(async () => {
  require('./src/index.js');
  await new Promise((r) => setTimeout(r, 500));

  const a = await request(PORT, 'POST', '/api/auth/register', { penName: 't_a', password: 'pw' });
  const b = await request(PORT, 'POST', '/api/auth/register', { penName: 't_b', password: 'pw' });
  const ta = a.body.token;
  const tb = b.body.token;

  // ---- Basic happy path: reply, then farewell seals the thread ----
  const rootId = await deliverFromAtoB(ta, tb, '你好，陌生人');
  assert(rootId, '随机信件送达 B');

  const rep = await request(PORT, 'POST', `/api/letters/${rootId}/reply`, { content: '你好呀' }, tb);
  assert(rep.status === 200, '普通回复成功');

  let th = await request(PORT, 'GET', `/api/letters/${rootId}/thread`, null, ta);
  assert(th.body.sealed === false, '封存前 thread.sealed=false');

  const fw = await request(PORT, 'POST', `/api/letters/${rootId}/farewell`, { content: '愿你一切都好，再会' }, ta);
  assert(fw.status === 201, `告别信 201（实际 ${fw.status}）`);

  th = await request(PORT, 'GET', `/api/letters/${rootId}/thread`, null, ta);
  assert(th.body.sealed === true && th.body.sealedAt > 0, 'thread 返回 sealed=true');
  const last = th.body.messages[th.body.messages.length - 1];
  assert(last.farewell === true && last.content === '愿你一切都好，再会', '最后一条是告别信并带 farewell 标记');
  assert(th.body.messages.filter((m) => m.farewell).length === 1, '只有一封告别信');

  // Repeat farewell / reply after sealed -> 409 for both sides
  assert((await request(PORT, 'POST', `/api/letters/${rootId}/farewell`, { content: '还有话说' }, ta)).status === 409,
    'A 重复告别 -> 409');
  assert((await request(PORT, 'POST', `/api/letters/${rootId}/farewell`, { content: '我也说' }, tb)).status === 409,
    'B 事后告别 -> 409');
  assert((await request(PORT, 'POST', `/api/letters/${rootId}/reply`, { content: '再回' }, ta)).status === 409,
    'A 封存后回复 -> 409');
  assert((await request(PORT, 'POST', `/api/letters/${rootId}/reply`, { content: '我也回' }, tb)).status === 409,
    'B 封存后回复 -> 409');

  // Still viewable + favorite works for both sides
  const thB = await request(PORT, 'GET', `/api/letters/${rootId}/thread`, null, tb);
  assert(thB.status === 200 && thB.body.sealed === true && thB.body.messages.length === 3,
    'B 仍可回看完整对话（3 条）');
  const favB = await request(PORT, 'POST', `/api/letters/${rootId}/favorite`, {}, tb);
  assert(favB.status === 200 && favB.body.favorited === true, 'B 封存后仍可收藏');
  const favA = await request(PORT, 'POST', `/api/letters/${rootId}/favorite`, {}, ta);
  assert(favA.status === 200, 'A 封存后仍可收藏');

  // Inbox shows sealed in conversations for both
  const ca = (await request(PORT, 'GET', '/api/inbox', null, ta)).body.conversations.find((x) => x.id === rootId);
  const cb = (await request(PORT, 'GET', '/api/inbox', null, tb)).body.conversations.find((x) => x.id === rootId);
  assert(ca && ca.sealed === true, 'A 的信箱对话列表显示已封存');
  assert(cb && cb.sealed === true && cb.favorited === true, 'B 的信箱对话列表显示已封存且收藏保留');

  // Outsider cannot farewell / view
  const tc = (await request(PORT, 'POST', '/api/auth/register', { penName: 't_c', password: 'pw' })).body.token;
  assert((await request(PORT, 'POST', `/api/letters/${rootId}/farewell`, { content: '外人' }, tc)).status === 403,
    '外人告别 -> 403');
  assert((await request(PORT, 'GET', `/api/letters/${rootId}/thread`, null, tc)).status === 403,
    '外人查看 -> 403');

  // ---- Races: reply and farewell arrive in the same instant ----
  // The server parses requests in the order their client call objects are
  // created (socket connect order), so creating one first deterministically
  // makes it the "first arrival". We exercise both orderings. Invariant for
  // every round: exactly one commit, the loser gets 409.
  const ROUNDS = 20;
  for (let round = 0; round < ROUNDS; round++) {
    const farewellFirst = round % 2 === 0;
    const rid = await deliverFromAtoB(ta, tb, `撞车第 ${round} 轮`);
    assert(rid, `第 ${round + 1} 轮：随机信件送达 B`);
    assert((await request(PORT, 'POST', `/api/letters/${rid}/reply`, { content: '聊起来' }, tb)).status === 200,
      `第 ${round + 1} 轮：开场回复成功`);

    // Create the call object that must win FIRST (its socket connects first).
    const firstCall = farewellFirst
      ? request(PORT, 'POST', `/api/letters/${rid}/farewell`, { content: '再见' }, ta)
      : request(PORT, 'POST', `/api/letters/${rid}/reply`, { content: '等等' }, tb);
    const secondCall = farewellFirst
      ? request(PORT, 'POST', `/api/letters/${rid}/reply`, { content: '等等' }, tb)
      : request(PORT, 'POST', `/api/letters/${rid}/farewell`, { content: '再见' }, ta);
    const [firstRes, secondRes] = await Promise.all([firstCall, secondCall]);
    const fwRes = farewellFirst ? firstRes : secondRes;
    const replyRes = farewellFirst ? secondRes : firstRes;

    const t = await request(PORT, 'GET', `/api/letters/${rid}/thread`, null, ta);
    if (farewellFirst) {
      assert(fwRes.status === 201 && replyRes.status === 409,
        `第 ${round + 1} 轮：告别先到写入(201)、回复 409（实际 ${fwRes.status}/${replyRes.status}）`);
      assert(t.body.sealed === true && t.body.messages.length === 3,
        `第 ${round + 1} 轮：仅告别写入且已封存（3 条）`);
      assert(t.body.messages[2].farewell === true, `第 ${round + 1} 轮：末条是告别信`);
    } else {
      assert(replyRes.status === 200 && fwRes.status === 409,
        `第 ${round + 1} 轮：回复先到写入(200)、告别 409（实际 reply=${replyRes.status}, fw=${fwRes.status}）`);
      assert(t.body.sealed === false && t.body.messages.length === 3,
        `第 ${round + 1} 轮：仅回复写入，对话未封存（3 条）`);
      assert(t.body.messages[2].content === '等等', `第 ${round + 1} 轮：末条是先到的回复`);

      // A deliberate later farewell (after the same-burst slot releases) seals it
      const fwLater = await request(PORT, 'POST', `/api/letters/${rid}/farewell`, { content: '正式告别' }, ta);
      assert(fwLater.status === 201, `第 ${round + 1} 轮：落败后顺序告别成功（实际 ${fwLater.status}）`);
      const t2 = await request(PORT, 'GET', `/api/letters/${rid}/thread`, null, ta);
      assert(t2.body.sealed === true && t2.body.messages.length === 4,
        `第 ${round + 1} 轮：随后封存成功（4 条）`);
      assert((await request(PORT, 'POST', `/api/letters/${rid}/reply`, { content: '迟到回复' }, tb)).status === 409,
        `第 ${round + 1} 轮：封存后回复 409`);
    }
  }

  // ---- Quick sequential reply then farewell must NOT be treated as a race ----
  const ridSeq = await deliverFromAtoB(ta, tb, '快速顺序');
  await request(PORT, 'POST', `/api/letters/${ridSeq}/reply`, { content: '回一句' }, tb);
  const fwSeq = await request(PORT, 'POST', `/api/letters/${ridSeq}/farewell`, { content: '随后告别' }, ta);
  assert(fwSeq.status === 201,
    `快速顺序的告别不被误判为撞车（实际 ${fwSeq.status}：${fwSeq.body.error || ''}）`);
  assert((await request(PORT, 'GET', `/api/letters/${ridSeq}/thread`, null, ta)).body.sealed === true,
    '快速顺序告别后对话已封存');

  console.log('\n全部断言通过');
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
