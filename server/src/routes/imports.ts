import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import Papa from 'papaparse';
import ExcelJS from 'exceljs';
import { query } from '../config/database';
import { authenticate } from '../middleware/auth';
import { addJob, processImportInline } from '../jobs/queue';

const router = Router();

// All routes require authentication
router.use(authenticate);

// --- Multer configuration ---
const uploadsDir = path.resolve(__dirname, '..', '..', 'uploads');

// Ensure uploads directory exists
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (_req, file, cb) => {
    const uniqueName = `${Date.now()}-${uuidv4()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  },
});

const fileFilter = (_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowedMimeTypes = [
    'text/csv',
    'text/plain',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ];
  const allowedExtensions = ['.csv', '.xls', '.xlsx'];
  const ext = path.extname(file.originalname).toLowerCase();

  if (allowedMimeTypes.includes(file.mimetype) || allowedExtensions.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Only CSV and Excel files are allowed.'));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB max
  },
});

// --- Helper: Parse CSV columns ---
async function parseCsvColumns(filePath: string): Promise<{ columns: string[]; previewRows: any[]; totalRows: number }> {
  return new Promise((resolve, reject) => {
    const fileContent = fs.readFileSync(filePath, 'utf-8');

    let columns: string[] = [];
    const previewRows: any[] = [];
    let totalRows = 0;

    Papa.parse(fileContent, {
      header: true,
      skipEmptyLines: true,
      preview: 5, // Only parse first 5 rows for preview
      complete: (results) => {
        columns = results.meta.fields || [];
        previewRows.push(...results.data);
        // Count total rows (parse full file for count)
        Papa.parse(fileContent, {
          header: true,
          skipEmptyLines: true,
          complete: (fullResults) => {
            totalRows = fullResults.data.length;
            resolve({ columns, previewRows, totalRows });
          },
          error: (err: Error) => reject(err),
        });
      },
      error: (err: Error) => reject(err),
    });
  });
}

// --- Helper: Parse Excel columns ---
async function parseExcelColumns(filePath: string): Promise<{ columns: string[]; previewRows: any[]; totalRows: number }> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw new Error('No worksheets found in the Excel file.');
  }

  const columns: string[] = [];
  const previewRows: any[] = [];
  let totalRows = 0;

  // Get header row (first row)
  const headerRow = worksheet.getRow(1);
  headerRow.eachCell((cell, colNumber) => {
    columns.push(String(cell.value || `Column ${colNumber}`));
  });

  // Get preview rows (rows 2-6)
  const rowCount = worksheet.rowCount;
  totalRows = Math.max(0, rowCount - 1); // Subtract header row

  for (let i = 2; i <= Math.min(6, rowCount); i++) {
    const row = worksheet.getRow(i);
    const rowData: Record<string, any> = {};
    columns.forEach((colName, index) => {
      const cell = row.getCell(index + 1);
      rowData[colName] = cell.value;
    });
    previewRows.push(rowData);
  }

  return { columns, previewRows, totalRows };
}

// --- POST /upload - Upload CSV/Excel file ---
router.post('/upload', upload.single('file'), async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.file) {
      res.status(400).json({
        success: false,
        error: 'No file uploaded. Please upload a CSV or Excel file.',
      });
      return;
    }

    const ext = path.extname(req.file.originalname).toLowerCase();
    let parseResult: { columns: string[]; previewRows: any[]; totalRows: number };

    try {
      if (ext === '.csv' || ext === '.txt') {
        parseResult = await parseCsvColumns(req.file.path);
      } else if (ext === '.xlsx' || ext === '.xls') {
        parseResult = await parseExcelColumns(req.file.path);
      } else {
        res.status(400).json({
          success: false,
          error: 'Unsupported file format. Please upload a CSV or Excel file.',
        });
        return;
      }
    } catch (parseError: any) {
      res.status(400).json({
        success: false,
        error: `Failed to parse file: ${parseError.message}`,
      });
      return;
    }

    // Create import record in the database
    const importId = uuidv4();

    await query(
      `INSERT INTO imports (id, file_name, file_path, file_size, status, total_rows, created_by)
       VALUES (?, ?, ?, ?, 'mapping', ?, ?)`,
      [
        importId,
        req.file.originalname,
        req.file.path,
        req.file.size,
        parseResult.totalRows,
        req.user!.id,
      ]
    );

    // Return columns and preview so frontend can show mapping UI
    res.status(201).json({
      success: true,
      data: {
        import_id: importId,
        file_name: req.file.originalname,
        file_size: req.file.size,
        total_rows: parseResult.totalRows,
        columns: parseResult.columns,
        preview_rows: parseResult.previewRows,
        // Suggested mappings for known column names
        suggested_mappings: suggestColumnMappings(parseResult.columns),
      },
    });
  } catch (error: any) {
    console.error('Upload error:', error);
    res.status(500).json({
      success: false,
      error: 'An error occurred while processing the uploaded file.',
    });
  }
});

// --- POST /:id/map - Receive column mapping and start import ---
router.post('/:id/map', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { column_mapping, default_tags } = req.body;

    if (!column_mapping || typeof column_mapping !== 'object') {
      res.status(400).json({
        success: false,
        error: 'Column mapping is required.',
      });
      return;
    }

    // Verify import exists and is in mapping status
    const imports = await query<any[]>(
      'SELECT * FROM imports WHERE id = ?',
      [id]
    );

    if (imports.length === 0) {
      res.status(404).json({
        success: false,
        error: 'Import not found.',
      });
      return;
    }

    const importRecord = imports[0];

    if (importRecord.status !== 'mapping') {
      res.status(400).json({
        success: false,
        error: `Import is in '${importRecord.status}' status. Column mapping is only allowed in 'mapping' status.`,
      });
      return;
    }

    // Save column mapping
    await query(
      `UPDATE imports SET column_mapping = ?, default_tags = ?, status = 'pending', started_at = NOW()
       WHERE id = ?`,
      [
        JSON.stringify(column_mapping),
        default_tags ? JSON.stringify(default_tags) : null,
        id,
      ]
    );

    // Process import immediately (inline)
    const result = await processImportInline({
      import_id: id,
      file_path: importRecord.file_path,
      file_name: importRecord.file_name,
      column_mapping,
      default_tags: default_tags || [],
      user_id: req.user!.id,
    });

    res.json({
      success: true,
      data: {
        message: `Importacion completada: ${result.imported} importados, ${result.skipped} omitidos, ${result.errors} errores.`,
        import_id: id,
        status: 'completed',
        ...result,
      },
    });
  } catch (error: any) {
    console.error('Map columns error:', error);
    res.status(500).json({
      success: false,
      error: 'An error occurred while saving the column mapping.',
    });
  }
});

// --- GET /:id - Import status and progress ---
router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const imports = await query<any[]>(
      'SELECT * FROM imports WHERE id = ?',
      [id]
    );

    if (imports.length === 0) {
      res.status(404).json({
        success: false,
        error: 'Import not found.',
      });
      return;
    }

    const importRecord = imports[0];

    // Calculate progress percentage
    const progress = importRecord.total_rows > 0
      ? Math.round((importRecord.processed_rows / importRecord.total_rows) * 100)
      : 0;

    res.json({
      success: true,
      data: {
        ...importRecord,
        progress,
      },
    });
  } catch (error: any) {
    console.error('Get import error:', error);
    res.status(500).json({
      success: false,
      error: 'An error occurred while fetching the import.',
    });
  }
});

// --- GET / - List all imports ---
router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 25));
    const offset = (page - 1) * limit;

    const countResult = await query<any[]>('SELECT COUNT(*) as total FROM imports');
    const total = countResult[0].total;

    const imports = await query<any[]>(
      `SELECT id, file_name, file_size, status, total_rows, processed_rows,
              imported_rows, skipped_rows, error_rows, started_at, completed_at, created_at
       FROM imports
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    res.json({
      success: true,
      data: {
        imports,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error: any) {
    console.error('List imports error:', error);
    res.status(500).json({
      success: false,
      error: 'An error occurred while fetching imports.',
    });
  }
});

// --- Helper: Suggest column mappings based on common column names ---
function suggestColumnMappings(columns: string[]): Record<string, string> {
  const mappings: Record<string, string> = {};

  const knownMappings: Record<string, string[]> = {
    email: ['email', 'e-mail', 'email_address', 'correo', 'correo_electronico'],
    first_name: ['first_name', 'firstname', 'first', 'nombre', 'given_name'],
    last_name: ['last_name', 'lastname', 'last', 'apellido', 'apellidos', 'surname', 'family_name'],
    title: ['title', 'job_title', 'position', 'cargo', 'puesto', 'job_position'],
    company_name: ['company', 'company_name', 'organization', 'empresa', 'org'],
    phone: ['phone', 'telephone', 'tel', 'telefono', 'phone_number', 'mobile'],
    city: ['city', 'ciudad', 'town'],
    region: ['region', 'state', 'provincia', 'province'],
    country: ['country', 'pais', 'nation'],
    linkedin_url: ['linkedin', 'linkedin_url', 'linkedin_profile'],
    seniority: ['seniority', 'level', 'seniority_level'],
    department: ['department', 'dept', 'departamento'],
    industry: ['industry', 'industria', 'sector'],
    website_url: ['website', 'website_url', 'url', 'web', 'sitio_web'],
    domain: ['domain', 'company_domain', 'dominio'],
  };

  for (const col of columns) {
    const lowerCol = col.toLowerCase().trim().replace(/\s+/g, '_');

    for (const [field, aliases] of Object.entries(knownMappings)) {
      if (aliases.includes(lowerCol)) {
        mappings[col] = field;
        break;
      }
    }
  }

  return mappings;
}

export default router;
