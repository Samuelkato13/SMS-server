import type { Express } from "express";
import pool from "../db";
import bcrypt from "bcryptjs";
import { DEFAULT_USER_PASSWORD } from "../lib/constants";

export function registerSignupRoutes(app: Express) {
  // POST /api/demo-request — save demo request to DB
  app.post("/api/demo-request", async (req, res) => {
    try {
      const { schoolName, contactName, email, phone, numberOfStudents, message, district, schoolType } = req.body;
      if (!schoolName || !contactName || !email)
        return res.status(400).json({ message: "School name, contact name and email are required" });
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        return res.status(400).json({ message: "Please provide a valid email address" });
      await pool.query(
        `INSERT INTO school_signup_requests (school_name, contact_name, email, phone, district, school_type, number_of_students, message, request_type)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'demo')`,
        [schoolName, contactName, email, phone || null, district || null, schoolType || null,
         numberOfStudents ? parseInt(numberOfStudents) : null, message || null]);
      res.json({ success: true, message: "Demo request received! Our team will contact you within 24 hours." });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // POST /api/signup-request — free trial or get-started request
  app.post("/api/signup-request", async (req, res) => {
    try {
      const { schoolName, contactName, email, phone, district, schoolType, numberOfStudents, message, requestType } = req.body;
      if (!schoolName || !contactName || !email)
        return res.status(400).json({ message: "School name, contact name and email are required" });
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        return res.status(400).json({ message: "Please provide a valid email address" });
      await pool.query(
        `INSERT INTO school_signup_requests (school_name, contact_name, email, phone, district, school_type, number_of_students, message, request_type)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [schoolName, contactName, email, phone || null, district || null, schoolType || null,
         numberOfStudents ? parseInt(numberOfStudents) : null, message || null, requestType || 'trial']);
      res.json({ success: true, message: "Request received! Our team will set up your school account within 24 hours." });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // GET /api/admin/signup-requests — list all requests
  app.get("/api/admin/signup-requests", async (req, res) => {
    try {
      const { status } = req.query;
      // Also look up the director's username from users table for approved requests
      let query = `
        SELECT sr.*,
          COALESCE(sr.created_school_admin_username, u.username) AS resolved_username
        FROM school_signup_requests sr
        LEFT JOIN users u ON u.email = sr.created_school_admin_email AND u.role = 'director'
      `;
      if (status) query += ` WHERE sr.status=$1`;
      query += ` ORDER BY sr.created_at DESC`;
      const result = await pool.query(query, status ? [status] : []);
      res.json(result.rows);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // PUT /api/admin/signup-requests/:id — update status/notes
  app.put("/api/admin/signup-requests/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const { status, adminNotes, reviewedBy } = req.body;
      const result = await pool.query(
        `UPDATE school_signup_requests SET status=COALESCE($1,status), admin_notes=COALESCE($2,admin_notes),
         reviewed_by=COALESCE($3,reviewed_by), reviewed_at=NOW(), updated_at=NOW()
         WHERE id=$4 RETURNING *`,
        [status || null, adminNotes || null, reviewedBy || null, id]);
      if (!result.rows.length) return res.status(404).json({ message: "Request not found" });
      res.json(result.rows[0]);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // POST /api/admin/signup-requests/:id/approve — create school + director user
  app.post("/api/admin/signup-requests/:id/approve", async (req, res) => {
    try {
      const { id } = req.params;
      const { reviewedBy, schoolEmail, schoolPhone, schoolAddress, schoolAbbr } = req.body;
      const req2 = await pool.query(`SELECT * FROM school_signup_requests WHERE id=$1`, [id]);
      if (!req2.rows.length) return res.status(404).json({ message: "Request not found" });
      const sr = req2.rows[0];
      if (sr.status === 'approved') return res.status(400).json({ message: "Already approved" });

      // Newly approved directors get the platform-wide default password and
      // can update it from their profile after first sign-in.
      const tempPassword = DEFAULT_USER_PASSWORD;
      const passwordHash = await bcrypt.hash(tempPassword, 10);
      const trialEnd = new Date(); trialEnd.setMonth(trialEnd.getMonth() + 1);
      const abbr = schoolAbbr || sr.school_name.split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0,5);

      // Create school
      const schoolResult = await pool.query(
        `INSERT INTO schools (name, abbreviation, email, phone, address, subscription_plan, status, is_active)
         VALUES ($1,$2,$3,$4,$5,'trial','active',true) RETURNING *`,
        [sr.school_name, abbr, schoolEmail||sr.email, schoolPhone||sr.phone||'0700000000', schoolAddress||sr.district||'Uganda']);
      const school = schoolResult.rows[0];

      // Create director user (the school's primary admin)
      const nameParts = sr.contact_name.trim().split(' ');
      const firstName = nameParts[0];
      const lastName = nameParts.slice(1).join(' ') || 'Director';
      // Generate proper username: dr-{schoolabbr}
      const usernameBase = `dr-${abbr.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
      const existingUn = await pool.query(
        `SELECT username FROM users WHERE username=$1 OR username LIKE $2`,
        [usernameBase, `${usernameBase}-%`]
      );
      let username = usernameBase;
      if (existingUn.rows.length) {
        const used = new Set(existingUn.rows.map((r: any) => r.username));
        if (used.has(usernameBase)) {
          for (let i = 2; i <= 99; i++) {
            if (!used.has(`${usernameBase}-${i}`)) { username = `${usernameBase}-${i}`; break; }
          }
        }
      }
      await pool.query(
        `INSERT INTO users (username, email, role, school_id, first_name, last_name, password_hash, is_active)
         VALUES ($1,$2,'director',$3,$4,$5,$6,true)`,
        [username, sr.email, school.id, firstName, lastName, passwordHash]);

      // Also create a trial subscription record
      await pool.query(
        `INSERT INTO subscriptions (school_id, plan, start_date, end_date, status, amount_ugx)
         VALUES ($1,'trial',NOW(),$2,'active',0)`,
        [school.id, trialEnd.toISOString().split('T')[0]]);

      // Mark request approved
      await pool.query(
        `UPDATE school_signup_requests SET status='approved', reviewed_by=$1, reviewed_at=NOW(),
         trial_start_date=NOW(), trial_end_date=$2, approved_school_id=$3,
         created_school_admin_email=$4, created_school_admin_password=$5,
         created_school_admin_username=$6, updated_at=NOW()
         WHERE id=$7`,
        [reviewedBy||null, trialEnd.toISOString().split('T')[0], school.id, sr.email, tempPassword, username, id]);

      res.json({
        success: true, school,
        directorUsername: username, directorEmail: sr.email, tempPassword,
        message: `School created! Credentials for ${sr.contact_name}: Username: ${username} / Password: ${tempPassword}`
      });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });
}
