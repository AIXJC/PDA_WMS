import React, { useEffect, useState } from 'react';
import { ArrowDownCircle, ArrowUpCircle, RefreshCw, Settings2, User, LoaderCircle, Calendar, Package, CheckCircle2, XCircle, Trash2 } from 'lucide-react';
import { Layout } from '../Components/Layout';
import { useTranslation } from '../utils/translations';
import { motion } from 'framer-motion';
import { useAppRefresh } from '../utils/realtime';

interface HistoryItem {
  id: string;
  type: 'inbound' | 'outbound' | 'adjustment' | 'transfer' | 'scrap';
  ref: string;
  provider?: string;
  receiver?: string;
  createdAt?: string;
  receivedAt?: string;
  updatedAt?: string;
  purchaseOrderId?: number;
  acceptedQty?: number;
  rejectedQty?: number;
  receivedQty?: number;
  detailCount?: number;
  quantity?: number;
  description?: string;
  locationName?: string;
  partNumber?: string;
}

export const HistoryPage: React.FC = () => {
  const { t } = useTranslation();
  const [filter, setFilter] = useState('all');
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadHistory = async (showLoading = true) => {
    try {
      if (showLoading) {
        setLoading(true);
      }
      if (showLoading) {
        setError('');
      }
      const response = await fetch('/api/history/inbound');
      if (!response.ok) throw new Error('No fue posible cargar el historial');
      const data = await response.json();
      setHistoryItems(Array.isArray(data.history) ? data.history : []);
    } catch (err) {
      if (showLoading) {
        setError(err instanceof Error ? err.message : 'Error cargando historial');
      }
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    void loadHistory();
  }, []);

  useAppRefresh(() => {
    void loadHistory(false);
  }, 10000);

  const filtered = historyItems.filter((h) => {
    if (filter === 'all') return true;
    if (filter === 'scrap') return h.type === 'scrap';
    return h.type === filter;
  });

  const formatDateTime = (value?: string) => {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString('es-MX', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <Layout title={t('history.title')}>
      <div className="space-y-4">
        {/* Filter */}
        <div className="flex gap-2 overflow-x-auto no-scrollbar pb-2">
          {[
            { id: 'all', label: t('history.filterAll') },
            { id: 'inbound', label: t('history.filterInbound') },
            { id: 'outbound', label: t('history.filterOutbound') },
            { id: 'adjustment', label: t('history.filterAdjustment') },
            { id: 'transfer', label: t('history.filterTransfer') },
            { id: 'scrap', label: t('history.filterScrap') },
          ].map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest whitespace-nowrap transition-all ${
                filter === f.id
                  ? 'bg-slate-900 text-white dark:bg-slate-700 dark:text-slate-100'
                  : 'bg-white text-slate-500 border border-slate-100 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Timeline */}
        <div className="relative">
          {loading && (
            <div className="flex items-center justify-center py-10 text-slate-500 dark:text-slate-400">
              <LoaderCircle size={18} className="mr-2 animate-spin" />
              Cargando historial...
            </div>
          )}

          {!loading && error && (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-600 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-400">
              {error}
            </div>
          )}

          {!loading && !error && filtered.map((item, index) => (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.05 }}
              className="relative pl-8 pb-6"
            >
              {index < filtered.length - 1 && (
                <div className="absolute left-[11px] top-6 bottom-0 w-0.5 bg-slate-100 dark:bg-slate-700" />
              )}

              <div className={`absolute left-0 top-1 w-6 h-6 rounded-full flex items-center justify-center ${
                item.type === 'inbound' ? 'bg-emerald-500' :
                item.type === 'outbound' ? 'bg-blue-500' :
                item.type === 'adjustment' ? 'bg-amber-500' :
                item.type === 'scrap' ? 'bg-rose-500' :
                'bg-violet-500'
              }`}>
                {item.type === 'inbound' && <ArrowDownCircle size={14} className="text-white" />}
                {item.type === 'outbound' && <ArrowUpCircle size={14} className="text-white" />}
                {item.type === 'adjustment' && <Settings2 size={12} className="text-white" />}
                {item.type === 'scrap' && <Trash2 size={12} className="text-white" />}
                {item.type === 'transfer' && <RefreshCw size={12} className="text-white" />}
              </div>

              <div className="bg-white p-4 rounded-[2rem] border border-slate-100 shadow-sm dark:bg-slate-800 dark:border-slate-700">
                <div className="flex justify-between items-start mb-3">
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-black uppercase px-2 py-1 rounded-md ${
                      item.type === 'inbound' ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400' :
                      item.type === 'outbound' ? 'bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400' :
                      item.type === 'adjustment' ? 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400' :
                      item.type === 'scrap' ? 'bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400' :
                      'bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-400'
                    }`}>
                      {item.type === 'inbound' ? t('history.entry') :
                       item.type === 'outbound' ? t('history.exit') :
                       item.type === 'adjustment' ? t('history.adjustment') :
                       item.type === 'scrap' ? t('dashboard.scrap') : t('history.transfer')}
                    </span>
                    <span className="text-xs font-black text-slate-900 dark:text-slate-100">{item.ref}</span>
                  </div>
                  <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500">{formatDateTime(item.receivedAt)}</span>
                </div>

                <div className="grid gap-2 text-xs text-slate-600 dark:text-slate-300">
                  {item.type === 'scrap' ? (
                    <>
                      <div className="flex items-center gap-2">
                        <Package size={12} />
                        <span><span className="font-semibold">Producto:</span> {item.ref}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <CheckCircle2 size={12} className="text-emerald-500" />
                        <span><span className="font-semibold">Cantidad:</span> {item.quantity ?? 0}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <User size={12} />
                        <span><span className="font-semibold">Usuario:</span> {item.receiver || 'Sin usuario'}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Calendar size={12} />
                        <span><span className="font-semibold">Ubicación:</span> {item.locationName || 'Sin ubicación'}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">Detalle:</span> {item.description || 'Sin comentarios'}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex items-center gap-2">
                        <User size={12} />
                        <span><span className="font-semibold">Recibe:</span> {item.receiver || 'Sin receptor'}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Calendar size={12} />
                        <span><span className="font-semibold">Creación:</span> {formatDateTime(item.createdAt)}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Package size={12} />
                        <span><span className="font-semibold">Proveedor:</span> {item.provider || 'Sin proveedor'}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <CheckCircle2 size={12} className="text-emerald-500" />
                        <span><span className="font-semibold">Aceptadas:</span> {item.acceptedQty ?? 0}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <XCircle size={12} className="text-rose-500" />
                        <span><span className="font-semibold">Rechazadas:</span> {item.rejectedQty ?? 0}</span>
                      </div>
                    </>
                  )}
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">ID:</span> {item.id}
                  </div>
                </div>
              </div>
            </motion.div>
          ))}

          {!loading && !error && filtered.length === 0 && (
            <div className="rounded-2xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
              <p className="font-semibold text-slate-700 dark:text-slate-200">No hay movimientos para este filtro.</p>
              <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">
                Si acabas de registrar una entrada o una merma, espera unos segundos y vuelve a cargar la pantalla.
              </p>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
};
