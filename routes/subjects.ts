import type { Express } from "express";
import pool from "../db";
import { loadGlobalSubjectTemplates } from "../lib/globalSubjectTemplates";

/** Non-empty subject code; DB NOT NULL + unique (school_id, code) on many schemas. */
function normalizeSubjectCode(name: string, raw: unknown): string {
  const trimmed = typeof raw === "string" ? raw.trim().toUpperCase() : "";
  if (trimmed.length > 0) return trimmed.slice(0, 50);
  const fromName = name
    .replace(/[^a-zA-Z0-9]+/g, "")
    .toUpperCase()
    .slice(0, 8);
  return (fromName || "SUBJ").slice(0, 50);
}

export function registerSubjectRoutes(app: Express) {
  /** Platform catalog (Super Admin → System Settings → Global Subject Pool). Public names/codes only. */
  app.get("/api/subject-templates", async (_req, res) => {
    try {
      const subjects = await loadGlobalSubjectTemplates(pool);
      res.json({ subjects, source: "global_settings" });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  /** Copy catalog entries into this school’s `subjects` table (skips codes already present). */
  app.post("/api/subjects/import-templates", async (req, res) => {
    try {
      const { schoolId, codes } = req.body as { schoolId?: string; codes?: string[] };
      if (!schoolId) return res.status(400).json({ message: "schoolId is required" });
      const templates = await loadGlobalSubjectTemplates(pool);
      const wantCodes = Array.isArray(codes) && codes.length
        ? new Set(codes.map((c) => String(c).trim().toUpperCase()).filter(Boolean))
        : null;
      const toAdd = wantCodes
        ? templates.filter((t) => wantCodes.has(t.code))
        : templates;
      const existing = await pool.query(
        `SELECT UPPER(TRIM(COALESCE(code::text, ''))) AS code FROM subjects WHERE school_id = $1`,
        [schoolId]
      );
      const have = new Set(existing.rows.map((r: { code: string }) => r.code));
      const created: unknown[] = [];
      for (const t of toAdd) {
        if (have.has(t.code)) continue;
        const ins = await pool.query(
          `INSERT INTO subjects (name, code, description, school_id, teacher_id, category, is_compulsory, updated_at)
           VALUES ($1, $2, NULL, $3, NULL, 'Core', true, NOW()) RETURNING *`,
          [t.name, t.code, schoolId]
        );
        if (ins.rows[0]) {
          created.push(ins.rows[0]);
          have.add(t.code);
        }
      }
      res.status(201).json({ created: created.length, subjects: created });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

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
      const { name, code, description, schoolId, teacherId, category, isCompulsory } = req.body;
      if (!name || typeof name !== "string" || !name.trim()) {
        return res.status(400).json({ message: "Subject name is required" });
      }
      if (!schoolId) return res.status(400).json({ message: "schoolId is required" });
      const finalCode = normalizeSubjectCode(name.trim(), code);
      const cat = typeof category === "string" && category.trim() ? category.trim().slice(0, 50) : "Core";
      const compulsory = isCompulsory === false ? false : true;
      const result = await pool.query(
        `INSERT INTO subjects (name, code, description, school_id, teacher_id, category, is_compulsory, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,NOW()) RETURNING *`,
        [name.trim(), finalCode, description ?? null, schoolId, teacherId ?? null, cat, compulsory]
      );
      res.status(201).json(result.rows[0]);
    } catch (err: any) {
      const msg = String(err?.message || err);
      if (/unique|duplicate/i.test(msg)) {
        return res.status(409).json({ message: "A subject with this code already exists for this school. Change the code and try again." });
      }
      res.status(500).json({ message: msg });
    }
  });

  app.put("/api/subjects/:id", async (req, res) => {
    try {
      const { name, code, teacherId, category, isCompulsory } = req.body;
      const fields: string[] = []; const params: any[] = []; let idx = 1;
      if (name !== undefined) { fields.push(`name=$${idx++}`); params.push(name); }
      if (code !== undefined) { fields.push(`code=$${idx++}`); params.push(String(code).trim().toUpperCase().slice(0, 50)); }
      if (teacherId !== undefined) { fields.push(`teacher_id=$${idx++}`); params.push(teacherId||null); }
      if (category !== undefined) { fields.push(`category=$${idx++}`); params.push(String(category).trim().slice(0, 50) || "Core"); }
      if (isCompulsory !== undefined) { fields.push(`is_compulsory=$${idx++}`); params.push(!!isCompulsory); }
      if (!fields.length) return res.status(400).json({ message: "No fields to update" });
      fields.push(`updated_at=NOW()`);
      params.push(req.params.id);
      const result = await pool.query(`UPDATE subjects SET ${fields.join(',')} WHERE id=$${idx} RETURNING *`, params);
      if (!result.rows.length) return res.status(404).json({ message: "Subject not found" });
      res.json(result.rows[0]);
    } catch (err: any) {
      const msg = String(err?.message || err);
      if (/unique|duplicate/i.test(msg)) {
        return res.status(409).json({ message: "A subject with this code already exists for this school." });
      }
      res.status(500).json({ message: msg });
    }
  });

  app.delete("/api/subjects/:id", async (req, res) => {
    try {
      await pool.query(`DELETE FROM subjects WHERE id=$1`, [req.params.id]);
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });
}
