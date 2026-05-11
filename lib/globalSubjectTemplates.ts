import type { Pool } from "pg";

/** Default catalog — same as Super Admin → System Settings when DB has no `globalSubjects` row. */
export const DEFAULT_GLOBAL_SUBJECTS: { name: string; code: string }[] = [
  { name: "Mathematics", code: "MATH" },
  { name: "English Language", code: "ENG" },
  { name: "Science", code: "SCI" },
  { name: "Social Studies", code: "SST" },
  { name: "Religious Education", code: "RE" },
];

export type GlobalSubjectTemplate = { name: string; code: string };

/**
 * Reads `global_settings.globalSubjects` (JSON array of { name, code }).
 * If the row is missing or invalid, returns the platform default list.
 * An explicitly stored empty array `[]` is returned as-is.
 */
export async function loadGlobalSubjectTemplates(pool: Pool): Promise<GlobalSubjectTemplate[]> {
  const r = await pool.query(`SELECT value FROM global_settings WHERE key = 'globalSubjects'`);
  if (!r.rows.length) return DEFAULT_GLOBAL_SUBJECTS.map((s) => ({ ...s }));
  try {
    const parsed = JSON.parse(r.rows[0].value);
    if (!Array.isArray(parsed)) return DEFAULT_GLOBAL_SUBJECTS.map((s) => ({ ...s }));
    return parsed
      .map((x: { name?: string; code?: string }) => ({
        name: String(x?.name ?? "").trim(),
        code: String(x?.code ?? "").trim().toUpperCase(),
      }))
      .filter((x) => x.name && x.code);
  } catch {
    return DEFAULT_GLOBAL_SUBJECTS.map((s) => ({ ...s }));
  }
}
