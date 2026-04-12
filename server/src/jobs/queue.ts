import { v4 as uuidv4 } from 'uuid';
import { query, getConnection } from '../config/database';
import { enrichProspect } from '../services/enrichment';
import { sendSequenceEmail } from '../services/email';

interface JobOptions {
  queue?: string;
  priority?: number;
  maxAttempts?: number;
  runAt?: Date;
}

/**
 * Add a job to the MySQL-based job queue.
 */
export async function addJob(
  type: string,
  payload: any,
  options: JobOptions = {}
): Promise<string> {
  const id = uuidv4();
  const {
    queue = 'default',
    priority = 0,
    maxAttempts = 3,
    runAt = new Date(),
  } = options;

  await query(
    `INSERT INTO jobs (id, queue, job_type, payload, status, priority, max_attempts, run_at)
     VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)`,
    [id, queue, type, JSON.stringify(payload), priority, maxAttempts, runAt]
  );

  return id;
}

/**
 * Poll for pending jobs and process them one by one.
 * Uses SELECT ... FOR UPDATE SKIP LOCKED to support concurrent workers.
 */
export async function processJobs(queueName?: string): Promise<number> {
  const conn = await getConnection();
  let processedCount = 0;

  try {
    // Find the next pending job
    const queueFilter = queueName ? 'AND queue = ?' : '';
    const params: any[] = queueName ? [queueName] : [];

    await conn.beginTransaction();

    const [rows] = await conn.execute(
      `SELECT * FROM jobs
       WHERE status IN ('pending', 'retry')
       AND run_at <= NOW()
       AND attempts < max_attempts
       ${queueFilter}
       ORDER BY priority DESC, run_at ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED`,
      params
    );

    const jobs = rows as any[];

    if (jobs.length === 0) {
      await conn.commit();
      return 0;
    }

    const job = jobs[0];

    // Mark as processing
    await conn.execute(
      `UPDATE jobs SET status = 'processing', started_at = NOW(), attempts = attempts + 1 WHERE id = ?`,
      [job.id]
    );

    await conn.commit();

    // Process the job outside the transaction
    try {
      const payload = typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload;
      const result = await executeJob(job.job_type, payload);

      // Mark as completed
      await query(
        `UPDATE jobs SET status = 'completed', completed_at = NOW(), result = ? WHERE id = ?`,
        [JSON.stringify(result), job.id]
      );

      processedCount++;
    } catch (error: any) {
      console.error(`Job ${job.id} (${job.job_type}) failed:`, error.message);

      const newStatus = job.attempts + 1 >= job.max_attempts ? 'failed' : 'retry';

      // Calculate exponential backoff for retry
      const backoffMinutes = Math.pow(2, job.attempts) * 5; // 5, 10, 20, 40 min...
      const retryAt = new Date(Date.now() + backoffMinutes * 60 * 1000);

      await query(
        `UPDATE jobs SET status = ?, error_message = ?, run_at = ? WHERE id = ?`,
        [newStatus, error.message, retryAt, job.id]
      );
    }
  } catch (error: any) {
    try {
      await conn.rollback();
    } catch {
      // Ignore rollback errors
    }
    console.error('Job processing error:', error.message);
  } finally {
    conn.release();
  }

  return processedCount;
}

/**
 * Execute a specific job based on its type.
 */
async function executeJob(jobType: string, payload: any): Promise<any> {
  switch (jobType) {
    case 'enrich_prospect':
      return enrichProspect(payload.prospect_id);

    case 'send_sequence_email':
      return sendSequenceEmail(payload.enrollment, payload.step);

    case 'import_process':
      return processImportInline(payload);

    case 'recalculate_scores':
      const { recalculateAllScores } = await import('../services/scoring');
      return recalculateAllScores();

    default:
      throw new Error(`Unknown job type: ${jobType}`);
  }
}

/**
 * Process a CSV/Excel import job.
 * Reads the file, applies column mapping, and inserts prospects.
 */
export async function processImportInline(payload: {
  import_id: string;
  file_path: string;
  file_name: string;
  column_mapping: Record<string, string>;
  default_tags: string[];
  user_id: string;
  tenant_id?: string;
}): Promise<{ imported: number; skipped: number; errors: number }> {
  const { import_id, file_path, column_mapping } = payload;
  const tenantId = payload.tenant_id || 'tenant-tecnocim-0003';
  const fs = await import('fs');
  const path = await import('path');

  // Update import status
  await query(
    "UPDATE imports SET status = 'importing' WHERE id = ?",
    [import_id]
  );

  const ext = path.extname(file_path).toLowerCase();
  let rows: Record<string, any>[] = [];

  // Parse the file
  if (ext === '.csv' || ext === '.txt') {
    const PapaMod = await import('papaparse');
    const Papa = PapaMod.default || PapaMod;
    const fileContent = fs.readFileSync(file_path, 'utf-8');
    const parseResult = Papa.parse(fileContent, { header: true, skipEmptyLines: true });
    rows = parseResult.data as Record<string, any>[];
  } else if (ext === '.xlsx' || ext === '.xls') {
    const ExcelMod = await import('exceljs');
    const ExcelJS = (ExcelMod as any).default || ExcelMod;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(file_path);
    const worksheet = workbook.worksheets[0];

    if (worksheet) {
      const headers: string[] = [];
      worksheet.getRow(1).eachCell((cell: any, colNumber: any) => {
        headers.push(String(cell.value || `Column ${colNumber}`));
      });

      for (let i = 2; i <= worksheet.rowCount; i++) {
        const row = worksheet.getRow(i);
        const rowData: Record<string, any> = {};
        headers.forEach((header, index) => {
          rowData[header] = row.getCell(index + 1).value;
        });
        rows.push(rowData);
      }
    }
  }

  let imported = 0;
  let skipped = 0;
  let errors = 0;

  for (let i = 0; i < rows.length; i++) {
    const rawRow = rows[i];
    const importRowId = uuidv4();

    try {
      // Apply column mapping
      const mappedData: Record<string, any> = {};
      for (const [sourceCol, targetField] of Object.entries(column_mapping)) {
        if (rawRow[sourceCol] !== undefined && rawRow[sourceCol] !== null && rawRow[sourceCol] !== '') {
          mappedData[targetField] = String(rawRow[sourceCol]).trim();
        }
      }

      // Validate: email is required
      if (!mappedData.email) {
        await query(
          `INSERT INTO import_rows (id, import_id, \`row_number\`, raw_data, mapped_data, status, error_message)
           VALUES (?, ?, ?, ?, ?, 'invalid', 'Missing email address')`,
          [importRowId, import_id, i + 1, JSON.stringify(rawRow), JSON.stringify(mappedData)]
        );
        skipped++;
        continue;
      }

      // Check for existing prospect (deduplication by email within tenant)
      const existing = await query<any[]>(
        'SELECT id FROM prospects WHERE email = ? AND tenant_id = ?',
        [mappedData.email, tenantId]
      );

      if (existing.length > 0) {
        await query(
          `INSERT INTO import_rows (id, import_id, \`row_number\`, raw_data, mapped_data, status, prospect_id, error_message)
           VALUES (?, ?, ?, ?, ?, 'duplicate', ?, 'Prospect already exists')`,
          [importRowId, import_id, i + 1, JSON.stringify(rawRow), JSON.stringify(mappedData), existing[0].id]
        );
        skipped++;
        continue;
      }

      // Handle company: if company_name is provided, find or create
      let companyId: string | null = null;
      if (mappedData.company_name || mappedData.domain) {
        const companyResult = await findOrCreateCompany(mappedData, tenantId);
        companyId = companyResult;
      }

      // Create prospect
      const prospectId = uuidv4();
      await query(
        `INSERT INTO prospects (id, tenant_id, email, first_name, last_name, title, seniority, department,
         phone, linkedin_url, city, region, country, company_id, source, source_detail)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'csv_import', ?)`,
        [
          prospectId,
          tenantId,
          mappedData.email,
          mappedData.first_name || null,
          mappedData.last_name || null,
          mappedData.title || null,
          mappedData.seniority || null,
          mappedData.department || null,
          mappedData.phone || null,
          mappedData.linkedin_url || null,
          mappedData.city || null,
          mappedData.region || null,
          mappedData.country || null,
          companyId,
          payload.file_name,
        ]
      );

      // Record successful import row
      await query(
        `INSERT INTO import_rows (id, import_id, \`row_number\`, raw_data, mapped_data, status, prospect_id)
         VALUES (?, ?, ?, ?, ?, 'imported', ?)`,
        [importRowId, import_id, i + 1, JSON.stringify(rawRow), JSON.stringify(mappedData), prospectId]
      );

      imported++;
    } catch (err: any) {
      await query(
        `INSERT INTO import_rows (id, import_id, \`row_number\`, raw_data, status, error_message)
         VALUES (?, ?, ?, ?, 'error', ?)`,
        [importRowId, import_id, i + 1, JSON.stringify(rawRow), err.message]
      );
      errors++;
    }

    // Update progress every 10 rows
    if ((i + 1) % 10 === 0 || i === rows.length - 1) {
      await query(
        `UPDATE imports SET processed_rows = ?, imported_rows = ?, skipped_rows = ?, error_rows = ?
         WHERE id = ?`,
        [i + 1, imported, skipped, errors, import_id]
      );
    }
  }

  // Mark import as completed
  await query(
    `UPDATE imports SET status = 'completed', processed_rows = ?, imported_rows = ?,
     skipped_rows = ?, error_rows = ?, completed_at = NOW()
     WHERE id = ?`,
    [rows.length, imported, skipped, errors, import_id]
  );

  return { imported, skipped, errors };
}

/**
 * Find an existing company by domain/name or create a new one.
 */
async function findOrCreateCompany(data: Record<string, any>, tenantId?: string): Promise<string> {
  // Try to find by domain first
  if (data.domain) {
    const existing = tenantId
      ? await query<any[]>(
          'SELECT id FROM companies WHERE domain = ? AND tenant_id = ?',
          [data.domain, tenantId]
        )
      : await query<any[]>(
          'SELECT id FROM companies WHERE domain = ?',
          [data.domain]
        );
    if (existing.length > 0) return existing[0].id;
  }

  // Try to find by name
  if (data.company_name) {
    const existing = tenantId
      ? await query<any[]>(
          'SELECT id FROM companies WHERE name = ? AND tenant_id = ?',
          [data.company_name, tenantId]
        )
      : await query<any[]>(
          'SELECT id FROM companies WHERE name = ?',
          [data.company_name]
        );
    if (existing.length > 0) return existing[0].id;
  }

  // Create new company
  const companyId = uuidv4();
  await query(
    `INSERT INTO companies (id, tenant_id, name, domain, industry, website_url, city, region, country)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      companyId,
      tenantId || null,
      data.company_name || data.domain || 'Unknown',
      data.domain || null,
      data.industry || null,
      data.website_url || (data.domain ? `https://${data.domain}` : null),
      data.city || null,
      data.region || null,
      data.country || null,
    ]
  );

  return companyId;
}

/**
 * Get the status of a specific job.
 */
export async function getJobStatus(jobId: string): Promise<any> {
  const jobs = await query<any[]>(
    'SELECT * FROM jobs WHERE id = ?',
    [jobId]
  );

  if (jobs.length === 0) {
    return null;
  }

  return jobs[0];
}
