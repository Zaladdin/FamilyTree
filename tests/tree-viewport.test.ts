import test from "node:test";
import assert from "node:assert/strict";
import { fitTreeViewport, focusTreeViewport, minimapScenePoint, normalizeTreeScale, TREE_MAX_SCALE, TREE_MIN_SCALE, zoomAroundCenter } from "@/lib/tree-viewport";
import { buildFamilyTreeLayout } from "@/lib/family-utils";
import { buildFamilyOverviewLayout } from "@/lib/family-overview-layout";
import { buildFamilyDisplayLayout } from "@/lib/family-display-layout";
import { buildFamilyPyramidLayout } from "@/lib/family-pyramid-layout";
import { getFamilyBySlug } from "@/lib/mock-data";

test("minimap clicks account for letterboxing in wide and tall pyramid diagrams", () => {
  const box = { left: 10, top: 20, width: 100, height: 100 };
  assert.deepEqual(minimapScenePoint({ x: 60, y: 45 }, box, { width: 200, height: 100 }), { x: 100, y: 0 });
  assert.deepEqual(minimapScenePoint({ x: 35, y: 70 }, box, { width: 100, height: 200 }), { x: 0, y: 100 });
  assert.deepEqual(minimapScenePoint({ x: 85, y: 120 }, box, { width: 100, height: 200 }), { x: 100, y: 200 });
  assert.deepEqual(minimapScenePoint({ x: 1000, y: -10 }, box, { width: 100, height: 100 }), { x: 100, y: 0 });
  assert.deepEqual(minimapScenePoint({ x: 60, y: 70 }, { ...box, width: 0 }, { width: 200, height: 100 }), { x: 100, y: 50 });
});

test("pyramid fit preserves its complete apex and widening outline on desktop and mobile", () => {
  const family = getFamilyBySlug("akhmedov")!;
  for (const viewport of [{ width: 850, height: 660 }, { width: 290, height: 545 }]) {
    const layout = buildFamilyPyramidLayout(family, "timur");
    const fit = fitTreeViewport(viewport, layout);
    const points = [{ x: layout.width / 2, y: 48 }, ...layout.pyramidLevels.flatMap((level) => [
      { x: layout.width / 2 - level.halfWidth, y: level.y }, { x: layout.width / 2 + level.halfWidth, y: level.y },
    ])];
    for (const point of points) {
      assert.ok(fit.x + point.x * fit.scale >= 24 - 0.01, "pyramid outline clears left edge");
      assert.ok(fit.x + point.x * fit.scale <= viewport.width - 24 + 0.01, "pyramid outline clears right edge");
      assert.ok(fit.y + point.y * fit.scale >= 56 - 0.01, "pyramid apex clears top edge");
      assert.ok(fit.y + point.y * fit.scale <= viewport.height - 56 + 0.01, "pyramid base clears bottom edge");
    }
    for (const node of layout.nodes) {
      const radius = (node.size ?? layout.nodeSize) / 2;
      assert.ok(fit.y + (node.y - radius) * fit.scale >= 0);
      assert.ok(fit.y + (node.y + radius) * fit.scale <= viewport.height);
    }
    const selected = focusTreeViewport(viewport, layout, "timur");
    assert.equal(selected.scale, 1, "selecting a person still zooms into the card");
  }
});

test("fits a three-generation branch inside a desktop canvas", () => {
  const family = getFamilyBySlug("akhmedov");
  assert.ok(family);
  const layout = buildFamilyTreeLayout(family, "timur");
  const viewport = { width: 850, height: 660 };
  const fit = fitTreeViewport(viewport, layout);
  for (const node of layout.nodes) {
    assert.ok(fit.x + (node.x - layout.nodeSize / 2) * fit.scale >= 0);
    assert.ok(fit.x + (node.x + layout.nodeSize / 2) * fit.scale <= viewport.width);
    assert.ok(fit.y + (node.y - layout.nodeSize / 2) * fit.scale >= 0);
    assert.ok(fit.y + (node.y + layout.nodeSize / 2) * fit.scale <= viewport.height);
  }
});

test("circular family fits desktop and mobile without clipping and still zooms selected people", () => {
  const family = getFamilyBySlug("akhmedov");
  assert.ok(family);
  for (const viewport of [{ width: 850, height: 660 }, { width: 290, height: 545 }]) {
    for (const perspective of [null, "timur", "magomed"]) {
      for (const close of [false, true]) {
        const layout = buildFamilyDisplayLayout(family, perspective, close);
        const fit = fitTreeViewport(viewport, layout);
        for (const node of layout.nodes) {
          const radius = (node.size ?? layout.nodeSize) / 2;
          assert.ok(fit.x + (node.x - radius) * fit.scale >= 24);
          assert.ok(fit.x + (node.x + radius) * fit.scale <= viewport.width - 24);
          assert.ok(fit.y + (node.y - radius) * fit.scale >= 0);
          assert.ok(fit.y + (node.y + radius) * fit.scale <= viewport.height);
        }
        if (perspective) {
          const focus = layout.nodes.find((node) => node.isFocus)!;
          const selected = focusTreeViewport(viewport, layout, perspective);
          assert.equal(selected.scale, 1);
          assert.equal(selected.x + focus.x * selected.scale, viewport.width / 2);
          assert.equal(selected.y + focus.y * selected.scale, (viewport.height - 40) / 2);
        }
      }
    }
  }
});

test("fit keeps single-person cards at natural size and bounds tiny viewports", () => {
  assert.equal(fitTreeViewport({ width: 1000, height: 660 }, { width: 488, height: 488, nodeSize: 188 }).scale, 1);
  const small = fitTreeViewport({ width: 320, height: 540 }, { width: 1220, height: 988, nodeSize: 188 });
  assert.ok(small.scale < 0.35 && small.scale >= TREE_MIN_SCALE);
  assert.ok((1220 - 300) * small.scale <= 320 - 48);
  assert.ok((988 - 300) * small.scale <= 540 - 112);
  assert.ok(Number.isFinite(small.x) && Number.isFinite(small.y));
});

test("fits five disconnected family members inside a 290px mobile canvas", () => {
  const family = getFamilyBySlug("akhmedov");
  assert.ok(family);
  const layout = buildFamilyOverviewLayout({ ...family, people: family.people.slice(0, 5), relationships: [] }, null);
  const viewport = { width: 290, height: 545 };
  const fit = fitTreeViewport(viewport, layout);

  assert.equal(layout.nodes.length, 5);
  assert.ok(fit.scale < 0.35);
  assert.equal(normalizeTreeScale(fit.scale), fit.scale, "controllers must retain the exact fitted scale");
  for (const node of layout.nodes) {
    const radius = (node.size ?? layout.nodeSize) / 2;
    assert.ok(fit.x + (node.x - radius) * fit.scale >= 24);
    assert.ok(fit.x + (node.x + radius) * fit.scale <= viewport.width - 24);
    assert.ok(fit.y + (node.y - radius) * fit.scale >= 0);
    assert.ok(fit.y + (node.y + radius) * fit.scale <= viewport.height);
  }
});

test("fit rounds down for wide diagrams and keeps a positive safety floor", () => {
  const viewport = { width: 290, height: 545 };
  const diagram = { width: 10_100, height: 488, nodeSize: 188 };
  const fit = fitTreeViewport(viewport, diagram);

  assert.ok(fit.scale < 0.03);
  assert.ok((diagram.width - 300) * fit.scale <= viewport.width - 48);
  const tiny = fitTreeViewport({ width: 1, height: 1 }, diagram);
  assert.equal(tiny.scale, TREE_MIN_SCALE);
  assert.ok(Number.isFinite(tiny.x) && Number.isFinite(tiny.y));
});

test("zoom controls remain monotonic below 35% and share their fit limits", () => {
  const fitted = 0.1263;
  assert.equal(normalizeTreeScale(fitted), fitted);
  assert.equal(normalizeTreeScale(fitted + 0.1), 0.2263);
  assert.equal(normalizeTreeScale(fitted - 0.1), 0.0263);
  assert.equal(normalizeTreeScale(TREE_MIN_SCALE - 0.1), TREE_MIN_SCALE);
  assert.equal(normalizeTreeScale(TREE_MAX_SCALE + 0.1), TREE_MAX_SCALE);
  assert.equal(normalizeTreeScale(Number.NaN), 1);
});

test("zoom preserves the scene point at the viewport centre", () => {
  const viewport = { width: 850, height: 660 };
  const before = { x: -100, y: -30 };
  const after = zoomAroundCenter(before, viewport, 0.7, 1.2);
  assert.ok(Math.abs((viewport.width / 2 - before.x) / 0.7 - (viewport.width / 2 - after.x) / 1.2) < 1e-8);
  assert.ok(Math.abs((viewport.height / 2 - before.y) / 0.7 - (viewport.height / 2 - after.y) / 1.2) < 1e-8);
});

test("selecting a person zooms a fitted family overview back to natural size and centres the card", () => {
  const family = getFamilyBySlug("akhmedov");
  assert.ok(family);
  const layout = buildFamilyOverviewLayout(family, "timur");
  const viewport = { width: 850, height: 660 };
  const overview = fitTreeViewport(viewport, layout);
  const focused = focusTreeViewport(viewport, layout, "timur");
  const node = layout.nodes.find((candidate) => candidate.person.id === "timur");
  assert.ok(node);

  assert.ok(overview.scale > 0 && overview.scale < 1, "the multigeneration overview is zoomed out before selection");
  assert.equal(focused.scale, 1);
  assert.equal(focused.x + node.x * focused.scale, viewport.width / 2);
  assert.equal(focused.y + node.y * focused.scale, (viewport.height - 40) / 2);
});

test("selection fits only the requested card within a narrow or short mobile canvas", () => {
  const family = getFamilyBySlug("akhmedov");
  assert.ok(family);
  const layout = buildFamilyOverviewLayout(family, "timur");
  const node = layout.nodes.find((candidate) => candidate.person.id === "timur");
  assert.ok(node);
  const radius = (node.size ?? layout.nodeSize) / 2;

  for (const viewport of [{ width: 210, height: 545 }, { width: 290, height: 220 }]) {
    const focused = focusTreeViewport(viewport, layout, "timur");
    assert.ok(focused.scale < 1 && focused.scale >= TREE_MIN_SCALE);
    assert.ok(focused.x + (node.x - radius) * focused.scale >= 24);
    assert.ok(focused.x + (node.x + radius) * focused.scale <= viewport.width - 24);
    assert.ok(focused.y + (node.y - radius) * focused.scale >= 56);
    assert.ok(focused.y + (node.y + radius) * focused.scale <= viewport.height - 40 - 56);
  }
});

test("selection respects preferred scale and individual card size rather than isFocus", () => {
  const family = getFamilyBySlug("akhmedov");
  assert.ok(family);
  const layout = buildFamilyOverviewLayout(family, "timur");
  const node = layout.nodes.find((candidate) => candidate.isContext);
  assert.ok(node);
  const viewport = { width: 220, height: 545 };
  const focused = focusTreeViewport(viewport, layout, node.person.id, 1.2);

  assert.equal(focused.scale, 1.2, "a smaller context card fits without using the global nodeSize");
  assert.ok(Math.abs(focused.x + node.x * focused.scale - viewport.width / 2) < 1e-8);
  assert.ok(Math.abs(focused.y + node.y * focused.scale - (viewport.height - 40) / 2) < 1e-8);
  assert.equal(focusTreeViewport({ width: 850, height: 660 }, layout, node.person.id, 10).scale, TREE_MAX_SCALE);
});

test("an unknown selection falls back to fitting the whole family", () => {
  const family = getFamilyBySlug("akhmedov");
  assert.ok(family);
  const layout = buildFamilyOverviewLayout(family, null);
  const viewport = { width: 290, height: 545 };

  assert.deepEqual(focusTreeViewport(viewport, layout, "missing-person"), fitTreeViewport(viewport, layout));
});

test("parent connecting thread has no gap below the couple", () => {
  const family = getFamilyBySlug("akhmedov");
  assert.ok(family);
  const layout = buildFamilyTreeLayout(family, "timur");
  const parents = layout.nodes.filter((node) => node.role === "Отец" || node.role === "Мать");
  assert.equal(parents.length, 2);
  const drop = layout.links.find((link) => link.key === "ancestors-drop");
  assert.ok(drop);
  assert.equal(Number(drop.d.split(" ")[2]), parents[0].y);
});
