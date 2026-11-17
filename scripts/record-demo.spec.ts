/**
 * Records a walkthrough video for each of the five roles against a live deployment.
 *
 *   APP_URL=https://your-app.vercel.app npm run demo:record
 *
 * Output: demo-videos/1-field-volunteer.mp4 … 5-observer.mp4
 * (1280×720 for dashboard roles, 390×844 mobile for the field app).
 * Playwright records .webm; each clip is converted to H.264 .mp4 and the raw .webm is deleted.
 * ffmpeg is found in this order: FFMPEG_PATH, the bundled `ffmpeg-static` binary (installed by
 * `npm install` on Windows/macOS/Linux), then `ffmpeg` on PATH. If none works, the .webm is kept.
 *
 * Options (environment variables):
 *   DEMO_ONLY=field,coordinator     record only some scenes (field, coordinator, opsadmin, sysadmin, observer)
 *   DEMO_PACE=1.5                   multiply every pause (slower = larger)
 *   DEMO_CAPTIONS=0                 hide the on-screen caption bar
 *   DEMO_KEEP_WEBM=1                keep the raw .webm next to the .mp4
 *   FFMPEG_PATH=/path/to/ffmpeg     use a specific ffmpeg binary
 *   DEMO_OUT=some/folder            output folder (default demo-videos)
 *
 * IMPORTANT: this signs in with the seeded demo accounts and CHANGES DATA (registers households,
 * records a distribution, resolves a conflict, creates and closes a demo operation). Run it only
 * against a demo database seeded with `npm run db:seed`. Re-seed before re-recording so every scene
 * finds the seeded conflict, duplicate pair and flag. Steps whose data is missing are skipped, not failed.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";

const APP_URL = (process.env.APP_URL ?? "").replace(/\/+$/, "");
if (!APP_URL) {
  console.error("Set APP_URL, e.g.  APP_URL=https://your-app.vercel.app npm run demo:record");
  process.exit(1);
}
const OUT = process.env.DEMO_OUT ?? "demo-videos";
const PACE = Number(process.env.DEMO_PACE ?? "1") || 1;
const CAPTIONS = process.env.DEMO_CAPTIONS !== "0";
const ONLY = process.env.DEMO_ONLY?.split(",").map((s) => s.trim());

/**
 * Locates an ffmpeg binary. `ffmpeg-static` is an optional dependency, so it is loaded at runtime
 * (not imported) and its absence never breaks type-checking or the app build.
 */
function findFfmpeg(): string | null {
  const candidates: string[] = [];
  if (process.env.FFMPEG_PATH) candidates.push(process.env.FFMPEG_PATH);
  try {
    const bundled = createRequire(__filename)("ffmpeg-static") as string | null;
    if (bundled && existsSync(bundled)) candidates.push(bundled);
  } catch {
    // ffmpeg-static not installed (optional dependency); fall through to PATH.
  }
  candidates.push("ffmpeg");
  for (const bin of candidates) {
    if (spawnSync(bin, ["-version"], { stdio: "ignore" }).status === 0) return bin;
  }
  return null;
}
const FFMPEG = findFfmpeg();

/** Converts a recording to a widely playable H.264 .mp4. Returns true when the .mp4 was written. */
function toMp4(ffmpeg: string, webm: string, mp4: string): boolean {
  const r = spawnSync(
    ffmpeg,
    // Even dimensions are required by yuv420p; +faststart lets the video start before it is fully downloaded.
    ["-y", "-loglevel", "error", "-i", webm, "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2", "-movflags", "+faststart", mp4],
    { encoding: "utf8" },
  );
  if (r.status === 0 && existsSync(mp4) && statSync(mp4).size > 0) return true;
  console.log(`  ! mp4 conversion failed: ${(r.stderr || r.error?.message || "unknown error").trim().split("\n").slice(-1)[0]}`);
  rmSync(mp4, { force: true });
  return false;
}

/** Seeded demo accounts (prisma/seed.ts). */
const ACCOUNTS = {
  field: { mobile: "01711000011", password: "Volunteer@2026", demoLabel: "Field Volunteer" },
  coordinator: { mobile: "01711000010", password: "Coordinator@2026", demoLabel: "Group Coordinator" },
  opsadmin: { mobile: "01700000002", password: "OpsAdmin@2026", demoLabel: "Operation Administrator" },
  sysadmin: { mobile: "01700000001", password: "SysAdmin@2026", demoLabel: "System Administrator" },
  observer: { mobile: "01700000005", password: "Observer@2026", demoLabel: "Observer" },
} as const;
type Role = keyof typeof ACCOUNTS;

const DESKTOP = { width: 1280, height: 720 };
const MOBILE = { width: 390, height: 844 };

const pause = (page: Page, ms = 1500) => page.waitForTimeout(ms * PACE);

/** Caption bar burned into the recording. Passed as a string so tsx helpers never leak into the page. */
async function caption(page: Page, text: string, mobile = false) {
  if (!CAPTIONS) return;
  const css = `position:fixed;left:50%;transform:translateX(-50%);${mobile ? "bottom:72px;max-width:92vw;font-size:13px" : "bottom:14px;max-width:80vw;font-size:16px"};z-index:2147483647;background:#0F172A;color:#fff;font:600 14px/1.35 Inter,system-ui,sans-serif;padding:8px 14px;border-radius:6px;pointer-events:none;text-align:center`;
  await page
    .evaluate(
      `(() => { let el = document.getElementById("demo-caption"); if (!el) { el = document.createElement("div"); el.id = "demo-caption"; document.body.appendChild(el); } el.style.cssText = ${JSON.stringify(css)}; el.textContent = ${JSON.stringify(text)}; })()`,
    )
    .catch(() => undefined);
}

/** Runs one walkthrough step; a missing element (e.g. data already reviewed) skips the step instead of aborting the clip. */
async function step(page: Page, name: string, fn: () => Promise<void>, mobile = false) {
  await caption(page, name, mobile);
  try {
    await fn();
    console.log(`    ✓ ${name}`);
  } catch (err) {
    console.log(`    – skipped: ${name} (${String(err instanceof Error ? err.message : err).split("\n")[0].slice(0, 90)})`);
  }
  await pause(page, 1200);
}

/** Desktop sign-in. Uses the "Capstone Demo Accounts" panel when the deployment shows it, otherwise types the credentials. */
async function loginDesktop(page: Page, role: Role) {
  const a = ACCOUNTS[role];
  await page.goto(`${APP_URL}/login`);
  await caption(page, `Sign in as ${a.demoLabel}`);
  await pause(page);
  const panel = page.getByText("Capstone Demo Accounts");
  if (await panel.isVisible().catch(() => false)) {
    await panel.click();
    await pause(page, 900);
    await page.locator("details li", { hasText: a.demoLabel }).first().click();
  } else {
    await page.getByLabel("Mobile number").fill(a.mobile);
    await page.getByLabel("Password", { exact: true }).fill(a.password);
  }
  await pause(page, 900);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/dashboard\//, { timeout: 20_000 });
  await pause(page);
}

const sidebar = (page: Page) => page.getByRole("navigation", { name: "Dashboard" });
async function open(page: Page, label: string) {
  await sidebar(page).getByRole("link", { name: label }).click();
  await pause(page, 1300);
}

async function record(browser: Browser, file: string, mobile: boolean, run: (page: Page) => Promise<void>) {
  console.log(`\n▶ ${file}`);
  const context = await browser.newContext({
    viewport: mobile ? MOBILE : DESKTOP,
    ...(mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}),
    recordVideo: { dir: path.join(OUT, ".tmp"), size: mobile ? MOBILE : DESKTOP },
    serviceWorkers: "allow",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(9_000);
  try {
    await run(page);
  } catch (err) {
    console.log(`  ! scene stopped early: ${err instanceof Error ? err.message.split("\n")[0] : err}`);
  }
  await pause(page, 1000);
  const video = page.video();
  await context.close(); // flushes the video file
  if (!video) return;
  const webm = path.join(OUT, `${file}.webm`);
  const mp4 = path.join(OUT, `${file}.mp4`);
  rmSync(webm, { force: true });
  renameSync(await video.path(), webm);
  if (FFMPEG && toMp4(FFMPEG, webm, mp4)) {
    if (process.env.DEMO_KEEP_WEBM !== "1") rmSync(webm, { force: true });
    console.log(`  saved ${mp4}`);
  } else {
    // Never delete the only copy of a recording.
    console.log(`  saved ${webm} (kept as .webm: no working ffmpeg; run "npm install" or set FFMPEG_PATH)`);
  }
}

// ---------------------------------------------------------------------------
// Scene 1 — Field Volunteer (mobile, /field)
// ---------------------------------------------------------------------------
const NAMES = ["Karima Khatun", "Abdul Mannan", "Shirina Begum", "Nazrul Haque", "Parvin Sultana", "Motaleb Mia", "Hasina Akter", "Rahim Sheikh"];

async function fieldVolunteer(page: Page) {
  const m = true;
  const a = ACCOUNTS.field;
  const nav = (label: string) => page.getByRole("navigation").getByRole("button", { name: label }).click();
  const pin = async (digits: string) => {
    for (const d of digits) {
      await page.getByRole("button", { name: d, exact: true }).click();
      await page.waitForTimeout(180);
    }
  };
  const household = NAMES[Math.floor(Date.now() / 60_000) % NAMES.length];

  await page.goto(`${APP_URL}/field`);
  await step(page, "Field app: sign in online once", async () => {
    await page.getByLabel("Mobile number").fill(a.mobile);
    await page.getByLabel("Password").fill(a.password);
    await pause(page, 900);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByText("Set a 4-digit app PIN").waitFor({ timeout: 20_000 });
  }, m);
  await step(page, "Set a 4-digit PIN for offline unlock (valid 7 days)", async () => {
    await pin("2580");
    await page.getByText("Enter the same PIN again").waitFor();
    await pause(page, 700);
    await pin("2580");
    await page.getByText("Offline data packs").waitFor({ timeout: 20_000 });
  }, m);
  await step(page, "Download ward data packs for offline work", async () => {
    for (const ward of ["Ward 03", "Ward 07"]) {
      const row = page.locator("li", { hasText: ward });
      if (await row.getByRole("button", { name: "Download" }).isVisible().catch(() => false)) {
        await row.getByRole("button", { name: "Download" }).click();
        await row.getByRole("button", { name: "Remove" }).waitFor({ timeout: 20_000 });
        await pause(page, 700);
      }
    }
  }, m);

  await step(page, "Register household — Step 1: consent in Bangla and English", async () => {
    await nav("Register");
    await pause(page, 2200);
    await page.getByRole("button", { name: /Consent Given/ }).click();
  }, m);
  await step(page, "Step 2: details (name in English letters, ward, members)", async () => {
    await page.getByLabel("Head of household name").fill(household);
    await page.getByLabel("Ward", { exact: true }).selectOption({ index: 1 });
    for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "Increase: Household members" }).click();
    await pause(page, 1200);
    await page.getByRole("button", { name: "Next" }).click();
  }, m);
  await step(page, "Step 3: local duplicate check, then save", async () => {
    await pause(page, 1500);
    await page.getByRole("button", { name: "Confirm New Household" }).click();
    await page.getByTestId("slip-code").waitFor();
  }, m);
  await step(page, "Short-code slip: write this code on the family's token", async () => {
    await page
      .waitForFunction(() => /^FN-\d{4}$/.test(document.querySelector('[data-testid="slip-code"]')?.textContent ?? ""), null, { timeout: 12_000 })
      .catch(() => undefined);
    await pause(page, 1800);
  }, m);
  await step(page, "Record distribution for this household", async () => {
    await page.getByRole("button", { name: "Record distribution for this household" }).click();
    await pause(page, 1200);
    const plus = page.getByRole("button", { name: /^Increase: / });
    await plus.nth(0).click();
    await plus.nth(0).click();
    await plus.nth(4).click();
    await pause(page, 1000);
    await page.getByRole("button", { name: "Confirm Distribution" }).click();
    await page.getByText("Distribution saved on this phone.", { exact: false }).waitFor();
  }, m);

  await step(page, "Switch on the Offline simulator: no network from here", async () => {
    await page.getByRole("switch").click();
    await page.getByText("Offline (simulated)").waitFor();
  }, m);
  await step(page, "Register another household completely offline", async () => {
    await nav("Register");
    if (await page.getByRole("button", { name: "Register another household" }).isVisible().catch(() => false)) {
      await page.getByRole("button", { name: "Register another household" }).click();
    }
    await page.getByRole("button", { name: /Consent Given/ }).click();
    await page.getByLabel("Head of household name").fill(NAMES[(Math.floor(Date.now() / 60_000) + 3) % NAMES.length]);
    await page.getByLabel("Ward", { exact: true }).selectOption({ index: 1 });
    await page.getByRole("button", { name: "Increase: Household members" }).click();
    await page.getByRole("button", { name: "Next" }).click();
    await pause(page, 1000);
    await page.getByRole("button", { name: "Confirm New Household" }).click();
    await page.getByTestId("slip-code").waitFor();
    await pause(page, 1500);
  }, m);
  await step(page, "Sync queue: the record waits as Pending", async () => {
    await nav("Sync");
    await page.getByRole("heading", { name: "Sync queue", exact: true }).scrollIntoViewIfNeeded();
    await pause(page, 1800);
  }, m);
  await step(page, "Network back: it uploads automatically (Acknowledged)", async () => {
    await page.getByRole("switch").click();
    await page.waitForFunction(() => !document.querySelector('[data-testid="outbox"] li[data-state="Pending"]'), null, { timeout: 20_000 });
    await pause(page, 1500);
  }, m);
  await step(page, "Records: history, edits and 24-hour void", async () => {
    await nav("Records");
    await page.getByRole("tab", { name: /Distributions/ }).click();
    await pause(page, 1500);
    await page.getByRole("button", { name: "Void distribution" }).first().click();
    await page.getByRole("dialog").getByLabel("Reason for voiding").fill("Recorded by mistake");
    await pause(page, 1800);
    await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  }, m);
  await step(page, "Full Bangla interface with one tap", async () => {
    await page.getByRole("radio", { name: "বাংলা" }).click();
    await pause(page, 2000);
    await page.getByRole("radio", { name: "EN" }).click();
  }, m);
}

// ---------------------------------------------------------------------------
// Scene 2 — Group Coordinator
// ---------------------------------------------------------------------------
async function coordinator(page: Page) {
  await loginDesktop(page, "coordinator");
  await step(page, "Area coverage: registered, served and unserved per ward", async () => {
    await page.getByRole("row", { name: /No Records/ }).first().waitFor();
    await pause(page, 1500);
    await page.getByLabel("Upazila").selectOption({ index: 1 });
    await pause(page, 1300);
    await page.getByLabel("Upazila").selectOption({ index: 0 });
  });
  await step(page, "Unserved households drawer → release the list to field devices", async () => {
    await page.getByRole("button", { name: "Unserved households" }).and(page.locator(":enabled")).first().click();
    await pause(page, 1800);
    await page.getByRole("dialog").getByRole("button", { name: "Release Unserved List to Field App" }).click();
    await page.getByRole("dialog").getByText(/Released \d+ households/).waitFor();
    await pause(page, 1500);
    await page.keyboard.press("Escape");
  });
  await step(page, "Conflicts: device value vs server value, side by side", async () => {
    await open(page, "Conflicts");
    await page.locator("ul[aria-label] li button").first().click();
    await pause(page, 2500);
    await page.getByRole("button", { name: "Accept Local" }).click();
    await pause(page, 1500);
  });
  await step(page, "Duplicates: compare two registrations, link, then undo", async () => {
    await open(page, "Duplicates & flags");
    await page.getByRole("button", { name: /↔/ }).first().click();
    await pause(page, 2500);
    await page.getByRole("button", { name: "Confirm Same Household (Link)" }).click();
    await pause(page, 1500);
    await page.getByRole("dialog").getByRole("button", { name: "Confirm Same Household (Link)" }).click();
    await pause(page, 1200);
    await page.getByLabel("Status").selectOption("Linked");
    await page.getByRole("button", { name: /↔/ }).first().click();
    await pause(page, 1200);
    await page.getByRole("button", { name: "Undo Link" }).click();
    await pause(page, 1000);
    await page.getByLabel("Status").selectOption("PendingReview");
  });
  await step(page, "24h repeat flags: two organisations, same item, reviewer note", async () => {
    await page.getByRole("tab", { name: "24h repeat distribution flags" }).click();
    await page.getByRole("button", { name: /FN-\d{4}/ }).first().click();
    await pause(page, 2200);
    await page.getByLabel("Reviewer note").fill("Second visit was a top-up for a large family.");
    await pause(page, 1200);
    await page.getByRole("button", { name: "Mark Justified" }).click();
  });
  await step(page, "Household history: append-only timeline", async () => {
    await open(page, "Household history");
    await page.getByPlaceholder("Search by short code or name").fill("FN-1006");
    await page.getByRole("button", { name: /FN-1006/ }).click();
    await page.getByRole("heading", { name: "Timeline" }).waitFor();
    await pause(page, 1500);
    await page.mouse.wheel(0, 500);
    await pause(page, 1800);
  });
  await step(page, "Members & devices: approve, change role, temp password, revoke", async () => {
    await open(page, "Organisations & members");
    await pause(page, 2500);
  });
  await step(page, "Notifications link straight into the queues", async () => {
    await page.getByRole("button", { name: /Notifications/ }).click();
    await pause(page, 2200);
    await page.keyboard.press("Escape");
  });
  await step(page, "Audit trail: filter by action, export CSV, no edit or delete", async () => {
    await open(page, "Audit trail");
    await page.getByLabel("Action").selectOption({ index: 2 });
    await pause(page, 2000);
  });
  await step(page, "Reports: organisation report, CSV and PDF export", async () => {
    await open(page, "Reports");
    await page.getByText("Item totals", { exact: false }).first().waitFor();
    await pause(page, 1500);
    await page.mouse.wheel(0, 450);
    await pause(page, 1500);
  });
}

// ---------------------------------------------------------------------------
// Scene 3 — Operation Administrator
// ---------------------------------------------------------------------------
async function opsAdmin(page: Page) {
  await loginDesktop(page, "opsadmin");
  const stamp = new Date().toISOString().slice(11, 19).replace(/:/g, "");
  const opName = `Demo Cyclone Response ${stamp}`;
  await step(page, "Operation setup: create a new disaster operation", async () => {
    await open(page, "Operation setup");
    await page.getByLabel("Operation name").fill(opName);
    await page.getByLabel("Disaster type").fill("Cyclone");
    await pause(page, 1000);
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await page.getByText(`Setup for: ${opName}`).waitFor();
  });
  await step(page, "Add an area manually (Upazila / Union / Ward)", async () => {
    await page.getByLabel("Upazila").fill("Companiganj");
    await page.getByLabel("Union").fill("Charkalam");
    await page.getByLabel("Ward").fill("3");
    await pause(page, 900);
    await page.getByRole("button", { name: "Add area" }).click();
    await page.getByRole("cell", { name: "03" }).waitFor();
  });
  await step(page, "CSV bulk upload: valid vs rejected rows previewed before import", async () => {
    const csv = "upazila,union_name,ward\nCompaniganj,Charkalam,04\nCompaniganj,Charkalam,03\n,Charhazari,01\nKabirhat,Narottampur,7\nKabirhat,Narottampur,07\n";
    await page.getByLabel("CSV bulk upload").setInputFiles({ name: "areas.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
    await page.getByText("2 valid rows", { exact: true }).waitFor();
    await pause(page, 2500);
    await page.getByRole("button", { name: "Import 2 valid rows" }).click();
    await page.getByText(/Imported 2 areas/).waitFor();
  });
  await step(page, "Configure relief items for this operation", async () => {
    await page.getByLabel("Item name").last().fill("Tarpaulin Sheet");
    await page.getByLabel("Unit").last().fill("sheet");
    await pause(page, 900);
    await page.getByRole("button", { name: "Add item" }).click();
    await pause(page, 1200);
  });
  await step(page, "Close operation: blocks new records, starts 90-day retention timer", async () => {
    await page.getByRole("button", { name: "Close operation" }).scrollIntoViewIfNeeded();
    await page.getByRole("button", { name: "Close operation" }).click();
    await pause(page, 3000);
    await page.getByRole("dialog").getByRole("button", { name: "Close operation" }).click();
    await page.getByText("This operation is closed. Setup is read-only.").waitFor();
  });
  await step(page, "Back to the live operation; review join requests", async () => {
    const select = page.getByLabel("Operation", { exact: true });
    const live = await select.locator("option").evaluateAll((opts) => (opts as HTMLOptionElement[]).find((o) => !o.textContent?.includes("(Closed)"))?.value ?? "");
    if (live) await select.selectOption(live);
    await open(page, "Organisations & members");
    await pause(page, 2200);
  });
  await step(page, "Anonymised operation summary report", async () => {
    await open(page, "Reports");
    await page.getByText("Coverage by area").waitFor();
    await pause(page, 1500);
    await page.mouse.wheel(0, 450);
    await pause(page, 1500);
  });
}

// ---------------------------------------------------------------------------
// Scene 4 — System Administrator
// ---------------------------------------------------------------------------
async function sysAdmin(page: Page) {
  await loginDesktop(page, "sysadmin");
  await step(page, "Organisations: approve or reject pending registrations", async () => {
    await open(page, "Organisations & members");
    await pause(page, 1800);
  });
  await step(page, "Rejecting requires a written reason", async () => {
    await page.getByRole("button", { name: "Reject" }).first().click();
    await pause(page, 1500);
    await page.getByRole("dialog").getByLabel("Rejection reason").fill("Registration documents are incomplete.");
    await pause(page, 1500);
    await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  });
  await step(page, "Users: every account, status and device", async () => {
    await page.getByRole("tab", { name: "Users" }).click();
    await pause(page, 1500);
    await page.mouse.wheel(0, 400);
    await pause(page, 1500);
    await page.mouse.wheel(0, -400);
  });
  await step(page, "90-day PII purge: preview first (dry run)", async () => {
    await page.getByRole("tab", { name: "PII retention purge" }).click();
    await pause(page, 1500);
    await page.getByRole("button", { name: "Preview (dry run)" }).click();
    await pause(page, 2500);
  });
  await step(page, "System-wide audit trail", async () => {
    await open(page, "Audit trail");
    await pause(page, 2200);
  });
}

// ---------------------------------------------------------------------------
// Scene 5 — Observer
// ---------------------------------------------------------------------------
async function observer(page: Page) {
  await loginDesktop(page, "observer");
  await step(page, "Observer: only Area coverage and Reports in the menu", async () => {
    await page.getByRole("row", { name: /No Records/ }).first().waitFor();
    await pause(page, 2500);
  });
  await step(page, "Area-level figures only: no household names, phones or drawers", async () => {
    await page.getByLabel("Upazila").selectOption({ index: 1 });
    await pause(page, 1500);
    await page.getByLabel("Upazila").selectOption({ index: 0 });
  });
  await step(page, "A forbidden page (Conflicts) redirects back", async () => {
    await page.goto(`${APP_URL}/dashboard/conflicts`);
    await page.waitForURL(/\/dashboard\/coverage/);
    await pause(page, 1500);
  });
  await step(page, "Anonymised summary report: aggregates only", async () => {
    await open(page, "Reports");
    await page.getByText("Coverage by area").waitFor();
    await pause(page, 1500);
    await page.mouse.wheel(0, 450);
    await pause(page, 1800);
  });
}

// ---------------------------------------------------------------------------

const SCENES: { key: Role; file: string; mobile: boolean; run: (p: Page) => Promise<void> }[] = [
  { key: "field", file: "1-field-volunteer", mobile: true, run: fieldVolunteer },
  { key: "coordinator", file: "2-group-coordinator", mobile: false, run: coordinator },
  { key: "opsadmin", file: "3-operation-administrator", mobile: false, run: opsAdmin },
  { key: "sysadmin", file: "4-system-administrator", mobile: false, run: sysAdmin },
  { key: "observer", file: "5-observer", mobile: false, run: observer },
];

async function main() {
  mkdirSync(OUT, { recursive: true });
  console.log(`Recording against ${APP_URL} → ${OUT}/`);
  console.log(FFMPEG ? `Converting to .mp4 with ${FFMPEG}` : "No ffmpeg found: clips will stay .webm");
  const browser = await chromium.launch({ slowMo: Math.round(120 * PACE) });
  for (const s of SCENES) {
    if (ONLY && !ONLY.includes(s.key)) continue;
    await record(browser, s.file, s.mobile, s.run);
  }
  await browser.close();
  if (existsSync(path.join(OUT, ".tmp"))) rmSync(path.join(OUT, ".tmp"), { recursive: true, force: true });
  console.log("\nDone.");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
