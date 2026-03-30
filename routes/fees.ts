import type { Express } from "express";
import pool from "../db";

export function registerFeeRoutes(app: Express) {
  // ── Fee Structures ────────────────────────────────────────────────────────
  app.get("/api/fees", async (req, res) => {
    try {
      const { schoolId } = req.query;
      if (!schoolId) return res.status(400).json({ message: "schoolId required" });
      const result = await pool.query(
        `SELECT f.*, c.name as class_name FROM fee_structures f
         LEFT JOIN classes c ON f.class_id=c.id WHERE f.school_id=$1 ORDER BY f.due_date`,
        [schoolId]);
      res.json(result.rows);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/fees", async (req, res) => {
    try {
      const { name, feeType, description, amount, dueDate, classId, schoolId, academicYear, term, isOptional, category } = req.body;
      const feeName = name || feeType || 'School Fee';
      const safeClassId = (!classId || classId === 'general' || classId === '') ? null : classId;
      const result = await pool.query(
        `INSERT INTO fee_structures (name, description, amount, due_date, class_id, school_id, academic_year, term, is_optional, category)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [feeName, description||null, amount, dueDate||null, safeClassId, schoolId, academicYear, term||'Term 1', isOptional||false, category||'tuition']);
      res.status(201).json(result.rows[0]);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.put("/api/fees/:id", async (req, res) => {
    try {
      const { name, feeType, description, amount, dueDate, classId, academicYear, term, isOptional, components, category } = req.body;
      const feeName = name || feeType || 'School Fee';
      const safeClassId = (!classId || classId === 'general' || classId === '') ? null : classId;
      const result = await pool.query(
        `UPDATE fee_structures SET name=$1, description=$2, amount=$3, due_date=$4, class_id=$5,
         academic_year=$6, term=$7, is_optional=$8, components=$9, category=$10, updated_at=NOW()
         WHERE id=$11 RETURNING *`,
        [feeName, description||null, amount, dueDate||null, safeClassId, academicYear, term||'Term 1', isOptional||false,
         components ? JSON.stringify(components) : null, category||'tuition', req.params.id]);
      if (!result.rows.length) return res.status(404).json({ message: "Fee not found" });
      res.json(result.rows[0]);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.delete("/api/fees/:id", async (req, res) => {
    try {
      await pool.query(`DELETE FROM fee_structures WHERE id=$1`, [req.params.id]);
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // ── Payments ──────────────────────────────────────────────────────────────
  app.get("/api/payments/summary", async (req, res) => {
    try {
      const { schoolId } = req.query;
      if (!schoolId) return res.status(400).json({ message: "schoolId required" });
      const today = new Date().toISOString().split('T')[0];
      const result = await pool.query(`
        SELECT
          COALESCE(SUM(CASE WHEN is_reversed=false AND status='completed' THEN amount ELSE 0 END),0) AS total_collected,
          COALESCE(SUM(CASE WHEN is_reversed=false AND status='completed' AND DATE(paid_at)=$2 THEN amount ELSE 0 END),0) AS today_collected,
          COUNT(CASE WHEN is_reversed=false AND status='completed' THEN 1 END) AS total_payments,
          COUNT(CASE WHEN is_reversed=false AND status='completed' AND DATE(paid_at)=$2 THEN 1 END) AS today_count
        FROM payments WHERE school_id=$1`, [schoolId, today]);
      const feeTotals = await pool.query(`SELECT COALESCE(SUM(amount),0) AS total_fees_billed FROM fee_structures WHERE school_id=$1`, [schoolId]);
      const studCount = await pool.query(`SELECT COUNT(*) as cnt FROM students WHERE school_id=$1`, [schoolId]);
      const totalBilled = parseFloat(feeTotals.rows[0].total_fees_billed) * parseInt(studCount.rows[0].cnt);
      const totalCollected = parseFloat(result.rows[0].total_collected);
      res.json({
        totalCollected, todayCollected: parseFloat(result.rows[0].today_collected),
        totalPayments: parseInt(result.rows[0].total_payments), todayCount: parseInt(result.rows[0].today_count),
        outstanding: Math.max(0, totalBilled - totalCollected),
        collectionRate: totalBilled > 0 ? Math.min(100, Math.round((totalCollected/totalBilled)*100)) : 0
      });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/payments/receipt-number", async (req, res) => {
    try {
      const { schoolId } = req.body;
      if (!schoolId) return res.status(400).json({ message: "schoolId required" });
      const count = await pool.query(`SELECT COUNT(*) as cnt FROM payments WHERE school_id=$1`, [schoolId]);
      const num = parseInt(count.rows[0].cnt) + 1;
      res.json({ receiptNumber: `RCP-${new Date().getFullYear()}-${String(num).padStart(5,'0')}` });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.get("/api/payments/report", async (req, res) => {
    try {
      const { schoolId, from, to } = req.query;
      if (!schoolId) return res.status(400).json({ message: "schoolId required" });
      let query = `SELECT p.*, s.first_name, s.last_name,
                          s.first_name || ' ' || s.last_name as student_name,
                          s.admission_number, s.payment_code as student_code,
                          c.name as class_name, f.name as fee_name, f.category as fee_category,
                          u.first_name || ' ' || u.last_name as recorded_by_name
                   FROM payments p JOIN students s ON p.student_id=s.id
                   LEFT JOIN classes c ON s.class_id=c.id
                   JOIN fee_structures f ON p.fee_structure_id=f.id JOIN users u ON p.recorded_by=u.id
                   WHERE p.school_id=$1 AND p.is_reversed=false AND p.status='completed'`;
      const params: any[] = [schoolId]; let idx = 2;
      if (from) { query += ` AND DATE(p.paid_at)>=$${idx++}`; params.push(from); }
      if (to) { query += ` AND DATE(p.paid_at)<=$${idx++}`; params.push(to); }
      query += ` ORDER BY p.paid_at DESC`;
      const result = await pool.query(query, params);
      res.json(result.rows);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.get("/api/payments", async (req, res) => {
    try {
      const { schoolId, studentId, paymentCode } = req.query;
      if (!schoolId) return res.status(400).json({ message: "schoolId required" });
      let query = `SELECT p.*, s.first_name, s.last_name, s.payment_code as student_code,
                          f.name as fee_name, f.category as fee_category,
                          u.first_name || ' ' || u.last_name as recorded_by_name
                   FROM payments p JOIN students s ON p.student_id=s.id
                   JOIN fee_structures f ON p.fee_structure_id=f.id JOIN users u ON p.recorded_by=u.id
                   WHERE p.school_id=$1`;
      const params: any[] = [schoolId]; let idx = 2;
      if (studentId) { query += ` AND p.student_id=$${idx++}`; params.push(studentId); }
      if (paymentCode) { query += ` AND p.payment_code=$${idx++}`; params.push(paymentCode); }
      query += ` ORDER BY p.created_at DESC`;
      const result = await pool.query(query, params);
      res.json(result.rows);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/payments", async (req, res) => {
    try {
      const { studentId, feeStructureId, schoolId, paymentCode, amount, paymentMethod, provider, phoneNumber, transactionRef, recordedBy } = req.body;
      const result = await pool.query(
        `INSERT INTO payments (student_id, fee_structure_id, school_id, payment_code, amount, payment_method, provider, phone_number, transaction_ref, status, paid_at, recorded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'completed',NOW(),$10) RETURNING *`,
        [studentId, feeStructureId, schoolId, paymentCode, amount, paymentMethod, provider, phoneNumber, transactionRef, recordedBy]);
      res.status(201).json(result.rows[0]);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/payments/record", async (req, res) => {
    try {
      const { studentId, feeStructureId, schoolId, paymentCode, amount, paymentMethod,
              transactionRef, notes, recordedBy, receiptNumber, provider, phoneNumber, prnNumber } = req.body;
      const result = await pool.query(
        `INSERT INTO payments (student_id, fee_structure_id, school_id, payment_code, amount, payment_method,
          transaction_ref, status, paid_at, recorded_by, receipt_number, notes, provider, phone_number, prn_number)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'completed',NOW(),$8,$9,$10,$11,$12,$13) RETURNING *`,
        [studentId, feeStructureId, schoolId, paymentCode, amount, paymentMethod,
         transactionRef||null, recordedBy, receiptNumber, notes||null, provider||null, phoneNumber||null, prnNumber||null]);
      res.status(201).json(result.rows[0]);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // PRN (Payment Reference Number) generation for mobile money
  app.post("/api/payments/prn", async (req, res) => {
    try {
      const { schoolId, studentId, amount, feeStructureId } = req.body;
      if (!schoolId || !studentId || !amount) return res.status(400).json({ message: "schoolId, studentId, amount required" });
      const code = await pool.query(`SELECT payment_code FROM students WHERE id=$1`, [studentId]);
      const payCode = code.rows[0]?.payment_code || 'STU';
      const prn = `PRN-${payCode}-${Date.now().toString(36).toUpperCase()}`;
      res.json({ prn, instructions: `Pay UGX ${Number(amount).toLocaleString()} via MTN/Airtel Mobile Money using PRN: ${prn}. Dial *165# (MTN) or *185# (Airtel), choose Pay Bills, enter this PRN.` });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // Fee adjustments (discounts, waivers, advances)
  app.get("/api/fee-adjustments", async (req, res) => {
    try {
      const { schoolId, studentId } = req.query;
      if (!schoolId) return res.status(400).json({ message: "schoolId required" });
      let q = `SELECT fa.*, s.first_name||' '||s.last_name as student_name, s.payment_code,
                      f.name as fee_name, f.category
               FROM fee_adjustments fa
               JOIN students s ON fa.student_id=s.id
               LEFT JOIN fee_structures f ON fa.fee_structure_id=f.id
               WHERE fa.school_id=$1`;
      const params: any[] = [schoolId]; let idx = 2;
      if (studentId) { q += ` AND fa.student_id=$${idx++}`; params.push(studentId); }
      q += ' ORDER BY fa.created_at DESC';
      const r = await pool.query(q, params);
      res.json(r.rows);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/fee-adjustments", async (req, res) => {
    try {
      const { schoolId, studentId, feeStructureId, adjustmentType, amount, reason, academicYear, term, appliedBy, appliedByName } = req.body;
      if (!schoolId || !studentId || !amount || !adjustmentType) return res.status(400).json({ message: "Missing required fields" });
      const r = await pool.query(
        `INSERT INTO fee_adjustments (school_id, student_id, fee_structure_id, adjustment_type, amount, reason, academic_year, term, applied_by, applied_by_name)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [schoolId, studentId, feeStructureId||null, adjustmentType, amount, reason||null, academicYear||null, term||null, appliedBy||null, appliedByName||null]);
      res.status(201).json(r.rows[0]);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.delete("/api/fee-adjustments/:id", async (req, res) => {
    try {
      await pool.query(`DELETE FROM fee_adjustments WHERE id=$1`, [req.params.id]);
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.put("/api/payments/:id/reverse", async (req, res) => {
    try {
      const { reversalReason } = req.body;
      if (!reversalReason) return res.status(400).json({ message: "Reversal reason required" });
      const result = await pool.query(
        `UPDATE payments SET is_reversed=true, reversal_reason=$1, status='cancelled', updated_at=NOW()
         WHERE id=$2 RETURNING *`, [reversalReason, req.params.id]);
      if (!result.rows.length) return res.status(404).json({ message: "Payment not found" });
      res.json(result.rows[0]);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // Alias: /api/fee-structures → same as /api/fees
  app.get("/api/fee-structures", async (req, res) => {
    try {
      const { schoolId } = req.query;
      if (!schoolId) return res.status(400).json({ message: "schoolId required" });
      const result = await pool.query(
        `SELECT f.*, c.name as class_name FROM fee_structures f
         LEFT JOIN classes c ON f.class_id=c.id WHERE f.school_id=$1 ORDER BY f.category, f.due_date`,
        [schoolId]);
      res.json(result.rows);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  // ── Financial (bank statements + reconciliation) ──────────────────────────
  app.get("/api/bank-statements", async (req, res) => {
    try {
      const { schoolId } = req.query;
      if (!schoolId) return res.status(400).json({ message: "schoolId required" });
      const result = await pool.query(
        `SELECT b.*, u.first_name || ' ' || u.last_name as uploaded_by_name
         FROM bank_statements b LEFT JOIN users u ON b.uploaded_by=u.id
         WHERE b.school_id=$1 ORDER BY b.statement_date DESC`, [schoolId]);
      res.json(result.rows);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/bank-statements", async (req, res) => {
    try {
      const { schoolId, bankName, accountNumber, statementDate, openingBalance, closingBalance, totalCredits, totalDebits, notes, uploadedBy } = req.body;
      const result = await pool.query(
        `INSERT INTO bank_statements (school_id, bank_name, account_number, statement_date, opening_balance, closing_balance, total_credits, total_debits, notes, uploaded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [schoolId, bankName, accountNumber, statementDate, openingBalance||0, closingBalance, totalCredits||0, totalDebits||0, notes, uploadedBy]);
      res.status(201).json(result.rows[0]);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.delete("/api/bank-statements/:id", async (req, res) => {
    try {
      await pool.query(`DELETE FROM bank_statements WHERE id=$1`, [req.params.id]);
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.get("/api/reconciliation", async (req, res) => {
    try {
      const { schoolId } = req.query;
      if (!schoolId) return res.status(400).json({ message: "schoolId required" });
      const unrecon = await pool.query(`
        SELECT p.*, s.first_name || ' ' || s.last_name as student_name, f.name as fee_name
        FROM payments p JOIN students s ON p.student_id=s.id JOIN fee_structures f ON p.fee_structure_id=f.id
        LEFT JOIN reconciliation_entries r ON r.payment_id=p.id
        WHERE p.school_id=$1 AND p.status='completed' AND p.is_reversed=false AND r.id IS NULL
        ORDER BY p.paid_at DESC`, [schoolId]);
      const recon = await pool.query(`
        SELECT r.*, p.amount as payment_amount, p.receipt_number, s.first_name || ' ' || s.last_name as student_name,
               b.bank_name, b.statement_date, u.first_name || ' ' || u.last_name as reconciled_by_name
        FROM reconciliation_entries r LEFT JOIN payments p ON r.payment_id=p.id
        LEFT JOIN students s ON p.student_id=s.id LEFT JOIN bank_statements b ON r.statement_id=b.id
        LEFT JOIN users u ON r.reconciled_by=u.id
        WHERE r.school_id=$1 ORDER BY r.created_at DESC LIMIT 50`, [schoolId]);
      res.json({ unreconciled: unrecon.rows, reconciled: recon.rows });
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });

  app.post("/api/reconciliation", async (req, res) => {
    try {
      const { schoolId, paymentId, statementId, amount, description, reconciledBy } = req.body;
      const result = await pool.query(
        `INSERT INTO reconciliation_entries (school_id, payment_id, statement_id, amount, description, status, reconciled_by, reconciled_at)
         VALUES ($1,$2,$3,$4,$5,'reconciled',$6,NOW()) RETURNING *`,
        [schoolId, paymentId, statementId||null, amount, description, reconciledBy]);
      res.status(201).json(result.rows[0]);
    } catch (err: any) { res.status(500).json({ message: err.message }); }
  });
}
