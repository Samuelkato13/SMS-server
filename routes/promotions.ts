import type { Express } from "express";
import pool from "../db";

export function registerPromotionRoutes(app: Express) {

  // GET promotion history for a school
  app.get("/api/promotions", async (req, res) => {
    const { schoolId } = req.query;
    if (!schoolId) return res.status(400).json({ error: "schoolId required" });
    try {
      const r = await pool.query(
        `SELECT * FROM promotion_logs WHERE school_id=$1 ORDER BY promoted_at DESC LIMIT 50`,
        [schoolId]
      );
      res.json(r.rows);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST promote students: bulk class change
  app.post("/api/promotions", async (req, res) => {
    const { schoolId, fromClassId, toClassId, studentIds, notes, promotedBy, promotedByName, academicYear } = req.body;
    if (!schoolId || !toClassId || !Array.isArray(studentIds) || !studentIds.length)
      return res.status(400).json({ error: "schoolId, toClassId, and studentIds[] required" });

    try {
      // Fetch class names
      const fromClass = fromClassId
        ? (await pool.query("SELECT name FROM classes WHERE id=$1", [fromClassId])).rows[0]
        : null;
      const toClass = (await pool.query("SELECT name FROM classes WHERE id=$1", [toClassId])).rows[0];
      if (!toClass) return res.status(404).json({ error: "Target class not found" });

      // Bulk update students
      await pool.query(
        `UPDATE students SET class_id=$1 WHERE id = ANY($2::uuid[]) AND school_id=$3`,
        [toClassId, studentIds, schoolId]
      );

      // Log the promotion
      const log = await pool.query(
        `INSERT INTO promotion_logs
          (school_id, from_class_id, to_class_id, from_class_name, to_class_name,
           student_ids, student_count, promoted_by, promoted_by_name, academic_year, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [
          schoolId,
          fromClassId || null,
          toClassId,
          fromClass?.name || "Various",
          toClass.name,
          JSON.stringify(studentIds),
          studentIds.length,
          promotedBy || null,
          promotedByName || null,
          academicYear || String(new Date().getFullYear()),
          notes || null,
        ]
      );

      res.json({ success: true, log: log.rows[0], moved: studentIds.length });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
}
