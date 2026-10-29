import { APIRequestContext, Browser, Page, expect, request } from '@playwright/test';

export const PASSWORD = 'Senha@123';

export type ProjectRole = 'OWNER' | 'EDITOR' | 'VIEWER';

export interface Member {
  email: string;
  api: APIRequestContext;
}

export interface Session {
  page: Page;
  dialogs: string[];
  close(): Promise<void>;
}

const baseURL = (): string => process.env.ERD_BASE_URL ?? 'http://localhost:4200';

/** Registers a user through the public API and returns an API client logged in as them. */
export async function createMember(label: string, run: string): Promise<Member> {
  const email = `${label}.${run}@e2e.local`;
  const api = await request.newContext({ baseURL: baseURL() });
  await api.post('/api/user', {
    data: { firstName: label, lastName: 'E2E', email, password: PASSWORD, role: 'USER' }
  });
  const login = await api.post('/api/auth/login', { data: { email, password: PASSWORD } });
  expect(login.status(), `login of ${email}`).toBe(200);
  return { email, api };
}

export async function createProject(owner: Member, name: string): Promise<string> {
  const response = await owner.api.post('/api/project', {
    data: { name, description: 'E2E collaboration test plan', userEmail: owner.email }
  });
  expect(response.status()).toBe(201);
  return (await response.json()).id;
}

export async function addMember(owner: Member, projectId: string, member: Member, role: ProjectRole): Promise<void> {
  const response = await owner.api.post('/api/project/team-member', {
    data: { userEmail: member.email, projectId, roleProjectEnum: role }
  });
  expect(response.status()).toBe(201);
}

/** Logs in through the real login page and opens the project from the sidebar. */
export async function openSession(browser: Browser, member: Member, projectName: string): Promise<Session> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const dialogs: string[] = [];
  page.on('dialog', dialog => {
    dialogs.push(dialog.message());
    void dialog.dismiss();
  });

  await page.goto('/login');
  await page.locator('#email').fill(member.email);
  await page.locator('#password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await page.waitForURL('**/diagram');
  await page.locator('.project-item', { hasText: projectName }).click();
  await page.waitForFunction(() => (document.getElementById('myDiagramDiv') as any)?.goDiagram);
  // The STOMP subscription to the project topics is asynchronous and invisible in the DOM.
  await page.waitForTimeout(1500);

  return { page, dialogs, close: () => context.close() };
}

/** Table names currently in this browser's diagram model (none while the diagram is still being built). */
export async function tableKeys(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const diagram = (document.getElementById('myDiagramDiv') as any)?.goDiagram;
    return diagram ? diagram.model.nodeDataArray.map((node: any) => node.key).sort() : [];
  });
}

/** Reloads the page and opens the project again, as a user returning to it would. */
export async function reopen(page: Page, projectName: string): Promise<void> {
  await page.reload();
  await page.locator('.project-item', { hasText: projectName }).click();
  await page.waitForFunction(() => (document.getElementById('myDiagramDiv') as any)?.goDiagram);
}

export async function expectTables(page: Page, keys: string[]): Promise<void> {
  await expect.poll(() => tableKeys(page)).toEqual([...keys].sort());
}

/** Clicks "Add New Table" and returns the wall-clock time of the click. */
export async function addTable(page: Page): Promise<number> {
  return page.evaluate(() => {
    const clickedAt = Date.now();
    (document.querySelector('.add-table-btn') as HTMLButtonElement).click();
    return clickedAt;
  });
}

/** Resolves with the wall-clock time at which the table first appears in this browser. */
export async function timeWhenTableAppears(page: Page, key: string, timeout = 20_000): Promise<number> {
  const handle = await page.waitForFunction(
    (expected: string) => {
      const diagram = (document.getElementById('myDiagramDiv') as any).goDiagram;
      return diagram.model.nodeDataArray.some((node: any) => node.key === expected) ? Date.now() : false;
    },
    key,
    { polling: 'raf', timeout }
  );
  return (await handle.jsonValue()) as number;
}

/** Double-clicks a table on the canvas, as a user would to edit it. */
export async function doubleClickTable(page: Page, key: string): Promise<void> {
  const point = await page.evaluate((tableKey: string) => {
    const div = document.getElementById('myDiagramDiv') as any;
    const diagram = div.goDiagram;
    const node = diagram.findNodeForKey(tableKey);
    diagram.centerRect(node.actualBounds);
    const center = diagram.transformDocToView(node.actualBounds.center);
    const rect = div.getBoundingClientRect();
    return { x: rect.left + center.x, y: rect.top + center.y };
  }, key);
  await page.mouse.dblclick(point.x, point.y);
}

export async function openTableEditor(page: Page, key: string): Promise<void> {
  await doubleClickTable(page, key);
  await expect(page.locator('#entityName')).toBeVisible();
}

export async function renameOpenTable(page: Page, newKey: string): Promise<void> {
  await page.locator('#entityName').fill(newKey);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('#entityName')).toBeHidden();
}

export async function closeTableEditor(page: Page): Promise<void> {
  await page.locator('.btn-close').click();
  await expect(page.locator('#entityName')).toBeHidden();
}
