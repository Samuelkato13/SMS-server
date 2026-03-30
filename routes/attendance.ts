import type { Express } from "express";
import pool from "../db";

export function registerAttendanceRoutes(app: Express) {
  app.get("/api/attendance", async (req, res) => {
    try {
      const { schoolId, classId, date } = req.query;
      if (!schoolId) return res.status(400).json({ message: "schoolId required" });
      let query = `SELECT a.*, s.first_name, s.last_name, s.payment_code
                   FROM attendance a JOIN students s ON a.student_id=s.id
                   WHERE a.school_id=$1`;
      const params: any[] = [schoolId]; let idx = 2;
      if (classId) { query += ` AND a.class_id=$${idx++}`; params.push(classId); }
      if (date) { query += ` AND a.attendance_date=$${idx++}`; params.push(date); }
      query += ` ORDER BY a.attendance_date DESC, s.last_name`;
      const result = await pool.query(query, params);
      res.json(result.rows);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/attendance", async (req, res) => {
    try {
      const { studentId, classId, schoolId, date, attendanceDate, status, remarks, recordedBy } = req.body;
      const dateVal = attendanceDate || date;
      const result = await pool.query(
        `INSERT INTO attendance (student_id, class_id, school_id, attendance_date, status, remarks, recorded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (student_id, attendance_date) DO UPDATE SET status=EXCLUDED.status, remarks=EXCLUDED.remarks
         RETURNING *`,
        [studentId, classId, schoolId, dateVal, status, remarks, recordedBy]
      );
      res.status(201).json(result.rows[0]);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/attendance/bulk", async (req, res) => {
    try {
      const { entries } = req.body;
      if (!Array.isArray(entries) || !entries.length) return res.status(400).json({ message: "entries array required" });
      const saved: any[] = [];
      for (const e of entries) {
        const { studentId, classId, schoolId, attendanceDate, status, remarks, recordedBy } = e;
        const r = await pool.query(
          `INSERT INTO attendance (student_id, class_id, school_id, attendance_date, status, remarks, recorded_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (student_id, attendance_date) DO UPDATE SET status=EXCLUDED.status, remarks=EXCLUDED.remarks
           RETURNING *`,
          [studentId, classId, schoolId, attendanceDate, status, remarks||null, recordedBy||null]
        );
        saved.push(r.rows[0]);
      }
      res.status(201).json({ saved: saved.length, records: saved });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });
}
