import React, { useEffect, useState } from 'react';
import { Settings2, Check, LoaderCircle } from 'lucide-react';
import { Layout } from '../Components/Layout';
import { motion } from 'framer-motion';

type AdjustmentItem = {
  RequestID: number;
  RequestStatusID?: number;
  StatusCode?: string;
  StatusDescription?: string;
  RequestTypeName?: string;
  RequestTypeDescription?: string;
  PartNumber?: string;
  PartName?: string;
  Quantity?: number;
  RegDate?: string;
  SubmitDate?: string;
  SourceLocationID?: number;
  DestinationLocationID?: number;
  LotInventoryID?: number;
  LotReceiveID?: number;
};

const isAdjustmentRequest = (item: AdjustmentItem) => {
  const typeName = String(item.RequestTypeName || item.RequestTypeDescription || '').toLowerCase();
  return typeName.includes('ajuste') || typeName.includes('adjustment');
};

export const Adjustments: React.FC = () => {
  const [adjustments, setAdjustments] = useState<AdjustmentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const loadAdjustments = async () => {
      setLoading(true);
      setError('');
      try {
        const res = await fetch('/api/requests?status=41&limit=200');
        if (!res.ok) throw new Error('Error cargando ajustes');
        const data = await res.json();
        const items = Array.isArray(data.requests) ? data.requests : [];
        setAdjustments(items.filter(isAdjustmentRequest));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error desconocido');
      } finally {
        setLoading(false);
      }
    };

    void loadAdjustments();
  }, []);

  return (
    <Layout title="Ajustes de Inventario">
      <div className="space-y-4">
        {error ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-600">
            {error}
          </div>
        ) : null}

        {loading ? (
          <div className="flex items-center justify-center py-14 text-slate-500">
            <LoaderCircle className="mr-2 animate-spin" size={18} />
            Cargando ajustes aprobados...
          </div>
        ) : adjustments.length === 0 ? (
          <div className="rounded-[2rem] border border-dashed border-slate-300 bg-slate-50 p-10 text-center text-slate-500">
            No hay conteos cíclicos aprobados para mostrar.
          </div>
        ) : (
          <div className="space-y-4">
            {adjustments.map((adj, index) => (
              <motion.div
                key={adj.RequestID}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.03 }}
                className="bg-white dark:bg-slate-800/95 p-5 rounded-[2.5rem] border border-slate-100 dark:border-slate-700 shadow-sm"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">Solicitud #{adj.RequestID}</p>
                    <h3 className="text-base font-black text-slate-900 dark:text-slate-100 mt-2">{adj.PartNumber || 'Item desconocido'}</h3>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{adj.PartName || adj.RequestTypeName || 'Ajuste de inventario'}</p>
                  </div>
                  <span className="inline-flex items-center gap-2 rounded-full bg-emerald-100 px-3 py-1 text-xs font-black text-emerald-700">
                    <Check size={14} />
                    Aprobado
                  </span>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-200">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">Cantidad</p>
                    <p className="mt-2 text-lg font-black">{adj.Quantity ?? 0}</p>
                  </div>
                  <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-200">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">Fecha</p>
                    <p className="mt-2 text-base font-black">{adj.SubmitDate || adj.RegDate || 'Sin fecha'}</p>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2 text-sm">
                  <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900/80">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">Ubicación origen</p>
                    <p className="mt-2 font-semibold text-slate-700 dark:text-slate-200">{adj.SourceLocationID || 'N/A'}</p>
                  </div>
                  <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900/80">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">Ubicación destino</p>
                    <p className="mt-2 font-semibold text-slate-700 dark:text-slate-200">{adj.DestinationLocationID || adj.LotReceiveID || 'N/A'}</p>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
};
