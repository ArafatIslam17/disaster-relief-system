/* eslint-disable @typescript-eslint/no-explicit-any -- assertion script over untyped HTTP JSON; the only sanctioned exception (see CLAUDE.md §6). */
/**
 * End-to-end API test. Re-seeds the database, then drives every endpoint over HTTP the way the
 * PWA and admin console will. Requires a running server:
 *
 *   npm run build && npm start            # or npm run dev
 *   npm run test:api                      # API_BASE defaults to http://localhost:3000
 *
 * DESTRUCTIVE: truncates and re-seeds the database in DATABASE_URL.
 */
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const BASE = process.env.API_BASE ?? "http://localhost:3000";
const prisma = new PrismaClient();

let passed = 0;
const failures: string[] = [];
function check(name: string, cond: unknown, detail?: unknown) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(name);
    console.log(`  ✗ ${name}${detail === undefined ? "" : ` — ${JSON.stringify(detail).slice(0, 400)}`}`);
  }
}
function section(title: string) {
  console.log(`\n${title}`);
}

type Res = { status: number; body: any; text: string; headers: Headers };

class Client {
  private cookie: string | null = null;
  constructor(readonly label: string) {}
  async req(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Res> {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(this.cookie ? { Cookie: this.cookie } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(";");
      if (pair.startsWith("relief_session=")) this.cookie = pair.endsWith("=") ? null : pair;
    }
    const text = await res.text();
    let parsed: any = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
    return { status: res.status, body: parsed, text, headers: res.headers };
  }
  get = (p: string) => this.req("GET", p);
  post = (p: string, b?: unknown, h?: Record<string, string>) => this.req("POST", p, b ?? {}, h);
  patch = (p: string, b?: unknown) => this.req("PATCH", p, b ?? {});
  async login(mobileNumber: string, password: string, deviceId?: string, deviceLabel?: string) {
    return this.post("/api/auth/login", { mobileNumber, password, deviceId, deviceLabel });
  }
}

const iso = (d = new Date()) => d.toISOString();
const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000);

async function main() {
  console.log(`Re-seeding database and testing ${BASE}`);
  execSync("npx tsx prisma/seed.ts", { stdio: "ignore" });

  // ---------------------------------------------------------------------------
  section("Auth: login, lockout, temp password (UC-01..05, NFR01-03)");
  const anon = new Client("anon");
  let r = await anon.login("01711000011", "wrong-password-1");
  check("wrong password → 401 generic", r.status === 401 && r.body.error.code === "UNAUTHENTICATED", r.body);
  r = await anon.login("01799999999", "whatever123");
  check("unknown mobile → same 401", r.status === 401 && r.body.error.message === "Mobile number or password is incorrect.");

  const shirin = new Client("shirin");
  for (let i = 1; i <= 4; i++) await shirin.login("01911000031", `bad-${i}`);
  r = await shirin.login("01911000031", "bad-5");
  check("5th failure locks account (403 ACCOUNT_LOCKED)", r.status === 403 && r.body.error.code === "ACCOUNT_LOCKED", r.body);
  const lockedUntil = new Date(r.body?.error?.details?.lockedUntil ?? 0).getTime();
  check("lockout is 15 minutes", Math.abs(lockedUntil - Date.now() - 15 * 60_000) < 60_000, r.body?.error?.details);
  r = await shirin.login("01911000031", "Coordinator@2026");
  check("correct password still refused while locked", r.status === 403 && r.body.error.code === "ACCOUNT_LOCKED");

  r = await anon.login("01611000040", "Coordinator@2026");
  check("PendingApproval user blocked", r.status === 403 && r.body.error.code === "ACCOUNT_PENDING", r.body);
  r = await anon.login("01711000012", "Volunteer@2026");
  check("Deactivated user blocked", r.status === 403 && r.body.error.code === "ACCOUNT_DEACTIVATED", r.body);

  const sys = new Client("sysadmin");
  r = await sys.login("01700000001", "SysAdmin@2026");
  check("sysadmin login", r.status === 200 && r.body.user.role === "SYSTEM_ADMINISTRATOR", r.body);
  const shirinId = (await prisma.user.findUniqueOrThrow({ where: { mobileNumber: "01911000031" } })).userId;
  r = await sys.post("/api/auth/reset-temp-password", { userId: shirinId });
  check("sysadmin issues temp password + unlocks", r.status === 200 && r.body.unlocked === true && typeof r.body.temporaryPassword === "string", r.body);
  const temp = r.body.temporaryPassword as string;
  r = await shirin.login("01911000031", temp);
  check("temp password login → mustChangePassword", r.status === 200 && r.body.mustChangePassword === true, r.body);
  r = await shirin.get("/api/coverage");
  check("APIs blocked until password changed", r.status === 403 && r.body.error.code === "PASSWORD_CHANGE_REQUIRED", r.body);
  r = await shirin.post("/api/auth/change-password", { currentPassword: temp, newPassword: "Shirin@2026x" });
  check("change password", r.status === 200, r.body);
  r = await shirin.get("/api/coverage");
  check("APIs available after change", r.status === 200);

  const rafiq = new Client("rafiqul");
  await rafiq.login("01711000010", "Coordinator@2026");
  const kamrul = await prisma.user.findUniqueOrThrow({ where: { mobileNumber: "01811000022" } });
  r = await rafiq.post("/api/auth/reset-temp-password", { userId: kamrul.userId });
  check("coordinator cannot reset another org's user", r.status === 403, r.body);

  // ---------------------------------------------------------------------------
  section("Registration & approvals (UC-01, UC-03, UC-04, UC-05)");
  r = await anon.get("/api/auth/organisations");
  check("public approved org list", r.status === 200 && r.body.organisations.length === 3);
  const shobujId = r.body.organisations.find((o: any) => o.name === "Shobuj Bangla Relief").organisationId;
  r = await anon.post("/api/auth/register", { organisationId: shobujId, fullName: "Rumana Akter", mobileNumber: "01722334455", password: "Rumana2026" });
  check("register user → PendingApproval", r.status === 201 && r.body.status === "PendingApproval", r.body);
  const rumanaId = r.body.userId;
  r = await anon.post("/api/auth/register", { organisationId: shobujId, fullName: "Dup", mobileNumber: "01722334455", password: "Rumana2026" });
  check("duplicate mobile → 409", r.status === 409);
  const cumilla = await prisma.organisation.findUniqueOrThrow({ where: { name: "Cumilla Flood Response" } });
  r = await anon.post("/api/auth/register", { organisationId: cumilla.organisationId, fullName: "X Y", mobileNumber: "01733334444", password: "Abcdefg12" });
  check("cannot register under Pending org", r.status === 400, r.body);
  r = await anon.post("/api/auth/register-org", { organisation: { name: "Noakhali Rescue Network", orgType: "Volunteer Group" }, coordinator: { fullName: "Saiful Islam", mobileNumber: "01744556677", password: "Saiful2026" } });
  check("register-org → org Pending + coordinator PendingApproval", r.status === 201 && r.body.organisationStatus === "Pending", r.body);
  const nrnOrgId = r.body.organisationId;
  r = await rafiq.patch(`/api/members/${rumanaId}`, { action: "approve" });
  check("coordinator approves own-org member", r.status === 200 && r.body.status === "Active", r.body);
  r = await rafiq.patch(`/api/members/${rumanaId}`, { action: "assignRole", role: "OPERATION_ADMINISTRATOR" });
  check("coordinator cannot grant admin roles", r.status === 403);
  r = await sys.get("/api/organisations?status=Pending");
  check("sysadmin sees pending orgs", r.status === 200 && r.body.organisations.length === 2);
  r = await sys.patch(`/api/organisations/${nrnOrgId}`, { decision: "approve" });
  check("approve org activates initial coordinator", r.status === 200 && r.body.usersUpdated === 1, r.body);
  r = await sys.patch(`/api/organisations/${cumilla.organisationId}`, { decision: "reject" });
  check("reject without reason → 422", r.status === 422);
  r = await sys.patch(`/api/organisations/${cumilla.organisationId}`, { decision: "reject", rejectionReason: "Registration documents incomplete." });
  check("reject with reason", r.status === 200 && r.body.status === "Rejected");
  r = await anon.login("01744556677", "Saiful2026");
  check("approved org's coordinator can sign in", r.status === 200, r.body);
  r = await sys.post("/api/members", { fullName: "Observer Two", mobileNumber: "01755667788", role: "OBSERVER" });
  check("sysadmin creates observer with temp password", r.status === 201 && r.body.mustChangePassword === true, r.body);

  // ---------------------------------------------------------------------------
  section("Operation context");
  const ops = (await rafiq.get("/api/operations")).body.operations;
  const op = ops.find((o: any) => o.status === "Active");
  check("active operation listed with my membership", op && op.myMembership?.status === "Approved", ops);
  const opDetail = (await rafiq.get(`/api/operations/${op.operationId}/setup`)).body;
  const area = (union: string) => opDetail.areas.find((a: any) => a.unionName === union);
  const item = (name: string) => opDetail.reliefItems.find((i: any) => i.itemName.startsWith(name)).itemId;
  const fazilpur = area("Fazilpur").areaId;
  const dharmapur = area("Dharmapur").areaId;

  // ---------------------------------------------------------------------------
  section("Sync: idempotency, short codes, merge, conflicts (UC-16, NFR09, FR16)");
  const sumaiya = new Client("sumaiya");
  const devS = randomUUID();
  r = await sumaiya.login("01711000011", "Volunteer@2026", devS, "Test phone — Sumaiya");
  check("volunteer login registers device", r.status === 200 && r.body.device?.deviceId === devS, r.body);
  const sync = (c: Client, deviceId: string, events: unknown[], extra: Record<string, unknown> = {}) =>
    c.post("/api/sync", { operationId: op.operationId, deviceId, areaIds: [fazilpur, dharmapur], events, ...extra });

  const hhId = randomUUID();
  const createEv = {
    eventId: randomUUID(),
    entityType: "HOUSEHOLD",
    entityId: hhId,
    action: "CREATE",
    baseVersion: 0,
    clientTime: iso(hoursAgo(2)),
    payload: { areaId: dharmapur, headName: "Jahanara Begum", mobileNumber: "01713667201", memberCount: 7, consentGiven: true, consentAt: iso(hoursAgo(2)) },
  };
  r = await sync(sumaiya, devS, [createEv]);
  check("household CREATE applied", r.status === 200 && r.body.acknowledgedIds.includes(createEv.eventId), r.body);
  const shortCode = r.body.householdShortCodes?.[hhId];
  check("server assigns FN-#### short code", /^FN-\d{4}$/.test(shortCode ?? ""), r.body.householdShortCodes);
  check("post-sync duplicate scoring creates pair vs FN-1005", r.body.postSync.duplicatePairsCreated >= 1, r.body.postSync);

  r = await sync(sumaiya, devS, [createEv]);
  check("replayed batch acknowledged without re-applying (NFR09)", r.body.acknowledgedIds.includes(createEv.eventId) && r.body.results[0].status === "duplicate" && r.body.householdShortCodes[hhId] === shortCode, r.body.results);
  check("still exactly one household row", (await prisma.household.count({ where: { householdId: hhId } })) === 1);

  const raceId = randomUUID();
  const raceEv = { ...createEv, eventId: randomUUID(), entityId: raceId, payload: { ...createEv.payload, headName: "Race Condition Test", mobileNumber: null } };
  const [ra, rb] = await Promise.all([sync(sumaiya, devS, [raceEv]), sync(sumaiya, devS, [raceEv])]);
  check("concurrent duplicate uploads both acknowledged, applied once", ra.body.acknowledgedIds.includes(raceEv.eventId) && rb.body.acknowledgedIds.includes(raceEv.eventId) && (await prisma.household.count({ where: { householdId: raceId } })) === 1 && (await prisma.syncEvent.count({ where: { eventId: raceEv.eventId } })) === 1, [ra.body.results, rb.body.results]);

  r = await sync(sumaiya, devS, [{ ...createEv, eventId: randomUUID(), payload: { ...createEv.payload, consentGiven: false } }]);
  check("consent required → rejected, non-retryable", r.body.rejected[0]?.code === "INVALID_PAYLOAD" && r.body.rejected[0].retryable === false, r.body.rejected);
  r = await sync(sumaiya, devS, [{ ...createEv, eventId: randomUUID(), entityId: randomUUID(), payload: { ...createEv.payload, headName: "জাহানারা" } }]);
  check("Bangla head_name rejected (English letters only)", r.body.rejected[0]?.code === "INVALID_PAYLOAD", r.body.rejected);

  // Coordinator edits member_count online (v1 → v2).
  r = await rafiq.patch(`/api/households/${shortCode}`, { baseVersion: 1, changes: { memberCount: 8 } });
  check("coordinator online edit → v2", r.status === 200 && r.body.household.version === 2, r.body);
  r = await rafiq.patch(`/api/households/${shortCode}`, { baseVersion: 1, changes: { memberCount: 9 } });
  check("stale online edit → 409", r.status === 409, r.body);

  // Device edited offline from base v1: member_count (same field → conflict) + head_name (auto-merge).
  const updEv = {
    eventId: randomUUID(),
    entityType: "HOUSEHOLD",
    entityId: hhId,
    action: "UPDATE",
    baseVersion: 1,
    clientTime: iso(hoursAgo(1)),
    payload: { changes: { memberCount: 6, headName: "Jahanara Begum Khan" } },
  };
  r = await sync(sumaiya, devS, [updEv]);
  const res0 = r.body.results?.[0];
  check("same-field collision → CONFLICT, other field auto-merged", res0?.status === "applied" && res0.conflicts?.length === 1 && res0.conflicts[0].fieldName === "member_count" && res0.mergedFields?.includes("head_name"), res0);
  const hh = await prisma.household.findUniqueOrThrow({ where: { householdId: hhId } });
  check("server value kept for member_count; head_name merged; version 3", hh.memberCount === 8 && hh.headName === "Jahanara Begum Khan" && hh.version === 3, hh);
  const conflictId = res0?.conflicts?.[0]?.conflictId;
  const rafiqNotes = (await rafiq.get("/api/notifications?unread=true")).body;
  check("coordinator notified of conflict", rafiqNotes.notifications.some((n: any) => n.type === "CONFLICT_OPEN" && n.linkPath === `/dashboard/conflicts?id=${conflictId}`));

  // ---------------------------------------------------------------------------
  section("Conflict resolution (UC-17)");
  r = await rafiq.get("/api/conflicts");
  check("coordinator conflict queue includes new + seeded own-org conflict", r.status === 200 && r.body.conflicts.length === 2, r.body.conflicts?.map((c: any) => c.household.shortCode));
  const mahmud = new Client("mahmudul");
  const devM = randomUUID();
  await mahmud.login("01811000020", "Volunteer@2026", devM, "Test phone — Mahmudul");
  r = await mahmud.get("/api/conflicts");
  check("field volunteer cannot read conflict queue", r.status === 403);
  const jannat = new Client("jannatul");
  await jannat.login("01811000021", "Coordinator@2026");
  r = await jannat.post(`/api/conflicts/${conflictId}/resolve`, { choice: "local" });
  check("other org's coordinator cannot resolve", r.status === 403, r.body);
  r = await rafiq.post(`/api/conflicts/${conflictId}/resolve`, { choice: "local" });
  check("resolve with device value → v4 CONFLICT_RESOLUTION", r.status === 200 && r.body.version === 4, r.body);
  const v4 = await prisma.householdVersion.findUnique({ where: { householdId_version: { householdId: hhId, version: 4 } } });
  check("HOUSEHOLD_VERSION row appended", v4?.changeSource === "CONFLICT_RESOLUTION" && v4.memberCount === 6, v4);
  r = await rafiq.post(`/api/conflicts/${conflictId}/resolve`, { choice: "server" });
  check("double resolve → 409", r.status === 409);

  // ---------------------------------------------------------------------------
  section("Distributions, cross-org flag, void window (UC-15, FR20)");
  const rice = item("Rice");
  const water = item("Drinking Water");
  const distS = randomUUID();
  r = await sync(sumaiya, devS, [
    { eventId: randomUUID(), entityType: "DISTRIBUTION", entityId: distS, action: "CREATE", baseVersion: 0, clientTime: iso(hoursAgo(3)), payload: { householdId: hhId, areaId: dharmapur, isAnonymous: false, distributedAt: iso(hoursAgo(3)), items: [{ itemId: rice, quantity: 1 }, { itemId: water, quantity: 4 }] } },
  ]);
  check("Shobuj distribution recorded", r.body.results?.[0]?.status === "applied", r.body.results);
  const distM = randomUUID();
  r = await sync(mahmud, devM, [
    { eventId: randomUUID(), entityType: "DISTRIBUTION", entityId: distM, action: "CREATE", baseVersion: 0, clientTime: iso(hoursAgo(1)), payload: { householdId: hhId, areaId: dharmapur, isAnonymous: false, distributedAt: iso(hoursAgo(1)), items: [{ itemId: rice, quantity: 1 }] } },
  ]);
  check("FYV distribution of same item within 24h → DISTRIBUTION_FLAG", r.body.results?.[0]?.flagIds?.length === 1, r.body.results);
  const flagId = r.body.results?.[0]?.flagIds?.[0];

  const anonDist = randomUUID();
  r = await sync(sumaiya, devS, [
    { eventId: randomUUID(), entityType: "DISTRIBUTION", entityId: anonDist, action: "CREATE", baseVersion: 0, clientTime: iso(), payload: { householdId: null, areaId: fazilpur, isAnonymous: true, distributedAt: iso(), items: [{ itemId: water, quantity: 2 }] } },
  ]);
  check("anonymous distribution recorded", r.body.results?.[0]?.status === "applied", r.body.results);

  r = await sync(mahmud, devM, [{ eventId: randomUUID(), entityType: "DISTRIBUTION", entityId: distS, action: "VOID", baseVersion: 1, clientTime: iso(), payload: { cancelReason: "Wrong household card" } }]);
  check("cannot void another volunteer's distribution", r.body.rejected?.[0]?.code === "FORBIDDEN", r.body.rejected);
  const old = await prisma.distribution.findFirstOrThrow({ where: { recordedByUser: { mobileNumber: "01711000011" }, status: "Active", distributedAt: { lt: hoursAgo(48) } } });
  r = await sync(sumaiya, devS, [{ eventId: randomUUID(), entityType: "DISTRIBUTION", entityId: old.distributionId, action: "VOID", baseVersion: 1, clientTime: iso(), payload: { cancelReason: "Recorded twice by mistake" } }]);
  check("void after 24h rejected (VOID_WINDOW_EXPIRED)", r.body.rejected?.[0]?.code === "VOID_WINDOW_EXPIRED", r.body.rejected);
  r = await sync(sumaiya, devS, [{ eventId: randomUUID(), entityType: "DISTRIBUTION", entityId: anonDist, action: "VOID", baseVersion: 1, clientTime: iso(), payload: { cancelReason: "Recorded twice by mistake" } }]);
  const voided = await prisma.distribution.findUniqueOrThrow({ where: { distributionId: anonDist } });
  check("own distribution voided within 24h, row kept", r.body.results?.[0]?.status === "applied" && voided.status === "Voided" && voided.cancelReason === "Recorded twice by mistake", voided);

  // ---------------------------------------------------------------------------
  section("Delta download & phone masking (NFR06)");
  r = await mahmud.post("/api/sync", { operationId: op.operationId, deviceId: devM, areaIds: [fazilpur], events: [] });
  const fn1001 = r.body.delta?.households?.find((h: any) => h.shortCode === "FN-1001");
  const fn1018 = r.body.delta?.households?.find((h: any) => h.shortCode === "FN-1018");
  check("other org's phone masked (017XX-XXX678)", fn1001?.mobileNumber === "017XX-XXX678" && fn1001.mobileMasked === true, fn1001);
  check("own org's phone visible", fn1018?.mobileNumber === "01712345678" && fn1018.mobileMasked === false, fn1018);
  check("delta has areas + relief items + distributions", r.body.delta.areas.length === 6 && r.body.delta.reliefItems.length === 5 && r.body.delta.distributions.length > 0);
  const since = r.body.delta.nextSince;
  r = await mahmud.post("/api/sync", { operationId: op.operationId, deviceId: devM, areaIds: [fazilpur], since, events: [] });
  check("incremental delta smaller than full", r.body.delta.households.length < 6, r.body.delta.households.length);
  r = await mahmud.post("/api/sync", { operationId: op.operationId, deviceId: devS, areaIds: [], events: [] });
  check("syncing with someone else's device → 403", r.status === 403);

  // ---------------------------------------------------------------------------
  section("Duplicates (UC-18, State Diagram 06)");
  const oa = new Client("opsadmin");
  await oa.login("01700000002", "OpsAdmin@2026");
  r = await oa.get("/api/duplicates");
  const scores = (r.body.pairs ?? []).map((p: any) => Number(p.score));
  check("pairs sorted by score DESC", scores.length >= 3 && scores.every((s: number, i: number) => i === 0 || scores[i - 1] >= s), scores);
  const newPair = r.body.pairs.find((p: any) => [p.householdA.shortCode, p.householdB.shortCode].includes(shortCode));
  check("new pair is Likely with exact mobile match, phones masked for admin", newPair?.label === "Likely" && newPair.mobileMatch === "exact" && newPair.householdA.mobileMasked === true, newPair);
  r = await oa.post(`/api/duplicates/${newPair.pairId}`, { action: "undoLink" });
  check("undoLink from PendingReview → 409", r.status === 409);
  r = await oa.post(`/api/duplicates/${newPair.pairId}`, { action: "confirmLink" });
  check("confirmLink → Linked", r.status === 200 && r.body.status === "Linked", r.body);
  r = await oa.post(`/api/duplicates/${newPair.pairId}`, { action: "undoLink" });
  check("undoLink → PendingReview", r.status === 200 && r.body.status === "PendingReview", r.body);
  r = await oa.post(`/api/duplicates/${newPair.pairId}`, { action: "markNotDuplicate" });
  check("markNotDuplicate → NotDuplicate", r.status === 200 && r.body.status === "NotDuplicate");
  r = await oa.post("/api/duplicates/scan", { operationId: op.operationId });
  check("full rescan does not reopen reviewed pairs", r.status === 200 && (await prisma.duplicatePair.findUniqueOrThrow({ where: { pairId: newPair.pairId } })).status === "NotDuplicate", r.body);

  // ---------------------------------------------------------------------------
  section("Distribution flags (UC-19)");
  r = await jannat.get("/api/flags");
  check("FYV coordinator sees flag involving own org", r.status === 200 && r.body.flags.some((f: any) => f.flagId === flagId), r.body);
  r = await jannat.post(`/api/flags/${flagId}/review`, { status: "Justified" });
  check("review without note → 422", r.status === 422);
  r = await jannat.post(`/api/flags/${flagId}/review`, { status: "Justified", note: "Household of 6 received half rations in the morning." });
  check("flag marked Justified", r.status === 200 && r.body.status === "Justified", r.body);

  // ---------------------------------------------------------------------------
  section("Coverage & unserved release (UC-20, UC-21)");
  const observer = new Client("observer");
  await observer.login("01700000005", "Observer@2026");
  r = await observer.get("/api/coverage");
  const ch = r.body.areas?.find((a: any) => a.unionName === "Chhagalnaiya");
  check("No Records / কোনো তথ্য নেই for empty ward", ch?.status === "NoRecords" && ch.label.en === "No Records" && ch.label.bn === "কোনো তথ্য নেই", ch);
  r = await oa.post("/api/coverage/release-unserved", { areaId: fazilpur });
  check("release unserved list", r.status === 201 && r.body.households >= 1, r.body);
  r = await oa.post("/api/coverage/release-unserved", { areaId: area("Chhagalnaiya").areaId });
  check("nothing to release in empty ward → 409", r.status === 409);
  r = await sumaiya.post("/api/sync", { operationId: op.operationId, deviceId: devS, areaIds: [fazilpur], since, events: [] });
  check("released list reaches field device in delta", r.body.delta?.releasedUnservedLists?.length === 1 && r.body.delta.releasedUnservedLists[0].households.length >= 1, r.body.delta?.releasedUnservedLists);

  // ---------------------------------------------------------------------------
  section("Privacy & RBAC");
  r = await observer.get("/api/households");
  check("observer cannot read household records", r.status === 403);
  r = await observer.get("/api/audit");
  check("observer cannot read audit log", r.status === 403);
  r = await rafiq.post("/api/coverage/release-unserved", { areaId: fazilpur }, { Origin: "https://evil.example" });
  check("cross-origin mutating request rejected", r.status === 403 && r.body.error.message.includes("Cross-origin"));
  r = await new Client("fresh").get("/api/coverage");
  check("unauthenticated → 401", r.status === 401, r.body);

  // ---------------------------------------------------------------------------
  section("Reports (UC-22..25)");
  r = await observer.get("/api/reports?type=summary&format=csv");
  check("summary CSV for observer", r.status === 200 && r.headers.get("content-type")?.includes("text/csv"));
  check("summary CSV has no short codes or phone numbers", !/FN-\d{4}/.test(r.text) && !/01[3-9]\d{8}/.test(r.text));
  r = await observer.get("/api/reports?type=summary&format=html");
  check("print-ready HTML", r.status === 200 && r.text.includes("@page") && r.text.includes("Coverage by area") && !/FN-\d{4}/.test(r.text));
  r = await observer.get("/api/reports?type=organisation");
  check("observer cannot get organisation report", r.status === 403);
  r = await rafiq.get("/api/reports?type=organisation");
  check("coordinator organisation report (own org only)", r.status === 200 && r.body.organisation === "Shobuj Bangla Relief" && r.body.rows.every((x: any) => x.recordedBy !== "Mahmudul Hasan"), r.body?.summary);
  r = await rafiq.get("/api/reports?type=summary");
  check("coordinator cannot get admin summary", r.status === 403);

  // ---------------------------------------------------------------------------
  section("Audit log (append-only, filters, CSV)");
  r = await sys.get("/api/audit?action=LOGIN&limit=5");
  check("audit filter + pagination", r.status === 200 && r.body.entries.length === 5 && r.body.entries.every((e: any) => e.action === "LOGIN") && r.body.nextCursor, r.body.entries?.length);
  r = await sys.get("/api/audit?format=csv&entityType=CONFLICT");
  check("audit CSV download", r.status === 200 && r.text.includes("CONFLICT_RESOLVED"));
  r = await rafiq.get("/api/audit?limit=500");
  const shobuj = (await prisma.organisation.findUniqueOrThrow({ where: { name: "Shobuj Bangla Relief" } })).organisationId;
  check("coordinator audit scoped to own org", r.body.entries.every((e: any) => e.organisationId === shobuj));
  r = await sys.req("DELETE", "/api/audit");
  check("no DELETE route on audit", r.status === 405);
  let triggerBlocked = false;
  try {
    await prisma.$executeRawUnsafe(`UPDATE audit_log SET action = 'TAMPERED'`);
  } catch {
    triggerBlocked = true;
  }
  check("DB trigger rejects audit UPDATE", triggerBlocked);

  // ---------------------------------------------------------------------------
  section("Notifications");
  r = await rafiq.get("/api/notifications");
  check("list notifications", r.status === 200 && r.body.unreadCount > 0);
  r = await rafiq.patch("/api/notifications", { all: true });
  check("mark all read", r.status === 200 && r.body.updated > 0);
  check("unread now zero", (await rafiq.get("/api/notifications")).body.unreadCount === 0);

  // ---------------------------------------------------------------------------
  section("Operation setup, CSV import, close (UC-06..09)");
  r = await rafiq.post("/api/operations", { name: "Should Fail Operation", disasterType: "Cyclone", startDate: "2026-11-16" });
  check("coordinator cannot create operations", r.status === 403);
  r = await oa.post("/api/operations", { name: "Sylhet Cyclone Response Test", disasterType: "Cyclone", startDate: "2026-11-16" });
  check("create operation", r.status === 201, r.body);
  const newOp = r.body.operationId;
  r = await oa.post(`/api/operations/${newOp}/setup`, { action: "addArea", area: { upazila: "Companiganj", unionName: "Charkalam", ward: "3" } });
  check("add area manually (ward normalised to 03)", r.status === 201 && r.body.area.ward === "03", r.body);
  const csv = "upazila,union_name,ward\nCompaniganj,Charkalam,04\nCompaniganj,Charkalam,03\n,Charhazari,01\nKabirhat,Narottampur,7\nKabirhat,Narottampur,07\n";
  r = await oa.post(`/api/operations/${newOp}/setup`, { action: "importAreasCsv", csv });
  check("CSV import: exact valid vs rejected counts (2 valid, 3 rejected)", r.body.totalRows === 5 && r.body.validCount === 2 && r.body.rejectedCount === 3, r.body);
  r = await oa.post(`/api/operations/${newOp}/setup`, { action: "addItem", itemName: "Tarpaulin Sheet", unit: "sheet" });
  check("add relief item", r.status === 201, r.body);
  const tarp = r.body.item.itemId;
  r = await oa.post(`/api/operations/${newOp}/setup`, { action: "updateItem", itemId: tarp, unit: "piece" });
  check("update relief item", r.status === 200 && r.body.item.unit === "piece");
  r = await oa.post(`/api/operations/${newOp}/setup`, { action: "removeItem", itemId: tarp });
  check("remove unused relief item", r.status === 200);
  r = await rafiq.post(`/api/operations/${newOp}/setup`, { action: "requestMembership" });
  check("coordinator requests membership", r.status === 201 && r.body.membership.status === "Pending", r.body);
  r = await oa.post(`/api/operations/${newOp}/setup`, { action: "reviewMembership", organisationId: shobuj, decision: "approve" });
  check("admin approves membership", r.status === 200 && r.body.membership.status === "Approved", r.body);
  r = await oa.patch(`/api/operations/${newOp}`, { action: "close" });
  check("close operation", r.status === 200 && r.body.operation.status === "Closed", r.body);
  r = await sumaiya.post("/api/sync", { operationId: newOp, deviceId: devS, areaIds: [], events: [] });
  check("sync to closed operation → 403 OPERATION_CLOSED", r.status === 403 && r.body.error.code === "OPERATION_CLOSED", r.body);
  r = await oa.post(`/api/operations/${newOp}/setup`, { action: "addItem", itemName: "Blanket", unit: "piece" });
  check("setup changes refused after close", r.status === 403);

  // ---------------------------------------------------------------------------
  section("90-day PII purge (NFR07)");
  const charkalam = await prisma.area.findFirstOrThrow({ where: { operationId: newOp, ward: "03" } });
  const purgeHh = randomUUID();
  const sumaiyaId = (await prisma.user.findUniqueOrThrow({ where: { mobileNumber: "01711000011" } })).userId;
  await prisma.household.create({ data: { householdId: purgeHh, shortCode: "FN-9001", areaId: charkalam.areaId, registeredBy: sumaiyaId, headName: "Purge Test", mobileNumber: "01799887766", memberCount: 3, consentGiven: true, consentAt: new Date(), gpsLocation: "22.81234,91.10234" } });
  await prisma.householdVersion.create({ data: { householdId: purgeHh, version: 1, headName: "Purge Test", mobileNumber: "01799887766", memberCount: 3, changedBy: sumaiyaId, changeSource: "FIELD_EDIT" } });
  await prisma.auditLog.create({ data: { userId: sumaiyaId, action: "HOUSEHOLD_CREATED", entityType: "HOUSEHOLD", entityId: purgeHh, newValue: { headName: "Purge Test", mobileNumber: "01799887766", memberCount: 3 } } });
  await prisma.operation.update({ where: { operationId: newOp }, data: { closedAt: new Date(Date.now() - 91 * 86_400_000) } });
  r = await oa.post("/api/operations/pii-purge", { dryRun: true });
  check("only System Administrator may purge", r.status === 403);
  r = await sys.post("/api/operations/pii-purge", {});
  check("dry run by default lists eligible operation", r.status === 200 && r.body.dryRun === true && r.body.operations.length === 1 && r.body.operations[0].purged === false, r.body);
  r = await sys.post("/api/operations/pii-purge", { dryRun: false });
  check("purge executes", r.status === 200 && r.body.operations[0]?.purged === true, r.body);
  const ph = await prisma.household.findUniqueOrThrow({ where: { householdId: purgeHh } });
  check("household redacted", ph.headName === "[REDACTED]" && ph.mobileNumber === null && ph.gpsLocation === null, ph);
  const pv = await prisma.householdVersion.findFirstOrThrow({ where: { householdId: purgeHh } });
  check("version history redacted", pv.headName === "[REDACTED]" && pv.mobileNumber === null, pv);
  const pa = await prisma.auditLog.findFirstOrThrow({ where: { entityId: purgeHh, action: "HOUSEHOLD_CREATED" } });
  check("audit JSON redacted, row retained", !JSON.stringify(pa.newValue).includes("01799887766") && (pa.newValue as any).memberCount === 3, pa.newValue);
  check("active operation untouched", (await prisma.household.findUniqueOrThrow({ where: { shortCode: "FN-1001" } })).headName === "Md. Abdul Karim");
  let deleteBlocked = false;
  try {
    await prisma.$executeRawUnsafe(`DELETE FROM household_version`);
  } catch {
    deleteBlocked = true;
  }
  check("household_version DELETE still blocked after purge", deleteBlocked);

  // ---------------------------------------------------------------------------
  section("Device revocation & deactivation");
  const sumaiyaUser = await prisma.user.findUniqueOrThrow({ where: { mobileNumber: "01711000011" } });
  r = await rafiq.patch(`/api/members/${sumaiyaUser.userId}`, { action: "revokeDevice", deviceId: devS });
  check("coordinator revokes lost device", r.status === 200, r.body);
  r = await sumaiya.post("/api/sync", { operationId: op.operationId, deviceId: devS, areaIds: [], events: [] });
  check("revoked device → 403 DEVICE_REVOKED", r.status === 403 && r.body.error.code === "DEVICE_REVOKED", r.body);
  r = await anon.login("01711000011", "Volunteer@2026", devS);
  check("revoked device cannot sign in again", r.status === 403 && r.body.error.code === "DEVICE_REVOKED");
  const rumana = new Client("rumana");
  await rumana.login("01722334455", "Rumana2026");
  r = await rafiq.patch(`/api/members/${rumanaId}`, { action: "deactivate" });
  check("deactivate member", r.status === 200);
  r = await rumana.get("/api/notifications");
  check("deactivation takes effect on existing session", r.status === 403 && r.body.error.code === "ACCOUNT_DEACTIVATED", r.body);

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
