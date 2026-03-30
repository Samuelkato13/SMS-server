import type { Express } from "express";
import pool from "../db";

export function registerAcademicRoutes(app: Express) {
  // ── Sections ──────────────────────────────────────────────────────────────
  app.get("/api/sections", async (req, res) => {
    try {
      const { schoolId } = req.query;
      const result = await pool.query(`SELECT * FROM sections WHERE school_id=$1 ORDER BY name`, [schoolId]);
      res.json(result.rows);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/sections", async (req, res) => {
    try {
      const { name, schoolId } = req.body;
      const existing = await pool.query(`SELECT id FROM sections WHERE school_id=$1 AND name=$2`, [schoolId, name]);
      if (existing.rows.length) return res.status(400).json({ message: 'Section already exists' });
      const result = await pool.query(`INSERT INTO sections (school_id, name) VALUES ($1,$2) RETURNING *`, [schoolId, name]);
      res.json(result.rows[0]);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.delete("/api/sections/:id", async (req, res) => {
    try {
      await pool.query(`DELETE FROM sections WHERE id=$1`, [req.params.id]);
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // ── Streams ───────────────────────────────────────────────────────────────
  app.get("/api/streams", async (req, res) => {
    try {
      const { schoolId } = req.query;
      const result = await pool.query(
        `SELECT s.*, c.name as class_name FROM streams s LEFT JOIN classes c ON s.class_id=c.id
         WHERE c.school_id=$1 ORDER BY c.name, s.name`, [schoolId]);
      res.json(result.rows);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/streams", async (req, res) => {
    try {
      const { name, classId } = req.body;
      const result = await pool.query(`INSERT INTO streams (class_id, name) VALUES ($1,$2) RETURNING *`, [classId, name]);
      res.json(result.rows[0]);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.delete("/api/streams/:id", async (req, res) => {
    try {
      await pool.query(`DELETE FROM streams WHERE id=$1`, [req.params.id]);
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // ── Academic Years ────────────────────────────────────────────────────────
  app.get("/api/academic-years", async (req, res) => {
    try {
      const { schoolId } = req.query;
      const result = await pool.query(
        `SELECT * FROM academic_years WHERE school_id=$1 ORDER BY start_date DESC NULLS LAST, name DESC`, [schoolId]);
      res.json(result.rows);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/academic-years", async (req, res) => {
    try {
      const { name, startDate, endDate, isActive, schoolId } = req.body;
      if (isActive) await pool.query(`UPDATE academic_years SET is_active=false WHERE school_id=$1`, [schoolId]);
      const result = await pool.query(
        `INSERT INTO academic_years (school_id, name, start_date, end_date, is_active)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [schoolId, name, startDate||null, endDate||null, !!isActive]);
      res.json(result.rows[0]);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.put("/api/academic-years/:id/activate", async (req, res) => {
    try {
      const yr = await pool.query(`SELECT school_id FROM academic_years WHERE id=$1`, [req.params.id]);
      if (!yr.rows.length) return res.status(404).json({ message: 'Not found' });
      await pool.query(`UPDATE academic_years SET is_active=false WHERE school_id=$1`, [yr.rows[0].school_id]);
      const result = await pool.query(`UPDATE academic_years SET is_active=true WHERE id=$1 RETURNING *`, [req.params.id]);
      res.json(result.rows[0]);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.delete("/api/academic-years/:id", async (req, res) => {
    try {
      await pool.query(`DELETE FROM academic_years WHERE id=$1`, [req.params.id]);
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // ── Terms ─────────────────────────────────────────────────────────────────
  app.get("/api/terms", async (req, res) => {
    try {
      const { schoolId } = req.query;
      const result = await pool.query(
        `SELECT t.*, ay.name as year_name FROM terms t LEFT JOIN academic_years ay ON t.academic_year_id=ay.id
         WHERE t.school_id=$1 ORDER BY ay.name DESC, t.name`, [schoolId]);
      res.json(result.rows);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/terms", async (req, res) => {
    try {
      const { name, academicYearId, startDate, endDate, schoolId } = req.body;
      const result = await pool.query(
        `INSERT INTO terms (academic_year_id, school_id, name, start_date, end_date)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [academicYearId, schoolId, name, startDate||null, endDate||null]);
      res.json(result.rows[0]);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.delete("/api/terms/:id", async (req, res) => {
    try {
      await pool.query(`DELETE FROM terms WHERE id=$1`, [req.params.id]);
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // ── Grading Systems ───────────────────────────────────────────────────────
  app.get("/api/grading-systems", async (req, res) => {
    try {
      const { schoolId } = req.query;
      const result = await pool.query(`SELECT * FROM grading_systems WHERE school_id=$1 ORDER BY section_name`, [schoolId]);
      res.json(result.rows);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/grading-systems", async (req, res) => {
    try {
      const { schoolId, sectionName, name, gradeRanges } = req.body;
      const result = await pool.query(
        `INSERT INTO grading_systems (school_id, section_name, name, grade_ranges)
         VALUES ($1,$2,$3,$4) ON CONFLICT (school_id, section_name) DO UPDATE SET name=$3, grade_ranges=$4 RETURNING *`,
        [schoolId, sectionName, name, JSON.stringify(gradeRanges)]);
      res.json(result.rows[0]);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // ── School Events ─────────────────────────────────────────────────────────
  app.get("/api/school-events", async (req, res) => {
    try {
      const { schoolId } = req.query;
      if (!schoolId) return res.status(400).json({ message: 'schoolId required' });
      const result = await pool.query(`SELECT * FROM school_events WHERE school_id=$1 ORDER BY date ASC`, [schoolId]);
      res.json(result.rows);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/school-events", async (req, res) => {
    try {
      const { title, type, date, endDate, description, schoolId } = req.body;
      if (!title || !date || !schoolId) return res.status(400).json({ message: 'title, date, schoolId required' });
      const result = await pool.query(
        `INSERT INTO school_events (school_id, title, type, date, end_date, description)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [schoolId, title, type||'event', date, endDate||null, description||null]);
      res.status(201).json(result.rows[0]);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.delete("/api/school-events/:id", async (req, res) => {
    try {
      await pool.query(`DELETE FROM school_events WHERE id=$1`, [req.params.id]);
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // ── Parent Communications ─────────────────────────────────────────────────
  app.get("/api/parent-communications", async (req, res) => {
    try {
      const { schoolId, classId } = req.query;
      if (!schoolId) return res.status(400).json({ message: 'schoolId required' });
      let query = `SELECT pc.*, s.first_name, s.last_name, u.first_name || ' ' || u.last_name as sent_by_name
                   FROM parent_communications pc LEFT JOIN students s ON pc.student_id=s.id
                   LEFT JOIN users u ON pc.sent_by=u.id WHERE pc.school_id=$1`;
      const params: any[] = [schoolId];
      if (classId) { query += ` AND pc.class_id=$2`; params.push(classId); }
      query += ` ORDER BY pc.sent_at DESC`;
      const result = await pool.query(query, params);
      res.json(result.rows);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/parent-communications", async (req, res) => {
    try {
      const { schoolId, classId, studentId, sentBy, message, subject, type } = req.body;
      if (!schoolId || !message) return res.status(400).json({ message: 'schoolId and message required' });
      const result = await pool.query(
        `INSERT INTO parent_communications (school_id, class_id, student_id, sent_by, message, subject, type)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [schoolId, classId||null, studentId||null, sentBy||null, message, subject||null, type||'individual']);
      res.status(201).json(result.rows[0]);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });
}
