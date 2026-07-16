import React, { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  Search,
  ChevronRight,
  Package,
  MapPin,
  AlertCircle,
  Download,
  LoaderCircle,
} from 'lucide-react';
import { Layout } from '../Components/Layout';
import { useTranslation } from '../utils/translations';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppRefresh, notifyAppRefresh } from '../utils/realtime';

interface InventoryRow {
  inventoryId: number;
  sku: string;
  name: string;
  stock: number | string;
  lastUpdate: string;
  locationName?: string;
  rackName?: string;
  rackColumn?: string;
  rackCell?: string;
  partType?: string;
  unitType?: string;
}

export const Inventory: React.FC = () => {
  const { t } = useTranslation();
  const location = useLocation();
  const [inventory, setInventory] = useState<InventoryRow[]>([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'low' | 'critical'>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedItem, setSelectedItem] = useState<InventoryRow | null>(null);
  const [selectedLoading, setSelectedLoading] = useState(false);

  const getStockState = (value: number | string) => {
    const stock = Number(value) || 0;
    if (stock <= 0) return 'critical';
    if (stock < 20) return 'low';
    return 'normal';
  };

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const requestedFilter = params.get('filter');
    if (requestedFilter === 'critical' || requestedFilter === 'low') {
      setFilter(requestedFilter);
    }
  }, [location.search]);

  const loadInventory = async (showLoading = true) => {
    try {
      if (showLoading) {
        setLoading(true);
      }

      const response = await fetch('/api/inventory?limit=500');
      if (!response.ok) {
        throw new Error('No fue posible cargar el inventario');
      }

      const data = await response.json();
      setInventory(Array.isArray(data.inventory) ? data.inventory : []);
      setError('');
    } catch (err) {
      if (showLoading) {
        setError(err instanceof Error ? err.message : 'Error cargando inventario');
      }
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    void loadInventory(true);
  }, []);

  useAppRefresh(() => {
    void loadInventory(false);
  }, 10000);

  const filteredInventory = useMemo(() => {
    return inventory.filter((item) => {
      const matchesSearch = [item.name, item.sku, item.locationName, item.rackName]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(search.toLowerCase());

      const stockState = getStockState(item.stock);
      if (!matchesSearch) return false;
      if (filter === 'low') return stockState === 'low';
      if (filter === 'critical') return stockState === 'critical';
      return true;
    });
  }, [inventory, search, filter]);

  const openDetail = async (item: InventoryRow) => {
    try {
      setSelectedLoading(true);
      const response = await fetch(`/api/inventory/id/${item.inventoryId}`);
      if (!response.ok) throw new Error('No fue posible cargar el detalle');
      const data = await response.json();
      setSelectedItem(data.inventory || item);
    } catch (err) {
      setSelectedItem(item);
    } finally {
      setSelectedLoading(false);
    }
  };

  const formatDate = (value?: string) => {
    if (!value) return 'Sin fecha';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' });
  };

  const exportInventory = () => {
    const rows = filteredInventory.map((item) => ({
      inventoryId: item.inventoryId,
      sku: item.sku,
      name: item.name,
      stock: item.stock,
      unitType: item.unitType || '',
      locationName: item.locationName || '',
      rackName: item.rackName || '',
      rackColumn: item.rackColumn || '',
      rackCell: item.rackCell || '',
      lastUpdate: item.lastUpdate || '',
    }));

    const headers = ['inventoryId', 'sku', 'name', 'stock', 'unitType', 'locationName', 'rackName', 'rackColumn', 'rackCell', 'lastUpdate'];
    const csvContent = [headers.join(','), ...rows.map((row) => headers.map((header) => `"${String(row[header as keyof typeof row] ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const fileDate = new Date().toISOString().slice(0, 10);
    const fileName = filter === 'low'
      ? `Stock-Bajo-${fileDate}.csv`
      : filter === 'critical'
        ? `Stock Critico - ${fileDate}.csv`
        : `inventario-${fileDate}.csv`;

    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <Layout title={t('inventory.title')}>
      <div className="space-y-6">
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('inventory.searchPlaceholder')}
              className="w-full bg-white dark:bg-slate-800 dark:border-slate-700 dark:text-slate-100 border-2 border-slate-100 rounded-2xl py-4 pl-12 pr-4 focus:border-blue-500 outline-none transition-all font-medium shadow-sm"
            />
          </div>

          <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar">
            {[
              { id: 'all', label: t('inventory.filterAll'), count: inventory.length },
              { id: 'low', label: t('inventory.filterLow'), count: inventory.filter((item) => getStockState(item.stock) === 'low').length },
              { id: 'critical', label: t('inventory.filterCritical'), count: inventory.filter((item) => getStockState(item.stock) === 'critical').length },
            ].map((f) => (
              <button
                key={f.id}
                onClick={() => setFilter(f.id as 'all' | 'low' | 'critical')}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest whitespace-nowrap transition-all ${
                  filter === f.id ? 'bg-slate-900 text-white shadow-lg' : 'bg-white text-slate-500 border border-slate-100'
                }`}
              >
                <span>{f.label}</span>
                <span className={`px-1.5 py-0.5 rounded-md text-[8px] ${filter === f.id ? 'bg-white/20' : 'bg-slate-100'}`}>
                  {f.count}
                </span>
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div className="rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-600">
            {error}
          </div>
        )}

        <div className="space-y-3">
          {loading ? (
            <div className="flex items-center justify-center rounded-[2rem] bg-white dark:bg-slate-800 dark:text-slate-300 py-10 text-slate-500">
              <LoaderCircle className="mr-2 animate-spin" size={18} />
              Cargando inventario...
            </div>
          ) : filteredInventory.length > 0 ? (
            filteredInventory.map((item, index) => {
              const stockState = getStockState(item.stock);
              const stockValue = Number(item.stock) || 0;

              return (
              <motion.button
                key={item.inventoryId}
                type="button"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.04 }}
                onClick={() => openDetail(item)}
                className="w-full bg-white dark:bg-slate-800 dark:border-slate-700 dark:text-slate-100 p-4 rounded-[2rem] border border-slate-100 shadow-sm flex items-center gap-4 text-left active:scale-[0.98] transition-all"
              >
                <div className="w-14 h-14 bg-slate-50 dark:bg-slate-900/80 rounded-2xl flex items-center justify-center border border-slate-100 dark:border-slate-700">
                  <Package size={24} className="text-slate-500 dark:text-slate-300" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-start mb-1">
                    <span className="text-[9px] font-black text-slate-400 dark:text-slate-300 uppercase tracking-tighter truncate">
                      ID {item.inventoryId}
                    </span>
                    <div className="flex items-center gap-1 text-slate-400 dark:text-slate-300">
                      <MapPin size={10} />
                      <span className="text-[9px] font-bold uppercase">{item.locationName || 'Sin ubicación'}</span>
                    </div>
                  </div>
                  <h3 className="text-sm font-black text-slate-900 dark:text-slate-100 truncate mb-1">{item.name || item.sku}</h3>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`text-lg font-black ${stockState === 'critical' ? 'text-rose-600 dark:text-rose-400' : stockState === 'low' ? 'text-amber-600 dark:text-amber-400' : 'text-slate-900 dark:text-slate-100'}`}>
                        {stockValue}
                      </span>
                      <span className="text-[10px] font-bold text-slate-400 dark:text-slate-300 uppercase">{t('inventory.units')}</span>
                    </div>
                    {stockState !== 'normal' && (
                      <div className={`flex items-center gap-1 px-2 py-0.5 rounded-md ${stockState === 'critical' ? 'text-rose-600 bg-rose-50 dark:text-rose-300 dark:bg-rose-500/15' : 'text-amber-600 bg-amber-50 dark:text-amber-300 dark:bg-amber-500/15'}`}>
                        <AlertCircle size={12} />
                        <span className="text-[8px] font-black uppercase">{stockState === 'critical' ? 'Stock crítico' : 'Stock bajo'}</span>
                      </div>
                    )}
                  </div>
                </div>
                <ChevronRight size={20} className="text-slate-300 dark:text-slate-400" />
              </motion.button>
              );
            })
          ) : (
            <div className="py-20 text-center space-y-4">
              <div className="w-20 h-20 bg-slate-100 dark:bg-slate-700/70 rounded-full flex items-center justify-center mx-auto">
                <Package size={40} className="text-slate-300 dark:text-slate-400" />
              </div>
              <p className="text-slate-500 dark:text-slate-300 font-bold">No se encontraron registros</p>
            </div>
          )}
        </div>

        <div className="fixed bottom-24 right-6 flex flex-col gap-3">
          <button
            type="button"
            onClick={exportInventory}
            className="w-14 h-14 bg-white dark:bg-slate-800 dark:text-slate-100 text-slate-900 rounded-2xl shadow-xl flex items-center justify-center border border-slate-100 dark:border-slate-700 active:scale-90 transition-all"
            aria-label="Descargar inventario"
          >
            <Download size={24} />
          </button>
        </div>

        <AnimatePresence>
          {selectedItem && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-end bg-slate-950/50 p-3"
              onClick={() => setSelectedItem(null)}
            >
              <motion.div
                initial={{ y: 24, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 24, opacity: 0 }}
                className="w-full max-w-md rounded-[2rem] bg-white dark:bg-slate-800 dark:text-slate-100 p-6 shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400 dark:text-slate-300">Detalle de inventario</p>
                    <h3 className="text-xl font-black text-slate-900 dark:text-slate-100">{selectedItem.name || selectedItem.sku}</h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedItem(null)}
                    className="rounded-full bg-slate-100 dark:bg-slate-700 px-3 py-2 text-sm font-bold text-slate-600 dark:text-slate-200"
                  >
                    Cerrar
                  </button>
                </div>

                {selectedLoading ? (
                  <div className="mt-6 flex items-center justify-center py-6 text-sm font-semibold text-slate-500 dark:text-slate-300">
                    <LoaderCircle className="mr-2 animate-spin" size={16} />
                    Cargando detalle...
                  </div>
                ) : (
                  <div className="mt-6 space-y-3 text-sm text-slate-600 dark:text-slate-300">
                    <div className="rounded-2xl bg-slate-50 dark:bg-slate-700/80 p-4">
                      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 dark:text-slate-300">Inventory ID</p>
                      <p className="mt-1 text-lg font-black text-slate-900 dark:text-slate-100">{selectedItem.inventoryId}</p>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-2xl bg-slate-50 dark:bg-slate-700/80 p-4">
                        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 dark:text-slate-300">Número de parte</p>
                        <p className="mt-1 font-bold text-slate-900 dark:text-slate-100">{selectedItem.sku}</p>
                      </div>
                      <div className="rounded-2xl bg-slate-50 dark:bg-slate-700/80 p-4">
                        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 dark:text-slate-300">Rack / ubicación</p>
                        <p className="mt-1 font-bold text-slate-900 dark:text-slate-100">{[selectedItem.rackName, selectedItem.rackColumn, selectedItem.rackCell].filter(Boolean).join(' / ') || selectedItem.locationName || 'Sin rack'}</p>
                      </div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-2xl bg-slate-50 dark:bg-slate-700/80 p-4">
                        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 dark:text-slate-300">Cantidad</p>
                        <div className="mt-1 flex items-center gap-2">
                          <p className={`font-black ${getStockState(selectedItem.stock) === 'critical' ? 'text-rose-600 dark:text-rose-400' : getStockState(selectedItem.stock) === 'low' ? 'text-amber-600 dark:text-amber-400' : 'text-slate-900 dark:text-slate-100'}`}>
                            {selectedItem.stock} {selectedItem.unitType || t('inventory.units')}
                          </p>
                          {getStockState(selectedItem.stock) !== 'normal' && (
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${getStockState(selectedItem.stock) === 'critical' ? 'bg-rose-50 dark:bg-rose-500/15 text-rose-600 dark:text-rose-300' : 'bg-amber-50 dark:bg-amber-500/15 text-amber-600 dark:text-amber-300'}`}>
                              {getStockState(selectedItem.stock) === 'critical' ? 'Stock crítico' : 'Stock bajo'}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="rounded-2xl bg-slate-50 dark:bg-slate-700/80 p-4">
                        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 dark:text-slate-300">Última actualización</p>
                        <p className="mt-1 font-bold text-slate-900 dark:text-slate-100">{formatDate(selectedItem.lastUpdate)}</p>
                      </div>
                    </div>
                  </div>
                )}
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Layout>
  );
};
