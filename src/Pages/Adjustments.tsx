import React, { useState } from 'react';
import { Settings2, Plus, Minus, Check, AlertCircle, Scan, X } from 'lucide-react';
import { Layout } from '../Components/Layout';
import { motion, AnimatePresence } from 'framer-motion';

const MOCK_ADJUSTMENTS = [
  { id: 'ADJ-001', sku: 'PROD-001', name: 'Caja de Herramientas', diff: +5, reason: 'Inventario físico', status: 'approved', date: '18 May' },
  { id: 'ADJ-002', sku: 'PROD-003', name: 'Casco de Seguridad', diff: -2, reason: 'Daño', status: 'pending', date: '17 May' },
];

export const Adjustments: React.FC = () => {
  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch] = useState('');

  return (
    <Layout title="Ajustes de Inventario">
      <AnimatePresence mode="wait">
        {showCreate ? (
          <motion.div
            key="create"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="space-y-6"
          >
            <div className="bg-white dark:bg-slate-800/95 p-5 rounded-[2rem] border border-slate-100 dark:border-slate-700 shadow-sm flex items-center gap-4">
              <div className="w-16 h-16 bg-slate-50 dark:bg-slate-700/70 rounded-2xl flex items-center justify-center">
                <Scan size={32} className="text-slate-400 dark:text-slate-300" />
              </div>
              <div>
                <p className="text-[10px] font-black text-slate-400 dark:text-slate-300 uppercase">Producto Escaneado</p>
                <h3 className="text-lg font-black text-slate-900 dark:text-slate-100">PROD-001</h3>
                <p className="text-xs font-bold text-slate-500 dark:text-slate-300">Caja de Herramientas</p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-black text-slate-500 dark:text-slate-300 uppercase ml-2">Ajuste de Cantidad</label>
                <div className="flex items-center gap-4 bg-white dark:bg-slate-800/95 p-2 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm">
                  <button className="w-14 h-14 bg-rose-100 text-rose-600 rounded-xl flex items-center justify-center font-black text-2xl active:scale-90 transition-all">
                    -
                  </button>
                  <div className="flex-1 text-center">
                    <input
                      type="number"
                      className="w-20 text-center text-3xl font-black text-slate-900 dark:text-slate-100 outline-none"
                      defaultValue={0}
                    />
                    <p className="text-[10px] font-bold text-slate-400 uppercase">unid.</p>
                  </div>
                  <button className="w-14 h-14 bg-emerald-100 text-emerald-600 rounded-xl flex items-center justify-center font-black text-2xl active:scale-90 transition-all">
                    +
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-black text-slate-500 dark:text-slate-300 uppercase ml-2">Motivo</label>
                <select className="w-full bg-white dark:bg-slate-800/95 border border-slate-100 dark:border-slate-700 rounded-2xl py-4 px-4 focus:border-blue-500 outline-none font-bold text-slate-700 dark:text-slate-100">
                  <option value="">Seleccione motivo...</option>
                  <option value="inventory">Conteo físico</option>
                  <option value="damage">Daño</option>
                  <option value="loss">Pérdida</option>
                  <option value="found">Mercancía encontrada</option>
                  <option value="other">Otro</option>
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-black text-slate-500 dark:text-slate-300 uppercase ml-2">Notas</label>
                <textarea
                  rows={3}
                  placeholder="Observaciones adicionales..."
                  className="w-full bg-white dark:bg-slate-800/95 border-2 border-slate-100 dark:border-slate-700 rounded-2xl py-4 px-4 focus:border-blue-500 outline-none font-medium resize-none text-slate-900 dark:text-slate-100"
                />
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowCreate(false)}
                className="flex-1 bg-white dark:bg-slate-800/95 border-2 border-slate-100 dark:border-slate-700 text-slate-600 dark:text-slate-200 py-5 rounded-2xl font-black uppercase tracking-widest active:scale-95 transition-all"
              >
                Cancelar
              </button>
              <button className="flex-1 bg-blue-600 text-white py-5 rounded-2xl font-black uppercase tracking-widest shadow-xl shadow-blue-500/20 active:scale-95 transition-all flex items-center justify-center gap-2">
                <span>Guardar</span>
                <Check size={18} />
              </button>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="list"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            className="space-y-4"
          >
            {MOCK_ADJUSTMENTS.map((adj, index) => (
              <motion.div
                key={adj.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
                className="bg-white dark:bg-slate-800/95 p-5 rounded-[2.5rem] border border-slate-100 dark:border-slate-700 shadow-sm flex items-center gap-4"
              >
                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${
                  adj.diff > 0 ? 'bg-emerald-100 text-emerald-600' : 'bg-rose-100 text-rose-600'
                }`}>
                  {adj.diff > 0 ? <Plus size={24} /> : <Minus size={24} />}
                </div>
                <div className="flex-1">
                  <div className="flex justify-between items-start mb-1">
                    <span className="text-[10px] font-black text-slate-400 dark:text-slate-300 uppercase">{adj.sku}</span>
                    <span className={`text-[9px] font-black uppercase px-2 py-1 rounded-md ${
                      adj.status === 'approved' ? 'bg-emerald-100 text-emerald-600' :
                      adj.status === 'pending' ? 'bg-amber-100 text-amber-600' :
                      'bg-rose-100 text-rose-600'
                    }`}>
                      {adj.status === 'approved' ? 'Aprobado' : 'Pendiente'}
                    </span>
                  </div>
                  <h3 className="text-sm font-black text-slate-900 dark:text-slate-100 mb-1">{adj.name}</h3>
                  <div className="flex items-center gap-3 text-[10px] font-bold text-slate-400 dark:text-slate-300 uppercase">
                    <span className={adj.diff > 0 ? 'text-emerald-600' : 'text-rose-600'}>
                      {adj.diff > 0 ? '+' : ''}{adj.diff} unidades
                    </span>
                    <span>•</span>
                    <span>{adj.reason}</span>
                  </div>
                </div>
              </motion.div>
            ))}

            <button
              onClick={() => setShowCreate(true)}
              className="fixed bottom-24 right-6 w-14 h-14 bg-blue-600 text-white rounded-2xl shadow-xl shadow-blue-500/40 flex items-center justify-center active:scale-90 transition-all"
            >
              <Plus size={28} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </Layout>
  );
};
