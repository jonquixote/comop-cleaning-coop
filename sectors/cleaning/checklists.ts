// Cleaning checklists (sector code, ADR-0003). Per-job checklist instances derived
// from CleaningJobDetails metrics (bedrooms, bathrooms, addons). Standards are code
// for MVP — a templates table can be added later if admin-customizable room/task
// definitions become a requirement. Runs in the caller's tx.
import type { PoolClient } from "pg";
import type { CleaningJobDetails } from "./pricing";

export interface ChecklistTask {
  description: string;
  optional: boolean;
}

export interface RoomDef {
  room: string;
  tasks: ChecklistTask[];
}

/**
 * Generates applicable checklist rooms from job details.
 * Derive-only: standards are code, not DB data.
 * Room derivation: 1 kitchen + N bathrooms + N bedrooms + 1 living room.
 * Zero bedrooms/bathrooms produce no room entries for that type (loop body never runs).
 */
export function getTemplatesForJob(details: CleaningJobDetails): RoomDef[] {
  const rooms: RoomDef[] = [];

  const kitchenTasks: ChecklistTask[] = [
    { description: "Wipe countertops", optional: false },
    { description: "Clean sink", optional: false },
    { description: "Wipe cabinet fronts", optional: false },
    { description: "Sweep floor", optional: false },
    { description: "Mop floor", optional: false },
    { description: "Empty trash", optional: false },
  ];
  // Add-on kitchen tasks: the customer paid for these (priced in pricing.ts ADDON_LABOR_MIN),
  // so the worker's checklist must list them — otherwise paid-for work has no operational teeth.
  if (details.addons.includes("inside_fridge"))
    kitchenTasks.push({ description: "Clean inside refrigerator", optional: false });
  if (details.addons.includes("inside_oven"))
    kitchenTasks.push({ description: "Clean inside oven", optional: false });
  rooms.push({ room: "Kitchen", tasks: kitchenTasks });

  for (let i = 1; i <= details.bathrooms; i++) {
    const label = details.bathrooms > 1 ? `Bathroom ${i}` : "Bathroom";
    rooms.push({
      room: label,
      tasks: [
        { description: "Clean toilet", optional: false },
        { description: "Clean sink & vanity", optional: false },
        { description: "Clean shower/tub", optional: false },
        { description: "Wipe mirror", optional: false },
        { description: "Sweep & mop floor", optional: false },
      ],
    });
  }

  for (let i = 1; i <= details.bedrooms; i++) {
    const label = details.bedrooms > 1 ? `Bedroom ${i}` : "Bedroom";
    rooms.push({
      room: label,
      tasks: [
        { description: "Dust surfaces", optional: false },
        { description: "Vacuum floor", optional: false },
        { description: "Wipe baseboards", optional: true },
      ],
    });
  }

  rooms.push({
    room: "Living Room",
    tasks: [
      { description: "Dust surfaces", optional: false },
      { description: "Vacuum floor", optional: false },
      { description: "Wipe baseboards", optional: true },
    ],
  });

  // Add-ons that don't map to an existing room get their own section (same reason as the
  // kitchen add-ons above: paid work must appear on the checklist).
  if (details.addons.includes("windows"))
    rooms.push({
      room: "Windows",
      tasks: [{ description: "Clean interior windows", optional: false }],
    });

  if (details.addons.includes("deep_clean"))
    rooms.push({
      room: "Deep Clean",
      tasks: [
        { description: "Detail baseboards throughout", optional: false },
        { description: "Wipe door frames & light switches", optional: false },
        { description: "Dust vents & ceiling corners", optional: false },
      ],
    });

  return rooms;
}

/**
 * Creates per-job checklist instances inside the booking transaction.
 * Called from createCleaningBooking after the job + details are inserted.
 */
export async function createJobChecklists(
  tx: PoolClient,
  coOpId: string,
  jobId: string,
  details: CleaningJobDetails,
): Promise<void> {
  const roomDefs = getTemplatesForJob(details);
  for (const r of roomDefs) {
    await tx.query(
      `INSERT INTO job_cleaning_checklists (co_op_id, job_id, room, tasks)
       VALUES ($1, $2, $3, $4)`,
      [coOpId, jobId, r.room, JSON.stringify(r.tasks)],
    );
  }
}
