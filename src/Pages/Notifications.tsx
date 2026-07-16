import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, Check, X, AlertCircle, Package, Clock } from 'lucide-react';
import { Layout } from '../Components/Layout';
import { motion } from 'framer-motion';

const MOCK_NOTIFICATIONS = [
  { id: 1, type: 'alert', title: 'Stock Crítico', message: 'El producto PROD-003 tiene menos de 15 unidades', time: 'Hace 5 min', read: false },
  { id: 2, type: 'success', title: 'Orden Completada', message: 'La orden REC-9021 ha sido recibida completamente', time: 'Hace 15 min', read: false },
  { id: 3, type: 'info', title: 'Nueva Orden', message: 'Se ha asignado la orden PICK-4415 para picking', time: 'Hace 30 min', read: true },
  { id: 4, type: 'warning', title: 'Sincronización Pendiente', message: '3 movimientos sin sincronizar', time: 'Hace 1 hora', read: true },
];

export const Notifications: React.FC = () => {
  const navigate = useNavigate();
  const unreadCount = MOCK_NOTIFICATIONS.filter(n => !n.read).length;

  return (
    <Layout title="Notificaciones">
      <div className="space-y-4">
        <div className="flex justify-between items-center px-2">
          <p className="text-xs font-bold text-slate-500 uppercase">
            {unreadCount > 0 ? `${unreadCount} sin leer` : 'Todas leídas'}
          </p>
          <button className="text-xs font-bold text-blue-600 uppercase">Marcar todo</button>
        </div>

        {MOCK_NOTIFICATIONS.map((notif, index) => (
          <motion.div
            key={notif.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05 }}
            className={`bg-white p-5 rounded-[2rem] border-2 transition-all ${
              notif.read ? 'border-slate-100' : 'border-blue-100 bg-blue-50/30'
            }`}
          >
            <div className="flex gap-4">
              <div className={`w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 ${
                notif.type === 'alert' ? 'bg-rose-100 text-rose-600' :
                notif.type === 'success' ? 'bg-emerald-100 text-emerald-600' :
                notif.type === 'warning' ? 'bg-amber-100 text-amber-600' :
                'bg-blue-100 text-blue-600'
              }`}>
                {notif.type === 'alert' && <AlertCircle size={24} />}
                {notif.type === 'success' && <Check size={24} />}
                {notif.type === 'warning' && <Clock size={24} />}
                {notif.type === 'info' && <Bell size={24} />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex justify-between items-start mb-1">
                  <h3 className="text-sm font-black text-slate-900">{notif.title}</h3>
                  {!notif.read && (
                    <div className="w-2 h-2 bg-blue-500 rounded-full" />
                  )}
                </div>
                <p className="text-xs text-slate-500 font-medium mb-2 line-clamp-2">{notif.message}</p>
                <p className="text-[10px] font-bold text-slate-400 uppercase">{notif.time}</p>
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </Layout>
  );
};
