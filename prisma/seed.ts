/**
 * Seed: "Feni & Noakhali Flash Flood Response 2026"
 *
 * Produces a realistic, internally consistent dataset that exercises every
 * state in State Diagrams 01–06 so each queue/screen has something to show:
 *
 *   - 1 active operation, 6 areas (Ward 05 of Chhagalnaiya has 0 households → "No Records")
 *   - 5 relief items
 *   - 3 Approved organisations + 1 Pending organisation
 *   - Accounts for all 5 roles (plus Locked, Deactivated and PendingApproval users)
 *   - 25 households with append-only version history
 *   - 18 distributions (1 anonymous, 1 voided, 2 cross-org within 24h → flag)
 *   - 2 Open same-field conflicts (+1 Resolved for history)
 *   - 2 duplicate pairs (0.88 Likely, 0.71 Possible)
 *   - 1 cross-organisation 24-hour DISTRIBUTION_FLAG
 *   - Notifications and an append-only audit trail for all of the above
 *
 * DESTRUCTIVE: truncates every table first. Refuses to run in production unless
 * ALLOW_DESTRUCTIVE_SEED=true.
 */
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import {
  Prisma,
  PrismaClient,
  type UserRole,
  type UserStatus,
} from "@prisma/client";

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Bangladesh Standard Time (UTC+06:00) timestamp. */
function bd(dateTime: string): Date {
  return new Date(`${dateTime.replace(" ", "T")}:00+06:00`);
}

function addMinutes(d: Date, minutes: number): Date {
  return new Date(d.getTime() + minutes * 60_000);
}

/** Canonical (a < b) ordering matching PostgreSQL's uuid comparison. */
function orderPair(x: string, y: string): [string, string] {
  return x < y ? [x, y] : [y, x];
}

const ROLE_PASSWORDS: Record<UserRole, string> = {
  FIELD_VOLUNTEER: "Volunteer@2026",
  GROUP_COORDINATOR: "Coordinator@2026",
  OPERATION_ADMINISTRATOR: "OpsAdmin@2026",
  SYSTEM_ADMINISTRATOR: "SysAdmin@2026",
  OBSERVER: "Observer@2026",
};

const TABLES = [
  "audit_log",
  "notification",
  "distribution_flag",
  "duplicate_pair",
  "conflict",
  "sync_event",
  "distribution_item",
  "distribution",
  "household_version",
  "household",
  "relief_item",
  "area",
  "operation_membership",
  "operation",
  "device",
  "user",
  "organisation",
];

type AuditInput = Prisma.AuditLogCreateManyInput;
const audit: AuditInput[] = [];
function log(entry: Omit<AuditInput, "auditId">) {
  audit.push({ auditId: randomUUID(), ...entry });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (
    process.env.NODE_ENV === "production" &&
    process.env.ALLOW_DESTRUCTIVE_SEED !== "true"
  ) {
    throw new Error(
      "Refusing to seed: NODE_ENV=production and ALLOW_DESTRUCTIVE_SEED is not 'true'. " +
        "This script truncates every table.",
    );
  }

  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${TABLES.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`,
  );

  const passwordHashes = Object.fromEntries(
    await Promise.all(
      (Object.keys(ROLE_PASSWORDS) as UserRole[]).map(async (role) => [
        role,
        await bcrypt.hash(ROLE_PASSWORDS[role], 10),
      ]),
    ),
  ) as Record<UserRole, string>;

  // -------------------------------------------------------------------------
  // Organisations (State Diagram 01)
  // -------------------------------------------------------------------------
  const org = {
    shobuj: { organisationId: randomUUID(), name: "Shobuj Bangla Relief", orgType: "National NGO" },
    fyv: { organisationId: randomUUID(), name: "Feni Youth Volunteers", orgType: "Volunteer Group" },
    delta: { organisationId: randomUUID(), name: "Delta Aid Foundation", orgType: "Foundation" },
    cumilla: { organisationId: randomUUID(), name: "Cumilla Flood Response", orgType: "Community-Based Organisation" },
  };

  await prisma.organisation.createMany({
    data: [
      { ...org.shobuj, status: "Approved", createdAt: bd("2026-10-20 10:00") },
      { ...org.fyv, status: "Approved", createdAt: bd("2026-10-22 15:30") },
      { ...org.delta, status: "Approved", createdAt: bd("2026-10-25 11:15") },
      { ...org.cumilla, status: "Pending", createdAt: bd("2026-11-14 19:40") },
    ],
  });

  // -------------------------------------------------------------------------
  // Users (State Diagram 02) and devices
  // -------------------------------------------------------------------------
  type SeedUser = {
    key: string;
    fullName: string;
    mobileNumber: string;
    role: UserRole;
    status: UserStatus;
    organisationId: string | null;
    createdAt: Date;
    failedAttempts?: number;
    lockedUntil?: Date | null;
  };

  const now = new Date();
  const seedUsers: SeedUser[] = [
    { key: "sysadmin", fullName: "Tanvir Ahmed", mobileNumber: "01700000001", role: "SYSTEM_ADMINISTRATOR", status: "Active", organisationId: null, createdAt: bd("2026-10-15 09:00") },
    { key: "opsadmin", fullName: "Nusrat Jahan", mobileNumber: "01700000002", role: "OPERATION_ADMINISTRATOR", status: "Active", organisationId: null, createdAt: bd("2026-10-15 09:30") },
    { key: "observer", fullName: "Farhana Akter", mobileNumber: "01700000005", role: "OBSERVER", status: "Active", organisationId: null, createdAt: bd("2026-11-03 12:00") },
    { key: "coordShobuj", fullName: "Rafiqul Islam", mobileNumber: "01711000010", role: "GROUP_COORDINATOR", status: "Active", organisationId: org.shobuj.organisationId, createdAt: bd("2026-10-20 10:05") },
    { key: "volShobuj", fullName: "Sumaiya Rahman", mobileNumber: "01711000011", role: "FIELD_VOLUNTEER", status: "Active", organisationId: org.shobuj.organisationId, createdAt: bd("2026-10-21 08:45") },
    { key: "volShobujOld", fullName: "Tahmina Akter", mobileNumber: "01711000012", role: "FIELD_VOLUNTEER", status: "Deactivated", organisationId: org.shobuj.organisationId, createdAt: bd("2026-10-21 09:10") },
    { key: "coordFyv", fullName: "Jannatul Ferdous", mobileNumber: "01811000021", role: "GROUP_COORDINATOR", status: "Active", organisationId: org.fyv.organisationId, createdAt: bd("2026-10-22 15:35") },
    { key: "volFyv", fullName: "Mahmudul Hasan", mobileNumber: "01811000020", role: "FIELD_VOLUNTEER", status: "Active", organisationId: org.fyv.organisationId, createdAt: bd("2026-10-23 10:00") },
    { key: "volFyvLocked", fullName: "Kamrul Hasan", mobileNumber: "01811000022", role: "FIELD_VOLUNTEER", status: "Locked", organisationId: org.fyv.organisationId, createdAt: bd("2026-10-23 10:20"), failedAttempts: 5, lockedUntil: addMinutes(now, 15) },
    { key: "coordDelta", fullName: "Shirin Sultana", mobileNumber: "01911000031", role: "GROUP_COORDINATOR", status: "Active", organisationId: org.delta.organisationId, createdAt: bd("2026-10-25 11:20") },
    { key: "volDelta", fullName: "Arif Hossain", mobileNumber: "01911000030", role: "FIELD_VOLUNTEER", status: "Active", organisationId: org.delta.organisationId, createdAt: bd("2026-10-26 09:00") },
    { key: "pendingCumilla", fullName: "Shahidul Alam", mobileNumber: "01611000040", role: "GROUP_COORDINATOR", status: "PendingApproval", organisationId: org.cumilla.organisationId, createdAt: bd("2026-11-14 19:45") },
  ];

  const u: Record<string, string> = {};
  for (const s of seedUsers) u[s.key] = randomUUID();

  await prisma.user.createMany({
    data: seedUsers.map((s) => ({
      userId: u[s.key],
      organisationId: s.organisationId,
      fullName: s.fullName,
      mobileNumber: s.mobileNumber,
      passwordHash: passwordHashes[s.role],
      role: s.role,
      status: s.status,
      failedAttempts: s.failedAttempts ?? 0,
      lockedUntil: s.lockedUntil ?? null,
      createdAt: s.createdAt,
    })),
  });

  const dev = {
    volShobuj: randomUUID(),
    volShobujOld: randomUUID(),
    volFyv: randomUUID(),
    volFyvLocked: randomUUID(),
    volDelta: randomUUID(),
    coordShobuj: randomUUID(),
  };

  await prisma.device.createMany({
    data: [
      { deviceId: dev.volShobuj, userId: u.volShobuj, deviceLabel: "Walton Primo RX9 — Sumaiya", status: "Active", registeredAt: bd("2026-10-21 09:00"), lastSyncAt: bd("2026-11-12 18:05") },
      { deviceId: dev.volShobujOld, userId: u.volShobujOld, deviceLabel: "Symphony Z60 — Tahmina", status: "Revoked", registeredAt: bd("2026-10-21 09:20"), lastSyncAt: bd("2026-11-04 17:00") },
      { deviceId: dev.volFyv, userId: u.volFyv, deviceLabel: "Samsung Galaxy A15 — Mahmudul", status: "Active", registeredAt: bd("2026-10-23 10:10"), lastSyncAt: bd("2026-11-12 21:30") },
      { deviceId: dev.volFyvLocked, userId: u.volFyvLocked, deviceLabel: "Xiaomi Redmi 13C — Kamrul", status: "Active", registeredAt: bd("2026-10-23 10:30"), lastSyncAt: bd("2026-11-08 20:10") },
      { deviceId: dev.volDelta, userId: u.volDelta, deviceLabel: "Tecno Spark 20 — Arif", status: "Active", registeredAt: bd("2026-10-26 09:15"), lastSyncAt: bd("2026-11-10 19:45") },
      { deviceId: dev.coordShobuj, userId: u.coordShobuj, deviceLabel: "Lenovo Tab M10 — Rafiqul", status: "Active", registeredAt: bd("2026-10-20 10:30"), lastSyncAt: bd("2026-11-11 09:20") },
    ],
  });

  for (const o of [org.shobuj, org.fyv, org.delta]) {
    log({ userId: u.sysadmin, organisationId: o.organisationId, action: "ORGANISATION_APPROVED", entityType: "ORGANISATION", entityId: o.organisationId, oldValue: { status: "Pending" }, newValue: { status: "Approved" }, createdAt: bd("2026-10-26 12:00") });
  }
  log({ userId: null, organisationId: org.cumilla.organisationId, action: "ORGANISATION_REGISTERED", entityType: "ORGANISATION", entityId: org.cumilla.organisationId, newValue: { name: org.cumilla.name, status: "Pending" }, createdAt: bd("2026-11-14 19:40") });
  for (const s of seedUsers.filter((x) => x.status !== "PendingApproval" && x.key !== "sysadmin")) {
    log({ userId: u.sysadmin, organisationId: s.organisationId, action: "USER_APPROVED", entityType: "USER", entityId: u[s.key], oldValue: { status: "PendingApproval" }, newValue: { status: "Active", role: s.role }, createdAt: addMinutes(s.createdAt, 60) });
  }
  log({ userId: u.pendingCumilla, organisationId: org.cumilla.organisationId, action: "USER_REGISTERED", entityType: "USER", entityId: u.pendingCumilla, newValue: { status: "PendingApproval", role: "GROUP_COORDINATOR" }, createdAt: bd("2026-11-14 19:45") });
  log({ userId: u.volFyvLocked, organisationId: org.fyv.organisationId, action: "USER_LOCKED", entityType: "USER", entityId: u.volFyvLocked, oldValue: { status: "Active", failedAttempts: 4 }, newValue: { status: "Locked", failedAttempts: 5 }, createdAt: addMinutes(now, -1) });
  log({ userId: u.sysadmin, organisationId: org.shobuj.organisationId, action: "USER_DEACTIVATED", entityType: "USER", entityId: u.volShobujOld, oldValue: { status: "Active" }, newValue: { status: "Deactivated" }, createdAt: bd("2026-11-04 18:00") });
  log({ userId: u.sysadmin, organisationId: org.shobuj.organisationId, deviceId: dev.volShobujOld, action: "DEVICE_REVOKED", entityType: "DEVICE", entityId: dev.volShobujOld, oldValue: { status: "Active" }, newValue: { status: "Revoked" }, createdAt: bd("2026-11-04 18:01") });

  // -------------------------------------------------------------------------
  // Operation, memberships, areas, relief items (State Diagram 03)
  // -------------------------------------------------------------------------
  const operationId = randomUUID();
  await prisma.operation.create({
    data: {
      operationId,
      name: "Feni & Noakhali Flash Flood Response 2026",
      disasterType: "Flash Flood",
      startDate: new Date("2026-11-02"),
      status: "Active",
    },
  });
  log({ userId: u.opsadmin, action: "OPERATION_CREATED", entityType: "OPERATION", entityId: operationId, newValue: { name: "Feni & Noakhali Flash Flood Response 2026", status: "Active" }, createdAt: bd("2026-11-02 07:30") });

  await prisma.operationMembership.createMany({
    data: [
      { operationId, organisationId: org.shobuj.organisationId, status: "Approved", requestedAt: bd("2026-11-02 08:10"), reviewedAt: bd("2026-11-02 09:00") },
      { operationId, organisationId: org.fyv.organisationId, status: "Approved", requestedAt: bd("2026-11-02 08:40"), reviewedAt: bd("2026-11-02 09:05") },
      { operationId, organisationId: org.delta.organisationId, status: "Approved", requestedAt: bd("2026-11-02 10:20"), reviewedAt: bd("2026-11-02 11:00") },
      { operationId, organisationId: org.cumilla.organisationId, status: "Pending", requestedAt: bd("2026-11-14 19:50") },
    ],
  });
  for (const o of [org.shobuj, org.fyv, org.delta]) {
    log({ userId: u.opsadmin, organisationId: o.organisationId, action: "MEMBERSHIP_APPROVED", entityType: "OPERATION_MEMBERSHIP", entityId: `${operationId}:${o.organisationId}`, oldValue: { status: "Pending" }, newValue: { status: "Approved" }, createdAt: bd("2026-11-02 09:00") });
  }

  const areaDefs = [
    { key: "fazilpur", upazila: "Feni Sadar", unionName: "Fazilpur", ward: "03", gps: [23.0466, 91.364] },
    { key: "dharmapur", upazila: "Feni Sadar", unionName: "Dharmapur", ward: "07", gps: [23.03, 91.42] },
    { key: "kazirbag", upazila: "Feni Sadar", unionName: "Kazirbag", ward: "02", gps: [23.005, 91.39] },
    // Intentionally left with zero households → "No Records" coverage state.
    { key: "chhagalnaiya", upazila: "Feni Sadar", unionName: "Chhagalnaiya", ward: "05", gps: [23.0274, 91.5131] },
    { key: "mirzanagar", upazila: "Parshuram", unionName: "Mirzanagar", ward: "01", gps: [23.24, 91.43] },
    { key: "chithalia", upazila: "Parshuram", unionName: "Chithalia", ward: "04", gps: [23.19, 91.41] },
  ] as const;
  type AreaKey = (typeof areaDefs)[number]["key"];
  const area = {} as Record<AreaKey, string>;
  for (const a of areaDefs) area[a.key] = randomUUID();
  await prisma.area.createMany({
    data: areaDefs.map((a) => ({ areaId: area[a.key], operationId, upazila: a.upazila, unionName: a.unionName, ward: a.ward })),
  });

  const itemDefs = [
    { key: "rice", itemName: "Rice (10kg Sack)", unit: "sack" },
    { key: "dal", itemName: "Lentils / Dal (2kg)", unit: "packet" },
    { key: "water", itemName: "Drinking Water (5L)", unit: "bottle" },
    { key: "ors", itemName: "Oral Saline / ORS (Box)", unit: "box" },
    { key: "hygiene", itemName: "Emergency Hygiene Kit", unit: "kit" },
  ] as const;
  type ItemKey = (typeof itemDefs)[number]["key"];
  const item = {} as Record<ItemKey, string>;
  for (const i of itemDefs) item[i.key] = randomUUID();
  await prisma.reliefItem.createMany({
    data: itemDefs.map((i) => ({ itemId: item[i.key], operationId, itemName: i.itemName, unit: i.unit })),
  });

  // -------------------------------------------------------------------------
  // Households (version 1 as registered in the field)
  // -------------------------------------------------------------------------
  type HH = {
    code: string;
    area: AreaKey;
    by: "volShobuj" | "volFyv" | "volDelta";
    head: string;
    mobile: string | null;
    members: number;
    at: string;
  };
  const households: HH[] = [
    // Feni Sadar / Fazilpur / Ward 03
    { code: "FN-1001", area: "fazilpur", by: "volShobuj", head: "Md. Abdul Karim", mobile: "01712345678", members: 6, at: "2026-11-03 10:12" },
    { code: "FN-1002", area: "fazilpur", by: "volShobuj", head: "Shahana Parvin", mobile: "01819224571", members: 4, at: "2026-11-03 10:35" },
    { code: "FN-1003", area: "fazilpur", by: "volShobuj", head: "Abul Kalam Azad", mobile: null, members: 4, at: "2026-11-03 11:02" },
    { code: "FN-1004", area: "fazilpur", by: "volShobuj", head: "Nasima Akter", mobile: "01558903412", members: 3, at: "2026-11-03 11:40" },
    // Feni Sadar / Dharmapur / Ward 07
    { code: "FN-1005", area: "dharmapur", by: "volShobuj", head: "Jahanara Begum", mobile: "01713667201", members: 7, at: "2026-11-04 09:20" },
    { code: "FN-1006", area: "dharmapur", by: "volShobuj", head: "Mizanur Rahman", mobile: "01920458813", members: 5, at: "2026-11-04 09:55" },
    { code: "FN-1007", area: "dharmapur", by: "volShobuj", head: "Delwar Hossain", mobile: "01674120998", members: 8, at: "2026-11-04 10:30" },
    { code: "FN-1008", area: "dharmapur", by: "volShobuj", head: "Selina Khatun", mobile: null, members: 2, at: "2026-11-04 11:05" },
    // Feni Sadar / Kazirbag / Ward 02
    { code: "FN-1009", area: "kazirbag", by: "volFyv", head: "Anwara Begum", mobile: "01715889034", members: 5, at: "2026-11-04 14:10" },
    { code: "FN-1010", area: "kazirbag", by: "volFyv", head: "Shafiqul Islam", mobile: "01831550762", members: 6, at: "2026-11-04 14:45" },
    // Parshuram / Mirzanagar / Ward 01
    { code: "FN-1011", area: "mirzanagar", by: "volDelta", head: "Rokeya Begum", mobile: "01819456321", members: 5, at: "2026-11-05 09:30" },
    { code: "FN-1012", area: "mirzanagar", by: "volDelta", head: "Nurul Amin", mobile: "01716300457", members: 9, at: "2026-11-05 10:05" },
    { code: "FN-1013", area: "mirzanagar", by: "volDelta", head: "Fatema Khatun", mobile: null, members: 3, at: "2026-11-05 10:40" },
    // Parshuram / Chithalia / Ward 04
    { code: "FN-1014", area: "chithalia", by: "volDelta", head: "Ayesha Siddika", mobile: "01937712045", members: 4, at: "2026-11-05 13:15" },
    { code: "FN-1015", area: "chithalia", by: "volDelta", head: "Jamal Uddin", mobile: "01611874390", members: 6, at: "2026-11-05 13:50" },
    { code: "FN-1016", area: "chithalia", by: "volDelta", head: "Rahima Khatun", mobile: "01780234516", members: 5, at: "2026-11-05 14:25" },
    { code: "FN-1017", area: "chithalia", by: "volDelta", head: "Monir Hossain", mobile: null, members: 7, at: "2026-11-05 15:00" },
    // Cross-organisation duplicate of FN-1001 (same mobile, name variant) → Likely 0.88
    { code: "FN-1018", area: "fazilpur", by: "volFyv", head: "Mohammad Abdul Karim", mobile: "01712345678", members: 6, at: "2026-11-06 16:20" },
    { code: "FN-1019", area: "dharmapur", by: "volShobuj", head: "Habibur Rahman", mobile: "01552671930", members: 5, at: "2026-11-06 10:15" },
    { code: "FN-1020", area: "kazirbag", by: "volFyv", head: "Morium Nesa", mobile: "01877013264", members: 3, at: "2026-11-06 11:30" },
    { code: "FN-1021", area: "kazirbag", by: "volFyv", head: "Abdur Rashid", mobile: null, members: 8, at: "2026-11-06 12:05" },
    { code: "FN-1022", area: "kazirbag", by: "volFyv", head: "Kulsum Akter", mobile: "01945220817", members: 4, at: "2026-11-06 12:40" },
    // Possible duplicate of FN-1011 (name variant, no mobile, member count differs) → Possible 0.71
    { code: "FN-1023", area: "mirzanagar", by: "volFyv", head: "Rokeya Khatun", mobile: null, members: 6, at: "2026-11-07 15:10" },
    { code: "FN-1024", area: "mirzanagar", by: "volDelta", head: "Belal Uddin", mobile: "01718446092", members: 5, at: "2026-11-07 16:00" },
    { code: "FN-1025", area: "chithalia", by: "volDelta", head: "Sufia Begum", mobile: "01633908125", members: 2, at: "2026-11-07 16:45" },
  ];

  const hhId: Record<string, string> = {};
  for (const h of households) hhId[h.code] = randomUUID();
  const areaGps = Object.fromEntries(areaDefs.map((a) => [a.key, a.gps])) as Record<AreaKey, readonly [number, number]>;

  await prisma.household.createMany({
    data: households.map((h, i) => {
      const [lat, lng] = areaGps[h.area];
      const jitterLat = (((i * 37) % 17) - 8) * 0.0007;
      const jitterLng = (((i * 53) % 19) - 9) * 0.0007;
      return {
        householdId: hhId[h.code],
        shortCode: h.code,
        areaId: area[h.area],
        registeredBy: u[h.by],
        headName: h.head,
        mobileNumber: h.mobile,
        memberCount: h.members,
        consentGiven: true,
        consentAt: bd(h.at),
        gpsLocation: h.mobile === null && i % 2 === 0 ? null : `${(lat + jitterLat).toFixed(5)},${(lng + jitterLng).toFixed(5)}`,
        version: 1,
        createdAt: bd(h.at),
      };
    }),
  });

  type VersionInput = Prisma.HouseholdVersionCreateManyInput;
  const versions: VersionInput[] = households.map((h) => ({
    versionId: randomUUID(),
    householdId: hhId[h.code],
    version: 1,
    headName: h.head,
    mobileNumber: h.mobile,
    memberCount: h.members,
    changedBy: u[h.by],
    changeSource: "FIELD_EDIT",
    createdAt: bd(h.at),
  }));

  type SyncInput = Prisma.SyncEventCreateManyInput;
  const syncEvents: SyncInput[] = [];
  const devOf = { volShobuj: dev.volShobuj, volFyv: dev.volFyv, volDelta: dev.volDelta } as const;

  for (const h of households) {
    const at = bd(h.at);
    syncEvents.push({
      eventId: randomUUID(),
      deviceId: devOf[h.by],
      entityType: "HOUSEHOLD",
      entityId: hhId[h.code],
      action: "CREATE",
      payload: {
        shortCode: h.code,
        areaId: area[h.area],
        headName: h.head,
        mobileNumber: h.mobile,
        memberCount: h.members,
        consentGiven: true,
        consentAt: at.toISOString(),
      },
      baseVersion: 0,
      clientTime: at,
      receivedAt: addMinutes(at, 95),
    });
    log({
      userId: u[h.by],
      organisationId: seedUsers.find((s) => s.key === h.by)!.organisationId,
      deviceId: devOf[h.by],
      action: "HOUSEHOLD_CREATED",
      entityType: "HOUSEHOLD",
      entityId: hhId[h.code],
      newValue: { shortCode: h.code, headName: h.head, mobileNumber: h.mobile, memberCount: h.members, version: 1 },
      createdAt: addMinutes(at, 95),
    });
  }

  // Clean (non-conflicting) offline edit: FN-1003 member_count 4 → 5, v2.
  {
    const at = bd("2026-11-06 08:50");
    const eventId = randomUUID();
    syncEvents.push({ eventId, deviceId: dev.volShobuj, entityType: "HOUSEHOLD", entityId: hhId["FN-1003"], action: "UPDATE", payload: { changes: { memberCount: 5 } }, baseVersion: 1, clientTime: at, receivedAt: addMinutes(at, 40) });
    versions.push({ versionId: randomUUID(), householdId: hhId["FN-1003"], version: 2, headName: "Abul Kalam Azad", mobileNumber: null, memberCount: 5, changedBy: u.volShobuj, changeSource: "FIELD_EDIT", createdAt: addMinutes(at, 40) });
    await prisma.household.update({ where: { householdId: hhId["FN-1003"] }, data: { memberCount: 5, version: 2 } });
    log({ userId: u.volShobuj, organisationId: org.shobuj.organisationId, deviceId: dev.volShobuj, action: "HOUSEHOLD_UPDATED", entityType: "HOUSEHOLD", entityId: hhId["FN-1003"], oldValue: { memberCount: 4, version: 1 }, newValue: { memberCount: 5, version: 2 }, createdAt: addMinutes(at, 40) });
  }

  // -------------------------------------------------------------------------
  // Conflicts (State Diagram 05): 2 Open same-field conflicts + 1 Resolved
  // -------------------------------------------------------------------------
  type ConflictInput = Prisma.ConflictCreateManyInput;
  const conflicts: ConflictInput[] = [];
  const conflictIds = { c1006: randomUUID(), c1009: randomUUID(), c1002: randomUUID() };

  // (1) FN-1006 member_count: coordinator edits server copy 5 → 6 while the
  //     volunteer's offline device (base v1) sets it to 7.
  {
    const serverAt = bd("2026-11-09 10:00");
    versions.push({ versionId: randomUUID(), householdId: hhId["FN-1006"], version: 2, headName: "Mizanur Rahman", mobileNumber: "01920458813", memberCount: 6, changedBy: u.coordShobuj, changeSource: "FIELD_EDIT", createdAt: serverAt });
    await prisma.household.update({ where: { householdId: hhId["FN-1006"] }, data: { memberCount: 6, version: 2 } });
    log({ userId: u.coordShobuj, organisationId: org.shobuj.organisationId, action: "HOUSEHOLD_UPDATED", entityType: "HOUSEHOLD", entityId: hhId["FN-1006"], oldValue: { memberCount: 5, version: 1 }, newValue: { memberCount: 6, version: 2 }, createdAt: serverAt });

    const clientTime = bd("2026-11-09 08:30");
    const receivedAt = bd("2026-11-09 18:02");
    const eventId = randomUUID();
    syncEvents.push({ eventId, deviceId: dev.volShobuj, entityType: "HOUSEHOLD", entityId: hhId["FN-1006"], action: "UPDATE", payload: { changes: { memberCount: 7 } }, baseVersion: 1, clientTime, receivedAt });
    conflicts.push({ conflictId: conflictIds.c1006, eventId, householdId: hhId["FN-1006"], fieldName: "member_count", localValue: "7", serverValue: "6", localUserId: u.volShobuj, localDeviceId: dev.volShobuj, clientTime, status: "Open" });
    log({ userId: u.volShobuj, organisationId: org.shobuj.organisationId, deviceId: dev.volShobuj, action: "CONFLICT_RAISED", entityType: "CONFLICT", entityId: conflictIds.c1006, newValue: { householdId: hhId["FN-1006"], fieldName: "member_count", localValue: "7", serverValue: "6" }, createdAt: receivedAt });
  }

  // (2) FN-1009 mobile_number: coordinator corrects number on server while the
  //     volunteer records a different new number offline.
  {
    const serverAt = bd("2026-11-10 11:20");
    versions.push({ versionId: randomUUID(), householdId: hhId["FN-1009"], version: 2, headName: "Anwara Begum", mobileNumber: "01911223344", memberCount: 5, changedBy: u.coordFyv, changeSource: "FIELD_EDIT", createdAt: serverAt });
    await prisma.household.update({ where: { householdId: hhId["FN-1009"] }, data: { mobileNumber: "01911223344", version: 2 } });
    log({ userId: u.coordFyv, organisationId: org.fyv.organisationId, action: "HOUSEHOLD_UPDATED", entityType: "HOUSEHOLD", entityId: hhId["FN-1009"], oldValue: { mobileNumber: "01715889034", version: 1 }, newValue: { mobileNumber: "01911223344", version: 2 }, createdAt: serverAt });

    const clientTime = bd("2026-11-10 09:45");
    const receivedAt = bd("2026-11-10 21:15");
    const eventId = randomUUID();
    syncEvents.push({ eventId, deviceId: dev.volFyv, entityType: "HOUSEHOLD", entityId: hhId["FN-1009"], action: "UPDATE", payload: { changes: { mobileNumber: "01815667788" } }, baseVersion: 1, clientTime, receivedAt });
    conflicts.push({ conflictId: conflictIds.c1009, eventId, householdId: hhId["FN-1009"], fieldName: "mobile_number", localValue: "01815667788", serverValue: "01911223344", localUserId: u.volFyv, localDeviceId: dev.volFyv, clientTime, status: "Open" });
    log({ userId: u.volFyv, organisationId: org.fyv.organisationId, deviceId: dev.volFyv, action: "CONFLICT_RAISED", entityType: "CONFLICT", entityId: conflictIds.c1009, newValue: { householdId: hhId["FN-1009"], fieldName: "mobile_number", localValue: "01815667788", serverValue: "01911223344" }, createdAt: receivedAt });
  }

  // (3) FN-1002 head_name: already Resolved by the coordinator (v3, CONFLICT_RESOLUTION).
  {
    const serverAt = bd("2026-11-07 09:10");
    versions.push({ versionId: randomUUID(), householdId: hhId["FN-1002"], version: 2, headName: "Shahana Parveen", mobileNumber: "01819224571", memberCount: 4, changedBy: u.coordShobuj, changeSource: "FIELD_EDIT", createdAt: serverAt });
    log({ userId: u.coordShobuj, organisationId: org.shobuj.organisationId, action: "HOUSEHOLD_UPDATED", entityType: "HOUSEHOLD", entityId: hhId["FN-1002"], oldValue: { headName: "Shahana Parvin", version: 1 }, newValue: { headName: "Shahana Parveen", version: 2 }, createdAt: serverAt });

    const clientTime = bd("2026-11-07 08:20");
    const receivedAt = bd("2026-11-07 17:40");
    const resolvedAt = bd("2026-11-08 09:05");
    const eventId = randomUUID();
    syncEvents.push({ eventId, deviceId: dev.volShobuj, entityType: "HOUSEHOLD", entityId: hhId["FN-1002"], action: "UPDATE", payload: { changes: { headName: "Shahana Parvin Akter" } }, baseVersion: 1, clientTime, receivedAt });
    conflicts.push({ conflictId: conflictIds.c1002, eventId, householdId: hhId["FN-1002"], fieldName: "head_name", localValue: "Shahana Parvin Akter", serverValue: "Shahana Parveen", localUserId: u.volShobuj, localDeviceId: dev.volShobuj, clientTime, status: "Resolved", resolvedValue: "Shahana Parveen Akter", resolvedBy: u.coordShobuj, resolvedAt });
    versions.push({ versionId: randomUUID(), householdId: hhId["FN-1002"], version: 3, headName: "Shahana Parveen Akter", mobileNumber: "01819224571", memberCount: 4, changedBy: u.coordShobuj, changeSource: "CONFLICT_RESOLUTION", createdAt: resolvedAt });
    await prisma.household.update({ where: { householdId: hhId["FN-1002"] }, data: { headName: "Shahana Parveen Akter", version: 3 } });
    log({ userId: u.volShobuj, organisationId: org.shobuj.organisationId, deviceId: dev.volShobuj, action: "CONFLICT_RAISED", entityType: "CONFLICT", entityId: conflictIds.c1002, newValue: { fieldName: "head_name", localValue: "Shahana Parvin Akter", serverValue: "Shahana Parveen" }, createdAt: receivedAt });
    log({ userId: u.coordShobuj, organisationId: org.shobuj.organisationId, action: "CONFLICT_RESOLVED", entityType: "CONFLICT", entityId: conflictIds.c1002, oldValue: { status: "Open" }, newValue: { status: "Resolved", resolvedValue: "Shahana Parveen Akter", householdVersion: 3 }, createdAt: resolvedAt });
  }

  await prisma.householdVersion.createMany({ data: versions });

  // -------------------------------------------------------------------------
  // Distributions (State Diagram 04): 18 total
  // -------------------------------------------------------------------------
  type DistDef = {
    key: string;
    hh: string | null; // null → anonymous
    area: AreaKey;
    by: "volShobuj" | "volFyv" | "volDelta";
    at: string;
    items: Partial<Record<ItemKey, number>>;
    voided?: { reason: string; at: string };
  };
  const dists: DistDef[] = [
    { key: "d01", hh: "FN-1001", area: "fazilpur", by: "volShobuj", at: "2026-11-05 09:15", items: { rice: 1, dal: 1, water: 4 } },
    { key: "d02", hh: "FN-1002", area: "fazilpur", by: "volShobuj", at: "2026-11-05 09:40", items: { rice: 1, dal: 1, water: 4, ors: 1 } },
    { key: "d03", hh: "FN-1003", area: "fazilpur", by: "volShobuj", at: "2026-11-05 10:05", items: { rice: 1, water: 4 } },
    { key: "d04", hh: "FN-1005", area: "dharmapur", by: "volShobuj", at: "2026-11-06 11:20", items: { rice: 1, dal: 1, hygiene: 1 } },
    { key: "d05", hh: "FN-1006", area: "dharmapur", by: "volShobuj", at: "2026-11-06 11:45", items: { rice: 1, dal: 1, water: 6 } },
    { key: "d06", hh: "FN-1007", area: "dharmapur", by: "volShobuj", at: "2026-11-06 12:10", items: { rice: 1, ors: 1 }, voided: { reason: "Recorded against wrong household card; items were handed to FN-1008.", at: "2026-11-06 12:30" } },
    { key: "d07", hh: "FN-1008", area: "dharmapur", by: "volShobuj", at: "2026-11-06 12:25", items: { rice: 1, ors: 1 } },
    { key: "d08", hh: "FN-1009", area: "kazirbag", by: "volFyv", at: "2026-11-07 10:00", items: { rice: 1, dal: 1, water: 4 } },
    { key: "d09", hh: "FN-1010", area: "kazirbag", by: "volFyv", at: "2026-11-07 10:30", items: { rice: 1, dal: 1, water: 4, hygiene: 1 } },
    { key: "d10", hh: "FN-1020", area: "kazirbag", by: "volFyv", at: "2026-11-07 11:00", items: { rice: 1, water: 2, ors: 1 } },
    { key: "d11", hh: "FN-1011", area: "mirzanagar", by: "volDelta", at: "2026-11-08 09:00", items: { rice: 1, dal: 1, water: 4 } },
    { key: "d12", hh: "FN-1012", area: "mirzanagar", by: "volDelta", at: "2026-11-08 09:30", items: { rice: 2, dal: 2, water: 6, hygiene: 1 } },
    { key: "d13", hh: "FN-1013", area: "mirzanagar", by: "volDelta", at: "2026-11-08 10:10", items: { rice: 1, ors: 2 } },
    { key: "d14", hh: "FN-1014", area: "chithalia", by: "volDelta", at: "2026-11-10 14:00", items: { rice: 1, dal: 1, water: 4 } },
    { key: "d15", hh: "FN-1015", area: "chithalia", by: "volDelta", at: "2026-11-10 14:30", items: { rice: 1, dal: 1, water: 4, hygiene: 1 } },
    // Anonymous: displaced family at the Chithalia shelter who declined registration.
    { key: "d16", hh: null, area: "chithalia", by: "volDelta", at: "2026-11-10 15:00", items: { water: 2, ors: 1 } },
    // Cross-organisation repeat within 24h for FN-1004 → DISTRIBUTION_FLAG
    { key: "d17", hh: "FN-1004", area: "fazilpur", by: "volShobuj", at: "2026-11-12 09:30", items: { rice: 1, dal: 1, water: 4 } },
    { key: "d18", hh: "FN-1004", area: "fazilpur", by: "volFyv", at: "2026-11-12 16:10", items: { rice: 1, water: 4 } },
  ];

  const distId: Record<string, string> = {};
  for (const d of dists) distId[d.key] = randomUUID();

  await prisma.distribution.createMany({
    data: dists.map((d) => ({
      distributionId: distId[d.key],
      householdId: d.hh ? hhId[d.hh] : null,
      areaId: area[d.area],
      recordedBy: u[d.by],
      distributedAt: bd(d.at),
      isAnonymous: d.hh === null,
      status: d.voided ? "Voided" : "Active",
      cancelReason: d.voided?.reason ?? null,
      version: d.voided ? 2 : 1,
    })),
  });
  await prisma.distributionItem.createMany({
    data: dists.flatMap((d) =>
      (Object.entries(d.items) as [ItemKey, number][]).map(([k, quantity]) => ({
        distributionId: distId[d.key],
        itemId: item[k],
        quantity,
      })),
    ),
  });

  for (const d of dists) {
    const at = bd(d.at);
    const orgId = seedUsers.find((s) => s.key === d.by)!.organisationId;
    const receivedAt = addMinutes(at, d.key === "d18" ? 320 : 180);
    syncEvents.push({
      eventId: randomUUID(),
      deviceId: devOf[d.by],
      entityType: "DISTRIBUTION",
      entityId: distId[d.key],
      action: "CREATE",
      payload: {
        householdId: d.hh ? hhId[d.hh] : null,
        areaId: area[d.area],
        isAnonymous: d.hh === null,
        distributedAt: at.toISOString(),
        items: Object.entries(d.items).map(([k, quantity]) => ({ itemId: item[k as ItemKey], quantity })),
      },
      baseVersion: 0,
      clientTime: at,
      receivedAt,
    });
    log({ userId: u[d.by], organisationId: orgId, deviceId: devOf[d.by], action: "DISTRIBUTION_CREATED", entityType: "DISTRIBUTION", entityId: distId[d.key], newValue: { shortCode: d.hh, isAnonymous: d.hh === null, items: d.items }, createdAt: receivedAt });
    if (d.voided) {
      const vAt = bd(d.voided.at);
      syncEvents.push({ eventId: randomUUID(), deviceId: devOf[d.by], entityType: "DISTRIBUTION", entityId: distId[d.key], action: "VOID", payload: { cancelReason: d.voided.reason }, baseVersion: 1, clientTime: vAt, receivedAt: addMinutes(vAt, 160) });
      log({ userId: u[d.by], organisationId: orgId, deviceId: devOf[d.by], action: "DISTRIBUTION_VOIDED", entityType: "DISTRIBUTION", entityId: distId[d.key], oldValue: { status: "Active", version: 1 }, newValue: { status: "Voided", version: 2, cancelReason: d.voided.reason }, createdAt: addMinutes(vAt, 160) });
    }
  }

  await prisma.syncEvent.createMany({ data: syncEvents });
  await prisma.conflict.createMany({ data: conflicts });

  // -------------------------------------------------------------------------
  // Duplicate pairs (State Diagram 06)
  // -------------------------------------------------------------------------
  const pairLikely = randomUUID();
  const pairPossible = randomUUID();
  {
    const [a1, b1] = orderPair(hhId["FN-1001"], hhId["FN-1018"]);
    const [a2, b2] = orderPair(hhId["FN-1011"], hhId["FN-1023"]);
    await prisma.duplicatePair.createMany({
      data: [
        { pairId: pairLikely, householdAId: a1, householdBId: b1, score: new Prisma.Decimal("0.88"), label: "Likely", status: "PendingReview" },
        { pairId: pairPossible, householdAId: a2, householdBId: b2, score: new Prisma.Decimal("0.71"), label: "Possible", status: "PendingReview" },
      ],
    });
    log({ action: "DUPLICATE_DETECTED", entityType: "DUPLICATE_PAIR", entityId: pairLikely, newValue: { codes: ["FN-1001", "FN-1018"], score: "0.88", label: "Likely" }, createdAt: bd("2026-11-06 17:55") });
    log({ action: "DUPLICATE_DETECTED", entityType: "DUPLICATE_PAIR", entityId: pairPossible, newValue: { codes: ["FN-1011", "FN-1023"], score: "0.71", label: "Possible" }, createdAt: bd("2026-11-07 18:30") });
  }

  // -------------------------------------------------------------------------
  // Distribution flag: FN-1004 served by Shobuj Bangla (09:30) and Feni Youth
  // Volunteers (16:10) on the same day.
  // -------------------------------------------------------------------------
  const flagId = randomUUID();
  const flagAt = addMinutes(bd("2026-11-12 16:10"), 320);
  await prisma.distributionFlag.create({
    data: { flagId, firstDistributionId: distId.d17, secondDistributionId: distId.d18, status: "PendingReview", createdAt: flagAt },
  });
  log({ action: "DISTRIBUTION_FLAGGED", entityType: "DISTRIBUTION_FLAG", entityId: flagId, newValue: { shortCode: "FN-1004", hoursApart: 6.67, organisations: [org.shobuj.name, org.fyv.name] }, createdAt: flagAt });

  // -------------------------------------------------------------------------
  // Notifications
  // -------------------------------------------------------------------------
  await prisma.notification.createMany({
    data: [
      { userId: u.coordShobuj, type: "CONFLICT_OPEN", message: "Sync conflict on FN-1006: member_count was changed on the server and on a device.", linkPath: `/conflicts/${conflictIds.c1006}`, createdAt: bd("2026-11-09 18:02") },
      { userId: u.coordShobuj, type: "CONFLICT_RESOLVED", message: "You resolved the head_name conflict on FN-1002.", linkPath: `/conflicts/${conflictIds.c1002}`, isRead: true, createdAt: bd("2026-11-08 09:05") },
      { userId: u.volShobuj, type: "CONFLICT_OPEN", message: "Your offline edit to FN-1006 conflicts with a server change and is awaiting coordinator review.", linkPath: `/households/FN-1006`, createdAt: bd("2026-11-09 18:02") },
      { userId: u.coordFyv, type: "CONFLICT_OPEN", message: "Sync conflict on FN-1009: mobile_number was changed on the server and on a device.", linkPath: `/conflicts/${conflictIds.c1009}`, createdAt: bd("2026-11-10 21:15") },
      { userId: u.opsadmin, type: "DUPLICATE_REVIEW", message: "Likely duplicate (0.88): FN-1001 and FN-1018 in Fazilpur, Ward 03.", linkPath: `/duplicates/${pairLikely}`, createdAt: bd("2026-11-06 17:55") },
      { userId: u.opsadmin, type: "DUPLICATE_REVIEW", message: "Possible duplicate (0.71): FN-1011 and FN-1023 in Mirzanagar, Ward 01.", linkPath: `/duplicates/${pairPossible}`, createdAt: bd("2026-11-07 18:30") },
      { userId: u.opsadmin, type: "DISTRIBUTION_FLAG", message: "FN-1004 received relief from Shobuj Bangla Relief and Feni Youth Volunteers within 24 hours.", linkPath: `/flags/${flagId}`, createdAt: flagAt },
      { userId: u.opsadmin, type: "MEMBERSHIP_PENDING", message: "Cumilla Flood Response requested to join this operation.", linkPath: "/operation/memberships", createdAt: bd("2026-11-14 19:50") },
      { userId: u.sysadmin, type: "ORGANISATION_PENDING", message: "New organisation registration: Cumilla Flood Response.", linkPath: "/admin/organisations", createdAt: bd("2026-11-14 19:40") },
      { userId: u.sysadmin, type: "USER_PENDING", message: "A new coordinator account for Cumilla Flood Response is awaiting approval.", linkPath: "/admin/users", createdAt: bd("2026-11-14 19:45") },
      { userId: u.sysadmin, type: "ACCOUNT_LOCKED", message: "An account was locked after 5 failed sign-in attempts.", linkPath: "/admin/users", createdAt: addMinutes(now, -1) },
    ],
  });

  await prisma.auditLog.createMany({ data: audit });

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  const counts = {
    organisations: await prisma.organisation.count(),
    users: await prisma.user.count(),
    devices: await prisma.device.count(),
    areas: await prisma.area.count(),
    reliefItems: await prisma.reliefItem.count(),
    households: await prisma.household.count(),
    householdVersions: await prisma.householdVersion.count(),
    distributions: await prisma.distribution.count(),
    anonymousDistributions: await prisma.distribution.count({ where: { isAnonymous: true } }),
    syncEvents: await prisma.syncEvent.count(),
    openConflicts: await prisma.conflict.count({ where: { status: "Open" } }),
    duplicatePairs: await prisma.duplicatePair.count(),
    distributionFlags: await prisma.distributionFlag.count(),
    notifications: await prisma.notification.count(),
    auditLogs: await prisma.auditLog.count(),
  };
  console.log("\nSeed complete:");
  console.table(counts);

  console.log("\nDemo accounts (sign in with mobile number):");
  console.table(
    seedUsers.map((s) => ({
      role: s.role,
      name: s.fullName,
      mobile: s.mobileNumber,
      password: ROLE_PASSWORDS[s.role],
      status: s.status,
    })),
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
