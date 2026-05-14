import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { importsApi } from '@/services/api';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { Table, TableHead, TableBody, TableRow, TableCell } from '@/components/ui/Table';
import {
  Upload,
  FileSpreadsheet,
  CheckCircle,
  XCircle,
  Loader2,
  ArrowRight,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Users,
  AlertTriangle,
  Check,
} from 'lucide-react';
import { formatDateTime, formatNumber, getStatusColor } from '@/lib/utils';
import toast from 'react-hot-toast';

const targetFieldOptions = [
  { value: '', label: 'No importar' },
  { value: 'first_name', label: 'Nombre' },
  { value: 'last_name', label: 'Apellido' },
  { value: 'email', label: 'Correo Electronico' },
  { value: 'phone', label: 'Telefono' },
  { value: 'company_name', label: 'Empresa' },
  { value: 'title', label: 'Cargo' },
  { value: 'seniority', label: 'Nivel Seniority' },
  { value: 'department', label: 'Departamento' },
  { value: 'linkedin_url', label: 'URL de LinkedIn' },
  { value: 'website_url', label: 'Sitio Web' },
  { value: 'domain', label: 'Dominio empresa' },
  { value: 'industry', label: 'Industria' },
  { value: 'city', label: 'Ciudad' },
  { value: 'region', label: 'Provincia/Region' },
  { value: 'country', label: 'Pais' },
  { value: 'source', label: 'Fuente' },
];

interface UploadResult {
  import_id: string;
  columns: string[];
  preview_rows: Record<string, unknown>[];
  total_rows: number;
  file_name?: string;
  file_size?: number;
  suggested_mappings?: Record<string, string>;
}

interface DuplicateDetail {
  email: string;
  first_name: string;
  row_number: number;
  type: 'db' | 'file';
}

interface DuplicateCheckResult {
  total_rows: number;
  valid_new: number;
  duplicates_in_db: number;
  duplicates_in_file: number;
  invalid_no_email: number;
  duplicate_details: DuplicateDetail[];
}

type WizardStep = 1 | 2 | 3 | 4;

const STEP_LABELS = [
  { num: 1, label: 'Subir Archivo' },
  { num: 2, label: 'Mapeo de Columnas' },
  { num: 3, label: 'Revision de Duplicados' },
  { num: 4, label: 'Importacion' },
];

function Stepper({ currentStep }: { currentStep: WizardStep }) {
  return (
    <div className="flex items-center justify-between mb-8">
      {STEP_LABELS.map((step, idx) => {
        const isCompleted = currentStep > step.num;
        const isCurrent = currentStep === step.num;
        return (
          <div key={step.num} className="flex items-center flex-1 last:flex-none">
            <div className="flex items-center gap-2">
              <div
                className={`flex items-center justify-center w-8 h-8 rounded-full text-sm font-semibold transition-colors ${
                  isCompleted
                    ? 'bg-emerald-500 text-white'
                    : isCurrent
                    ? 'bg-primary-600 text-white'
                    : 'bg-slate-200 text-slate-500'
                }`}
              >
                {isCompleted ? <Check className="h-4 w-4" /> : step.num}
              </div>
              <span
                className={`text-sm font-medium hidden sm:inline ${
                  isCurrent ? 'text-primary-700' : isCompleted ? 'text-emerald-600' : 'text-slate-400'
                }`}
              >
                {step.label}
              </span>
            </div>
            {idx < STEP_LABELS.length - 1 && (
              <div
                className={`flex-1 h-0.5 mx-3 ${
                  currentStep > step.num ? 'bg-emerald-400' : 'bg-slate-200'
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function Imports() {
  const queryClient = useQueryClient();
  const [wizardStep, setWizardStep] = useState<WizardStep>(1);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});
  const [duplicateCheck, setDuplicateCheck] = useState<DuplicateCheckResult | null>(null);
  const [importProgress, setImportProgress] = useState<number | null>(null);
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number; errors: number } | null>(null);
  const [showDuplicateDetails, setShowDuplicateDetails] = useState(false);

  // Import history
  const { data: historyData, isLoading: historyLoading } = useQuery({
    queryKey: ['imports'],
    queryFn: () => importsApi.list(),
  });

  // Upload mutation
  const uploadMutation = useMutation({
    mutationFn: (file: File) => importsApi.upload(file),
    onSuccess: (response) => {
      const result = response.data?.data || response.data;
      setUploadResult(result);

      // Use server-suggested mappings or auto-map
      const autoMapping: Record<string, string> = result.suggested_mappings || {};
      if (Object.keys(autoMapping).length === 0) {
        const columns = result.columns || [];
        columns.forEach((col: string) => {
          const lower = col.toLowerCase().trim().replace(/\s+/g, '_');
          if (lower === 'first_name' || lower === 'firstname' || lower === 'nombre') autoMapping[col] = 'first_name';
          else if (lower === 'last_name' || lower === 'lastname' || lower === 'apellido') autoMapping[col] = 'last_name';
          else if (lower === 'email' || lower === 'correo' || lower === 'email_address') autoMapping[col] = 'email';
          else if (lower === 'phone' || lower === 'telefono' || lower === 'mobile_phone') autoMapping[col] = 'phone';
          else if (lower === 'company_name' || lower === 'company' || lower === 'empresa') autoMapping[col] = 'company_name';
          else if (lower === 'title' || lower === 'job_title' || lower === 'cargo') autoMapping[col] = 'title';
          else if (lower === 'seniority') autoMapping[col] = 'seniority';
          else if (lower === 'industry' || lower === 'industria') autoMapping[col] = 'industry';
          else if (lower === 'person_linkedin_url' || lower === 'linkedin_url' || lower === 'linkedin') autoMapping[col] = 'linkedin_url';
          else if (lower === 'website' || lower === 'website_url') autoMapping[col] = 'website_url';
          else if (lower === 'city' || lower === 'ciudad') autoMapping[col] = 'city';
          else if (lower === 'state' || lower === 'region' || lower === 'provincia') autoMapping[col] = 'region';
          else if (lower === 'country' || lower === 'pais') autoMapping[col] = 'country';
          else if (lower === 'department' || lower === 'departments') autoMapping[col] = 'department';
        });
      }
      setColumnMapping(autoMapping);
      setWizardStep(2);
      toast.success(`Archivo cargado: ${result.total_rows || 0} filas detectadas`);
    },
    onError: () => {
      toast.error('Error al cargar el archivo. Verifica el formato.');
    },
  });

  // Check duplicates mutation
  const checkDuplicatesMutation = useMutation({
    mutationFn: () => importsApi.checkDuplicates(uploadResult!.import_id, columnMapping),
    onSuccess: (response) => {
      const result = response.data?.data || response.data;
      setDuplicateCheck(result);
      setWizardStep(3);
    },
    onError: () => {
      toast.error('Error al verificar duplicados.');
    },
  });

  // Map columns (import) mutation
  const mapMutation = useMutation({
    mutationFn: () => importsApi.map(uploadResult!.import_id, columnMapping),
    onSuccess: (response) => {
      const result = response.data?.data || response.data;
      setImportResult({ imported: result.imported || 0, skipped: result.skipped || 0, errors: result.errors || 0 });
      setImportProgress(100);
      toast.success(`Importacion completada: ${result.imported || 0} registros importados`);
      queryClient.invalidateQueries({ queryKey: ['imports'] });
    },
    onError: () => {
      setImportProgress(null);
      toast.error('Error al iniciar la importacion');
    },
  });

  const handleStartImport = () => {
    setWizardStep(4);
    setImportProgress(0);
    mapMutation.mutate();
  };

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) {
        const ext = file.name.split('.').pop()?.toLowerCase();
        if (ext === 'csv' || ext === 'xlsx' || ext === 'xls') {
          uploadMutation.mutate(file);
        } else {
          toast.error('Solo se aceptan archivos CSV o Excel (.xlsx, .xls)');
        }
      }
    },
    [uploadMutation]
  );

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      uploadMutation.mutate(file);
    }
  };

  const resetWizard = () => {
    setWizardStep(1);
    setUploadResult(null);
    setColumnMapping({});
    setDuplicateCheck(null);
    setImportProgress(null);
    setImportResult(null);
    setShowDuplicateDetails(false);
  };

  const imports = historyData?.data?.data?.imports || historyData?.data?.data || [];

  const hasEmailMapping = Object.values(columnMapping).includes('email');
  const isInWizard = wizardStep > 1 || uploadMutation.isPending;

  return (
    <div className="p-6 lg:p-8 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Importar Datos</h1>
        <p className="text-slate-500 mt-1">Importa prospectos desde archivos CSV o Excel</p>
      </div>

      {/* Wizard area */}
      {isInWizard && <Stepper currentStep={wizardStep} />}

      {/* Step 1: Upload */}
      {wizardStep === 1 && (
        <Card padding="none">
          <div
            className={`relative border-2 border-dashed rounded-xl p-12 text-center transition-colors ${
              isDragging
                ? 'border-primary-400 bg-primary-50'
                : 'border-slate-300 hover:border-primary-300 hover:bg-slate-50'
            }`}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
          >
            {uploadMutation.isPending ? (
              <div className="flex flex-col items-center">
                <Loader2 className="h-12 w-12 animate-spin text-primary-600 mb-4" />
                <p className="text-lg font-medium text-slate-700">Procesando archivo...</p>
                <p className="text-sm text-slate-500 mt-1">Esto puede tomar unos segundos</p>
              </div>
            ) : (
              <div className="flex flex-col items-center">
                <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-primary-50 text-primary-600 mb-4">
                  <Upload className="h-8 w-8" />
                </div>
                <p className="text-lg font-medium text-slate-700">
                  Arrastra tu archivo aqui
                </p>
                <p className="text-sm text-slate-500 mt-1">
                  o haz clic para seleccionar un archivo CSV o Excel
                </p>
                <input
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  onChange={handleFileSelect}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
                <div className="flex items-center gap-2 mt-4 text-xs text-slate-400">
                  <FileSpreadsheet className="h-4 w-4" />
                  <span>Formatos aceptados: CSV, XLSX, XLS</span>
                </div>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* Step 2: Column Mapping */}
      {wizardStep === 2 && uploadResult && (
        <Card padding="none">
          <div className="px-6 py-4 border-b border-slate-200">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-slate-900">Mapeo de Columnas</h3>
                <p className="text-sm text-slate-500 mt-0.5">
                  {uploadResult.total_rows} filas detectadas - Asigna cada columna al campo correspondiente
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={resetWizard}>
                Cancelar
              </Button>
            </div>
          </div>

          {/* Column mapping */}
          <div className="p-6 space-y-3">
            {uploadResult.columns.map((col) => (
              <div key={col} className="flex items-center gap-4">
                <div className="w-1/3">
                  <div className="px-3 py-2 bg-slate-50 rounded-lg border border-slate-200">
                    <span className="text-sm font-medium text-slate-700">{col}</span>
                  </div>
                </div>
                <ArrowRight className="h-4 w-4 text-slate-400 shrink-0" />
                <div className="w-1/3">
                  <Select
                    options={targetFieldOptions}
                    value={columnMapping[col] || ''}
                    onChange={(val) =>
                      setColumnMapping((prev) => ({ ...prev, [col]: val }))
                    }
                    placeholder="Seleccionar campo"
                  />
                </div>
              </div>
            ))}
          </div>

          {/* Preview */}
          {uploadResult.preview_rows && uploadResult.preview_rows.length > 0 && (
            <div className="px-6 pb-4">
              <h4 className="text-sm font-medium text-slate-700 mb-2">Vista previa (primeras filas):</h4>
              <div className="overflow-x-auto border border-slate-200 rounded-lg">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50">
                    <tr>
                      {uploadResult.columns.map((col) => (
                        <th key={col} scope="col" className="px-3 py-2 text-left font-medium text-slate-600">
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {uploadResult.preview_rows.slice(0, 3).map((row, i) => (
                      <tr key={i}>
                        {uploadResult.columns.map((col) => (
                          <td key={col} className="px-3 py-2 text-slate-600 truncate max-w-[150px]">
                            {(row[col] as string) || '-'}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="px-6 py-4 border-t border-slate-200 flex justify-between">
            <Button variant="secondary" onClick={resetWizard}>
              Cancelar
            </Button>
            <Button
              onClick={() => checkDuplicatesMutation.mutate()}
              loading={checkDuplicatesMutation.isPending}
              disabled={!hasEmailMapping}
            >
              {hasEmailMapping ? 'Verificar Duplicados' : 'Mapea el campo Email para continuar'}
            </Button>
          </div>
        </Card>
      )}

      {/* Step 3: Duplicate Review */}
      {wizardStep === 3 && duplicateCheck && (
        <Card padding="none">
          <div className="px-6 py-4 border-b border-slate-200">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-slate-900">Revision de Duplicados</h3>
                <p className="text-sm text-slate-500 mt-0.5">
                  Revisa el resumen antes de importar
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={resetWizard}>
                Cancelar
              </Button>
            </div>
          </div>

          {/* Summary cards */}
          <div className="p-6 grid grid-cols-2 lg:grid-cols-4 gap-4">
            {/* New contacts */}
            <div className="rounded-xl border-2 border-emerald-200 bg-emerald-50 p-4">
              <div className="flex items-center gap-2 mb-2">
                <Users className="h-5 w-5 text-emerald-600" />
                <span className="text-sm font-medium text-emerald-700">Contactos Nuevos</span>
              </div>
              <p className="text-3xl font-bold text-emerald-700">{formatNumber(duplicateCheck.valid_new)}</p>
              <p className="text-xs text-emerald-600 mt-1">Se importaran</p>
            </div>

            {/* DB duplicates */}
            <div className="rounded-xl border-2 border-amber-200 bg-amber-50 p-4">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="h-5 w-5 text-amber-600" />
                <span className="text-sm font-medium text-amber-700">Duplicados en BD</span>
              </div>
              <p className="text-3xl font-bold text-amber-700">{formatNumber(duplicateCheck.duplicates_in_db)}</p>
              <p className="text-xs text-amber-600 mt-1">Se omitiran</p>
            </div>

            {/* File duplicates */}
            <div className="rounded-xl border-2 border-amber-200 bg-amber-50 p-4">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="h-5 w-5 text-amber-600" />
                <span className="text-sm font-medium text-amber-700">Duplicados en Archivo</span>
              </div>
              <p className="text-3xl font-bold text-amber-700">{formatNumber(duplicateCheck.duplicates_in_file)}</p>
              <p className="text-xs text-amber-600 mt-1">Se importara solo 1 de cada uno</p>
            </div>

            {/* Invalid */}
            <div className="rounded-xl border-2 border-red-200 bg-red-50 p-4">
              <div className="flex items-center gap-2 mb-2">
                <XCircle className="h-5 w-5 text-red-500" />
                <span className="text-sm font-medium text-red-700">Sin Email / Invalidos</span>
              </div>
              <p className="text-3xl font-bold text-red-700">{formatNumber(duplicateCheck.invalid_no_email)}</p>
              <p className="text-xs text-red-600 mt-1">Se omitiran</p>
            </div>
          </div>

          {/* Duplicate details expandable */}
          {duplicateCheck.duplicate_details.length > 0 && (
            <div className="px-6 pb-4">
              <button
                onClick={() => setShowDuplicateDetails(!showDuplicateDetails)}
                className="flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors"
              >
                {showDuplicateDetails ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
                Ver detalle de duplicados ({duplicateCheck.duplicate_details.length})
              </button>

              {showDuplicateDetails && (
                <div className="mt-3 border border-slate-200 rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50">
                      <tr>
                        <th scope="col" className="px-4 py-2 text-left font-medium text-slate-600">Fila</th>
                        <th scope="col" className="px-4 py-2 text-left font-medium text-slate-600">Email</th>
                        <th scope="col" className="px-4 py-2 text-left font-medium text-slate-600">Nombre</th>
                        <th scope="col" className="px-4 py-2 text-left font-medium text-slate-600">Tipo</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {duplicateCheck.duplicate_details.slice(0, 100).map((d, i) => (
                        <tr key={i} className="hover:bg-slate-50">
                          <td className="px-4 py-2 text-slate-500">#{d.row_number}</td>
                          <td className="px-4 py-2 text-slate-700">{d.email}</td>
                          <td className="px-4 py-2 text-slate-600">{d.first_name || '-'}</td>
                          <td className="px-4 py-2">
                            <Badge className={d.type === 'db' ? 'bg-amber-100 text-amber-700' : 'bg-orange-100 text-orange-700'}>
                              {d.type === 'db' ? 'Ya existe en BD' : 'Repetido en archivo'}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {duplicateCheck.duplicate_details.length > 100 && (
                    <div className="px-4 py-2 bg-slate-50 text-xs text-slate-500 text-center">
                      Mostrando 100 de {duplicateCheck.duplicate_details.length} duplicados
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="px-6 py-4 border-t border-slate-200 flex justify-between">
            <Button variant="secondary" onClick={() => setWizardStep(2)}>
              Volver al Mapeo
            </Button>
            <Button onClick={handleStartImport} disabled={duplicateCheck.valid_new === 0}>
              {duplicateCheck.valid_new > 0
                ? `Importar ${formatNumber(duplicateCheck.valid_new)} contactos nuevos`
                : 'No hay contactos nuevos para importar'}
            </Button>
          </div>
        </Card>
      )}

      {/* Step 4: Import Progress / Result */}
      {wizardStep === 4 && (
        <Card padding="none">
          <div className="px-6 py-4 border-b border-slate-200">
            <h3 className="font-semibold text-slate-900">
              {importProgress !== null && importProgress >= 100 ? 'Importacion Completada' : 'Importando...'}
            </h3>
          </div>

          <div className="p-6">
            {/* Progress bar */}
            {importProgress !== null && importProgress < 100 && (
              <div className="mb-6">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-primary-700">Procesando registros...</span>
                  <Loader2 className="h-4 w-4 animate-spin text-primary-600" />
                </div>
                <div className="w-full bg-primary-100 rounded-full h-3">
                  <div
                    className="bg-primary-600 h-3 rounded-full transition-all duration-500 animate-pulse"
                    style={{ width: '60%' }}
                  />
                </div>
              </div>
            )}

            {/* Result */}
            {importResult && (
              <div className="space-y-4">
                <div className="flex items-center gap-3 mb-4">
                  <div className="flex items-center justify-center w-12 h-12 rounded-full bg-emerald-100">
                    <CheckCircle className="h-6 w-6 text-emerald-600" />
                  </div>
                  <div>
                    <p className="text-lg font-semibold text-slate-900">Importacion finalizada</p>
                    <p className="text-sm text-slate-500">Los contactos fueron procesados exitosamente</p>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-4 text-center">
                    <p className="text-2xl font-bold text-emerald-700">{formatNumber(importResult.imported)}</p>
                    <p className="text-sm text-emerald-600">Importados</p>
                  </div>
                  <div className="rounded-lg bg-amber-50 border border-amber-200 p-4 text-center">
                    <p className="text-2xl font-bold text-amber-700">{formatNumber(importResult.skipped)}</p>
                    <p className="text-sm text-amber-600">Omitidos</p>
                  </div>
                  <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-center">
                    <p className="text-2xl font-bold text-red-700">{formatNumber(importResult.errors)}</p>
                    <p className="text-sm text-red-600">Errores</p>
                  </div>
                </div>
              </div>
            )}

            {/* Loading state while mutation is pending */}
            {mapMutation.isPending && !importResult && (
              <div className="flex flex-col items-center py-8">
                <Loader2 className="h-10 w-10 animate-spin text-primary-600 mb-4" />
                <p className="text-slate-600 font-medium">Importando contactos...</p>
                <p className="text-sm text-slate-400 mt-1">Esto puede tomar unos segundos</p>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="px-6 py-4 border-t border-slate-200 flex justify-end">
            <Button onClick={resetWizard} disabled={mapMutation.isPending}>
              Nueva Importacion
            </Button>
          </div>
        </Card>
      )}

      {/* Import history */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-slate-900">Historial de Importaciones</h2>
          <Button
            variant="ghost"
            size="sm"
            icon={<RefreshCw className="h-4 w-4" />}
            onClick={() => queryClient.invalidateQueries({ queryKey: ['imports'] })}
          >
            Actualizar
          </Button>
        </div>

        {historyLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
          </div>
        ) : imports.length === 0 ? (
          <Card className="flex flex-col items-center justify-center py-12">
            <FileSpreadsheet className="h-8 w-8 text-slate-300 mb-2" />
            <p className="text-sm text-slate-500">Sin importaciones previas</p>
          </Card>
        ) : (
          <Table>
            <TableHead>
              <TableRow hoverable={false}>
                <TableCell isHeader>Archivo</TableCell>
                <TableCell isHeader>Fecha</TableCell>
                <TableCell isHeader className="text-center">Filas</TableCell>
                <TableCell isHeader className="text-center">Importados</TableCell>
                <TableCell isHeader className="text-center">Errores</TableCell>
                <TableCell isHeader>Estado</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {imports.map((imp: Record<string, unknown>) => {
                const impId = (imp.id || imp._id) as string;
                return (
                  <TableRow key={impId}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <FileSpreadsheet className="h-4 w-4 text-slate-400" />
                        <span className="text-sm font-medium text-slate-700">
                          {imp.file_name as string || 'Archivo'}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-slate-500 text-sm">
                      {imp.created_at ? formatDateTime(imp.created_at as string) : '-'}
                    </TableCell>
                    <TableCell className="text-center text-slate-600">
                      {formatNumber(imp.total_rows as number || 0)}
                    </TableCell>
                    <TableCell className="text-center">
                      <span className="flex items-center justify-center gap-1 text-emerald-600">
                        <CheckCircle className="h-3.5 w-3.5" />
                        {formatNumber(imp.imported_rows as number || 0)}
                      </span>
                    </TableCell>
                    <TableCell className="text-center">
                      <span className="flex items-center justify-center gap-1 text-red-500">
                        <XCircle className="h-3.5 w-3.5" />
                        {formatNumber(imp.error_rows as number || 0)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge className={getStatusColor(imp.status as string || 'completed')}>
                        {imp.status as string || 'completado'}
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
