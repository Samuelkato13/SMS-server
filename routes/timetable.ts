import type { Express } from "express";
import pool from "../db";

export function registerTimetableRoutes(app: Express) {
  app.get("/api/timetable", async (req, res) => {
    const { schoolId, classId } = req.query;
    if (!schoolId) return res.status(400).json({ message: "schoolId required" });
    try {
      let q = `SELECT t.*, c.name AS class_name, s.name AS subject_name,
                      u.first_name||' '||u.last_name AS teacher_name
               FROM timetable t
               LEFT JOIN classes c ON c.id = t.class_id::uuid
               LEFT JOIN subjects s ON s.id = t.subject_id::uuid
               LEFT JOIN users u ON u.id = t.teacher_id::uuid
               WHERE t.school_id = $1`;
      const params: any[] = [schoolId];
      if (classId) { q += ` AND t.class_id = $2`; params.push(classId); }
      q += ' ORDER BY t.period_number, t.day_of_week';
      const r = await pool.query(q, params);
      res.json(r.rows);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.post("/api/timetable", async (req, res) => {
    const { schoolId, classId, subjectId, teacherId, dayOfWeek, periodNumber, startTime, endTime, room } = req.body;
    if (!schoolId || !classId || !dayOfWeek || !periodNumber)
      return res.status(400).json({ message: "schoolId, classId, dayOfWeek, periodNumber required" });
    try {
      // Upsert on class+day+period combination
      const r = await pool.query(
        `INSERT INTO timetable (school_id, class_id, subject_id, teacher_id, day_of_week, period_number, start_time, end_time, room)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT DO NOTHING
         RETURNING *`,
        [schoolId, classId, subjectId||null, teacherId||null, dayOfWeek, periodNumber,
         startTime||null, endTime||null, room||null]
      );
      if (r.rows.length === 0) {
        // Update existing
        const u = await pool.query(
          `UPDATE timetable SET subject_id=$1, teacher_id=$2, start_time=$3, end_time=$4, room=$5
           WHERE school_id=$6 AND class_id=$7 AND day_of_week=$8 AND period_number=$9 RETURNING *`,
          [subjectId||null, teacherId||null, startTime||null, endTime||null, room||null,
           schoolId, classId, dayOfWeek, periodNumber]
        );
        return res.json(u.rows[0]);
      }
      res.json(r.rows[0]);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.delete("/api/timetable/:id", async (req, res) => {
    try {
      await pool.query("DELETE FROM timetable WHERE id=$1", [req.params.id]);
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });
}
