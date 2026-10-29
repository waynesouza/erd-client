import { test } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';
import { addMember, addTable, createMember, createProject, openSession, timeWhenTableAppears } from './support/erd';

/**
 * What a user perceives: from the click on "Add New Table" in one browser to
 * the table appearing in another member's browser. Unlike the protocol-level
 * measurement (latency/measure-propagation.mjs) this includes the editor's
 * 1.5 s autosave debounce and the rendering. Skipped unless MEASURE=1.
 *
 *   MEASURE=1 SAMPLES=30 npx playwright test latency
 */
test.skip(!process.env.MEASURE, 'measurement only, set MEASURE=1');

test('perceived propagation time of a new table', async ({ browser }) => {
  const samples = Number(process.env.SAMPLES ?? 30);
  test.setTimeout(samples * 10_000 + 60_000);
  const run = `${Date.now()}`;
  const owner = await createMember('lat-owner', run);
  const editor = await createMember('lat-editor', run);
  const projectName = `latency-ui ${run}`;
  const projectId = await createProject(owner, projectName);
  await addMember(owner, projectId, editor, 'EDITOR');

  const ownerSession = await openSession(browser, owner, projectName);
  const editorSession = await openSession(browser, editor, projectName);

  const latencies: number[] = [];
  for (let i = 1; i <= samples; i++) {
    const appears = timeWhenTableAppears(editorSession.page, `table${i}`);
    const clickedAt = await addTable(ownerSession.page);
    latencies.push((await appears) - clickedAt);
    // Let the autosave of this table settle before the next click restarts the debounce.
    await ownerSession.page.waitForTimeout(500);
  }

  mkdirSync('results', { recursive: true });
  writeFileSync(`results/latency-ui-${new URL(process.env.ERD_BASE_URL ?? 'http://localhost:4200').hostname}-${run}.json`,
    JSON.stringify({ measuredAt: new Date().toISOString(), samples, latencies }, null, 2));
  test.info().annotations.push({ type: 'latencies-ms', description: latencies.join(',') });
});
