/**
 * Field app end-to-end test on a 360×740 Android-sized viewport against a production build.
 *
 *   npm run build && npm start      # one terminal
 *   npm run test:field              # another — RE-SEEDS THE DATABASE
 *
 * Covers: first sign-in + PIN, data-pack download, registration with local duplicate check,
 * short-code swap, offline simulator, encrypted IndexedDB, real network loss + cold reload served by
 * the service worker, PIN unlock, interrupted upload resuming, retryable failure, 24 h void,
 * cross-organisation phone masking, unserved list, Bangla toggle, PIN lockout → online recovery.
 */
import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { chromium, type Page } from "playwright";
import { PrismaClient } from "@prisma/client";

const BASE = process.env.API_BASE ?? "http://localhost:3000";
const SHOTS = process.env.SHOTS_DIR ?? "field-e2e-screens";
const prisma = new PrismaClient();
let passed = 0;
const failures: string[] = [];

function check(name: string, cond: unknown, detail?: unknown) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(name);
    console.log(`  ✗ ${name}${detail === undefined ? "" : ` — ${String(JSON.stringify(detail)).slice(0, 300)}`}`);
  }
}
const section = (s: string) => console.log(`\n${s}`);
const shot = (page: Page, name: string) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });

async function enterPin(page: Page, pin: string) {
  for (const d of pin) await page.getByRole("button", { name: d, exact: true }).click();
}
async function pendingCount(page: Page) {
  const txt = await page.getByText(/^Pending: \d+$/).first().textContent();
  return Number(txt?.match(/\d+/)?.[0] ?? -1);
}
async function nav(page: Page, label: string) {
  await page.getByRole("navigation").getByRole("button", { name: label }).click();
}
async function setSimulator(page: Page, on: boolean) {
  const sw = page.getByRole("switch");
  if ((await sw.getAttribute("aria-checked")) !== String(on)) await sw.click();
}

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  execSync("npx tsx prisma/seed.ts", { stdio: "ignore" });

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, serviceWorkers: "allow" });
  const page = await context.newPage();
  const consoleErrors: string[] = [];
  page.on("pageerror", (e) => consoleErrors.push(e.message));

  // -------------------------------------------------------------------------
  section("First sign-in, PIN setup, data packs (UC-02, UC-10)");
  await page.goto(`${BASE}/field`);
  await page.getByLabel("Mobile number").fill("01711000011");
  await page.getByLabel("Password").fill("Volunteer@2026");
  await shot(page, "01-login");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByText("Set a 4-digit app PIN").waitFor();
  await enterPin(page, "2580");
  await page.getByText("Enter the same PIN again").waitFor();
  await enterPin(page, "2580");
  await page.getByText("Offline data packs").waitFor({ timeout: 15_000 });
  check("lands on Areas & sync after first sign-in", page.url().endsWith("/field/sync"));
  check("ward list downloaded (6 wards)", (await page.getByRole("button", { name: "Download" }).count()) === 6);
  for (const ward of ["Ward 03", "Ward 07"]) {
    await page.locator("li", { hasText: ward }).getByRole("button", { name: "Download" }).click();
    await page.locator("li", { hasText: ward }).getByRole("button", { name: "Remove" }).waitFor({ timeout: 15_000 });
  }
  const w07 = await page.locator("li", { hasText: "Ward 07" }).textContent();
  check("data pack shows household count + timestamp", /5 households · /.test(w07 ?? ""), w07);
  await shot(page, "02-sync-datapacks");

  // -------------------------------------------------------------------------
  section("Register household online: consent, validation, duplicate check, short code (UC-11, UC-12)");
  await nav(page, "Register");
  await shot(page, "03-consent");
  check("consent shown in Bangla and English", (await page.getByText("আপনি কি রাজি আছেন?").count()) === 1 && (await page.getByText("Do you agree?").count()) === 1);
  await page.getByRole("button", { name: /Consent Given/ }).click();
  await page.getByLabel("Head of household name").fill("জাহানারা");
  await page.getByRole("button", { name: "Next" }).click();
  check("Bangla script rejected with inline error", await page.getByText("Use English letters only (A–Z), at least 2 letters.").isVisible());
  await page.getByLabel("Head of household name").fill("Jahanara Begum");
  await page.getByLabel("Mobile number (optional)").fill("01713667201");
  await page.getByLabel("Ward", { exact: true }).selectOption({ label: "Dharmapur, Ward 07" });
  for (let i = 0; i < 6; i++) await page.getByRole("button", { name: "Increase: Household members" }).click();
  await shot(page, "04-details");
  const t0 = Date.now();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByText(/Possible existing households \(\d\)/).waitFor();
  check("local similarity check < 1 s", Date.now() - t0 < 1000, Date.now() - t0);
  check("matches FN-1005 with comparison card", await page.locator("article", { hasText: "FN-1005" }).isVisible());
  check("both actions offered", (await page.getByRole("button", { name: "Select Existing Household" }).count()) >= 1 && (await page.getByRole("button", { name: "Confirm New Household" }).count()) === 1);
  await shot(page, "05-duplicate-check");
  await page.getByRole("button", { name: "Confirm New Household" }).click();
  const slip = page.getByTestId("slip-code");
  await slip.waitFor();
  check("slip shows a code immediately", /^(TMP|FN)-\d{4}$/.test((await slip.textContent()) ?? ""));
  await page.waitForFunction(() => /^FN-\d{4}$/.test(document.querySelector('[data-testid="slip-code"]')?.textContent ?? ""), null, { timeout: 15_000 });
  const fnCode = (await slip.textContent())!;
  check("slip swaps to server FN code after auto-sync", /^FN-\d{4}$/.test(fnCode), fnCode);
  check("server has the household", !!(await prisma.household.findUnique({ where: { shortCode: fnCode } })));
  await shot(page, "06-slip");

  // -------------------------------------------------------------------------
  section("Offline simulator: register, distribute, void with zero network");
  await setSimulator(page, true);
  check("top bar shows simulated offline", await page.getByText("Offline (simulated)").waitFor({ timeout: 5_000 }).then(() => true, () => false));
  await page.getByRole("button", { name: "Register another household" }).click();
  await page.getByRole("button", { name: /Consent Given/ }).click();
  await page.getByLabel("Head of household name").fill("Rokshana Parvin");
  await page.getByLabel("Ward", { exact: true }).selectOption({ label: "Fazilpur, Ward 03" });
  await page.getByRole("button", { name: "Increase: Household members" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Confirm New Household" }).click();
  await slip.waitFor();
  const tmpCode = (await slip.textContent())!;
  check("offline registration gets a temporary code", /^TMP-\d{4}$/.test(tmpCode), tmpCode);
  check("slip explains the temporary code", await page.getByText(/Temporary code\. The final FN code appears here after sync/).isVisible());
  await page.getByRole("button", { name: "Record distribution for this household" }).click();
  check("hand-off preselects the household", await page.getByText(tmpCode, { exact: true }).waitFor({ timeout: 5_000 }).then(() => true, () => false));
  check("history banner says none yet", await page.getByText("No previous distributions recorded.").isVisible());
  await page.getByRole("button", { name: "Increase: Rice (10kg Sack)" }).click();
  await page.getByRole("button", { name: "Increase: Drinking Water (5L)" }).click();
  await page.getByRole("button", { name: "Increase: Drinking Water (5L)" }).click();
  await shot(page, "07-distribute");
  await page.getByRole("button", { name: "Confirm Distribution" }).click();
  await page.getByText("Distribution saved on this phone. It will sync automatically.").waitFor();
  await page.getByRole("button", { name: "Record another" }).click();
  await page.getByPlaceholder("Short code, name or mobile").fill(tmpCode);
  await page.getByRole("button", { name: new RegExp(tmpCode) }).click();
  check("already-served-today warning", await page.getByText("Already served today. Check before giving more.").isVisible());

  await nav(page, "Distribute");
  await page.getByRole("checkbox").check();
  await page.getByLabel("Ward", { exact: true }).selectOption({ label: "Fazilpur, Ward 03" });
  await page.getByRole("button", { name: "Increase: Oral Saline / ORS (Box)" }).click();
  await page.getByRole("button", { name: "Confirm Distribution" }).click();
  await page.getByText("Distribution saved on this phone.").waitFor();

  await nav(page, "Records");
  await page.getByRole("tab", { name: /Distributions/ }).click();
  const anonRow = page.locator("li", { hasText: "Anonymous" }).first();
  await anonRow.getByRole("button", { name: "Void distribution" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Void distribution" }).click();
  check("void requires a reason", await dialog.getByText("Give a reason of at least 5 characters.").isVisible());
  await dialog.getByLabel("Reason for voiding").fill("Counted twice at the shelter");
  await shot(page, "08-void-dialog");
  await dialog.getByRole("button", { name: "Void distribution" }).click();
  await page.locator("li", { hasText: "Counted twice at the shelter" }).waitFor();
  check("voided distribution stays visible with reason", await page.locator("li", { hasText: "Counted twice at the shelter" }).getByText("Voided").isVisible());
  const seededOld = page.locator("li", { hasText: "FN-1001" }).first();
  check("old distribution (>24h) cannot be voided", (await seededOld.getByRole("button", { name: "Void distribution" }).count()) === 0);

  await page.getByRole("tab", { name: /Households/ }).click();
  await page.getByPlaceholder("Filter by code, name or mobile").fill("Karim");
  check("filter finds both name variants (FN-1001, FN-1018)", (await page.locator("li", { hasText: "FN-1001" }).count()) === 1 && (await page.locator("li", { hasText: "FN-1018" }).count()) === 1);
  await page.locator("li", { hasText: "FN-1001" }).getByRole("button").first().click();
  check("edit form opens for own-org household with full phone", (await page.getByLabel("Mobile number (optional)").first().inputValue()) === "01712345678");
  await page.locator("li", { hasText: "FN-1001" }).getByRole("button").first().click();

  await page.getByPlaceholder("Filter by code, name or mobile").fill(tmpCode);
  await page.locator("li", { hasText: tmpCode }).getByRole("button").first().click();
  for (let i = 0; i < 2; i++) await page.getByRole("button", { name: "Increase: Household members" }).click();
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.getByText("Saved on this phone.").waitFor();
  const outboxCount = (await page.evaluate(`new Promise((resolve) => {
    const req = indexedDB.open("relief-field");
    req.onsuccess = () => {
      const c = req.result.transaction("outboxEvents", "readonly").objectStore("outboxEvents").count();
      c.onsuccess = () => resolve(c.result);
    };
  })`)) as number;
  check("offline edit coalesced into the pending CREATE (no extra event)", outboxCount === 5, outboxCount);
  check("Pending badge counts queued records", (await pendingCount(page)) === 4, await pendingCount(page));

  // -------------------------------------------------------------------------
  section("Encrypted IndexedDB (NFR04)");
  // Passed as a string: tsx's keepNames helper (__name) does not exist inside the page.
  const raw = (await page.evaluate(`(async () => {
    const dump = (store) => new Promise((resolve) => {
      const req = indexedDB.open("relief-field");
      req.onsuccess = () => {
        const all = req.result.transaction(store, "readonly").objectStore(store).getAll();
        all.onsuccess = () => resolve(all.result);
      };
    });
    const text = JSON.stringify({ h: await dump("households"), o: await dump("outboxEvents") }, (_k, v) => (v instanceof ArrayBuffer || ArrayBuffer.isView(v) ? "[bytes]" : v));
    return { text, hasPinHash: JSON.stringify(await dump("authSession")).includes("pinVerifier") };
  })()`)) as { text: string; hasPinHash: boolean };
  check("no plaintext head_name in households/outbox", !raw.text.includes("Rokshana") && !raw.text.includes("Jahanara"));
  check("no plaintext mobile numbers", !/01[3-9]\d{8}/.test(raw.text.replace(/"mobileNumber":"[^"]*"/g, "")));
  check("PIN stored only as salted verifier", raw.hasPinHash && !raw.text.includes("2580"));

  // -------------------------------------------------------------------------
  section("Real network loss + cold reload from service worker, PIN unlock");
  await page.waitForFunction(async () => !!navigator.serviceWorker?.controller && !!(await caches.match("/field/records")), null, { timeout: 30_000 });
  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByText("Enter your PIN").waitFor({ timeout: 15_000 });
  check("app shell loads with no network (service worker)", await page.getByText("Enter your PIN").isVisible());
  await shot(page, "09-pin-offline");
  await enterPin(page, "1111");
  check("wrong PIN counted", await page.getByText("Wrong PIN. 4 attempts left.").waitFor().then(() => true, () => false));
  await enterPin(page, "2580");
  await page.getByRole("navigation").waitFor();
  check("unlocked offline, queue preserved", (await pendingCount(page)) === 4);
  await nav(page, "Distribute");
  await page.getByPlaceholder("Short code, name or mobile").fill("Rokshana");
  check("decrypted local search works offline", await page.getByRole("button", { name: /Rokshana Parvin/ }).isVisible());
  await page.getByRole("radio", { name: "বাংলা" }).click();
  check("Bangla toggle works offline", await page.getByRole("navigation").getByText("বিতরণ").isVisible());
  await shot(page, "10-distribute-bn-offline");
  await page.getByRole("radio", { name: "EN" }).click();

  // -------------------------------------------------------------------------
  section("Resumable sync: interrupted upload, retryable failure, recovery (Sequence Diagram 03)");
  await context.setOffline(false);
  let aborts = 0;
  await page.route("**/api/sync", async (route) => {
    aborts++;
    await route.abort("connectionreset");
  });
  await setSimulator(page, false);
  await page.waitForFunction(() => document.body.innerText.includes("Online"));
  await page.getByRole("button", { name: "Sync now" }).click();
  await page.waitForTimeout(1500);
  await nav(page, "Sync");
  const resumed = await page
    .waitForFunction(() => document.querySelectorAll('[data-testid="outbox"] li[data-state="Pending"]').length === 4, null, { timeout: 5_000 })
    .then(() => true, () => false);
  const states = await page.locator('[data-testid="outbox"] li').evaluateAll((els) => els.map((e) => e.getAttribute("data-state")));
  check("connection dropped mid-upload → events back to Pending (not lost)", aborts > 0 && resumed, { aborts, states });
  await page.unroute("**/api/sync");
  await page.route("**/api/sync", (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "INTERNAL", message: "Internal server error." } }) }));
  await page.getByRole("button", { name: "Sync now" }).click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="outbox"] li[data-state="Failed"]').length === 4, null, { timeout: 10_000 }).catch(() => undefined);
  check("server error → Failed (retryable) with next retry time", (await page.getByText("Failed (retryable)").count()) === 4 && (await page.getByText(/Next retry/).count()) === 4);
  check("FR23 alert banner raised", await page.getByText(/records failed to sync/).isVisible());
  await shot(page, "11-sync-queue-failed");
  await page.unroute("**/api/sync");
  await page.getByRole("button", { name: "Retry failed" }).click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="outbox"] li[data-state="Acknowledged"]').length >= 5, null, { timeout: 20_000 });
  check("retry uploads everything → Acknowledged", (await page.locator('[data-testid="outbox"] li[data-state="Pending"], [data-testid="outbox"] li[data-state="Failed"]').count()) === 0);
  check("Pending: 0 after sync", (await pendingCount(page)) === 0);
  await shot(page, "12-sync-queue-acked");

  const rok = await prisma.household.findFirst({ where: { headName: "Rokshana Parvin" }, include: { distributions: { include: { items: true } } } });
  check("server household from offline CREATE (edit coalesced: 4 members)", rok?.memberCount === 4 && /^FN-\d{4}$/.test(rok.shortCode), rok);
  check("server distribution with items", rok?.distributions[0]?.items.length === 2);
  const voided = await prisma.distribution.findFirst({ where: { cancelReason: "Counted twice at the shelter" } });
  check("server anonymous distribution voided with reason", voided?.status === "Voided" && voided.isAnonymous);
  await nav(page, "Records");
  check("TMP code replaced by FN code locally", await page.getByText(rok?.shortCode ?? "missing", { exact: true }).first().isVisible());

  // -------------------------------------------------------------------------
  section("Cross-org masking + released unserved list (NFR06, UC-21)");
  await page.getByPlaceholder("Filter by code, name or mobile").fill("FN-1018");
  await page.locator("li", { hasText: "FN-1018" }).getByRole("button").first().click();
  check("other organisation's household is read-only", await page.getByText("Only the registering organisation can edit this household.").isVisible());
  await nav(page, "Distribute");
  await page.getByPlaceholder("Short code, name or mobile").fill("FN-1018");
  check("other organisation's phone masked", await page.getByText(/017XX-XXX678/).isVisible());
  await page.getByPlaceholder("Short code, name or mobile").fill("");

  const oaLogin = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mobileNumber: "01700000002", password: "OpsAdmin@2026" }) });
  const cookie = oaLogin.headers.getSetCookie()[0].split(";")[0];
  const fazilpur = await prisma.area.findFirstOrThrow({ where: { unionName: "Fazilpur" } });
  const rel = await fetch(`${BASE}/api/coverage/release-unserved`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify({ areaId: fazilpur.areaId }) });
  check("coordinator/admin released Fazilpur unserved list", rel.status === 201, rel.status);
  await page.getByRole("button", { name: "Sync now" }).click();
  await page.waitForTimeout(2500);
  await page.getByRole("tab", { name: "Unserved list" }).click();
  check("unserved households appear in quick-select tab", await page.getByRole("button", { name: /FN-1018/ }).isVisible());
  await shot(page, "13-unserved");

  // -------------------------------------------------------------------------
  section("PIN lockout → online re-authentication keeps local data (State Diagram 02)");
  await nav(page, "Sync");
  await page.getByRole("button", { name: "Lock app" }).click();
  for (let i = 0; i < 5; i++) {
    await enterPin(page, "0000");
    if (i < 4) await page.getByText(`Wrong PIN. ${4 - i} attempts left.`).waitFor();
  }
  await page.getByRole("heading", { name: "Sign in online to unlock" }).waitFor();
  check("5 wrong PINs → local lock requiring online sign-in", await page.getByText("Too many wrong PINs. Sign in online to unlock this phone.").isVisible());
  check("mobile number pre-filled and fixed", (await page.getByLabel("Mobile number").inputValue()) === "01711000011");
  await shot(page, "14-locked-out");
  await page.getByLabel("Password").fill("Volunteer@2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByText("Set a 4-digit app PIN").waitFor();
  await enterPin(page, "1357");
  await enterPin(page, "1357");
  await page.getByRole("navigation").waitFor();
  await nav(page, "Records");
  await page.getByPlaceholder("Filter by code, name or mobile").fill("Rokshana");
  check("records recovered with password-wrapped key", await page.getByText("Rokshana Parvin").isVisible());

  check("no uncaught page errors", consoleErrors.length === 0, consoleErrors);

  await browser.close();
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log("Failed:\n - " + failures.join("\n - "));
    process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
