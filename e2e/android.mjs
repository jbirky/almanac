// The Android app in an emulator, next to a laptop in Chromium, both syncing with the test
// server. scripts/android/test runs it in three parts, cutting the phone off from the server
// and restarting the app in between:
//   1  sync both ways, and the server address in Settings
//   2  (restarted, server out of reach) the data is still on the phone; write offline
//   3  (server back) what was written offline reaches the laptop
import { _android as android, chromium, expect } from '@playwright/test';

const URL = 'http://127.0.0.1:8790/';
const OUT = '/work/shots';
const part = process.argv[2];
const problems = [];

const step = (msg) => console.log('•', msg);
const attach = (page, name) => {
  page.on('console', (m) => ['error', 'warning'].includes(m.type()) && problems.push(`[${name}] ${m.type()}: ${m.text()}`));
  page.on('pageerror', (e) => problems.push(`[${name}] pageerror: ${e}`));
};
const syncState = (page) => page.locator('.sync-status');
async function syncNow(page) {
  await page.locator('.sync-status button').dispatchEvent('click');
  await page.waitForTimeout(200);
  await expect(syncState(page)).toHaveAttribute('data-state', 'synced', { timeout: 15000 });
}

const [device] = await android.devices();
const app = await (await device.webView({ pkg: 'app.almanac' })).page();
attach(app, 'app');
const browser = await chromium.launch();
const laptop = await browser.newPage({ viewport: { width: 1200, height: 820 } });
attach(laptop, 'laptop');
await laptop.goto(URL);
await expect(syncState(laptop)).toHaveAttribute('data-state', 'synced', { timeout: 15000 });

if (part === '1') {
  await expect(syncState(app)).toHaveAttribute('data-state', 'synced', { timeout: 15000 });
  if ((await app.evaluate(() => location.origin)) !== 'https://localhost') throw new Error('not loaded from the app');
  await expect(app.locator('.sync-status .warn')).toHaveCount(0);
  step('the app opens from its own files, keeps its data on the phone, and syncs with the server');

  await laptop.getByLabel('New task').fill('call the observatory from the laptop');
  await laptop.getByLabel('New task').press('Enter');
  await syncNow(laptop);
  await syncNow(app);
  await expect(app.locator('.overview .task-row', { hasText: 'call the observatory from the laptop' })).toHaveCount(1);

  await app.locator('.journal-rest').click();
  await expect(app.locator('.prose')).toBeFocused();
  await app.keyboard.type('Written on the phone: $E = mc^2$ checks out.');
  await app.keyboard.press('Enter');
  await app.keyboard.type('[] ');
  await expect(app.locator('.task-block-title')).toBeFocused({ timeout: 5000 });
  await app.keyboard.type('reply from the phone');
  await expect(app.locator('.math-inline .katex')).toHaveCount(1);
  // The journal saves after a second of quiet, a task's title after half a second.
  await app.waitForTimeout(1500);
  await expect(app.locator('.overview .task-row', { hasText: 'reply from the phone' })).toHaveCount(1);
  await syncNow(app);
  await syncNow(laptop);
  await expect(laptop.locator('.prose')).toContainText('Written on the phone', { timeout: 5000 });
  await expect(laptop.locator('.overview .task-row', { hasText: 'reply from the phone' })).toBeVisible({ timeout: 5000 });
  await device.screenshot({ path: `${OUT}/android-1-day.png` });
  step("a task from the laptop reaches the phone; the phone's journal, with an equation and a task, reaches the laptop");

  await app.getByRole('link', { name: 'Settings' }).click();
  const server = app.getByLabel('Server address');
  await expect(server).toHaveValue('http://localhost:8790');
  await server.fill('nowhere.invalid');
  await app.getByRole('button', { name: 'Save' }).click();
  await expect(app.locator('.server-error')).toContainText("Couldn't reach it", { timeout: 15000 });
  await server.fill('http://localhost:8790');
  await app.getByRole('button', { name: 'Check' }).click();
  await expect(app.locator('.server-ok')).toContainText('Connected');
  await device.screenshot({ path: `${OUT}/android-2-settings.png` });
  await app.getByRole('link', { name: 'By day' }).click();
  step('Settings checks a server address before syncing with it');
}

if (part === '2') {
  await expect(syncState(app)).toHaveAttribute('data-state', 'offline', { timeout: 30000 });
  await expect(app.locator('.prose')).toContainText('Written on the phone');
  await expect(app.locator('.overview .task-row', { hasText: 'call the observatory from the laptop' })).toHaveCount(1);
  await expect(app.locator('.sync-status .warn')).toHaveCount(0);
  step('restarted with the server out of reach, the app still has everything, and says it is offline');

  // At the start of the line: its middle is the formula, which a click opens for editing.
  await app.locator('.prose p', { hasText: 'Written on the phone' }).click({ position: { x: 4, y: 12 } });
  await app.keyboard.press('End');
  await app.keyboard.type(' Then the tunnel dropped.');
  await app.waitForTimeout(1600);
  await expect(syncState(app)).toContainText('waiting', { timeout: 20000 });
  await device.screenshot({ path: `${OUT}/android-3-offline.png` });
  step('writing offline queues the change');
}

if (part === '3') {
  await syncNow(app);
  await syncNow(laptop);
  await expect(laptop.locator('.prose')).toContainText('Then the tunnel dropped.', { timeout: 5000 });
  step('with the server back, what was written offline reaches the laptop');
}

await browser.close();
await device.close();
console.log(problems.length ? '\nconsole problems:' : '\nno console errors or warnings');
for (const line of problems) console.log('  ', line);
