import { createServer } from "http";
import type { Express } from "express";
import type { Server } from "http";
import { DEFAULT_USER_PASSWORD } from "../lib/constants";
import { registerAuthRoutes } from "./auth";
import { registerSchoolRoutes } from "./schools";
import { registerUserRoutes } from "./users";
import { registerStudentRoutes } from "./students";
import { registerClassRoutes } from "./classes";
import { registerSubjectRoutes } from "./subjects";
import { registerAttendanceRoutes } from "./attendance";
import { registerExamRoutes } from "./exams";
import { registerMarksRoutes } from "./marks";
import { registerFeeRoutes } from "./fees";
import { registerAcademicRoutes } from "./academic";
import { registerAdminRoutes } from "./admin";
import { registerSignupRoutes } from "./signup";
import { registerUploadRoutes } from "./upload";
import { registerPromotionRoutes } from "./promotions";
import { registerGroupRoutes } from "./groups";
import { registerTimetableRoutes } from "./timetable";
import { registerStaffAssignmentRoutes } from "./staffAssignments";
import pool from "../db";
import bcrypt from "bcryptjs";

// ── DB bootstrap: ensure all required tables and seed data exist ─────────────
async function bootstrap() {
  try {
    // Core auth columns
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS department VARCHAR(100)`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(50)`);
    await pool.query(`ALTER TABLE classes ADD COLUMN IF NOT EXISTS section VARCHAR(50)`);
    await pool.query(`ALTER TABLE schools ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active'`);
    await pool.query(`ALTER TABLE schools ADD COLUMN IF NOT EXISTS subdomain VARCHAR(100)`);
    await pool.query(`ALTER TABLE schools ADD COLUMN IF NOT EXISTS motto VARCHAR(255)`);
    await pool.query(`ALTER TABLE schools ADD COLUMN IF NOT EXISTS school_type VARCHAR(30)`);
    await pool.query(`ALTER TABLE schools ADD COLUMN IF NOT EXISTS section_type VARCHAR(30)`);
    await pool.query(`ALTER TABLE schools ADD COLUMN IF NOT EXISTS bank_account_title VARCHAR(255)`);
    await pool.query(`ALTER TABLE schools ADD COLUMN IF NOT EXISTS bank_account_type VARCHAR(50)`);
    await pool.query(`ALTER TABLE schools ADD COLUMN IF NOT EXISTS bank_account_number VARCHAR(100)`);
    await pool.query(`ALTER TABLE schools ADD COLUMN IF NOT EXISTS bank_name VARCHAR(255)`);
    await pool.query(`ALTER TABLE schools ADD COLUMN IF NOT EXISTS logo_url TEXT`);

    // Fix role constraint to include super_admin
    try {
      await pool.query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check`);
      await pool.query(`
        ALTER TABLE users ADD CONSTRAINT users_role_check
        CHECK (role IN ('super_admin','admin','director','head_teacher','class_teacher','subject_teacher','bursar'))
      `);
    } catch (_) {}

    // ── Seed demo school (MUST come before any user inserts due to FK) ──────────
    await pool.query(`
      INSERT INTO schools (id, name, abbreviation, email, phone, address, subscription_plan, is_active, status)
      SELECT 'a0000000-0000-0000-0000-000000000001',
             'ZaabuPay Demo School','EDS','admin@zaabupay.com',
             '+256 700 123456','Plot 45, Kampala Road, Kampala, Uganda',
             'professional',true,'active'
      WHERE NOT EXISTS (SELECT 1 FROM schools WHERE id='a0000000-0000-0000-0000-000000000001')
    `);

    // ── Seed real superadmin (no school attached) ────────────────────────────
    // Password is always reset to the platform default on boot so the SKYVALE
    // admin can always sign in. Change it from the profile page after login.
    const superHash = await bcrypt.hash(DEFAULT_USER_PASSWORD, 10);
    await pool.query(`DELETE FROM users WHERE username='super_admin' AND id!='f0000000-0000-0000-0000-000000000001'`);
    await pool.query(`
      INSERT INTO users (id, username, email, role, school_id, first_name, last_name, is_active, password_hash)
      VALUES ('f0000000-0000-0000-0000-000000000001','skyvale_admin','admin@skyvale.com','super_admin',NULL,'SKYVALE','Admin',true,$1)
      ON CONFLICT (id) DO UPDATE SET
        username='skyvale_admin',
        email='admin@skyvale.com',
        school_id=NULL,
        password_hash=EXCLUDED.password_hash,
        is_active=true
    `, [superHash]);

    // ── Backfill: any active user missing a password_hash gets the default ──
    // This unlocks accounts that were created before passwords were required.
    const defaultHash = await bcrypt.hash(DEFAULT_USER_PASSWORD, 10);
    await pool.query(
      `UPDATE users
         SET password_hash = $1, updated_at = NOW()
       WHERE (password_hash IS NULL OR password_hash = '')
         AND is_active = true`,
      [defaultHash]
    );

    // ── Seed demo school users ───────────────────────────────────────────────
    const demoHash = await bcrypt.hash("demo123", 10);
    const demoUsers = [
      { id: 'c0000000-0000-0000-0000-000000000002', username: 'dr-eds',  email: 'director@demo.com',       role: 'director',        first: 'Sarah',     last: 'Director',  hash: demoHash },
      { id: 'c0000000-0000-0000-0000-000000000003', username: 'ht-eds',  email: 'headteacher@demo.com',    role: 'head_teacher',    first: 'Samuel',    last: 'Kato',      hash: demoHash },
      { id: 'c0000000-0000-0000-0000-000000000004', username: 'ct-eds',  email: 'classteacher@demo.com',   role: 'class_teacher',   first: 'Grace',     last: 'Nakato',    hash: demoHash },
      { id: 'c0000000-0000-0000-0000-000000000005', username: 'st-eds',  email: 'subjectteacher@demo.com', role: 'subject_teacher', first: 'David',     last: 'Mugisha',   hash: demoHash },
      { id: 'c0000000-0000-0000-0000-000000000006', username: 'bsr-eds', email: 'bursar@demo.com',         role: 'bursar',          first: 'Christine', last: 'Nabukeera', hash: demoHash },
    ];

    for (const u of demoUsers) {
      await pool.query(`DELETE FROM users WHERE LOWER(email)=$1 AND id!=$2`, [u.email.toLowerCase(), u.id]);
      await pool.query(`DELETE FROM users WHERE username=$1 AND id!=$2`, [u.username, u.id]);
      await pool.query(`
        INSERT INTO users (id, username, email, role, school_id, first_name, last_name, is_active, password_hash)
        VALUES ($1,$2,$3,$4,'a0000000-0000-0000-0000-000000000001',$5,$6,true,$7)
        ON CONFLICT (id) DO UPDATE SET
          username=EXCLUDED.username, email=EXCLUDED.email,
          password_hash=EXCLUDED.password_hash, role=EXCLUDED.role, is_active=true
      `, [u.id, u.username, u.email, u.role, u.first, u.last, u.hash]);
    }


    // SaaS tables
    await pool.query(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        school_id UUID,
        plan VARCHAR(20) NOT NULL DEFAULT 'trial',
        start_date DATE NOT NULL DEFAULT CURRENT_DATE,
        end_date DATE NOT NULL DEFAULT (CURRENT_DATE + INTERVAL '30 days'),
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        amount_ugx INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT now()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR(255),
        user_email VARCHAR(255),
        school_id VARCHAR(255),
        school_name VARCHAR(255),
        action VARCHAR(100) NOT NULL,
        details TEXT,
        ip_address VARCHAR(50),
        created_at TIMESTAMPTZ DEFAULT now()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS global_settings (
        key VARCHAR(100) PRIMARY KEY,
        value TEXT
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS sections (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        school_id UUID REFERENCES schools(id) ON DELETE CASCADE,
        name VARCHAR(50) NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS streams (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        class_id UUID REFERENCES classes(id) ON DELETE CASCADE,
        name VARCHAR(50) NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS academic_years (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        school_id UUID REFERENCES schools(id) ON DELETE CASCADE,
        name VARCHAR(50) NOT NULL,
        start_date DATE,
        end_date DATE,
        is_active BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS terms (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        academic_year_id UUID REFERENCES academic_years(id) ON DELETE CASCADE,
        school_id UUID,
        name VARCHAR(30) NOT NULL,
        start_date DATE,
        end_date DATE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS grading_systems (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        school_id UUID REFERENCES schools(id) ON DELETE CASCADE,
        section_name VARCHAR(50),
        name VARCHAR(100),
        grade_ranges JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(school_id, section_name)
      )
    `);

    // Payments & financial tables
    await pool.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS is_reversed BOOLEAN DEFAULT false`);
    await pool.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS reversal_reason TEXT`);
    await pool.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS receipt_number VARCHAR(50)`);
    await pool.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS notes TEXT`);
    await pool.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS provider VARCHAR(50)`);
    await pool.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS phone_number VARCHAR(20)`);
    await pool.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS prn_number VARCHAR(50)`);
    await pool.query(`ALTER TABLE fee_structures ADD COLUMN IF NOT EXISTS category VARCHAR(50) DEFAULT 'tuition'`);
    await pool.query(`ALTER TABLE fee_structures ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`);
    await pool.query(`ALTER TABLE fee_structures ALTER COLUMN due_date DROP NOT NULL`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS fee_adjustments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
        student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        fee_structure_id UUID REFERENCES fee_structures(id),
        adjustment_type VARCHAR(30) NOT NULL DEFAULT 'discount',
        amount NUMERIC(12,2) NOT NULL,
        reason TEXT,
        academic_year VARCHAR(20),
        term VARCHAR(20),
        applied_by UUID REFERENCES users(id),
        applied_by_name VARCHAR(200),
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS bank_statements (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        school_id UUID REFERENCES schools(id) ON DELETE CASCADE,
        bank_name VARCHAR(100),
        account_number VARCHAR(50),
        statement_date DATE,
        opening_balance NUMERIC(15,2) DEFAULT 0,
        closing_balance NUMERIC(15,2),
        total_credits NUMERIC(15,2) DEFAULT 0,
        total_debits NUMERIC(15,2) DEFAULT 0,
        notes TEXT,
        uploaded_by UUID REFERENCES users(id),
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS reconciliation_entries (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        school_id UUID,
        payment_id UUID REFERENCES payments(id),
        statement_id UUID REFERENCES bank_statements(id),
        amount NUMERIC(15,2),
        description TEXT,
        status VARCHAR(20) DEFAULT 'reconciled',
        reconciled_by UUID REFERENCES users(id),
        reconciled_at TIMESTAMPTZ DEFAULT NOW(),
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Subjects — required by marks, staff_subject_class_assignments, timetable (FKs).
    // Some deployments only had subjects from manual SQL; ensure table + columns exist.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS subjects (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        code VARCHAR(50) NOT NULL,
        description TEXT,
        school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
        teacher_id UUID REFERENCES users(id) ON DELETE SET NULL,
        category VARCHAR(50) DEFAULT 'Core',
        is_compulsory BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query(`ALTER TABLE subjects ADD COLUMN IF NOT EXISTS description TEXT`);
    await pool.query(`ALTER TABLE subjects ADD COLUMN IF NOT EXISTS teacher_id UUID`);
    await pool.query(`ALTER TABLE subjects ADD COLUMN IF NOT EXISTS category VARCHAR(50) DEFAULT 'Core'`);
    await pool.query(`ALTER TABLE subjects ADD COLUMN IF NOT EXISTS is_compulsory BOOLEAN DEFAULT true`);
    await pool.query(`ALTER TABLE subjects ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`);
    await pool.query(`ALTER TABLE subjects ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`);

    // Marks columns
    await pool.query(`ALTER TABLE marks ADD COLUMN IF NOT EXISTS subject_teacher_remarks TEXT`);
    await pool.query(`ALTER TABLE marks ADD COLUMN IF NOT EXISTS is_locked BOOLEAN DEFAULT false`);
    await pool.query(`ALTER TABLE marks ADD COLUMN IF NOT EXISTS approved_by UUID`);
    await pool.query(`ALTER TABLE marks ADD COLUMN IF NOT EXISTS edit_reason TEXT`);
    await pool.query(`ALTER TABLE marks ADD COLUMN IF NOT EXISTS edited_by UUID`);
    await pool.query(`ALTER TABLE marks ADD COLUMN IF NOT EXISTS edited_by_name VARCHAR(200)`);

    // Marks entry permissions (subject teacher allows class teacher to help)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS marks_entry_permissions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        school_id UUID REFERENCES schools(id) ON DELETE CASCADE,
        class_id UUID REFERENCES classes(id) ON DELETE CASCADE,
        subject_id UUID REFERENCES subjects(id) ON DELETE CASCADE,
        exam_id UUID REFERENCES exams(id) ON DELETE CASCADE,
        granted_by UUID REFERENCES users(id),
        granted_by_name VARCHAR(200),
        granted_to_role VARCHAR(50) DEFAULT 'class_teacher',
        is_active BOOLEAN DEFAULT TRUE,
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(class_id, subject_id, exam_id, granted_to_role)
      )
    `);
    await pool.query(`ALTER TABLE fee_structures ADD COLUMN IF NOT EXISTS components JSONB`);

    // Report card remarks
    await pool.query(`
      CREATE TABLE IF NOT EXISTS report_card_remarks (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        student_id UUID REFERENCES students(id) ON DELETE CASCADE,
        school_id UUID REFERENCES schools(id) ON DELETE CASCADE,
        class_id UUID,
        term VARCHAR(30),
        academic_year VARCHAR(10),
        class_teacher_remarks TEXT,
        headteacher_remarks TEXT,
        next_term_begins DATE,
        is_published BOOLEAN DEFAULT false,
        published_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(student_id, term, academic_year)
      )
    `);

    // Events and communications
    await pool.query(`
      CREATE TABLE IF NOT EXISTS school_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        school_id UUID REFERENCES schools(id) ON DELETE CASCADE,
        title VARCHAR(200) NOT NULL,
        type VARCHAR(50) DEFAULT 'event',
        date DATE NOT NULL,
        end_date DATE,
        description TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS parent_communications (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        school_id UUID REFERENCES schools(id) ON DELETE CASCADE,
        class_id UUID,
        student_id UUID,
        sent_by UUID REFERENCES users(id),
        message TEXT NOT NULL,
        subject VARCHAR(200),
        type VARCHAR(50) DEFAULT 'individual',
        sent_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // School signup requests
    await pool.query(`
      CREATE TABLE IF NOT EXISTS school_signup_requests (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        school_name VARCHAR(200) NOT NULL,
        contact_name VARCHAR(100) NOT NULL,
        email VARCHAR(255) NOT NULL,
        phone VARCHAR(20),
        district VARCHAR(100),
        school_type VARCHAR(50),
        number_of_students INTEGER,
        message TEXT,
        request_type VARCHAR(20) DEFAULT 'demo',
        status VARCHAR(20) DEFAULT 'pending',
        admin_notes TEXT,
        reviewed_by VARCHAR(255),
        reviewed_at TIMESTAMPTZ,
        trial_start_date DATE,
        trial_end_date DATE,
        approved_school_id UUID,
        created_school_admin_email VARCHAR(255),
        created_school_admin_password VARCHAR(100),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // ── Promotion & Grouping tables ──────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS promotion_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        school_id UUID REFERENCES schools(id) ON DELETE CASCADE,
        from_class_id UUID,
        to_class_id UUID,
        from_class_name VARCHAR(100),
        to_class_name VARCHAR(100),
        student_ids JSONB NOT NULL DEFAULT '[]',
        student_count INTEGER DEFAULT 0,
        promoted_by UUID REFERENCES users(id),
        promoted_by_name VARCHAR(200),
        academic_year VARCHAR(20),
        notes TEXT,
        promoted_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS student_groups (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        school_id UUID REFERENCES schools(id) ON DELETE CASCADE,
        name VARCHAR(200) NOT NULL,
        description TEXT,
        color VARCHAR(20) DEFAULT 'blue',
        created_by UUID REFERENCES users(id),
        created_by_name VARCHAR(200),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS student_group_members (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        group_id UUID REFERENCES student_groups(id) ON DELETE CASCADE,
        student_id UUID REFERENCES students(id) ON DELETE CASCADE,
        added_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(group_id, student_id)
      )
    `);

    // Timetable
    await pool.query(`
      CREATE TABLE IF NOT EXISTS timetable (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        school_id UUID NOT NULL,
        class_id UUID NOT NULL,
        subject_id UUID,
        teacher_id UUID,
        day_of_week VARCHAR(15) NOT NULL,
        period_number INTEGER NOT NULL,
        start_time VARCHAR(10),
        end_time VARCHAR(10),
        room VARCHAR(50),
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS staff_class_teacher_assignments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
        school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
        assigned_by UUID REFERENCES users(id),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (user_id, class_id)
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_staff_ct_school ON staff_class_teacher_assignments(school_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_staff_ct_user ON staff_class_teacher_assignments(user_id)`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS staff_subject_class_assignments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
        subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
        school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
        assigned_by UUID REFERENCES users(id),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (user_id, class_id, subject_id)
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_staff_sc_school ON staff_subject_class_assignments(school_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_staff_sc_user ON staff_subject_class_assignments(user_id)`);

    // Demo school subscription
    await pool.query(`
      INSERT INTO subscriptions (school_id, plan, start_date, end_date, status, amount_ugx)
      SELECT 'a0000000-0000-0000-0000-000000000001','professional',
             CURRENT_DATE-INTERVAL '15 days', CURRENT_DATE+INTERVAL '365 days','active',80000
      WHERE NOT EXISTS (SELECT 1 FROM subscriptions WHERE school_id='a0000000-0000-0000-0000-000000000001')
    `);

    // Add username column to signup requests if missing
    await pool.query(`ALTER TABLE school_signup_requests ADD COLUMN IF NOT EXISTS created_school_admin_username VARCHAR(100)`);

    // Fix users that have NULL or email-based usernames — assign proper role-based usernames
    const ROLE_PFX: Record<string, string> = {
      director: 'dr', head_teacher: 'ht', class_teacher: 'ct',
      subject_teacher: 'st', bursar: 'bsr', admin: 'adm',
    };
    const usersNeedingUsername = await pool.query(`
      SELECT u.id, u.role, u.email, u.username, s.abbreviation as abbr
      FROM users u
      LEFT JOIN schools s ON u.school_id = s.id
      WHERE u.role != 'super_admin'
        AND (u.username IS NULL OR u.username = '' OR u.username NOT LIKE '%-%')
    `);
    for (const u of usersNeedingUsername.rows) {
      const pfx = ROLE_PFX[u.role] ?? u.role.slice(0, 3);
      const code = (u.abbr ?? u.email?.split('@')[0] ?? 'sch').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 6);
      const base = `${pfx}-${code}`;
      const existingUn = await pool.query(
        `SELECT username FROM users WHERE (username=$1 OR username LIKE $2) AND id!=$3`,
        [base, `${base}-%`, u.id]
      );
      let finalUsername = base;
      if (existingUn.rows.length) {
        const used = new Set(existingUn.rows.map((r: any) => r.username));
        if (used.has(base)) {
          for (let i = 2; i <= 99; i++) {
            if (!used.has(`${base}-${i}`)) { finalUsername = `${base}-${i}`; break; }
          }
        }
      }
      await pool.query(`UPDATE users SET username=$1 WHERE id=$2`, [finalUsername, u.id]);
    }

    console.log(`[bootstrap] DB ready. Super admin seeded with default password. Demo passwords set.`);
  } catch (err: any) {
    console.error("[bootstrap] Error:", err);
    throw err;
  }
}

export async function registerRoutes(app: Express): Promise<Server> {
  await bootstrap();

  // Register all route modules
  registerAuthRoutes(app);
  registerUploadRoutes(app);
  registerSchoolRoutes(app);
  registerUserRoutes(app);
  registerStudentRoutes(app);
  registerClassRoutes(app);
  registerSubjectRoutes(app);
  registerAttendanceRoutes(app);
  registerExamRoutes(app);
  registerMarksRoutes(app);
  registerFeeRoutes(app);
  registerAcademicRoutes(app);
  registerAdminRoutes(app);
  registerSignupRoutes(app);
  registerPromotionRoutes(app);
  registerGroupRoutes(app);
  registerTimetableRoutes(app);
  registerStaffAssignmentRoutes(app);

  return createServer(app);
}
