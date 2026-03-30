import type { Express } from "express";
import pool from "../db";

export function registerGroupRoutes(app: Express) {

  // GET all groups for a school
  app.get("/api/student-groups", async (req, res) => {
    const { schoolId } = req.query;
    if (!schoolId) return res.status(400).json({ error: "schoolId required" });
    try {
      const r = await pool.query(
        `SELECT sg.*,
                COUNT(sgm.id)::int AS member_count
         FROM student_groups sg
         LEFT JOIN student_group_members sgm ON sgm.group_id = sg.id
         WHERE sg.school_id=$1
         GROUP BY sg.id
         ORDER BY sg.created_at DESC`,
        [schoolId]
      );
      res.json(r.rows);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST create group
  app.post("/api/student-groups", async (req, res) => {
    const { schoolId, name, description, color, createdBy, createdByName } = req.body;
    if (!schoolId || !name) return res.status(400).json({ error: "schoolId and name required" });
    try {
      const r = await pool.query(
        `INSERT INTO student_groups (school_id, name, description, color, created_by, created_by_name)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [schoolId, name, description || null, color || 'blue', createdBy || null, createdByName || null]
      );
      res.json(r.rows[0]);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // PUT update group
  app.put("/api/student-groups/:id", async (req, res) => {
    const { name, description, color } = req.body;
    try {
      const r = await pool.query(
        `UPDATE student_groups SET name=$1, description=$2, color=$3, updated_at=NOW()
         WHERE id=$4 RETURNING *`,
        [name, description || null, color || 'blue', req.params.id]
      );
      res.json(r.rows[0]);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // DELETE group
  app.delete("/api/student-groups/:id", async (req, res) => {
    try {
      await pool.query("DELETE FROM student_groups WHERE id=$1", [req.params.id]);
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET members of a group (with student details)
  app.get("/api/student-groups/:id/members", async (req, res) => {
    try {
      const r = await pool.query(
        `SELECT s.*, c.name as class_name, sgm.added_at
         FROM student_group_members sgm
         JOIN students s ON s.id = sgm.student_id
         LEFT JOIN classes c ON c.id = s.class_id
         WHERE sgm.group_id=$1
         ORDER BY s.last_name, s.first_name`,
        [req.params.id]
      );
      res.json(r.rows);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST add members to group
  app.post("/api/student-groups/:id/members", async (req, res) => {
    const { studentIds } = req.body;
    if (!Array.isArray(studentIds) || !studentIds.length)
      return res.status(400).json({ error: "studentIds[] required" });
    try {
      for (const sid of studentIds) {
        await pool.query(
          `INSERT INTO student_group_members (group_id, student_id) VALUES ($1,$2)
           ON CONFLICT (group_id, student_id) DO NOTHING`,
          [req.params.id, sid]
        );
      }
      res.json({ success: true, added: studentIds.length });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // DELETE remove a member from group
  app.delete("/api/student-groups/:id/members/:studentId", async (req, res) => {
    try {
      await pool.query(
        "DELETE FROM student_group_members WHERE group_id=$1 AND student_id=$2",
        [req.params.id, req.params.studentId]
      );
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST bulk assign fee to group members (records payment entries)
  app.post("/api/student-groups/:id/assign-fee", async (req, res) => {
    const { feeStructureId, schoolId, recordedBy } = req.body;
    if (!feeStructureId || !schoolId) return res.status(400).json({ error: "feeStructureId and schoolId required" });
    try {
      // Get members
      const members = await pool.query(
        `SELECT s.id, s.payment_code FROM student_group_members sgm
         JOIN students s ON s.id=sgm.student_id WHERE sgm.group_id=$1`,
        [req.params.id]
      );
      // Get fee amount
      const fee = await pool.query("SELECT * FROM fee_structures WHERE id=$1", [feeStructureId]);
      if (!fee.rows[0]) return res.status(404).json({ error: "Fee structure not found" });
      const amount = fee.rows[0].amount;

      let created = 0;
      for (const m of members.rows) {
        // Check no duplicate pending
        const exists = await pool.query(
          `SELECT id FROM payments WHERE student_id=$1 AND fee_structure_id=$2 AND status='pending'`,
          [m.id, feeStructureId]
        );
        if (!exists.rows.length) {
          await pool.query(
            `INSERT INTO payments (student_id, fee_structure_id, school_id, payment_code, amount,
              payment_method, status, recorded_by)
             VALUES ($1,$2,$3,$4,$5,'cash','pending',$6)`,
            [m.id, feeStructureId, schoolId, m.payment_code, amount, recordedBy || null]
          );
          created++;
        }
      }
      res.json({ success: true, assigned: created, total: members.rows.length });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
}
