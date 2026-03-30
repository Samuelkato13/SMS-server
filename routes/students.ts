import type { Express } from "express";
import pool from "../db";

export function registerStudentRoutes(app: Express) {
  app.get("/api/students/defaulters", async (req, res) => {
    try {
      const { schoolId } = req.query;
      if (!schoolId) return res.status(400).json({ message: "schoolId required" });
      const result = await pool.query(`
        SELECT s.id, s.first_name || ' ' || s.last_name as student_name,
               s.admission_number, s.payment_code, c.name as class_name,
               COALESCE(SUM(fs.amount),0) as total_billed,
               COALESCE(paid.total_paid,0) as total_paid,
               COALESCE(SUM(fs.amount),0) - COALESCE(paid.total_paid,0) as balance
        FROM students s
        LEFT JOIN classes c ON s.class_id = c.id
        CROSS JOIN fee_structures fs
        LEFT JOIN (
          SELECT student_id, SUM(amount) as total_paid FROM payments
          WHERE school_id=$1 AND status='completed' AND is_reversed=false GROUP BY student_id
        ) paid ON paid.student_id = s.id
        WHERE s.school_id=$1 AND fs.school_id=$1
        GROUP BY s.id, s.first_name, s.last_name, s.admission_number, s.payment_code, c.name, paid.total_paid
        HAVING COALESCE(SUM(fs.amount),0) - COALESCE(paid.total_paid,0) > 0
        ORDER BY balance DESC`, [schoolId]);
      res.json(result.rows);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.get("/api/students", async (req, res) => {
    try {
      const { schoolId, classId } = req.query;
      if (!schoolId) return res.status(400).json({ message: "schoolId required" });
      let query = `SELECT s.*, c.name as class_name, c.level as class_level
                   FROM students s LEFT JOIN classes c ON s.class_id=c.id
                   WHERE s.school_id=$1 AND s.is_active=true`;
      const params: any[] = [schoolId];
      if (classId) { query += ` AND s.class_id=$2`; params.push(classId); }
      query += ` ORDER BY s.last_name, s.first_name`;
      const result = await pool.query(query, params);
      res.json(result.rows);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.get("/api/students/:id", async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT s.*, c.name as class_name FROM students s LEFT JOIN classes c ON s.class_id=c.id WHERE s.id=$1`,
        [req.params.id]
      );
      if (!result.rows.length) return res.status(404).json({ message: "Student not found" });
      res.json(result.rows[0]);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/students", async (req, res) => {
    try {
      const { firstName, lastName, email, dateOfBirth, gender, classId, schoolId, guardianName, guardianPhone, guardianEmail, address, section } = req.body;
      const abbr = await pool.query("SELECT abbreviation FROM schools WHERE id=$1", [schoolId]);
      const schoolAbbr = abbr.rows[0]?.abbreviation || "SCH";
      const countRes = await pool.query("SELECT COUNT(*) FROM students WHERE school_id=$1", [schoolId]);
      const count = String(parseInt(countRes.rows[0].count) + 1).padStart(4, '0');
      const year = new Date().getFullYear();
      const paymentCode = `${schoolAbbr}-${year}-${count}`;
      const result = await pool.query(
        `INSERT INTO students (first_name, last_name, email, date_of_birth, gender, class_id, school_id, payment_code, guardian_name, guardian_phone, guardian_email, address, section)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
        [firstName, lastName, email, dateOfBirth, gender, classId, schoolId, paymentCode, guardianName, guardianPhone, guardianEmail, address, section??'day']
      );
      res.status(201).json(result.rows[0]);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.put("/api/students/:id", async (req, res) => {
    try {
      const { firstName, lastName, email, dateOfBirth, gender, classId, guardianName, guardianPhone, guardianEmail, address, isActive, medicalInfo, section } = req.body;
      const result = await pool.query(
        `UPDATE students SET
           first_name=COALESCE($1,first_name), last_name=COALESCE($2,last_name),
           email=COALESCE($3,email), date_of_birth=COALESCE($4,date_of_birth),
           gender=COALESCE($5,gender), class_id=COALESCE($6,class_id),
           guardian_name=COALESCE($7,guardian_name), guardian_phone=COALESCE($8,guardian_phone),
           guardian_email=COALESCE($9,guardian_email), address=COALESCE($10,address),
           is_active=COALESCE($11,is_active), medical_info=COALESCE($12,medical_info),
           section=COALESCE($13,section), updated_at=NOW()
         WHERE id=$14 RETURNING *`,
        [firstName??null, lastName??null, email??null, dateOfBirth??null, gender??null,
         classId??null, guardianName??null, guardianPhone??null, guardianEmail??null,
         address??null, isActive!==undefined?isActive:null, medicalInfo??null, section??null, req.params.id]
      );
      if (!result.rows.length) return res.status(404).json({ message: "Student not found" });
      res.json(result.rows[0]);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.delete("/api/students/:id", async (req, res) => {
    try {
      const result = await pool.query(
        `DELETE FROM students WHERE id=$1 RETURNING id`, [req.params.id]
      );
      if (!result.rows.length) return res.status(404).json({ message: "Student not found" });
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });
}
