/**
 * Coordination dashboard end-to-end test (1366×900) against a running production server.
 *
 *   npm run build && npm start        # one terminal (NEXT_PUBLIC_SHOW_DEMO_ACCOUNTS=true at build time)
 *   npm run test:dashboard            # another — RE-SEEDS THE DATABASE
 */
import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { chromium, type Browser, type Page } from "playwright";
import { PrismaClient } from "@prisma/client";

const BASE = process.env.API_BASE ?? "http://localhost:3000";
const SHOTS = process.env.SHOTS_DIR ?? "dashboard-e2e-screens";
const prisma = new PrismaClient();
let passed = 0;
const failures: string[] = [];
const pageErrors: string[] = [];

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
const visible = (p: Promise<void>) => p.then(() => true, () => false);

async function session(browser: Browser, mobile?: string, password?: string) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => pageErrors.push(e.message));
  if (mobile && password) {
    await page.goto(`${BASE}/login`);
    await page.getByLabel("Mobile number").fill(mobile);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/\/(dashboard|field)/);
  }
  return page;
}
const sidebar = (page: Page) => page.getByRole("navigation", { name: "Dashboard" });
async function navLabels(page: Page) {
  return (await sidebar(page).getByRole("link").allTextContents()).map((s) => s.trim());
}

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  execSync("npx tsx prisma/seed.ts", { stdio: "ignore" });
  const browser = await chromium.launch();

  // -------------------------------------------------------------------------
  section("Portal, login lockout countdown, demo accounts");
  let page = await session(browser);
  await page.goto(`${BASE}/`);
  check("portal shows three entry cards", (await page.getByRole("link", { name: /Sign In|Register Volunteer \/ Staff Account|Register Relief Organisation/ }).count()) === 3);
  await shot(page, "01-portal");
  await page.getByRole("link", { name: /Register Relief Organisation/ }).click();
  await page.getByLabel("Organisation name").fill("Noakhali Rescue Network");
  await page.getByLabel("Full name").fill("Saiful Islam");
  await page.getByLabel("Mobile number").fill("01744556677");
  await page.getByLabel("Password", { exact: true }).fill("Saiful2026");
  await page.getByLabel("Confirm password").fill("Saiful2026");
  await page.getByRole("button", { name: "Submit registration" }).click();
  check("organisation registration submitted (UC-03)", await visible(page.getByText(/Registration received for Noakhali Rescue Network/).waitFor({ timeout: 5000 })));
  await page.goto(`${BASE}/register`);
  await page.getByLabel("Organisation").selectOption({ label: "Shobuj Bangla Relief" });
  await page.getByLabel("Full name").fill("Rumana Akter");
  await page.getByLabel("Mobile number").fill("01722334455");
  await page.getByLabel("Password", { exact: true }).fill("Rumana2026");
  await page.getByLabel("Confirm password").fill("Rumana2027");
  await page.getByRole("button", { name: "Submit registration" }).click();
  check("password mismatch shown inline", await page.getByText("The passwords do not match.").isVisible());
  await page.getByLabel("Confirm password").fill("Rumana2026");
  await page.getByRole("button", { name: "Submit registration" }).click();
  check("volunteer registration submitted (UC-01)", await visible(page.getByText(/must approve the account/).waitFor({ timeout: 5000 })));

  await page.goto(`${BASE}/login`);
  await page.getByText("Capstone Demo Accounts").click();
  check("demo panel lists all five roles", (await page.locator("details li").count()) === 5);
  await page.getByLabel("Mobile number").fill("01911000031");
  for (let i = 0; i < 5; i++) {
    await page.getByLabel("Password", { exact: true }).fill(`wrong-${i}`);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForTimeout(400);
  }
  const lockText = await page.getByText(/Account locked after 5 failed attempts\. Try again in \d+:\d\d\./).textContent().catch(() => null);
  check("lockout countdown shown after 5 failures", /in 1[45]:\d\d/.test(lockText ?? ""), lockText);
  check("sign-in disabled while locked", await page.getByRole("button", { name: "Sign in" }).isDisabled());
  await shot(page, "02-login-locked");
  await page.locator("details li", { hasText: "Group Coordinator" }).click();
  check("demo account fills the form", (await page.getByLabel("Mobile number").inputValue()) === "01711000010");
  await page.context().close();

  // -------------------------------------------------------------------------
  section("Group Coordinator: shell, coverage, unserved release (UC-21, UC-22)");
  page = await session(browser, "01711000010", "Coordinator@2026");
  check("coordinator lands on /dashboard/coverage", page.url().endsWith("/dashboard/coverage"));
  const gcNav = await navLabels(page);
  check("coordinator nav filtered by role", gcNav.join("|") === "Area coverage|Conflicts|Duplicates & flags|Household history|Organisations & members|Audit trail|Reports", gcNav);
  await page.getByRole("row", { name: /Chhagalnaiya/ }).waitFor();
  check("6 areas + total row", (await page.locator("tbody tr").count()) === 7);
  check("0-household area labelled bilingually", await page.getByRole("row", { name: /Chhagalnaiya/ }).getByText("No Records / কোনো তথ্য নেই").isVisible());
  check("last field sync indicator", await page.getByText(/Last field sync: /).isVisible());
  await page.getByLabel("Upazila").selectOption("Parshuram");
  check("cascade filter: upazila → 2 areas", (await page.locator("tbody tr").count()) === 3);
  check("union list narrowed by upazila", (await page.getByLabel("Union").locator("option").count()) === 3);
  await page.getByLabel("Upazila").selectOption("");
  await shot(page, "03-coverage");
  await page.getByRole("row", { name: /Fazilpur/ }).getByRole("button", { name: "Unserved households" }).click();
  const drawer = page.getByRole("dialog");
  await drawer.getByRole("cell", { name: "FN-1018" }).waitFor();
  check("drawer lists unserved households with cross-org phone masked", await drawer.getByText("017XX-XXX678").isVisible());
  await shot(page, "04-unserved-drawer");
  await drawer.getByRole("button", { name: "Release Unserved List to Field App" }).click();
  check("release confirms count", await visible(drawer.getByText(/Released \d+ households at/).waitFor({ timeout: 5000 })));
  await page.keyboard.press("Escape");

  section("Conflicts (UC-17)");
  await sidebar(page).getByRole("link", { name: "Conflicts" }).click();
  await page.getByRole("button", { name: /FN-1006/ }).click();
  check("diff shows device vs server values", (await page.getByText("Local value (device)").isVisible()) && (await page.getByText("Server value").isVisible()));
  check("volunteer and device shown", (await page.getByText("Sumaiya Rahman").count()) > 0 && (await page.getByText(/Walton Primo/).isVisible()));
  await shot(page, "05-conflicts");
  await page.getByRole("button", { name: "Leave Open for Field Check" }).click();
  check("leave open keeps it Open", await page.getByText(/Left open\./).isVisible());
  await page.getByRole("button", { name: /FN-1006/ }).click();
  await page.getByRole("button", { name: "Accept Local" }).click();
  await page.getByText("No open conflicts.", { exact: false }).waitFor();
  const fn1006 = await prisma.household.findUniqueOrThrow({ where: { shortCode: "FN-1006" } });
  check("resolution applied with a new version", fn1006.memberCount === 7 && fn1006.version === 3, fn1006);

  section("Duplicates & flags (UC-18, UC-19)");
  await sidebar(page).getByRole("link", { name: "Duplicates & flags" }).click();
  const pairBtn = page.getByRole("button", { name: /FN-1001 ↔ FN-1018|FN-1018 ↔ FN-1001/ });
  await pairBtn.click();
  check("side-by-side comparison with masked other-org phone", (await page.getByText("017XX-XXX678").isVisible()) && (await page.getByText("01712345678").isVisible()));
  await shot(page, "06-duplicates");
  await page.getByRole("button", { name: "Confirm Same Household (Link)" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirm Same Household (Link)" }).click();
  await page.getByText("No pairs in this state.").waitFor();
  await page.getByLabel("Status").selectOption("Linked");
  await pairBtn.click();
  await page.getByRole("button", { name: "Undo Link" }).click();
  await page.getByText("No pairs in this state.").waitFor();
  await page.getByLabel("Status").selectOption("PendingReview");
  await pairBtn.click();
  await page.getByRole("button", { name: "Mark Not Duplicate" }).click();
  await page.waitForTimeout(500);
  const pairStatus = await prisma.duplicatePair.findFirst({ where: { label: "Likely" } });
  check("link → undo → not duplicate persisted", pairStatus?.status === "NotDuplicate", pairStatus?.status);
  await page.getByRole("tab", { name: "24h repeat distribution flags" }).click();
  await page.getByRole("button", { name: /FN-1004/ }).click();
  check("flag compares both organisations", (await page.getByText("Shobuj Bangla Relief").count()) > 0 && (await page.getByText("Feni Youth Volunteers").count()) > 0);
  await page.getByRole("button", { name: "Mark Justified" }).click();
  check("reviewer note required", await page.getByText("Write a note of at least 5 characters.").isVisible());
  await page.getByLabel("Reviewer note").fill("Second visit delivered water only for a family of seven.");
  await shot(page, "07-flags");
  await page.getByRole("button", { name: "Mark Justified" }).click();
  await page.getByText("No flags in this state.").waitFor();
  check("flag reviewed", (await prisma.distributionFlag.findFirstOrThrow()).status === "Justified");

  section("Household history (UC-23)");
  await sidebar(page).getByRole("link", { name: "Household history" }).click();
  await page.getByPlaceholder("Search by short code or name").fill("FN-1006");
  await page.getByRole("button", { name: /FN-1006/ }).click();
  await page.getByText("Timeline").waitFor();
  check("timeline: registration, edits, conflict resolution", (await page.getByText("Registered — version 1").isVisible()) && (await page.getByText("Conflict resolution — version 3").isVisible()) && (await page.getByText(/Conflict on Member count resolved/).isVisible()));
  await shot(page, "08-household-timeline");
  await page.getByPlaceholder("Search by short code or name").fill("FN-1007");
  await page.getByRole("button", { name: /FN-1007/ }).click();
  check("voided distribution kept in history with reason", await visible(page.getByText(/Void reason: Recorded against wrong household card/).waitFor({ timeout: 5000 })));

  section("Members & devices (UC-05, NFR03)");
  await sidebar(page).getByRole("link", { name: "Organisations & members" }).click();
  const rumana = page.getByRole("row", { name: /Rumana Akter/ });
  await rumana.getByRole("button", { name: "Approve" }).click();
  await rumana.getByText("Active").waitFor();
  check("coordinator approves pending volunteer", true);
  const sumaiyaRow = page.getByRole("row", { name: /Sumaiya Rahman/ });
  await sumaiyaRow.getByRole("button", { name: "Temporary password" }).click();
  const temp = (await page.getByTestId("temp-password").textContent())?.trim() ?? "";
  check("temporary password shown once", /^[A-Za-z0-9]{10}$/.test(temp), temp);
  await shot(page, "09-members-temp");
  await page.getByRole("dialog").getByRole("button", { name: "Confirm" }).click();
  await sumaiyaRow.getByRole("button", { name: "Revoke" }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Revoke" }).click();
  await page.waitForTimeout(500);
  check("device revoked", (await prisma.device.findFirstOrThrow({ where: { deviceLabel: { contains: "Sumaiya" } } })).status === "Revoked");
  const tempLogin = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mobileNumber: "01711000011", password: temp }) });
  check("temporary password works and forces change", (await tempLogin.json()).mustChangePassword === true);

  section("Notifications, audit, reports, language");
  await page.getByRole("button", { name: /Notifications/ }).click();
  check("bell popover lists notifications", (await page.locator("[data-radix-popper-content-wrapper] li").count()) > 0);
  await shot(page, "10-notifications");
  await page.locator("[data-radix-popper-content-wrapper] li", { hasText: "FN-1006" }).first().click();
  await page.waitForURL(/\/dashboard\/conflicts\?id=/);
  check("notification deep-links into the queue", true);
  await sidebar(page).getByRole("link", { name: "Audit trail" }).click();
  await page.getByLabel("Action").selectOption("CONFLICT_RESOLVED");
  await page.waitForTimeout(800);
  const actions = await page.locator("tbody tr td:nth-child(2)").allTextContents();
  check("audit filtered by action", actions.length > 0 && actions.every((a) => a === "CONFLICT_RESOLVED"), actions);
  check("no edit/delete controls in audit table", (await page.locator("tbody button").count()) === 0);
  const csvHref = await page.getByRole("link", { name: "Export CSV" }).getAttribute("href");
  const csv = await page.request.get(`${BASE}${csvHref}`);
  check("audit CSV export honours filters", csv.ok() && (await csv.text()).includes("CONFLICT_RESOLVED"));
  await shot(page, "11-audit");
  await sidebar(page).getByRole("link", { name: "Reports" }).click();
  await page.getByText("Organisation distribution report").first().waitFor();
  await page.evaluate("window.__printed = false; window.print = () => { window.__printed = true; };");
  await page.getByRole("button", { name: "Export PDF" }).click();
  check("Export PDF calls window.print()", await page.evaluate("window.__printed"));
  const repCsv = await page.request.get(`${BASE}${await page.getByRole("link", { name: "Download CSV" }).getAttribute("href")}`);
  check("organisation report CSV downloads", repCsv.ok() && (repCsv.headers()["content-type"] ?? "").includes("text/csv"));
  await page.emulateMedia({ media: "print" });
  check("print stylesheet hides the sidebar", !(await sidebar(page).isVisible()));
  await shot(page, "12-report-print");
  await page.emulateMedia({ media: "screen" });
  await page.getByRole("radio", { name: "বাংলা" }).click();
  check("EN | বাংলা toggle translates the shell", await visible(sidebar(page).getByText("এলাকাভিত্তিক কভারেজ").waitFor({ timeout: 5000 })));
  await page.getByRole("radio", { name: "EN" }).click();
  await page.context().close();

  // -------------------------------------------------------------------------
  section("Observer: area-level only (NFR06)");
  page = await session(browser, "01700000005", "Observer@2026");
  check("observer nav: coverage + reports only", (await navLabels(page)).join("|") === "Area coverage|Reports");
  await page.getByRole("row", { name: /Fazilpur/ }).waitFor();
  check("no household drawers for observers", (await page.getByRole("button", { name: "Unserved households" }).count()) === 0);
  await page.goto(`${BASE}/dashboard/conflicts`);
  check("direct URL to a forbidden page is redirected", !page.url().includes("/conflicts"), page.url());
  await page.goto(`${BASE}/dashboard/reports`);
  await page.getByText("Anonymised operation summary").first().waitFor();
  const body = await page.locator("main").innerText();
  check("summary report has no short codes or phone numbers", !/FN-\d{4}/.test(body) && !/01[3-9]\d{8}/.test(body));
  await page.context().close();

  // -------------------------------------------------------------------------
  section("Operation Administrator: setup, CSV preview/import, close, join requests (UC-06, UC-07)");
  page = await session(browser, "01700000002", "OpsAdmin@2026");
  await sidebar(page).getByRole("link", { name: "Operation setup" }).click();
  await page.getByLabel("Operation name").fill("Sylhet Flash Flood Test 2026");
  await page.getByLabel("Disaster type").fill("Flash Flood");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await page.getByText("Setup for: Sylhet Flash Flood Test 2026").waitFor();
  check("new operation created and selected", true);
  await page.getByLabel("Upazila").fill("Companiganj");
  await page.getByLabel("Union").fill("Charkalam");
  await page.getByLabel("Ward").fill("3");
  await page.getByRole("button", { name: "Add area" }).click();
  await page.getByRole("cell", { name: "03" }).waitFor();
  check("manual area added, ward normalised to 03", true);
  const csvText = "upazila,union_name,ward\nCompaniganj,Charkalam,04\nCompaniganj,Charkalam,03\n,Charhazari,01\nKabirhat,Narottampur,7\nKabirhat,Narottampur,07\n";
  await page.getByLabel("CSV bulk upload").setInputFiles({ name: "areas.csv", mimeType: "text/csv", buffer: Buffer.from(csvText) });
  check("client-side preview: 2 valid, 3 rejected", (await visible(page.getByText("2 valid rows", { exact: true }).waitFor({ timeout: 5000 }))) && (await page.getByText("3 rejected rows", { exact: true }).isVisible()));
  check("rejection reasons listed", (await page.getByText("Duplicate: already exists or repeated in the file.").count()) === 2 && (await page.getByText("Upazila, union and ward are all required.").isVisible()));
  await shot(page, "13-operations-csv");
  await page.getByRole("button", { name: "Import 2 valid rows" }).click();
  check("server confirms import", await visible(page.getByText("Imported 2 areas. Server rejected 0.").waitFor({ timeout: 5000 })));
  await page.getByLabel("Item name").last().fill("Tarpaulin Sheet");
  await page.getByLabel("Unit").last().fill("sheet");
  await page.getByRole("button", { name: "Add item" }).click();
  await page.getByRole("textbox", { name: "Item name" }).first().waitFor();
  check("relief item added", (await page.getByRole("textbox", { name: "Item name" }).count()) === 1);
  await page.getByRole("button", { name: "Close operation" }).click();
  check("close dialog explains blocking + 90-day timer", await page.getByRole("dialog").getByText(/90-day personal data retention timer starts now/).isVisible());
  await shot(page, "14-close-dialog");
  await page.getByRole("dialog").getByRole("button", { name: "Close operation" }).click();
  await page.getByText("This operation is closed. Setup is read-only.").waitFor();
  check("operation closed", (await prisma.operation.findFirstOrThrow({ where: { name: "Sylhet Flash Flood Test 2026" } })).status === "Closed");
  await page.getByLabel("Operation", { exact: true }).selectOption({ label: "Feni & Noakhali Flash Flood Response 2026" });
  await sidebar(page).getByRole("link", { name: "Organisations & members" }).click();
  const cumilla = page.getByRole("row", { name: /Cumilla Flood Response/ });
  await cumilla.getByRole("button", { name: "Approve" }).click();
  check("cannot approve membership of an unapproved organisation", await visible(page.getByText(/organisation itself has not been approved/).waitFor({ timeout: 5000 })));
  await cumilla.getByRole("button", { name: "Reject" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Reject" }).click();
  await cumilla.getByText("Rejected").waitFor();
  check("join request rejected after confirmation", true);
  await page.context().close();

  // -------------------------------------------------------------------------
  section("System Administrator: organisations, users, PII purge (UC-04, NFR07)");
  page = await session(browser, "01700000001", "SysAdmin@2026");
  await sidebar(page).getByRole("link", { name: "Organisations & members" }).click();
  await page.getByRole("row", { name: /Noakhali Rescue Network/ }).getByRole("button", { name: "Approve" }).click();
  await page.getByRole("row", { name: /Cumilla Flood Response/ }).waitFor();
  await page.getByRole("row", { name: /Cumilla Flood Response/ }).getByRole("button", { name: "Reject" }).click();
  check("rejection reason mandatory", await page.getByRole("dialog").getByRole("button", { name: "Reject" }).isDisabled());
  await page.getByRole("dialog").getByLabel("Rejection reason").fill("Registration documents are incomplete.");
  await page.getByRole("dialog").getByRole("button", { name: "Reject" }).click();
  await page.getByText("No organisations in this state.").waitFor();
  const orgs = await prisma.organisation.findMany({ where: { name: { in: ["Noakhali Rescue Network", "Cumilla Flood Response"] } } });
  check("approve + reject with reason persisted", orgs.find((o) => o.name.startsWith("Noakhali"))?.status === "Approved" && orgs.find((o) => o.name.startsWith("Cumilla"))?.rejectionReason === "Registration documents are incomplete.");
  await shot(page, "15-admin-orgs");
  await page.getByRole("tab", { name: "Users" }).click();
  await page.getByLabel("Full name").fill("Observer Two");
  await page.getByLabel("Mobile number").fill("01755667788");
  await page.getByRole("button", { name: "Create account" }).click();
  check("sysadmin creates account with temp password", /^[A-Za-z0-9]{10}$/.test(((await page.getByTestId("temp-password").textContent()) ?? "").trim()));
  await page.getByRole("dialog").getByRole("button", { name: "Confirm" }).click();
  await page.getByRole("tab", { name: "PII retention purge" }).click();
  await page.getByRole("button", { name: "Preview (dry run)" }).click();
  check("dry run: nothing past 90 days yet", await visible(page.getByText("No closed operation is past the 90-day retention period.").waitFor({ timeout: 5000 })));
  const sylhet = await prisma.operation.findFirstOrThrow({ where: { name: "Sylhet Flash Flood Test 2026" } });
  await prisma.operation.update({ where: { operationId: sylhet.operationId }, data: { closedAt: new Date(Date.now() - 91 * 86_400_000) } });
  await page.getByRole("button", { name: "Preview (dry run)" }).click();
  await page.getByRole("cell", { name: "Sylhet Flash Flood Test 2026" }).waitFor();
  await page.getByRole("button", { name: "Run purge" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Run purge" }).click();
  check("purge runs and reports counts", await visible(page.getByText(/Redacted \d+ households/).waitFor({ timeout: 10_000 })));
  check("purged operation listed for verification", await page.getByRole("row", { name: /Sylhet Flash Flood Test 2026/ }).isVisible());
  await shot(page, "16-purge");
  await page.context().close();

  // -------------------------------------------------------------------------
  section("Field volunteers are sent to the field app");
  page = await session(browser, "01811000020", "Volunteer@2026");
  check("FIELD_VOLUNTEER → /field", page.url().includes("/field"));
  await page.goto(`${BASE}/dashboard/coverage`);
  check("dashboard refuses field volunteers", page.url().includes("/field"));
  await page.context().close();

  check("no uncaught page errors", pageErrors.length === 0, pageErrors);
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
