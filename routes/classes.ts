import type { Express } from "express";
import pool from "../db";

export function registerClassRoutes(app: Express) {
  app.get("/api/classes", async (req, res) => {
    try {
      const { schoolId } = req.query;
      if (!schoolId) return res.status(400).json({ message: "schoolId required" });
      const result = await pool.query(
        `SELECT c.*,
                TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) as teacher_name,
                (SELECT COUNT(*)::int FROM students st WHERE st.class_id = c.id AND COALESCE(st.is_active, true) = true) as student_count
         FROM classes c LEFT JOIN users u ON c.class_teacher_id=u.id
         WHERE c.school_id=$1 ORDER BY c.level NULLS LAST, c.name`,
        [schoolId]
      );
      res.json(result.rows);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/classes", async (req, res) => {
    try {
      const body = req.body || {};
      const name = String(body.name || "").trim();
      if (!name) return res.status(400).json({ message: "name required" });
      const schoolId = body.schoolId;
      if (!schoolId) return res.status(400).json({ message: "schoolId required" });

      // Client (SMS-client SchoolSetup) often sends only { name, section, schoolId } — DB requires level + academic_year NOT NULL.
      const level = String(body.level || body.name || "General").trim().slice(0, 100);
      const section = body.section != null ? String(body.section).slice(0, 100) : null;
      const classTeacherId = body.classTeacherId ?? body.class_teacher_id ?? null;
      const y = new Date().getFullYear();
      const academicYear = String(body.academicYear ?? body.academic_year ?? `${y}/${y + 1}`).trim().slice(0, 20);
      let maxStudentsVal: number | null = null;
      const rawMax = body.maxStudents ?? body.max_students;
      if (rawMax != null && rawMax !== "") {
        const n = parseInt(String(rawMax), 10);
        if (Number.isFinite(n)) maxStudentsVal = n;
      }

      const result = await pool.query(
        `INSERT INTO classes (name, level, section, school_id, class_teacher_id, academic_year, max_students)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [name, level, section, schoolId, classTeacherId, academicYear, maxStudentsVal]
      );
      res.status(201).json(result.rows[0]);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.put("/api/classes/:id", async (req, res) => {
    try {
      const { name, classTeacherId, capacity, maxStudents, max_students } = req.body;
      const fields: string[] = []; const params: any[] = []; let idx = 1;
      if (name !== undefined) { fields.push(`name=$${idx++}`); params.push(name); }
      if (classTeacherId !== undefined) { fields.push(`class_teacher_id=$${idx++}`); params.push(classTeacherId||null); }
      const cap = maxStudents ?? max_students ?? capacity;
      if (cap !== undefined) { fields.push(`max_students=$${idx++}`); params.push(cap === null || cap === "" ? null : parseInt(String(cap), 10)); }
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
