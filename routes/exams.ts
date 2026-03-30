import type { Express } from "express";
import pool from "../db";

export function registerExamRoutes(app: Express) {
  app.get("/api/exams", async (req, res) => {
    try {
      const { schoolId, classId } = req.query;
      if (!schoolId) return res.status(400).json({ message: "schoolId required" });
      let query = `SELECT e.*, s.name as subject_name, c.name as class_name
                   FROM exams e LEFT JOIN subjects s ON e.subject_id=s.id LEFT JOIN classes c ON e.class_id=c.id
                   WHERE e.school_id=$1`;
      const params: any[] = [schoolId];
      if (classId) { query += ` AND e.class_id=$2`; params.push(classId); }
      query += ` ORDER BY e.exam_date DESC`;
      const result = await pool.query(query, params);
      res.json(result.rows);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/exams", async (req, res) => {
    try {
      const { title, description, subjectId, classId, schoolId, examDate, duration, totalMarks, passingMarks, examType } = req.body;
      const result = await pool.query(
        `INSERT INTO exams (title, description, subject_id, class_id, school_id, exam_date, duration, total_marks, passing_marks, exam_type)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [title, description, subjectId, classId, schoolId, examDate, duration, totalMarks, passingMarks, examType]
      );
      res.status(201).json(result.rows[0]);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.put("/api/exams/:id", async (req, res) => {
    try {
      const { title, term, examType, examDate, duration, totalMarks, passingMarks, description, classId, subjectId, status } = req.body;
      const fields: string[] = []; const params: any[] = []; let idx = 1;
      if (title !== undefined) { fields.push(`title=$${idx++}`); params.push(title); }
      if (term !== undefined) { fields.push(`term=$${idx++}`); params.push(term); }
      if (examType !== undefined) { fields.push(`exam_type=$${idx++}`); params.push(examType); }
      if (examDate !== undefined) { fields.push(`exam_date=$${idx++}`); params.push(examDate); }
      if (duration !== undefined) { fields.push(`duration=$${idx++}`); params.push(duration); }
      if (totalMarks !== undefined) { fields.push(`total_marks=$${idx++}`); params.push(totalMarks); }
      if (passingMarks !== undefined) { fields.push(`passing_marks=$${idx++}`); params.push(passingMarks); }
      if (description !== undefined) { fields.push(`description=$${idx++}`); params.push(description); }
      if (classId !== undefined) { fields.push(`class_id=$${idx++}`); params.push(classId||null); }
      if (subjectId !== undefined) { fields.push(`subject_id=$${idx++}`); params.push(subjectId||null); }
      if (status !== undefined) { fields.push(`status=$${idx++}`); params.push(status); }
      if (!fields.length) return res.status(400).json({ message: "No fields to update" });
      fields.push(`updated_at=now()`); params.push(req.params.id);
      const result = await pool.query(`UPDATE exams SET ${fields.join(',')} WHERE id=$${idx} RETURNING *`, params);
      if (!result.rows.length) return res.status(404).json({ message: "Exam not found" });
      res.json(result.rows[0]);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });
}
