import type { Express } from "express";
import pool from "../db";

export function registerClassRoutes(app: Express) {
  app.get("/api/classes", async (req, res) => {
    try {
      const { schoolId } = req.query;
      if (!schoolId) return res.status(400).json({ message: "schoolId required" });
      const result = await pool.query(
        `SELECT c.*, u.first_name || ' ' || u.last_name as teacher_name,
                (SELECT COUNT(*) FROM students WHERE class_id=c.id AND is_active=true) as student_count
         FROM classes c LEFT JOIN users u ON c.class_teacher_id=u.id
         WHERE c.school_id=$1 ORDER BY c.level, c.name`,
        [schoolId]
      );
      res.json(result.rows);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/classes", async (req, res) => {
    try {
      const { name, level, section, schoolId, classTeacherId, academicYear, maxStudents } = req.body;
      const result = await pool.query(
        `INSERT INTO classes (name, level, section, school_id, class_teacher_id, academic_year, max_students)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [name, level, section, schoolId, classTeacherId, academicYear, maxStudents]
      );
      res.status(201).json(result.rows[0]);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.put("/api/classes/:id", async (req, res) => {
    try {
      const { name, classTeacherId, capacity } = req.body;
      const fields: string[] = []; const params: any[] = []; let idx = 1;
      if (name !== undefined) { fields.push(`name=$${idx++}`); params.push(name); }
      if (classTeacherId !== undefined) { fields.push(`class_teacher_id=$${idx++}`); params.push(classTeacherId||null); }
      if (capacity !== undefined) { fields.push(`capacity=$${idx++}`); params.push(capacity); }
      if (!fields.length) return res.status(400).json({ message: "No fields to update" });
      params.push(req.params.id);
      const result = await pool.query(`UPDATE classes SET ${fields.join(',')} WHERE id=$${idx} RETURNING *`, params);
      if (!result.rows.length) return res.status(404).json({ message: "Class not found" });
      res.json(result.rows[0]);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.delete("/api/classes/:id", async (req, res) => {
    try {
      await pool.query(`DELETE FROM classes WHERE id=$1`, [req.params.id]);
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });
}
