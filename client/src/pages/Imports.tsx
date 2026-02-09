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
  AlertCircle,
  ArrowRight,
  RefreshCw,
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

export default function Imports() {
  const queryClient = useQueryClient();
  const [isDragging, setIsDragging] = useState(false);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});
  const [importProgress, setImportProgress] = useState<number | null>(null);

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
      // If no server suggestions, do basic auto-mapping
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

      toast.success(`Archivo cargado: ${result.total_rows || 0} filas detectadas`);
    },
    onError: () => {
      toast.error('Error al cargar el archivo. Verifica el formato.');
    },
  });

  // Map columns mutation
  const mapMutation = useMutation({
    mutationFn: () => importsApi.map(uploadResult!.import_id, columnMapping),
    onSuccess: () => {
      setImportProgress(0);
      // Poll for status
      const interval = setInterval(async () => {
        try {
          const res = await importsApi.getStatus(uploadResult!.import_id);
          const status = res.data?.data || res.data;
          if (status.progress !== undefined) {
            setImportProgress(status.progress);
          }
          if (status.status === 'completed' || status.progress >= 100) {
            clearInterval(interval);
            setImportProgress(100);
            toast.success(`Importacion completada: ${status.imported || 0} registros importados`);
            queryClient.invalidateQueries({ queryKey: ['imports'] });
            setTimeout(() => {
              setUploadResult(null);
              setColumnMapping({});
              setImportProgress(null);
            }, 2000);
          }
          if (status.status === 'error' || status.status === 'failed') {
            clearInterval(interval);
            setImportProgress(null);
            toast.error('Error durante la importacion');
          }
        } catch {
          clearInterval(interval);
          setImportProgress(null);
        }
      }, 1000);
    },
    onError: () => {
      toast.error('Error al iniciar la importacion');
    },
  });

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

  const imports = historyData?.data?.data?.imports || historyData?.data?.data || [];

  return (
    <div className="p-6 lg:p-8 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Importar Datos</h1>
        <p className="text-slate-500 mt-1">Importa prospectos desde archivos CSV o Excel</p>
      </div>

      {/* Upload area or mapping */}
      {!uploadResult ? (
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
      ) : (
        <Card padding="none">
          <div className="px-6 py-4 border-b border-slate-200">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-slate-900">Mapeo de Columnas</h3>
                <p className="text-sm text-slate-500 mt-0.5">
                  {uploadResult.total_rows} filas detectadas - Asigna cada columna al campo correspondiente
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setUploadResult(null);
                  setColumnMapping({});
                }}
              >
                Cancelar
              </Button>
            </div>
          </div>

          {/* Import progress */}
          {importProgress !== null && (
            <div className="px-6 py-4 bg-primary-50 border-b border-primary-100">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-primary-700">
                  {importProgress >= 100 ? 'Importacion completada' : 'Importando...'}
                </span>
                <span className="text-sm font-bold text-primary-700">{Math.round(importProgress)}%</span>
              </div>
              <div className="w-full bg-primary-200 rounded-full h-2">
                <div
                  className="bg-primary-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${importProgress}%` }}
                />
              </div>
            </div>
          )}

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
                        <th key={col} className="px-3 py-2 text-left font-medium text-slate-600">
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

          {/* Action */}
          <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-3">
            <Button
              variant="secondary"
              onClick={() => {
                setUploadResult(null);
                setColumnMapping({});
              }}
            >
              Cancelar
            </Button>
            <Button
              onClick={() => mapMutation.mutate()}
              loading={mapMutation.isPending}
              disabled={importProgress !== null || !Object.values(columnMapping).some((v) => v)}
            >
              Iniciar Importacion
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
