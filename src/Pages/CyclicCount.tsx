import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, RefreshCw, X, AlertCircle, LoaderCircle, ChevronLeft, ChevronRight, ScanLine } from 'lucide-react';
import { Layout } from '../Components/Layout';
import { motion } from 'framer-motion';

interface CycleCount {
  CycleCountID: number;
  ERPCycleCountID: string | null;
  LocationID: number;
  StorageLocationID: number | null;
  StatusID: number;
  InventoryID: number | null;
  PartNumber: string | null;
  LocationCode: string | null;
  SystemQuantity: number | null;
  CountedQuantity: number | null;
  Difference: number | null;
  Result: string | null;
  AdjustmentStatus: string | null;
  ProgressPercent: number | null;
  AttemptNo: number | null;
  Comments: string | null;
  CreatedDate: string;
  UpdateDate: string;
  StatusCode: string;
  StatusDescription: string;
  RackName: string | null;
  RackColumn: number | null;
  RackCell: number | null;
  LocationName: string | null;
  PartName: string | null;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

const STATUS_FILTERS: { id: number | 'all'; label: string }[] = [
  { id: 'all', label: 'Todos' },
  { id: 47, label: 'En proceso' },
  { id: 49, label: 'Reconteo' },
  { id: 46, label: 'Completados' },
  { id: 48, label: 'Cancelados' },
];

const PAGE_SIZE = 10;

const STATUS_STYLES: Record<number, { icon: React.ElementType; badge: string; iconWrap: string }> = {
  46: {
    icon: Check,
    badge: 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300',
    iconWrap: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  },
  47: {
    icon: RefreshCw,
    badge: 'bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300',
    iconWrap: 'bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400',
  },
  48: {
    icon: X,
    badge: 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-200',
    iconWrap: 'bg-slate-50 dark:bg-slate-700/70 text-slate-400 dark:text-slate-300',
  },
  49: {
    icon: AlertCircle,
    badge: 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300',
    iconWrap: 'bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400',
  },
};

const formatLocation = (cycle: CycleCount) => {
  if (cycle.RackName) {
    return `${cycle.RackName}-${Number(cycle.RackColumn || 0)}-${Number(cycle.RackCell || 0)}`;
  }
  return cycle.LocationCode || cycle.LocationName || `Ubicación ${cycle.LocationID}`;
};

const formatQty = (value: number | null) => {
  if (value === null || value === undefined) return '—';
  return Number(value).toFixed(2);
};

export const CyclicCount: React.FC = () => {
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState<number | 'all'>('all');
  const [page, setPage] = useState(1);
  const [cycles, setCycles] = useState<CycleCount[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadCycles = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    setError('');
    try {
      const statusParam = statusFilter === 'all' ? '46,47,48,49' : String(statusFilter);
      const res = await fetch(`/api/cyclic-count?status=${statusParam}&page=${page}&limit=${PAGE_SIZE}`);
      if (!res.ok) throw new Error('Error cargando conteos cíclicos');
      const data = await res.json();
      setCycles(Array.isArray(data.cycles) ? data.cycles : []);
      setPagination(data.pagination ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error cargando conteos cíclicos');
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [statusFilter, page]);

  useEffect(() => {
    void loadCycles();
  }, [loadCycles]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      void loadCycles(false);
    }, 10000);
    return () => window.clearInterval(intervalId);
  }, [loadCycles]);

  const handleFilterChange = (id: number | 'all') => {
    setStatusFilter(id);
    setPage(1);
  };

  const canGoPrev = (pagination?.page ?? page) > 1;
  const canGoNext = pagination ? pagination.page < pagination.totalPages : false;

  return (
    <Layout title="Conteo Cíclico">
      <div className="space-y-4">
        {error && (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-600">
            {error}
          </div>
        )}

        <div className="rounded-[2rem] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-400 mb-2">Filtrar por estado</p>
          <div className="flex flex-wrap gap-2">
            {STATUS_FILTERS.map((filter) => {
              const isActive = statusFilter === filter.id;
              return (
                <button
                  key={String(filter.id)}
                  type="button"
                  onClick={() => handleFilterChange(filter.id)}
                  className={`rounded-full px-3 py-1.5 text-[10px] font-black uppercase transition-all ${
                    isActive
                      ? 'bg-blue-600 text-white'
                      : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-200 border border-slate-200 dark:border-slate-700'
                  }`}
                >
                  {filter.label}
                </button>
              );
            })}
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-10 text-slate-500">
            <LoaderCircle className="mr-2 animate-spin" size={18} />
            Cargando conteos...
          </div>
        ) : cycles.length === 0 ? (
          <div className="bg-white dark:bg-slate-800/95 rounded-[2.5rem] p-8 border-2 border-dashed border-slate-200 dark:border-slate-700 text-center">
            <div className="w-20 h-20 bg-slate-50 dark:bg-slate-700/50 rounded-full flex items-center justify-center mx-auto mb-4">
              <ScanLine size={36} className="text-slate-400" />
            </div>
            <h3 className="text-lg font-black text-slate-900 dark:text-slate-100 mb-1">Sin conteos</h3>
            <p className="text-sm text-slate-500 dark:text-slate-300 font-medium">No hay conteos cíclicos con este filtro.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {cycles.map((cycle, index) => {
              const style = STATUS_STYLES[cycle.StatusID] || STATUS_STYLES[47];
              const StatusIcon = style.icon;
              const canStart = cycle.StatusID === 47 || cycle.StatusID === 49;

              return (
                <motion.div
                  key={cycle.CycleCountID}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.03 }}
                  className="w-full bg-white dark:bg-slate-800/95 p-5 rounded-[2rem] border border-slate-100 dark:border-slate-700 shadow-sm"
                >
                  <div className="flex items-start gap-4">
                    <div className={`w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0 ${style.iconWrap}`}>
                      <StatusIcon size={26} />
                    </div>
                    <div className="flex-1 min-w-0 text-left">
                      <div className="flex justify-between items-start gap-2 mb-1">
                        <span className="text-[10px] font-black text-slate-400 dark:text-slate-300 uppercase">
                          {cycle.ERPCycleCountID || `Ciclo ${cycle.CycleCountID}`}
                        </span>
                        <span className={`text-[9px] font-black uppercase px-2 py-1 rounded-md flex-shrink-0 ${style.badge}`}>
                          {cycle.StatusDescription || cycle.StatusCode}
                        </span>
                      </div>
                      <h3 className="text-base font-black text-slate-900 dark:text-slate-100 mb-1 leading-tight">
                        {cycle.PartName || cycle.PartNumber || 'Sin número de parte'}
                      </h3>
                      <p className="text-[11px] font-bold text-slate-400 dark:text-slate-300 uppercase mb-2">
                        {formatLocation(cycle)}
                      </p>

                      <div className="grid grid-cols-3 gap-2 text-[11px]">
                        <div className="rounded-xl bg-slate-50 dark:bg-slate-700/60 px-2 py-1.5">
                          <p className="text-[9px] font-black uppercase text-slate-400 dark:text-slate-400">Sistema</p>
                          <p className="font-bold text-slate-800 dark:text-slate-100">{formatQty(cycle.SystemQuantity)}</p>
                        </div>
                        <div className="rounded-xl bg-slate-50 dark:bg-slate-700/60 px-2 py-1.5">
                          <p className="text-[9px] font-black uppercase text-slate-400 dark:text-slate-400">Contado</p>
                          <p className="font-bold text-slate-800 dark:text-slate-100">{formatQty(cycle.CountedQuantity)}</p>
                        </div>
                        <div className="rounded-xl bg-slate-50 dark:bg-slate-700/60 px-2 py-1.5">
                          <p className="text-[9px] font-black uppercase text-slate-400 dark:text-slate-400">Diferencia</p>
                          <p className={`font-bold ${Number(cycle.Difference || 0) === 0 ? 'text-slate-800 dark:text-slate-100' : 'text-rose-600 dark:text-rose-400'}`}>
                            {formatQty(cycle.Difference)}
                          </p>
                        </div>
                      </div>

                      {cycle.Comments ? (
                        <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400 italic">"{cycle.Comments}"</p>
                      ) : null}

                      {canStart && (
                        <button
                          onClick={() => navigate(`/inventory/cyclic/${cycle.CycleCountID}/count`)}
                          className="mt-3 w-full bg-blue-600 text-white py-3 rounded-2xl font-black uppercase tracking-widest text-xs active:scale-95 transition-all flex items-center justify-center gap-2"
                        >
                          <ScanLine size={16} />
                          <span>Iniciar Conteo</span>
                        </button>
                      )}
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}

        {pagination && pagination.total > 0 && (
          <div className="flex items-center justify-between rounded-[2rem] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3 shadow-sm">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={!canGoPrev}
              className="flex items-center gap-1 rounded-2xl bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-200 px-4 py-2 text-xs font-black uppercase disabled:opacity-40 active:scale-95 transition-all"
            >
              <ChevronLeft size={16} />
              <span>Anterior</span>
            </button>
            <div className="text-center">
              <p className="text-xs font-black text-slate-700 dark:text-slate-200">
                Página {pagination.page} de {pagination.totalPages}
              </p>
              <p className="text-[10px] text-slate-400 dark:text-slate-400">{pagination.total} conteos</p>
            </div>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={!canGoNext}
              className="flex items-center gap-1 rounded-2xl bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-200 px-4 py-2 text-xs font-black uppercase disabled:opacity-40 active:scale-95 transition-all"
            >
              <span>Siguiente</span>
              <ChevronRight size={16} />
            </button>
          </div>
        )}
      </div>
    </Layout>
  );
};
