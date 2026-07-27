import React from 'react';
import { Bell, Check, AlertCircle, Clock } from 'lucide-react';
import { Layout } from '../Components/Layout';
import { motion } from 'framer-motion';

const formatTime = (timestamp) => {
  if (!timestamp) return '';
  return new Date(timestamp).toLocaleString([], { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
};

export const Notifications: React.FC = () => {
  const [notifications, setNotifications] = React.useState([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    const loadNotifications = async () => {
      setLoading(true);
      try {
        const response = await fetch('/api/notifications?limit=20');
        if (!response.ok) throw new Error('No fue posible cargar las notificaciones');
        const data = await response.json();
        setNotifications(Array.isArray(data.notifications) ? data.notifications : []);
      } catch (error) {
        console.error(error);
        setNotifications([]);
      } finally {
        setLoading(false);
      }
    };

    loadNotifications();
  }, []);

  const unreadCount = notifications.length;

  const getIcon = (type) => {
    if (type === 'alert') return <AlertCircle size={24} />;
    if (type === 'success') return <Check size={24} />;
    if (type === 'warning') return <Clock size={24} />;
    return <Bell size={24} />;
  };

  const getBadgeClasses = (type) => {
    if (type === 'alert') return 'bg-rose-100 text-rose-600 border-rose-200 dark:bg-rose-900/30 dark:text-rose-300 dark:border-rose-800';
    if (type === 'success') return 'bg-emerald-100 text-emerald-600 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800';
    if (type === 'warning') return 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800';
    return 'bg-sky-100 text-sky-600 border-sky-200 dark:bg-slate-800/60 dark:text-sky-300 dark:border-slate-700';
  };

  const getCardClasses = (type) => {
    if (type === 'alert') return 'border-rose-200 bg-rose-50/80 dark:border-rose-800 dark:bg-rose-950/60';
    if (type === 'success') return 'border-emerald-200 bg-emerald-50/80 dark:border-emerald-800 dark:bg-emerald-950/50';
    if (type === 'warning') return 'border-amber-200 bg-amber-50/80 dark:border-amber-800 dark:bg-amber-950/50';
    return 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900';
  };

  return (
    <Layout title="Notificaciones">
      <div className="space-y-4">
        <div className="flex justify-between items-center px-2">
          <p className="text-xs font-bold text-slate-500 uppercase">
            {loading ? 'Cargando...' : unreadCount > 0 ? `${unreadCount} notificaciones` : 'No hay notificaciones'}
          </p>
          <button className="text-xs font-bold text-blue-600 uppercase">Marcar todo</button>
        </div>

        {loading ? (
          <div className="rounded-3xl border border-slate-200 bg-slate-50 p-6 text-sm text-slate-500 text-center">
            Cargando notificaciones...
          </div>
        ) : notifications.length === 0 ? (
          <div className="rounded-3xl border border-slate-200 bg-slate-50 p-6 text-sm text-slate-500 text-center">
            No hay notificaciones recientes.
          </div>
        ) : (
          notifications.map((notif, index) => (
            <motion.div
              key={notif.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.03 }}
              className={`p-5 rounded-[2rem] border-2 ${getCardClasses(notif.type)}`}
            >
              <div className="flex gap-4">
                <div className={`w-12 h-12 rounded-2xl border flex items-center justify-center flex-shrink-0 ${getBadgeClasses(notif.type)}`}>
                  {getIcon(notif.type)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-start mb-1">
                    <h3 className="text-sm font-black text-slate-900 dark:text-slate-100 truncate">{notif.title}</h3>
                    <span className="text-[10px] font-bold text-slate-400 dark:text-slate-400 uppercase">{formatTime(notif.timestamp)}</span>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-300 font-medium mb-2 line-clamp-2">{notif.message}</p>
                  {notif.details && (
                    <div className="text-[11px] text-slate-400 dark:text-slate-400 space-y-1">
                      {notif.details.sourceLocation && <p>Origen: {notif.details.sourceLocation}</p>}
                      {notif.details.destinationLocation && <p>Destino: {notif.details.destinationLocation}</p>}
                      {notif.details.quantity !== undefined && <p>Cantidad: {notif.details.quantity}</p>}
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          ))
        )}
      </div>
    </Layout>
  );
};
