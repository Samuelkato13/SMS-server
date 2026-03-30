import type { Express } from "express";
import pool from "../db";

export function registerSchoolRoutes(app: Express) {
  app.get("/api/schools", async (_req, res) => {
    try {
      const result = await pool.query(
        `SELECT *, (SELECT COUNT(*) FROM students WHERE school_id = schools.id) as student_count
         FROM schools WHERE is_active = true ORDER BY name`
      );
      res.json(result.rows);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.get("/api/schools/:id", async (req, res) => {
    try {
      const result = await pool.query("SELECT * FROM schools WHERE id = $1", [req.params.id]);
      if (!result.rows.length) return res.status(404).json({ message: "School not found" });
      res.json(result.rows[0]);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/schools", async (req, res) => {
    try {
      const { name, abbreviation, email, phone, address, logoUrl, subscriptionPlan, schoolType, motto } = req.body;
      const result = await pool.query(
        `INSERT INTO schools (name, abbreviation, email, phone, address, logo_url, subscription_plan, school_type, motto)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [name, abbreviation, email, phone, address, logoUrl, subscriptionPlan || "starter", schoolType, motto]
      );
      res.status(201).json(result.rows[0]);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // Director-editable fields (no bank details — those are admin/superadmin only)
  app.put("/api/schools/:id", async (req, res) => {
    try {
      const { name, abbreviation, email, phone, address, logoUrl, motto, schoolType, sectionType } = req.body;
      const result = await pool.query(
        `UPDATE schools SET
           name=COALESCE($1,name), abbreviation=COALESCE($2,abbreviation),
           email=COALESCE($3,email), phone=COALESCE($4,phone),
           address=COALESCE($5,address), logo_url=COALESCE($6,logo_url),
           motto=COALESCE($7,motto), school_type=COALESCE($8,school_type),
           section_type=COALESCE($9,section_type),
           updated_at=NOW()
         WHERE id=$10 RETURNING *`,
        [name, abbreviation, email, phone, address, logoUrl, motto, schoolType, sectionType??null, req.params.id]
      );
      if (!result.rows.length) return res.status(404).json({ message: "School not found" });
      res.json(result.rows[0]);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // Admin/super_admin bank + full details update
  app.put("/api/schools/:id/admin", async (req, res) => {
    try {
      const {
        name, abbreviation, email, phone, address, logoUrl, motto, schoolType, sectionType, subdomain, status,
        bankAccountTitle, bankAccountType, bankAccountNumber, bankName
      } = req.body;
      const result = await pool.query(
        `UPDATE schools SET
           name=COALESCE($1,name), abbreviation=COALESCE($2,abbreviation),
           email=COALESCE($3,email), phone=COALESCE($4,phone),
           address=COALESCE($5,address), logo_url=COALESCE($6,logo_url),
           motto=COALESCE($7,motto), school_type=COALESCE($8,school_type),
           section_type=COALESCE($9,section_type),
           subdomain=COALESCE($10,subdomain), status=COALESCE($11,status),
           bank_account_title=COALESCE($12,bank_account_title),
           bank_account_type=COALESCE($13,bank_account_type),
           bank_account_number=COALESCE($14,bank_account_number),
           bank_name=COALESCE($15,bank_name),
           updated_at=NOW()
         WHERE id=$16 RETURNING *`,
        [name, abbreviation, email, phone, address, logoUrl, motto, schoolType, sectionType??null, subdomain, status,
         bankAccountTitle, bankAccountType, bankAccountNumber, bankName, req.params.id]
      );
      if (!result.rows.length) return res.status(404).json({ message: "School not found" });
      res.json(result.rows[0]);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });
}
