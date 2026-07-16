import React, { useState } from 'react';
import { BarChart2, Download, TrendingUp, TrendingDown, Package, ArrowDownCircle, ArrowUpCircle } from 'lucide-react';
import { Layout } from '../Components/Layout';
import { useTranslation } from '../utils/translations';
import { motion } from 'framer-motion';

const MOCK_STATS = [
  { label: 'Recepciones Hoy', value: '24', change: '+12%', up: true },
  { label: 'Salidas Hoy', value: '18', change: '+5%', up: true },
  { label: 'Precisión Inventario', value: '98.5%', change: '+0.3%', up: true },
  { label: 'Tiempo Promedio', value: '4.2 min', change: '-8%', up: false },
];

const MOCK_REPORTS = [
  { id: 1, name: 'Movimientos Diario', date: '18 Mayo 2026', type: 'Excel' },
  { id: 2, name: 'Inventario Actual', date: '18 Mayo 2026', type: 'PDF' },
  { id: 3, name: 'Órdenes Pendientes', date: '18 Mayo 2026', type: 'PDF' },
  { id: 4, name: 'KPI Operativos', date: 'Mayo 2026', type: 'Excel' },
];

export const Reports: React.FC = () => {
  const { t } = useTranslation();
  const [period, setPeriod] = useState('today');

  return (
    <Layout title={t('reports.title')}>
      <div className="space-y-6">
        {/* Period Selector */}
        <div className="flex gap-2 overflow-x-auto no-scrollbar">
          {[
            { id: 'today', label: 'Hoy' },
            { id: 'week', label: 'Semana' },
            { id: 'month', label: 'Mes' },
          ].map((p) => (
            <button
              key={p.id}
              onClick={() => setPeriod(p.id)}
              className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest whitespace-nowrap transition-all ${
                period === p.id ? 'bg-slate-900 text-white' : 'bg-white text-slate-500 border border-slate-100'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 gap-3">
          {MOCK_STATS.map((stat, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
              className="bg-white dark:bg-slate-800 dark:border-slate-700 dark:text-slate-100 p-4 rounded-3xl border border-slate-100 shadow-sm"
            >
              <p className="text-[10px] font-black text-slate-400 uppercase mb-1">{stat.label}</p>
              <div className="flex items-end justify-between">
                <span className="text-2xl font-black text-slate-900">{stat.value}</span>
                <div className={`flex items-center gap-1 text-[10px] font-bold ${stat.up ? 'text-emerald-600' : 'text-rose-600'}`}>
                  {stat.up ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                  <span>{stat.change}</span>
                </div>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Quick Charts Placeholder */}
        <div className="bg-white dark:bg-slate-800 dark:border-slate-700 dark:text-slate-100 p-6 rounded-[2.5rem] border border-slate-100 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-black text-slate-900">{t('reports.movements')}</h3>
            <BarChart2 size={20} className="text-slate-400" />
          </div>
          <div className="h-32 flex items-end justify-between gap-2 px-4">
            {[65, 45, 80, 55, 70, 90, 75].map((h, i) => (
              <div key={i} className="flex-1 bg-blue-100 rounded-t-lg relative" style={{ height: `${h}%` }}>
                <div className="absolute bottom-0 left-0 right-0 bg-blue-500 rounded-t-lg" style={{ height: '100%' }} />
              </div>
            ))}
          </div>
          <div className="flex justify-between mt-2 text-[10px] font-bold text-slate-400 uppercase">
            <span>Lun</span><span>Mar</span><span>Mié</span><span>Jue</span><span>Vie</span><span>Sáb</span><span>Dom</span>
          </div>
        </div>

        {/* Reports List */}
        <div className="space-y-3">
          <h3 className="text-xs font-black text-slate-400 uppercase ml-2">{t('reports.availableReports')}</h3>
          {MOCK_REPORTS.map((report, index) => (
            <motion.button
              key={report.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.05 }}
              className="w-full bg-white dark:bg-slate-800 dark:border-slate-700 dark:text-slate-100 p-4 rounded-[2rem] border border-slate-100 shadow-sm flex items-center justify-between active:scale-[0.98] transition-all"
            >
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center">
                  <Package size={20} className="text-slate-500" />
                </div>
                <div className="text-left">
                  <p className="text-sm font-black text-slate-900">{report.name}</p>
                  <p className="text-[10px] font-bold text-slate-400 uppercase">{report.date}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[10px] font-black text-blue-600 bg-blue-50 px-2 py-1 rounded-md uppercase">{report.type}</span>
                <Download size={18} className="text-slate-300" />
              </div>
            </motion.button>
          ))}
        </div>
      </div>
    </Layout>
  );
};