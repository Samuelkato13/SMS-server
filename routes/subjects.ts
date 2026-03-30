import type { Express } from "express";
import pool from "../db";

export function registerSubjectRoutes(app: Express) {
  app.get("/api/subjects", async (req, res) => {
    try {
      const { schoolId } = req.query;
      if (!schoolId) return res.status(400).json({ message: "schoolId required" });
      const result = await pool.query(
        `SELECT s.*, u.first_name || ' ' || u.last_name as teacher_name
         FROM subjects s LEFT JOIN users u ON s.teacher_id=u.id
         WHERE s.school_id=$1 ORDER BY s.name`,
        [schoolId]
      );
      res.json(result.rows);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/subjects", async (req, res) => {
    try {
      const { name, code, description, schoolId, teacherId } = req.body;
      const result = await pool.query(
        `INSERT INTO subjects (name, code, description, school_id, teacher_id)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [name, code, description, schoolId, teacherId]
      );
      res.status(201).json(result.rows[0]);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.put("/api/subjects/:id", async (req, res) => {
    try {
      const { name, code, teacherId } = req.body;
      const fields: string[] = []; const params: any[] = []; let idx = 1;
      if (name !== undefined) { fields.push(`name=$${idx++}`); params.push(name); }
      if (code !== undefined) { fields.push(`code=$${idx++}`); params.push(code); }
      if (teacherId !== undefined) { fields.push(`teacher_id=$${idx++}`); params.push(teacherId||null); }
      if (!fields.length) return res.status(400).json({ message: "No fields to update" });
      params.push(req.params.id);
      const result = await pool.query(`UPDATE subjects SET ${fields.join(',')} WHERE id=$${idx} RETURNING *`, params);
      if (!result.rows.length) return res.status(404).json({ message: "Subject not found" });
      res.json(result.rows[0]);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.delete("/api/subjects/:id", async (req, res) => {
    try {
      await pool.query(`DELETE FROM subjects WHERE id=$1`, [req.params.id]);
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });
}
