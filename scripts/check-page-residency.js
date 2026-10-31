const fs = require('node:fs'), path = require('node:path'), ts = require('typescript'), vm = require('node:vm'), assert = require('node:assert/strict');
const { loadSource } = require('./load-source');
const source = fs.readFileSync(path.resolve(__dirname, '../main.ts'), 'utf8');
const tree = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
const cls = tree.statements.find(n => ts.isClassDeclaration(n) && n.name?.text === 'NativePdfAnnotatorSession');
const names = ['updateVisiblePageRange', 'reconcileWarmPageResidency', 'scheduleWarmPageEviction', 'getPageRetainedCost'];
const methods = names.map(name => cls.members.find(n => n.name?.getText(tree) === name)?.getText(tree) || '').join('\n');
let now = 100;
const context = { PAGE_VIRTUALIZATION_MARGIN: 0, performance: { now: () => now } };
vm.runInNewContext(ts.transpileModule('class Session {' + methods + '} globalThis.Session = Session;', { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, context);
const released = [], queued = [];
const surface = () => ({ overlayEl: { width: 1, height: 1, setCssStyles() {} }, transientEl: { width: 1, height: 1 }, vectorEl: {}, hostEl: { isConnected: true } });
const session = new context.Session();
let near = 1;
const windows = { next: 0, callbacks: new Map(), setTimeout(fn) { const id = ++this.next; this.callbacks.set(id, fn); return id; }, clearTimeout(id) { this.callbacks.delete(id); } };
Object.assign(session, { ownerWindow: windows, pageSurfaces: new Map([[1, surface()], [2, surface()]]), scrollParent: {}, visiblePageRange: { start: 2, end: 2 }, pageRenderSlots: new Map(), pointerPage: null, inlineTextPageNumber: null, currentPage: 1,
 isPageNearViewport: n => n === near, shouldKeepPageHot: n => n === near,
 svgRenderer: { hasCommittedFrame: () => true, getRetainedCost: () => ({ nodes: 850, bytes: 850 * 900 }) }, cancelPageRenderJob() {},
 releasePageCanvasResources(n) { released.push(n); this.pageResidency?.forget(n); }, schedulePageRedraw: n => queued.push(n), hasActiveTransientRender: () => false,
});
try { const { PageResidencyCache } = loadSource('src/render/pageResidencyCache.ts'); session.pageResidency = new PageResidencyCache(); } catch (e) { if (e.code !== 'ENOENT') throw e; }
session.updateVisiblePageRange();
assert.deepEqual(released, [], 'A recently viewed complete SVG page must remain mounted for warm backtracking instead of being released immediately');
near = 2; session.currentPage = 2; session.updateVisiblePageRange();
assert.deepEqual(released, [], 'Revisiting the warm page must retain its committed frame');
console.log('Recently viewed committed pages survive backtracking.');

const { PageResidencyCache } = loadSource('src/render/pageResidencyCache.ts');
assert.equal(session.pageResidency.has(2), false, 'Returning visible pages must leave the warm-only accounting');
assert.equal(session.pageResidency.has(1), true);
now += 12001; session.reconcileWarmPageResidency();
assert.deepEqual(released, [1], 'Expired pages must release their vector geometry even with 1×1 raster canvases');
const cache = new PageResidencyCache(1000, 1200, 2, 100);
cache.retain(1, { nodes: 300, bytes: 200 }, 0); cache.retain(2, { nodes: 300, bytes: 200 }, 1); cache.retain(3, { nodes: 300, bytes: 200 }, 2);
assert.deepEqual(Array.from(cache.trim(3)), [1], 'Page limit must evict the least recently visited page');
cache.retain(4, { nodes: 900, bytes: 900 }, 4);
assert.deepEqual(Array.from(cache.trim(5)), [2, 3], 'The cumulative byte/node budgets must evict older pages');
cache.retain(5, { nodes: 2000, bytes: 10 }, 6);
assert.deepEqual(Array.from(cache.trim(7)), [5], 'A page above the object budget must not be retained');
cache.retain(6, { nodes: 10, bytes: Infinity }, 8); assert.deepEqual(Array.from(cache.trim(9)), [6]);
assert.deepEqual(Array.from(cache.trim(105)), [4]);
cache.retain(7, { nodes: 1, bytes: 1 }, 106); cache.retain(7, { nodes: 1, bytes: 1 }, 200);
assert.equal(cache.nextExpiry(), 206, 'Scroll callbacks must not keep offscreen pages alive forever');
cache.forget(7); assert.equal(cache.nextExpiry(), null);

// Actual session policy must protect a partially visible page and an offscreen text editor.
released.length = 0; session.pageResidency.clear(); now = 100;
session.inlineTextPageNumber = 1; session.reconcileWarmPageResidency();
assert.equal(session.pageResidency.has(1), false, 'The page with an active editor must never be evicted');
session.inlineTextPageNumber = null; session.shouldKeepPageHot = () => false;
session.reconcileWarmPageResidency(); assert.equal(session.pageResidency.has(2), false, 'Partial actual viewport intersection must override a stale cached range');
now += 12001;
session.pointerPage = 1; session.shouldKeepPageHot = n => n === session.pointerPage;
session.reconcileWarmPageResidency(); assert.equal(released.includes(1), false, 'Input pages must be protected at the eviction deadline');

// Expiration defers repeatedly while input stays active, and teardown owns its timer.
session.pointerPage = null; session.shouldKeepPageHot = () => false; now = 30000;
session.reconcileWarmPageResidency();
let active = true; session.hasActiveTransientRender = () => active;
const tick = () => { const id = session.pageResidencyEvictionHandle; const callback = windows.callbacks.get(id); windows.callbacks.delete(id); callback(); };
const beforeRelease = released.length;
tick(); tick(); assert.equal(released.length, beforeRelease, 'Warm expiry must not destroy resources during continuous input');
active = false; now += 13000; tick(); assert.ok(released.length > beforeRelease);
assert.ok(source.includes('this.ownerWindow.clearTimeout(this.pageResidencyEvictionHandle)'));
assert.ok(source.includes('this.pageResidency.clear();'));
console.log('Warm cache budgets, expiration, partial visibility, editor/input protection and repeated input deferral passed.');
