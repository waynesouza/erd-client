import { expect, test } from '@playwright/test';
import {
  addMember,
  addTable,
  closeTableEditor,
  createMember,
  createProject,
  doubleClickTable,
  expectTables,
  Member,
  openSession,
  openTableEditor,
  renameOpenTable,
  reopen,
  tableKeys,
  timeWhenTableAppears
} from './support/erd';

/**
 * Collaboration test plan. Every case opens real browsers for different
 * members of one project and checks, in the other browsers, what a user
 * would see. Each case gets its own project so they do not interfere.
 */
const run = `${Date.now()}`;
let owner: Member;
let editor: Member;
let viewer: Member;

test.beforeAll(async () => {
  owner = await createMember('owner', run);
  editor = await createMember('editor', run);
  viewer = await createMember('viewer', run);
});

async function newProject(name: string): Promise<string> {
  const projectName = `${name} ${run}`;
  const projectId = await createProject(owner, projectName);
  await addMember(owner, projectId, editor, 'EDITOR');
  await addMember(owner, projectId, viewer, 'VIEWER');
  return projectName;
}

test('CT-01 a table added by one member appears for the other members', async ({ browser }) => {
  const project = await newProject('CT-01');
  const ownerSession = await openSession(browser, owner, project);
  const editorSession = await openSession(browser, editor, project);
  const viewerSession = await openSession(browser, viewer, project);

  const editorSees = timeWhenTableAppears(editorSession.page, 'table1');
  const viewerSees = timeWhenTableAppears(viewerSession.page, 'table1');
  const clickedAt = await addTable(ownerSession.page);

  const [editorAt, viewerAt] = await Promise.all([editorSees, viewerSees]);
  test.info().annotations.push(
    { type: 'latency-ms editor', description: String(editorAt - clickedAt) },
    { type: 'latency-ms viewer', description: String(viewerAt - clickedAt) }
  );
});

test('CT-02 a table renamed in the editor is renamed for the other members', async ({ browser }) => {
  const project = await newProject('CT-02');
  const ownerSession = await openSession(browser, owner, project);
  const editorSession = await openSession(browser, editor, project);
  await addTable(ownerSession.page);
  await expectTables(editorSession.page, ['table1']);

  await openTableEditor(editorSession.page, 'table1');
  await renameOpenTable(editorSession.page, 'customers');

  await expectTables(ownerSession.page, ['customers']);
});

test('CT-03 a table being edited is locked for the other members until it is released', async ({ browser }) => {
  const project = await newProject('CT-03');
  const ownerSession = await openSession(browser, owner, project);
  const editorSession = await openSession(browser, editor, project);
  await addTable(ownerSession.page);
  await expectTables(editorSession.page, ['table1']);

  await openTableEditor(editorSession.page, 'table1');
  await ownerSession.page.waitForTimeout(1000);
  await doubleClickTable(ownerSession.page, 'table1');

  await expect.poll(() => ownerSession.dialogs.join('\n')).toContain('Being edited by');
  await expect(ownerSession.page.locator('#entityName')).toBeHidden();

  await closeTableEditor(editorSession.page);
  await ownerSession.page.waitForTimeout(1000);
  await openTableEditor(ownerSession.page, 'table1');
});

test('CT-04 a viewer can follow the diagram but not change it', async ({ browser }) => {
  const project = await newProject('CT-04');
  const ownerSession = await openSession(browser, owner, project);
  const viewerSession = await openSession(browser, viewer, project);
  await addTable(ownerSession.page);
  await expectTables(viewerSession.page, ['table1']);

  // The viewer's toolbar has no "Add New Table" button at all...
  await expect(viewerSession.page.locator('.add-table-btn')).toHaveCount(0);
  // ...and opening a table for editing is refused.
  await doubleClickTable(viewerSession.page, 'table1');

  await expect.poll(() => viewerSession.dialogs.join(' | ')).toContain('view-only access');
  await expect(viewerSession.page.locator('#entityName')).toBeHidden();
  await ownerSession.page.waitForTimeout(3000);
  expect(await tableKeys(ownerSession.page)).toEqual(['table1']);
});

test('CT-05 simultaneous edits to different tables are both kept', async ({ browser }) => {
  const project = await newProject('CT-05');
  const ownerSession = await openSession(browser, owner, project);
  const editorSession = await openSession(browser, editor, project);
  await addTable(ownerSession.page);
  await expectTables(editorSession.page, ['table1']);
  await addTable(ownerSession.page);
  await expectTables(editorSession.page, ['table1', 'table2']);

  await openTableEditor(ownerSession.page, 'table1');
  await openTableEditor(editorSession.page, 'table2');
  // Both saves land within the same 1.5 s autosave window.
  await Promise.all([
    renameOpenTable(ownerSession.page, 'orders'),
    renameOpenTable(editorSession.page, 'customers')
  ]);

  await expectTables(ownerSession.page, ['customers', 'orders']);
  await expectTables(editorSession.page, ['customers', 'orders']);
  await reopen(ownerSession.page, project);
  await expectTables(ownerSession.page, ['customers', 'orders']);
});

test('CT-06 the diagram is kept after the page is reloaded', async ({ browser }) => {
  const project = await newProject('CT-06');
  const ownerSession = await openSession(browser, owner, project);
  await addTable(ownerSession.page);
  await addTable(ownerSession.page);
  await ownerSession.page.waitForTimeout(3000);

  await reopen(ownerSession.page, project);

  await expectTables(ownerSession.page, ['table1', 'table2']);
});

test('CT-07 the locks of a member who disconnects are released for the others', async ({ browser }) => {
  const project = await newProject('CT-07');
  const ownerSession = await openSession(browser, owner, project);
  const editorSession = await openSession(browser, editor, project);
  await addTable(ownerSession.page);
  await expectTables(editorSession.page, ['table1']);
  await openTableEditor(editorSession.page, 'table1');
  await ownerSession.page.waitForTimeout(1000);

  // The editor's browser goes away without closing the modal.
  await editorSession.close();
  await ownerSession.page.waitForTimeout(3000);

  await openTableEditor(ownerSession.page, 'table1');
});
