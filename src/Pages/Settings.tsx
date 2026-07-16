import React from 'react';
import { 
  Settings as SettingsIcon, 
  Globe, 
  Moon, 
  Sun, 
  Database, 
  Smartphone, 
  RefreshCw, 
  Shield, 
  Info,
  ChevronRight,
  LogOut,
  Wifi
} from 'lucide-react';
import { Layout } from '../Components/Layout';
import useAuthStore from '../store/useAuthStore';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { getTranslation } from '../utils/translations';

export const Settings: React.FC = () => {
  const { logout, isOffline, setOffline, darkMode, setDarkMode, language, setLanguage } = useAuthStore();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const handleDarkModeToggle = () => {
    setDarkMode(!darkMode);
  };

  const handleLanguageChange = () => {
    const languages: Array<'es' | 'en' | 'ko'> = ['es', 'en', 'ko'];
    const currentIndex = languages.indexOf(language);
    const nextIndex = (currentIndex + 1) % languages.length;
    setLanguage(languages[nextIndex]);
  };

  const sections = [
    {
      title: getTranslation(language, 'settings.connectivity'),
      items: [
        { 
          icon: Wifi, 
          label: getTranslation(language, 'settings.offlineMode'), 
          value: isOffline ? getTranslation(language, 'settings.activated') : getTranslation(language, 'settings.deactivated'),
          action: () => setOffline(!isOffline),
          toggle: true,
          active: isOffline
        },
        { 
          icon: Database, 
          label: getTranslation(language, 'settings.apiServer'), 
          value: 'https://api.warehouse.pro',
          action: () => {}
        },
        { 
          icon: RefreshCw, 
          label: getTranslation(language, 'settings.manualSync'), 
          value: 'Hace 10 min',
          action: () => {}
        },
      ]
    },
    {
      title: getTranslation(language, 'settings.preferences'),
      items: [
        { 
          icon: Globe, 
          label: getTranslation(language, 'settings.language'), 
          value: language === 'es' ? getTranslation(language, 'settings.spanish') : language === 'en' ? getTranslation(language, 'settings.english') : getTranslation(language, 'settings.korean'),
          action: handleLanguageChange
        },
        { 
          icon: darkMode ? Moon : Sun, 
          label: getTranslation(language, 'settings.theme'), 
          value: darkMode ? getTranslation(language, 'settings.darkTheme') : getTranslation(language, 'settings.lightTheme'),
          action: handleDarkModeToggle,
          toggle: true,
          active: darkMode
        },
      ]
    },
    {
      title: getTranslation(language, 'settings.device'),
      items: [
        { 
          icon: Smartphone, 
          label: getTranslation(language, 'settings.pdaInfo'), 
          value: 'Zebra TC22',
          action: () => {}
        },
        { 
          icon: SettingsIcon, 
          label: getTranslation(language, 'settings.scannerConfig'), 
          value: getTranslation(language, 'settings.activeLaser'),
          action: () => {}
        },
      ]
    },
    {
      title: getTranslation(language, 'settings.system'),
      items: [
        { 
          icon: Shield, 
          label: getTranslation(language, 'settings.security'), 
          value: getTranslation(language, 'settings.administrator'),
          action: () => {}
        },
        { 
          icon: Info, 
          label: getTranslation(language, 'settings.about'), 
          value: getTranslation(language, 'settings.version'),
          action: () => {}
        },
      ]
    }
  ];

  return (
    <Layout title={getTranslation(language, 'settings.title')}>
      <div className="space-y-8 pb-12">
        {sections.map((section, i) => (
          <div key={i} className="space-y-3">
            <h3 className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-[0.2em] ml-4">
              {section.title}
            </h3>
            <div className="bg-white dark:bg-slate-800 rounded-[2rem] border border-slate-100 dark:border-slate-700 shadow-sm overflow-hidden">
              {section.items.map((item, j) => (
                <button
                  key={j}
                  onClick={item.action}
                  className={`w-full flex items-center justify-between p-5 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors border-b border-slate-50 dark:border-slate-700 last:border-0 active:bg-slate-100 dark:active:bg-slate-700`}
                >
                  <div className="flex items-center gap-4">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${item.active ? 'bg-blue-600 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400'}`}>
                      <item.icon size={20} />
                    </div>
                    <div className="text-left">
                      <p className="text-sm font-black text-slate-900 dark:text-slate-50">{item.label}</p>
                      <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase">{item.value}</p>
                    </div>
                  </div>
                  {item.toggle ? (
                    <div className={`w-12 h-6 rounded-full p-1 transition-colors ${item.active ? 'bg-blue-600' : 'bg-slate-200 dark:bg-slate-600'}`}>
                      <div className={`w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${item.active ? 'translate-x-6' : 'translate-x-0'}`} />
                    </div>
                  ) : (
                    <ChevronRight size={18} className="text-slate-300 dark:text-slate-600" />
                  )}
                </button>
              ))}
            </div>
          </div>
        ))}

        <button
          onClick={handleLogout}
          className="w-full bg-rose-50 dark:bg-rose-950 text-rose-600 dark:text-rose-400 py-5 rounded-[2rem] font-black uppercase tracking-widest flex items-center justify-center gap-3 active:scale-95 transition-all border-2 border-rose-100 dark:border-rose-800"
        >
          <LogOut size={22} />
          <span>{getTranslation(language, 'common.closeSession')}</span>
        </button>

        <div className="text-center space-y-1">
          <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase">{getTranslation(language, 'settings.footer')}</p>
          <p className="text-[9px] font-medium text-slate-300 dark:text-slate-600 uppercase tracking-widest">{getTranslation(language, 'settings.copyright')}</p>
        </div>
      </div>
    </Layout>
  );
};
