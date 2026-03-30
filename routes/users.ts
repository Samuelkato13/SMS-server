import type { Express } from "express";
import pool from "../db";
import bcrypt from "bcryptjs";

export function registerUserRoutes(app: Express) {
  app.get("/api/users", async (req, res) => {
    try {
      const { schoolId } = req.query;
      const q = schoolId
        ? `SELECT u.*, s.name as school_name FROM users u LEFT JOIN schools s ON u.school_id=s.id WHERE u.school_id=$1 ORDER BY u.last_name`
        : `SELECT u.*, s.name as school_name FROM users u LEFT JOIN schools s ON u.school_id=s.id ORDER BY u.last_name`;
      const result = await pool.query(q, schoolId ? [schoolId] : []);
      res.json(result.rows.map(({ password_hash, ...u }: any) => u));
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/users", async (req, res) => {
    try {
      const { email, role, schoolId, firstName, lastName, phone, department, password } = req.body;
      if (!email || !role || !schoolId || !firstName) {
        return res.status(400).json({ message: "email, role, schoolId and firstName are required" });
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ message: "Please provide a valid email address" });
      }
      const abbr = await pool.query("SELECT abbreviation FROM schools WHERE id=$1", [schoolId]);
      const schoolAbbr = (abbr.rows[0]?.abbreviation ?? 'sch').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 6);
      const ROLE_PREFIX: Record<string, string> = {
        director: 'dr', head_teacher: 'ht', class_teacher: 'ct',
        subject_teacher: 'st', bursar: 'bsr', admin: 'adm',
      };
      const pfx = ROLE_PREFIX[role] ?? role.slice(0, 3);
      const base = `${pfx}-${schoolAbbr}`;
      const existingUn = await pool.query(
        `SELECT username FROM users WHERE username=$1 OR username LIKE $2`, [base, `${base}-%`]
      );
      let username = base;
      if (existingUn.rows.length) {
        const used = new Set(existingUn.rows.map((r: any) => r.username));
        if (used.has(base)) {
          for (let i = 2; i <= 99; i++) {
            if (!used.has(`${base}-${i}`)) { username = `${base}-${i}`; break; }
          }
        }
      }
      const passwordHash = password ? await bcrypt.hash(password, 10) : null;
      const result = await pool.query(
        `INSERT INTO users (username, email, role, school_id, first_name, last_name, phone, department, password_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [username, email, role, schoolId, firstName, lastName, phone ?? null, department ?? null, passwordHash]
      );
      const { password_hash, ...newUser } = result.rows[0];
      res.status(201).json(newUser);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.put("/api/users/:id", async (req, res) => {
    try {
      const { role, firstName, lastName, isActive, email, department, phone, password, username } = req.body;
      let passwordHash = undefined;
      if (password) passwordHash = await bcrypt.hash(password, 10);
      if (username) {
        const check = await pool.query(`SELECT id FROM users WHERE username=$1 AND id!=$2`, [username, req.params.id]);
        if (check.rows.length) return res.status(400).json({ message: `Username "${username}" is already taken` });
      }
      const result = await pool.query(
        `UPDATE users SET
           role=COALESCE($1,role), first_name=COALESCE($2,first_name), last_name=COALESCE($3,last_name),
           is_active=COALESCE($4,is_active), email=COALESCE($5,email), department=COALESCE($6,department),
           phone=COALESCE($7,phone), password_hash=COALESCE($8,password_hash),
           username=COALESCE($9,username), updated_at=NOW()
         WHERE id=$10 RETURNING *`,
        [role??null, firstName??null, lastName??null, isActive!==undefined?isActive:null,
         email??null, department??null, phone??null, passwordHash??null, username??null, req.params.id]
      );
      if (!result.rows.length) return res.status(404).json({ message: "User not found" });
      const { password_hash, ...safeUser } = result.rows[0];
      res.json(safeUser);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.delete("/api/users/:id", async (req, res) => {
    try {
      await pool.query(`UPDATE users SET is_active=false WHERE id=$1`, [req.params.id]);
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });
}
