import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { 
  Home, 
  Scan, 
  Package, 
  BarChart2, 
  Bell, 
  Settings, 
  Menu,
  X,
  LogOut,
  Wifi,
  WifiOff,
  Battery,
  User
} from 'lucide-react';
import useAuthStore from '../store/useAuthStore';
import { motion, AnimatePresence } from 'framer-motion';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { getTranslation } from '../utils/translations';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface LayoutProps {
  children: React.ReactNode;
  title?: string;
  showNav?: boolean;
}

export const Layout: React.FC<LayoutProps> = ({ children, title, showNav = true }) => {
  const { user, logout, isOffline, language } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [isSidebarOpen, setIsSidebarOpen] = React.useState(false);

  const navItems = [
    { icon: Home, label: getTranslation(language, 'nav.home'), path: '/' },
    { icon: Scan, label: getTranslation(language, 'nav.scanner'), path: '/scanner' },
    { icon: Package, label: getTranslation(language, 'nav.inventory'), path: '/inventory' },
    { icon: BarChart2, label: getTranslation(language, 'nav.reports'), path: '/reports' },
    { icon: Bell, label: getTranslation(language, 'nav.notifications'), path: '/notifications' },
    { icon: Settings, label: getTranslation(language, 'nav.settings'), path: '/settings' },
  ];

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="flex flex-col h-screen bg-white text-slate-900 font-sans overflow-hidden dark:bg-slate-950 dark:text-slate-100">
      {/* Status Bar */}
      <div className="bg-slate-900 text-slate-200 px-4 py-1 flex justify-between items-center text-[10px] font-medium uppercase tracking-wider border-b border-slate-800 shadow-none">
        <div className="flex items-center gap-2">
          {isOffline ? <WifiOff size={12} className="text-rose-400" /> : <Wifi size={12} className="text-emerald-400" />}
          <span>{isOffline ? getTranslation(language, 'common.offline') : getTranslation(language, 'common.online')}</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <Battery size={12} className="text-emerald-400" />
            <span>85%</span>
          </div>
          <span>{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
      </div>

      {/* Header */}
      <header className="bg-slate-900 border-b border-slate-800 px-4 py-3 flex items-center justify-between shadow-none z-10">
        <div className="flex items-center gap-3 min-w-0 flex-1 overflow-hidden">
          {showNav && (
            <button 
              onClick={() => setIsSidebarOpen(true)}
              className="p-2 hover:bg-slate-800 rounded-lg transition-colors active:scale-95 flex-shrink-0"
            >
              <Menu size={24} className="text-white" />
            </button>
          )}
          <div className="flex items-center gap-3 rounded-2xl bg-slate-950/95 px-3 py-2 border border-slate-800 shadow-[0_1px_2px_rgba(0,0,0,0.25)] min-w-0 flex-1 max-w-full">
            <img
              src="/src/assets/keumgang.png"
              alt="Keumgang logo"
              className="h-9 w-auto max-w-[110px] object-contain flex-shrink-0"
            />
            <div className="min-w-0 text-left flex-1 overflow-hidden">
              <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-slate-400 leading-none">PDA</p>
              <h1 className="text-sm font-black truncate text-slate-50 text-left leading-tight">
                {title || 'Dashboard'}
              </h1>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 ml-2">
          <div className="bg-slate-800 p-2 rounded-full">
            <User size={20} className="text-slate-200" />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto relative dark:bg-slate-950">
        <AnimatePresence mode="wait">
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            className="p-4 pb-24 dark:bg-slate-950"
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Bottom Navigation (Mobile PDA style) */}
      {showNav && (
        <nav className="bg-white border-t border-slate-200 flex justify-around items-center py-2 px-1 fixed bottom-0 left-0 right-0 shadow-[0_-1px_1px_rgba(15,23,42,0.05)] z-10 dark:bg-slate-950 dark:border-slate-800 dark:shadow-[0_-1px_1px_rgba(0,0,0,0.35)]">
          {navItems.slice(0, 4).map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <button
                key={item.path}
                onClick={() => navigate(item.path)}
                className={cn(
                  "flex flex-col items-center gap-1 p-2 rounded-xl transition-all active:scale-90",
                  isActive
                    ? "text-blue-600 bg-blue-50 dark:text-blue-400 dark:bg-slate-800"
                    : "text-slate-500 dark:text-slate-400"
                )}
              >
                <item.icon size={22} strokeWidth={isActive ? 2 : 1.5} />
                <span className="text-[10px] font-semibold uppercase">{item.label}</span>
              </button>
            );
          })}
        </nav>
      )}

      {/* Sidebar Overlay */}
      <AnimatePresence>
        {isSidebarOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsSidebarOpen(false)}
              className="fixed inset-0 bg-black/30 z-40 backdrop-blur-sm"
            />
            <motion.aside
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed inset-y-0 left-0 w-80 bg-white/95 z-50 shadow-[0_6px_18px_rgba(15,23,42,0.08)] flex flex-col dark:bg-slate-950/95"
            >
              <div className="p-6 border-b border-slate-200 flex justify-between items-center bg-slate-900 text-slate-100 dark:border-slate-800 dark:bg-slate-900">
                <div>
                  <p className="text-[10px] font-black text-sky-400 uppercase tracking-[0.25em] mb-1">Operador Activo</p>
                  <h2 className="text-xl font-black">{user?.name || 'Usuario'}</h2>
                  <p className="text-xs text-slate-400">{user?.role.toUpperCase()} • ID: {user?.employeeId}</p>
                </div>
                <button 
                  onClick={() => setIsSidebarOpen(false)}
                  className="p-2 hover:bg-slate-100 rounded-full transition-colors"
                >
                  <X size={24} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto py-4">
                {navItems.map((item) => {
                  const isActive = location.pathname === item.path;
                  return (
                    <button
                      key={item.path}
                      onClick={() => {
                        navigate(item.path);
                        setIsSidebarOpen(false);
                      }}
                      className={cn(
                        "mx-3 mb-2 flex items-center gap-4 rounded-2xl px-5 py-4 transition-all",
                        isActive ? "bg-blue-50 text-blue-600 dark:bg-slate-800 dark:text-blue-400" : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-900"
                      )}
                    >
                      <item.icon size={20} />
                      <span className="font-semibold">{item.label}</span>
                    </button>
                  );
                })}
              </div>

              <div className="p-4 border-t border-slate-200/60 dark:border-slate-800">
                <button
                  onClick={handleLogout}
                  className="w-full flex items-center gap-4 px-5 py-4 text-rose-500 hover:bg-rose-100 rounded-2xl transition-colors font-semibold"
                >
                  <LogOut size={22} />
                  <span>Cerrar Sesión</span>
                </button>
                <p className="text-center text-[10px] text-slate-500 mt-4 font-medium">
                  v1.0.0 • PDA WMS
                </p>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </div>
  );
};
