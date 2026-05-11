import type { Express } from "express";
import pool from "../db";

const MANAGER_ROLES = ["super_admin", "admin", "director", "head_teacher"];

async function assertCanManageAssignments(assignerUserId: string, schoolId: string): Promise<void> {
  const r = await pool.query(`SELECT role, school_id FROM users WHERE id=$1`, [assignerUserId]);
  const row = r.rows[0];
  if (!row) {
    const e = new Error("Assigner not found") as Error & { status?: number };
    e.status = 400;
    throw e;
  }
  if (!MANAGER_ROLES.includes(row.role)) {
    const e = new Error("Forbidden") as Error & { status?: number };
    e.status = 403;
    throw e;
  }
  if (row.role !== "super_admin" && String(row.school_id) !== String(schoolId)) {
    const e = new Error("School mismatch") as Error & { status?: number };
    e.status = 403;
    throw e;
  }
}

/** Who may record marks for a given class + subject at a school. */
export async function canUserRecordMarksForClassSubject(
  userId: string,
  subjectId: string,
  classId: string,
  schoolId: string
): Promise<boolean> {
  if (!userId || !subjectId || !classId || !schoolId) return false;

  const u = await pool.query(`SELECT role, school_id FROM users WHERE id=$1`, [userId]);
  const user = u.rows[0];
  if (!user) return false;
  if (String(user.school_id) !== String(schoolId)) return false;

  const role: string = user.role;
  if (["super_admin", "admin", "director", "head_teacher"].includes(role)) return true;

  const sub = await pool.query(`SELECT teacher_id FROM subjects WHERE id=$1 AND school_id=$2`, [subjectId, schoolId]);
  const subjectTeacherId = sub.rows[0]?.teacher_id;
  if (subjectTeacherId && String(subjectTeacherId) === String(userId) && role === "subject_teacher") {
    return true;
  }

  const scc = await pool.query(
    `SELECT 1 FROM staff_subject_class_assignments
     WHERE user_id=$1 AND class_id=$2 AND subject_id=$3 AND school_id=$4`,
    [userId, classId, subjectId, schoolId]
  );
  if (scc.rows.length) {
    return ["subject_teacher", "class_teacher"].includes(role);
  }

  const ctStaff = await pool.query(
    `SELECT 1 FROM staff_class_teacher_assignments WHERE user_id=$1 AND class_id=$2 AND school_id=$3`,
    [userId, classId, schoolId]
  );
  if (ctStaff.rows.length) {
    return ["class_teacher", "subject_teacher", "bursar"].includes(role);
  }

  const cls = await pool.query(`SELECT class_teacher_id FROM classes WHERE id=$1 AND school_id=$2`, [classId, schoolId]);
  if (cls.rows[0]?.class_teacher_id && String(cls.rows[0].class_teacher_id) === String(userId)) {
    return ["class_teacher", "subject_teacher", "bursar"].includes(role);
  }

  return false;
}

export function registerStaffAssignmentRoutes(app: Express) {
  app.get("/api/staff-assignments", async (req, res) => {
    try {
      const { schoolId, managerUserId } = req.query;
      if (!schoolId || !managerUserId) {
        return res.status(400).json({ message: "schoolId and managerUserId required" });
      }
      await assertCanManageAssignments(String(managerUserId), String(schoolId));

      const classTeachers = await pool.query(
        `SELECT scta.*, u.first_name, u.last_name, u.role AS user_role, c.name AS class_name
         FROM staff_class_teacher_assignments scta
         JOIN users u ON scta.user_id = u.id
         JOIN classes c ON scta.class_id = c.id
         WHERE scta.school_id = $1
         ORDER BY c.name, u.last_name`,
        [schoolId]
      );
      const subjectClassTeachers = await pool.query(
        `SELECT ssca.*, u.first_name, u.last_name, u.role AS user_role, c.name AS class_name, sub.name AS subject_name
         FROM staff_subject_class_assignments ssca
         JOIN users u ON ssca.user_id = u.id
         JOIN classes c ON ssca.class_id = c.id
         JOIN subjects sub ON ssca.subject_id = sub.id
         WHERE ssca.school_id = $1
         ORDER BY u.last_name, c.name, sub.name`,
        [schoolId]
      );
      res.json({ classTeachers: classTeachers.rows, subjectClassTeachers: subjectClassTeachers.rows });
    } catch (e: any) {
      const status = e.status ?? 500;
      res.status(status).json({ message: e.message || "Error" });
    }
  });

  app.post("/api/staff-assignments/class-teacher", async (req, res) => {
    try {
      const { userId, classId, schoolId, assignerUserId } = req.body;
      if (!userId || !classId || !schoolId || !assignerUserId) {
        return res.status(400).json({ message: "userId, classId, schoolId, assignerUserId required" });
      }
      await assertCanManageAssignments(String(assignerUserId), String(schoolId));

      const v = await pool.query(
        `SELECT 1 FROM users u
         JOIN classes c ON c.id=$2 AND c.school_id=$3
         WHERE u.id=$1 AND u.school_id=$3`,
        [userId, classId, schoolId]
      );
      if (!v.rows.length) return res.status(400).json({ message: "User or class not in this school" });

      const ins = await pool.query(
        `INSERT INTO staff_class_teacher_assignments (user_id, class_id, school_id, assigned_by)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (user_id, class_id) DO UPDATE SET
           school_id = EXCLUDED.school_id,
           assigned_by = EXCLUDED.assigned_by,
           updated_at = NOW()
         RETURNING *`,
        [userId, classId, schoolId, assignerUserId]
      );
      await pool.query(
        `UPDATE classes SET class_teacher_id=$1 WHERE id=$2 AND school_id=$3 AND class_teacher_id IS NULL`,
        [userId, classId, schoolId]
      );
      res.json(ins.rows[0]);
    } catch (e: any) {
      const status = e.status ?? 500;
      res.status(status).json({ message: e.message || "Error" });
    }
  });

  app.delete("/api/staff-assignments/class-teacher/:id", async (req, res) => {
    try {
      const { assignerUserId, schoolId } = req.query;
      if (!assignerUserId || !schoolId) {
        return res.status(400).json({ message: "assignerUserId and schoolId required" });
      }
      await assertCanManageAssignments(String(assignerUserId), String(schoolId));
      const del = await pool.query(
        `DELETE FROM staff_class_teacher_assignments WHERE id=$1 AND school_id=$2 RETURNING id`,
        [req.params.id, schoolId]
      );
      if (!del.rowCount) return res.status(404).json({ message: "Not found" });
      res.json({ success: true });
    } catch (e: any) {
      const status = e.status ?? 500;
      res.status(status).json({ message: e.message || "Error" });
    }
  });

  app.post("/api/staff-assignments/subject-class", async (req, res) => {
    try {
      const { userId, classId, subjectId, schoolId, assignerUserId } = req.body;
      if (!userId || !classId || !subjectId || !schoolId || !assignerUserId) {
        return res.status(400).json({ message: "userId, classId, subjectId, schoolId, assignerUserId required" });
      }
      await assertCanManageAssignments(String(assignerUserId), String(schoolId));

      const v = await pool.query(
        `SELECT 1 FROM users u
         JOIN classes c ON c.id=$2 AND c.school_id=$3
         JOIN subjects s ON s.id=$4 AND s.school_id=$3
         WHERE u.id=$1 AND u.school_id=$3`,
        [userId, classId, schoolId, subjectId]
      );
      if (!v.rows.length) return res.status(400).json({ message: "User, class, or subject not in this school" });

      const ins = await pool.query(
        `INSERT INTO staff_subject_class_assignments (user_id, class_id, subject_id, school_id, assigned_by)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (user_id, class_id, subject_id) DO UPDATE SET
           school_id = EXCLUDED.school_id,
           assigned_by = EXCLUDED.assigned_by,
           updated_at = NOW()
         RETURNING *`,
        [userId, classId, subjectId, schoolId, assignerUserId]
      );
      res.json(ins.rows[0]);
    } catch (e: any) {
      const status = e.status ?? 500;
      res.status(status).json({ message: e.message || "Error" });
    }
  });

  app.delete("/api/staff-assignments/subject-class/:id", async (req, res) => {
    try {
      const { assignerUserId, schoolId } = req.query;
      if (!assignerUserId || !schoolId) {
        return res.status(400).json({ message: "assignerUserId and schoolId required" });
      }
      await assertCanManageAssignments(String(assignerUserId), String(schoolId));
      const del = await pool.query(
        `DELETE FROM staff_subject_class_assignments WHERE id=$1 AND school_id=$2 RETURNING id`,
        [req.params.id, schoolId]
      );
      if (!del.rowCount) return res.status(404).json({ message: "Not found" });
      res.json({ success: true });
    } catch (e: any) {
      const status = e.status ?? 500;
      res.status(status).json({ message: e.message || "Error" });
    }
  });
}
