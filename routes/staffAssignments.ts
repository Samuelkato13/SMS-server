import type { Express } from "express";
import pool from "../db";

const MANAGER_ROLES = new Set(["super_admin", "admin", "director", "head_teacher"]);

async function assertCanManageAssignments(assignerId: string | undefined, schoolId: string): Promise<{ ok: boolean; message?: string }> {
  if (!assignerId) return { ok: false, message: "assignerUserId required" };
  const r = await pool.query(
    `SELECT role, school_id FROM users WHERE id = $1 AND COALESCE(is_active, true) = true`,
    [assignerId]
  );
  const u = r.rows[0];
  if (!u) return { ok: false, message: "Assigner not found" };
  if (!MANAGER_ROLES.has(u.role)) return { ok: false, message: "Only admin, director, or head teacher can manage teaching assignments" };
  if (u.role === "super_admin") return { ok: true };
  if (String(u.school_id) !== String(schoolId)) return { ok: false, message: "Assigner must belong to this school" };
  return { ok: true };
}

export function registerStaffAssignmentRoutes(app: Express) {
  app.get("/api/staff-assignments", async (req, res) => {
    try {
      const { schoolId } = req.query;
      if (!schoolId) return res.status(400).json({ message: "schoolId required" });

      const [ct, sc] = await Promise.all([
        pool.query(
          `SELECT a.id, a.user_id, a.class_id, a.school_id, a.created_at,
                  u.first_name, u.last_name, u.username, u.role as user_role,
                  c.name as class_name, c.level as class_level
           FROM staff_class_teacher_assignments a
           JOIN users u ON u.id = a.user_id
           JOIN classes c ON c.id = a.class_id
           WHERE a.school_id = $1
           ORDER BY c.name, u.last_name`,
          [schoolId]
        ),
        pool.query(
          `SELECT a.id, a.user_id, a.class_id, a.subject_id, a.school_id, a.created_at,
                  u.first_name, u.last_name, u.username, u.role as user_role,
                  c.name as class_name, sub.name as subject_name, sub.code as subject_code
           FROM staff_subject_class_assignments a
           JOIN users u ON u.id = a.user_id
           JOIN classes c ON c.id = a.class_id
           JOIN subjects sub ON sub.id = a.subject_id
           WHERE a.school_id = $1
           ORDER BY c.name, sub.name, u.last_name`,
          [schoolId]
        ),
      ]);

      res.json({
        classTeachers: ct.rows,
        subjectClassTeachers: sc.rows,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/staff-assignments/class-teacher", async (req, res) => {
    try {
      const { userId, classId, schoolId, assignerUserId } = req.body || {};
      if (!userId || !classId || !schoolId || !assignerUserId) {
        return res.status(400).json({ message: "userId, classId, schoolId, assignerUserId required" });
      }
      const gate = await assertCanManageAssignments(assignerUserId, schoolId);
      if (!gate.ok) return res.status(403).json({ message: gate.message });

      const ins = await pool.query(
        `INSERT INTO staff_class_teacher_assignments (school_id, user_id, class_id, assigned_by)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, class_id) DO UPDATE SET assigned_by = EXCLUDED.assigned_by
         RETURNING *`,
        [schoolId, userId, classId, assignerUserId]
      );

      await pool.query(
        `UPDATE classes SET class_teacher_id = $1 WHERE id = $2 AND school_id = $3 AND class_teacher_id IS NULL`,
        [userId, classId, schoolId]
      );

      res.status(201).json(ins.rows[0]);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/staff-assignments/class-teacher/:id", async (req, res) => {
    try {
      const { assignerUserId, schoolId } = req.query as Record<string, string>;
      if (!assignerUserId || !schoolId) {
        return res.status(400).json({ message: "assignerUserId and schoolId query params required" });
      }
      const gate = await assertCanManageAssignments(assignerUserId, schoolId);
      if (!gate.ok) return res.status(403).json({ message: gate.message });

      const row = await pool.query(
        `DELETE FROM staff_class_teacher_assignments WHERE id = $1 AND school_id = $2 RETURNING class_id, user_id`,
        [req.params.id, schoolId]
      );
      if (!row.rows.length) return res.status(404).json({ message: "Assignment not found" });

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/staff-assignments/subject-class", async (req, res) => {
    try {
      const { userId, classId, subjectId, schoolId, assignerUserId } = req.body || {};
      if (!userId || !classId || !subjectId || !schoolId || !assignerUserId) {
        return res.status(400).json({ message: "userId, classId, subjectId, schoolId, assignerUserId required" });
      }
      const gate = await assertCanManageAssignments(assignerUserId, schoolId);
      if (!gate.ok) return res.status(403).json({ message: gate.message });

      const ins = await pool.query(
        `INSERT INTO staff_subject_class_assignments (school_id, user_id, class_id, subject_id, assigned_by)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (user_id, class_id, subject_id) DO UPDATE SET assigned_by = EXCLUDED.assigned_by
         RETURNING *`,
        [schoolId, userId, classId, subjectId, assignerUserId]
      );

      res.status(201).json(ins.rows[0]);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/staff-assignments/subject-class/:id", async (req, res) => {
    try {
      const { assignerUserId, schoolId } = req.query as Record<string, string>;
      if (!assignerUserId || !schoolId) {
        return res.status(400).json({ message: "assignerUserId and schoolId query params required" });
      }
      const gate = await assertCanManageAssignments(assignerUserId, schoolId);
      if (!gate.ok) return res.status(403).json({ message: gate.message });

      const row = await pool.query(
        `DELETE FROM staff_subject_class_assignments WHERE id = $1 AND school_id = $2 RETURNING id`,
        [req.params.id, schoolId]
      );
      if (!row.rows.length) return res.status(404).json({ message: "Assignment not found" });

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });
}

/** Used by marks routes — exported for tests / reuse */
export async function canUserRecordMarksForClassSubject(
  userId: string,
  subjectId: string,
  classId: string,
  schoolId: string
): Promise<boolean> {
  const ur = await pool.query(`SELECT role FROM users WHERE id = $1 AND COALESCE(is_active, true) = true`, [userId]);
  const role = ur.rows[0]?.role as string | undefined;
  if (!role) return false;
  if (["super_admin", "admin", "director", "head_teacher"].includes(role)) return true;

  const legacy = await pool.query(
    `SELECT teacher_id FROM subjects WHERE id = $1 AND school_id = $2`,
    [subjectId, schoolId]
  );
  if (legacy.rows[0]?.teacher_id && String(legacy.rows[0].teacher_id) === String(userId)) return true;

  const sc = await pool.query(
    `SELECT 1 FROM staff_subject_class_assignments
     WHERE user_id = $1 AND subject_id = $2 AND class_id = $3 AND school_id = $4`,
    [userId, subjectId, classId, schoolId]
  );
  if (sc.rows.length) return true;

  const ct = await pool.query(
    `SELECT 1 FROM staff_class_teacher_assignments WHERE user_id = $1 AND class_id = $2 AND school_id = $3`,
    [userId, classId, schoolId]
  );
  if (ct.rows.length) {
    return ["class_teacher", "subject_teacher", "bursar"].includes(role);
  }

  return false;
}
