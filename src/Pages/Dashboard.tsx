import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  ArrowDownCircle, 
  ArrowUpCircle, 
  Package, 
  Trash2, 
  FileText, 
  RefreshCw, 
  ClipboardList, 
  MoveHorizontal,
  Settings2,
  History,
  AlertTriangle
} from 'lucide-react';
import { Layout } from '../Components/Layout';
import { useTranslation } from '../utils/translations';
import { motion } from 'framer-motion';
import { notifyAppRefresh, useAppRefresh } from '../utils/realtime';

const modules = (t: (k: string) => string) => [
  { id: 'inbound', label: t('dashboard.entry'), icon: ArrowDownCircle, color: 'bg-emerald-500', path: '/orders/inbound' },
  { id: 'outbound', label: t('dashboard.exit'), icon: ArrowUpCircle, color: 'bg-blue-500', path: '/orders/outbound' },
  { id: 'inventory', label: t('dashboard.inventory'), icon: Package, color: 'bg-amber-500', path: '/inventory' },
  { id: 'merma', label: t('dashboard.scrap'), icon: Trash2, color: 'bg-rose-500', path: '/merma' },
  { id: 'requests', label: t('dashboard.requests'), icon: FileText, color: 'bg-indigo-500', path: '/requests' },
  { id: 'cyclic', label: t('dashboard.cyclic'), icon: RefreshCw, color: 'bg-cyan-500', path: '/inventory/cyclic' },
  { id: 'transfers', label: t('dashboard.transfers'), icon: MoveHorizontal, color: 'bg-violet-500', path: '/transfers' },
  { id: 'adjustments', label: t('dashboard.damage'), icon: Settings2, color: 'bg-slate-500', path: '/adjustments' },
  { id: 'history', label: t('dashboard.history'), icon: History, color: 'bg-slate-700', path: '/history' },
];

interface RecentActivityItem {
  id: string;
  type: string;
  ref?: string;
  provider?: string;
  receiver?: string;
  createdAt?: string;
  receivedAt?: string;
  description?: string;
  status?: string;
}

export const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [dashboardData, setDashboardData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [recentActivities, setRecentActivities] = useState<RecentActivityItem[]>([]);
  const [activitiesLoading, setActivitiesLoading] = useState(true);

  const loadDashboard = async (showLoading = true) => {
    try {
      if (showLoading) {
        setLoading(true);
      }
      const response = await fetch('/api/dashboard');
      if (!response.ok) throw new Error('No fue posible cargar el dashboard');
      const data = await response.json();
      setDashboardData(data);
    } catch (err) {
      if (showLoading) {
        setDashboardData(null);
      }
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  };

  const loadRecentActivities = async (showLoading = true) => {
    try {
      if (showLoading) {
        setActivitiesLoading(true);
      }
      const response = await fetch('/api/history/inbound?limit=3');
      if (!response.ok) throw new Error('No fue posible cargar la actividad reciente');
      const data = await response.json();
      setRecentActivities(Array.isArray(data.history) ? data.history : []);
    } catch (err) {
      if (showLoading) {
        setRecentActivities([]);
      }
    } finally {
      if (showLoading) {
        setActivitiesLoading(false);
      }
    }
  };

  useEffect(() => {
    void loadDashboard();
    void loadRecentActivities();
  }, []);

  useAppRefresh(() => {
    void loadDashboard(false);
    void loadRecentActivities(false);
  }, 10000);

  const criticalItems = useMemo(() => {
    return dashboardData?.inventory?.criticalItems ?? 0;
  }, [dashboardData]);

  const pendingOrders = useMemo(() => {
    return dashboardData?.inboundReceipts ?? 0;
  }, [dashboardData]);

  const getActivityMeta = (item: RecentActivityItem) => {
    switch (item.type) {
      case 'inbound':
        return {
          icon: ArrowDownCircle,
          iconClass: 'bg-emerald-500/20 text-emerald-400',
          label: t('dashboard.entry'),
        };
      case 'outbound':
        return {
          icon: ArrowUpCircle,
          iconClass: 'bg-blue-500/20 text-blue-400',
          label: t('dashboard.exit'),
        };
      case 'adjustment':
        return {
          icon: Settings2,
          iconClass: 'bg-amber-500/20 text-amber-400',
          label: t('dashboard.adjustment'),
        };
      case 'transfer':
        return {
          icon: MoveHorizontal,
          iconClass: 'bg-violet-500/20 text-violet-400',
          label: t('dashboard.transfers'),
        };
      case 'scrap':
        return {
          icon: Trash2,
          iconClass: 'bg-rose-500/20 text-rose-400',
          label: t('dashboard.scrap'),
        };
      case 'cyclic':
        return {
          icon: RefreshCw,
          iconClass: 'bg-cyan-500/20 text-cyan-400',
          label: t('dashboard.cyclic'),
        };
      default:
        return {
          icon: History,
          iconClass: 'bg-slate-500/20 text-slate-300',
          label: t('dashboard.history'),
        };
    }
  };

  const formatActivityTime = (value?: string) => {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    const diffMinutes = Math.max(1, Math.round((Date.now() - date.getTime()) / 60000));
    if (diffMinutes < 60) return `Hace ${diffMinutes} min`;
    const diffHours = Math.round(diffMinutes / 60);
    if (diffHours < 24) return `Hace ${diffHours} h`;
    const diffDays = Math.round(diffHours / 24);
    return `Hace ${diffDays} d`;
  };

  return (
    <Layout title={t('dashboard.title')}>
      <div className="space-y-6">
        {/* Quick Stats / Alerts */}
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => navigate('/orders/inbound?status=Pendiente%20de%20entrega')}
            className="bg-white/95 dark:bg-slate-800/95 dark:border-slate-700 dark:shadow-slate-950/30 p-4 rounded-3xl border border-slate-200/90 shadow-[0_6px_18px_rgba(15,23,42,0.06)] text-left"
          >
            <p className="text-[10px] font-black text-slate-400 dark:text-slate-300 uppercase tracking-wider mb-1">{t('dashboard.pending')}</p>
            <div className="flex items-end justify-between">
              <span className="text-2xl font-black text-slate-900 dark:text-slate-100">{loading ? '…' : pendingOrders}</span>
              <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/15 px-2 py-1 rounded-lg">{t('dashboard.orders')}</span>
            </div>
          </button>
          <button
            type="button"
            onClick={() => navigate('/inventory?filter=critical')}
            className="bg-white/95 dark:bg-slate-800/95 dark:border-slate-700 dark:shadow-slate-950/30 p-4 rounded-3xl border border-slate-200/90 shadow-[0_6px_18px_rgba(15,23,42,0.06)] text-left"
          >
            <p className="text-[10px] font-black text-slate-400 dark:text-slate-300 uppercase tracking-wider mb-1">Stock Crítico</p>
            <div className="flex items-end justify-between">
              <span className="text-2xl font-black text-rose-600 dark:text-rose-400">{loading ? '…' : criticalItems}</span>
              <AlertTriangle size={16} className="text-rose-500 dark:text-rose-400 mb-1" />
            </div>
          </button>
        </div>

        {/* Modules Grid */}
        <div className="grid grid-cols-3 gap-3">
          {modules(t).map((mod, index) => (
            <motion.button
              key={mod.id}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: index * 0.05 }}
              onClick={() => navigate(mod.path)}
              className="flex flex-col items-center justify-center aspect-square bg-white/95 dark:bg-slate-800/95 dark:border-slate-700 dark:text-slate-100 rounded-[2rem] border border-slate-200/90 shadow-[0_6px_18px_rgba(15,23,42,0.06)] active:scale-90 active:bg-slate-50 dark:active:bg-slate-700 transition-all group"
            >
              <div className={`w-12 h-12 ${mod.color} rounded-2xl flex items-center justify-center mb-2 shadow-lg shadow-${mod.color.split('-')[1]}-500/20 group-active:scale-110 transition-transform`}>
                <mod.icon size={24} className="text-white" />
              </div>
              <span className="text-[10px] font-black text-slate-700 dark:text-slate-200 uppercase text-center px-2 leading-tight">
                {mod.label}
              </span>
            </motion.button>
          ))}
        </div>

        {/* Recent Activity Section */}
        <div className="bg-slate-900 rounded-[2.5rem] p-6 text-white shadow-xl">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-sm font-black uppercase tracking-widest">{t('dashboard.recentActivity')}</h3>
            <button
              type="button"
              onClick={() => navigate('/history')}
              className="text-[10px] font-bold text-blue-400 uppercase"
            >
              {t('dashboard.viewAll')}
            </button>
          </div>
          <div className="space-y-4">
            {activitiesLoading ? (
              <div className="text-sm text-slate-400">Cargando eventos...</div>
            ) : recentActivities.length === 0 ? (
              <div className="text-sm text-slate-400">No hay eventos recientes.</div>
            ) : recentActivities.map((item) => {
              const meta = getActivityMeta(item);
              const Icon = meta.icon;
              return (
                <div key={item.id} className="flex items-center justify-between border-b border-white/10 pb-3 last:border-0 last:pb-0">
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center ${meta.iconClass}`}>
                      <Icon size={16} />
                    </div>
                    <div>
                      <p className="text-xs font-bold">{item.ref || `#${item.id}`}</p>
                      <p className="text-[10px] text-slate-400">
                        {item.description || item.provider || item.receiver || meta.label} • {formatActivityTime(item.receivedAt || item.createdAt)}
                      </p>
                    </div>
                  </div>
                  <span className="max-w-[120px] truncate text-[9px] font-black uppercase px-2 py-1 rounded-md bg-slate-800 text-slate-300">
                    {item.status || meta.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </Layout>
  );
};
