// @ts-check
// Acceptance tests for rpc_delivery_add_bag + rpc_delivery_swap_bag
// Be-PM: committed BEFORE implementation — tests define the contract
const { test, expect } = require('@playwright/test');

/** Helper: call Supabase RPC via PostgREST from page context */
async function callRpc(page, rpcName, params) {
  return page.evaluate(async ({ rpcName, params }) => {
    const sb = window.NNTN_SB_URL;
    const tok = localStorage.getItem('nntn_sb_token');
    const res = await fetch(`${sb}/rest/v1/rpc/${rpcName}`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + tok,
        apikey: window.NNTN_SB_ANON,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(params)
    });
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
  }, { rpcName, params });
}

/** Helper: query Supabase REST from page context (supports schema prefix e.g. 'stock/deliveries') */
async function query(page, table, params) {
  return page.evaluate(async ({ table, params }) => {
    const sb = window.NNTN_SB_URL;
    const tok = localStorage.getItem('nntn_sb_token');
    const q = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
    const parts = table.split('/');
    const schema = parts.length > 1 ? parts[0] : null;
    const tbl = parts.length > 1 ? parts.slice(1).join('/') : table;
    const h = { Authorization: 'Bearer ' + tok, apikey: window.NNTN_SB_ANON };
    if (schema) { h['Accept-Profile'] = schema; }
    const res = await fetch(`${sb}/rest/v1/${tbl}?${q}`, { headers: h });
    return res.json();
  }, { table, params });
}

test.describe('Adjust delivery RPCs', () => {
  test.describe.configure({ mode: 'serial', timeout: 45_000 });
  test.beforeEach(async ({ page }) => {
    await page.goto('hub-delivery.html');
    await page.waitForLoadState('networkidle', { timeout: 15_000 });
  });

  // ═══════════════════════════════════════════════════════════════
  // rpc_delivery_add_bag
  // ═══════════════════════════════════════════════════════════════

  test('add_bag · rejects reason < 10 chars', async ({ page }) => {
    const r = await callRpc(page, 'rpc_delivery_add_bag', {
      p_actor: 'test',
      p_delivery_id: '00000000-0000-0000-0000-000000000000',
      p_cw_id: 1,
      p_reason: 'short'
    });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(r.body)).toContain('reason');
  });

  test('add_bag · rejects bag not In Stock', async ({ page }) => {
    // Find a Delivered bag (should exist if any delivery has been made)
    const delivered = await query(page, 'catch_weight', {
      status: 'eq.🚚 Delivered',
      select: 'id',
      limit: '1'
    });
    if (!delivered?.[0]?.id) return test.skip();

    // Find a recent delivery
    const dels = await query(page, 'stock/deliveries', {
      select: 'id',
      order: 'created_at.desc',
      limit: '1'
    });
    if (!dels?.[0]?.id) return test.skip();

    const r = await callRpc(page, 'rpc_delivery_add_bag', {
      p_actor: 'playwright-test',
      p_delivery_id: dels[0].id,
      p_cw_id: delivered[0].id,
      p_reason: 'test: bag should not be In Stock'
    });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(r.body)).toContain('not In Stock');
  });

  test('add_bag · success + verify status + cleanup', async ({ page }) => {
    // Find a recent delivery (within 24hr)
    const dels = await query(page, 'stock/deliveries', {
      select: 'id,created_at',
      order: 'created_at.desc',
      limit: '5'
    });
    const recent = dels?.find(d => {
      const age = Date.now() - new Date(d.created_at).getTime();
      return age < 24 * 60 * 60 * 1000;
    });
    if (!recent) { test.skip(); return; }

    // Find an In Stock bag not already in this delivery
    const bags = await query(page, 'catch_weight', {
      status: 'eq.✅ In Stock',
      select: 'id,item_id,weight_g',
      limit: '1'
    });
    if (!bags?.[0]?.id) { test.skip(); return; }

    const bag = bags[0];

    // Call add_bag
    const r = await callRpc(page, 'rpc_delivery_add_bag', {
      p_actor: 'playwright-test',
      p_delivery_id: recent.id,
      p_cw_id: bag.id,
      p_reason: 'playwright acceptance test · add bag'
    });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.cw_id).toBe(bag.id);
    expect(r.body.sm_id).toBeTruthy();

    // Verify bag status changed to Delivered
    const after = await query(page, 'catch_weight', {
      id: `eq.${bag.id}`,
      select: 'status'
    });
    expect(after[0].status).toBe('🚚 Delivered');

    // Cleanup: reverse the bag back to In Stock
    const rev = await callRpc(page, 'rpc_delivery_reverse', {
      p_actor: 'playwright-cleanup',
      p_cw_id: bag.id,
      p_reason: 'playwright cleanup · undo add_bag test'
    });
    expect(rev.status).toBe(200);
    expect(rev.body.ok).toBe(true);
  });

  // ═══════════════════════════════════════════════════════════════
  // rpc_delivery_swap_bag
  // ═══════════════════════════════════════════════════════════════

  test('swap_bag · rejects old bag not Delivered', async ({ page }) => {
    // Find an In Stock bag (wrong status for old_cw)
    const inStock = await query(page, 'catch_weight', {
      status: 'eq.✅ In Stock',
      select: 'id',
      limit: '2'
    });
    if (!inStock || inStock.length < 2) { test.skip(); return; }

    const r = await callRpc(page, 'rpc_delivery_swap_bag', {
      p_actor: 'playwright-test',
      p_old_cw_id: inStock[0].id,
      p_new_cw_id: inStock[1].id,
      p_reason: 'test: old bag should be Delivered'
    });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(r.body)).toContain('not Delivered');
  });

  test('swap_bag · rejects new bag not In Stock', async ({ page }) => {
    // Find two Delivered bags
    const delivered = await query(page, 'catch_weight', {
      status: 'eq.🚚 Delivered',
      select: 'id',
      limit: '2'
    });
    if (!delivered || delivered.length < 2) { test.skip(); return; }

    const r = await callRpc(page, 'rpc_delivery_swap_bag', {
      p_actor: 'playwright-test',
      p_old_cw_id: delivered[0].id,
      p_new_cw_id: delivered[1].id,
      p_reason: 'test: new bag should be In Stock'
    });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(r.body)).toContain('not In Stock');
  });

  test('swap_bag · success + verify both statuses + cleanup', async ({ page }) => {
    // Find a Delivered bag that has a delivery_line (within 24hr delivery)
    const deliveredBags = await query(page, 'catch_weight', {
      status: 'eq.🚚 Delivered',
      select: 'id,item_id'
    });
    if (!deliveredBags?.length) { test.skip(); return; }

    // Check which ones belong to recent deliveries
    let oldBag = null;
    for (const bag of deliveredBags.slice(0, 10)) {
      const dl = await query(page, 'stock/delivery_lines', {
        catch_weight_id: `eq.${bag.id}`,
        select: 'delivery_id,deliveries:delivery_id(created_at)'
      });
      if (dl?.[0]?.deliveries?.created_at) {
        const age = Date.now() - new Date(dl[0].deliveries.created_at).getTime();
        if (age < 24 * 60 * 60 * 1000) {
          oldBag = bag;
          break;
        }
      }
    }
    if (!oldBag) { test.skip(); return; }

    // Find an In Stock bag to swap in
    const newBags = await query(page, 'catch_weight', {
      status: 'eq.✅ In Stock',
      select: 'id',
      limit: '1'
    });
    if (!newBags?.[0]?.id) { test.skip(); return; }

    const newBag = newBags[0];

    // Call swap
    const r = await callRpc(page, 'rpc_delivery_swap_bag', {
      p_actor: 'playwright-test',
      p_old_cw_id: oldBag.id,
      p_new_cw_id: newBag.id,
      p_reason: 'playwright acceptance test · swap bag'
    });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.old_cw_id).toBe(oldBag.id);
    expect(r.body.new_cw_id).toBe(newBag.id);
    expect(r.body.sm_reverse_id).toBeTruthy();
    expect(r.body.sm_deliver_id).toBeTruthy();

    // Verify: old bag is now In Stock
    const oldAfter = await query(page, 'catch_weight', {
      id: `eq.${oldBag.id}`,
      select: 'status'
    });
    expect(oldAfter[0].status).toBe('✅ In Stock');

    // Verify: new bag is now Delivered
    const newAfter = await query(page, 'catch_weight', {
      id: `eq.${newBag.id}`,
      select: 'status'
    });
    expect(newAfter[0].status).toBe('🚚 Delivered');

    // Cleanup: swap back
    const rev = await callRpc(page, 'rpc_delivery_swap_bag', {
      p_actor: 'playwright-cleanup',
      p_old_cw_id: newBag.id,
      p_new_cw_id: oldBag.id,
      p_reason: 'playwright cleanup · undo swap_bag test'
    });
    expect(rev.status).toBe(200);
    expect(rev.body.ok).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// Adjust UI tab tests
// ═══════════════════════════════════════════════════════════════
test.describe('Adjust UI tab', () => {
  test('adjust tab exists and loads', async ({ page }) => {
    await page.goto('hub-delivery.html');
    await page.waitForLoadState('networkidle', { timeout: 15_000 });

    const adjBtn = page.locator('#tab-btn-adjust');
    if (await adjBtn.count() === 0) { test.skip(); return; }

    await expect(adjBtn).toContainText('ปรับแก้');
    await adjBtn.click();
    const adjPane = page.locator('#tab-adjust');
    await expect(adjPane).toHaveClass(/active/);

    await page.waitForSelector('#adjust-list :not(.loading)', { timeout: 15_000 });
    await expect(page.locator('#adjust-list .loading')).toHaveCount(0);
  });

  test('adjust tab shows 24hr banner', async ({ page }) => {
    await page.goto('hub-delivery.html');
    await page.waitForLoadState('networkidle', { timeout: 15_000 });

    const adjBtn = page.locator('#tab-btn-adjust');
    if (await adjBtn.count() === 0) { test.skip(); return; }

    await adjBtn.click();
    const banner = page.locator('#tab-adjust .info-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('24 ชั่วโมง');
  });
});
