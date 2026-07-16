import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Lock, 
  User, 
  QrCode, 
  ChevronRight,
  AlertCircle,
  Settings,
  Database,
  Globe,
  Moon,
  Sun,
  Info,
  Key,
  X,
} from 'lucide-react';
import useAuthStore from '../store/useAuthStore';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from '../utils/translations';
import KeumgangLogoPng from '../assets/keumgang.png';

type LoginMethod = 'password' | 'pin' | 'qr';

const KeumgangLogo: React.FC = () => (
  <div className="mx-auto mb-3 w-full max-w-[420px] overflow-hidden shadow-2xl shadow-slate-950/20">
    <img src={KeumgangLogoPng} alt="Keumgang Mexico" className="w-full h-auto block" />
  </div>
);

export const Login: React.FC = () => {
  const [method, setMethod] = useState<LoginMethod>('password');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [configStep, setConfigStep] = useState<'auth' | 'edit'>('auth');
  const [adminPassword, setAdminPassword] = useState('');
  const [configError, setConfigError] = useState('');
  const [isConfigLoading, setIsConfigLoading] = useState(false);
  const [serverConfig, setServerConfig] = useState({
    dbHost: '',
    dbPort: '',
    dbUser: '',
    dbPassword: '',
    dbName: '',
    apiHost: '',
    apiPort: '',
    apiBaseUrl: '',
  });
  const { login, darkMode, setDarkMode, setLanguage } = useAuthStore();
  const { t, language } = useTranslation();
  const navigate = useNavigate();

  const handleLogin = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setIsLoading(true);
    setError('');
    try {
      const resp = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: username, password }),
      });

      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        setError(body.message || t('login.invalidCredentials'));
        setIsLoading(false);
        return;
      }

      const data = await resp.json();
      login({
        id: String(data.id),
        name: data.name,
        role: (data.role || 'operator') as any,
        employeeId: data.employeeId || '',
      });
      navigate('/');
    } catch (err) {
      setError(t('login.invalidCredentials'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenConfig = () => {
    setShowConfig(true);
    setConfigStep('auth');
    setAdminPassword('');
    setConfigError('');
  };

  const handleCloseConfig = () => {
    setShowConfig(false);
    setConfigStep('auth');
    setAdminPassword('');
    setConfigError('');
  };

  const handleConfigAuth = async () => {
    setConfigError('');
    setIsConfigLoading(true);
    try {
      const resp = await fetch('/api/server-config/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: adminPassword }),
      });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        setConfigError(body.message || t('login.configInvalidPassword'));
        return;
      }
      const data = await resp.json();
      setServerConfig({
        dbHost: data.dbHost || '',
        dbPort: data.dbPort || '',
        dbUser: data.dbUser || '',
        dbPassword: data.dbPassword || '',
        dbName: data.dbName || '',
        apiHost: data.apiHost || '',
        apiPort: data.apiPort || '',
        apiBaseUrl: data.apiBaseUrl || '',
      });
      setConfigStep('edit');
    } catch (err) {
      setConfigError(t('login.configInvalidPassword'));
    } finally {
      setIsConfigLoading(false);
    }
  };

  const handleSaveConfig = async () => {
    setConfigError('');
    setIsConfigLoading(true);
    try {
      const resp = await fetch('/api/server-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: adminPassword, values: serverConfig }),
      });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        setConfigError(body.message || t('login.configSaveError'));
        return;
      }
      setConfigError('');
      setShowConfig(false);
      setConfigStep('auth');
    } catch (err) {
      setConfigError(t('login.configSaveError'));
    } finally {
      setIsConfigLoading(false);
    }
  };

  const handleLanguageSelect = (lang: 'es' | 'en' | 'ko') => {
    setLanguage(lang);
  };

  const handleThemeToggle = () => {
    setDarkMode(!darkMode);
  };

  const renderMethodSelector = () => (
    <div className="flex gap-2 mb-8 bg-slate-100 p-1 rounded-2xl">
      {(['password', 'pin', 'qr'] as LoginMethod[]).map((m) => {
        const isDisabled = m !== 'password';
        return (
          <button
            key={m}
            type="button"
            onClick={() => {
              if (isDisabled) return;
              setMethod(m);
              setError('');
            }}
            disabled={isDisabled}
            className={`flex-1 py-3 rounded-xl text-xs font-bold uppercase transition-all ${
              method === m 
                ? 'bg-white text-blue-600 shadow-sm' 
                : 'text-slate-500 hover:text-slate-700'
            } ${isDisabled ? 'cursor-not-allowed opacity-50' : ''}`}
          >
            {m === 'password' && t('login.methodPassword')}
            {m === 'pin' && `${t('login.methodPin')} • Próximamente`}
            {m === 'qr' && `${t('login.methodQR')} • Próximamente`}
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col p-6 text-white">
      <div className="flex-1 flex flex-col justify-center max-w-md mx-auto w-full">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8 text-center"
        >
          <KeumgangLogo />
          <h1 className="text-3xl font-black tracking-tight mb-1">{t('login.title')}</h1>
          <p className="text-slate-400 font-medium">{t('login.subtitle')}</p>
        </motion.div>
        <button
          type="button"
          onClick={handleOpenConfig}
          className="fixed right-6 top-6 z-50 p-3 rounded-full bg-slate-800 text-white shadow-lg hover:bg-slate-700"
          aria-label={t('login.configTitle')}
        >
          <Settings size={22} />
        </button>

        <div className="bg-white rounded-[2.5rem] p-8 text-slate-900 shadow-2xl">
          {renderMethodSelector()}

          <AnimatePresence mode="wait">
            {method === 'password' && (
              <motion.form 
                key="password"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                onSubmit={handleLogin}
                className="space-y-4"
              >
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase ml-1">{t('login.username')}</label>
                  <div className="relative">
                    <User className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
                    <input
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder={t('login.placeholderUser')}
                      className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl py-4 pl-12 pr-4 focus:border-blue-500 focus:bg-white outline-none transition-all font-medium text-slate-900 dark:text-slate-200"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase ml-1">{t('login.password')}</label>
                  <div className="relative">
                    <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={t('login.placeholderPassword')}
                      className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl py-4 pl-12 pr-4 focus:border-blue-500 focus:bg-white outline-none transition-all font-medium text-slate-900 dark:text-slate-200"
                    />
                  </div>
                </div>
              </motion.form>
            )}

            {method === 'pin' && (
              <motion.div 
                key="pin"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-6"
              >
                <div className="flex justify-center gap-3">
                  {[0, 1, 2, 3].map((i) => (
                    <div 
                      key={i}
                      className={`w-4 h-4 rounded-full border-2 transition-all duration-300 ${
                        pin.length > i ? 'bg-blue-600 border-blue-600 scale-125' : 'bg-slate-100 border-slate-200'
                      }`}
                    />
                  ))}
                </div>
                <div className="grid grid-cols-3 gap-3">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 'C', 0, 'OK'].map((val) => (
                    <button
                      key={val}
                      onClick={() => {
                        if (val === 'C') setPin('');
                        else if (val === 'OK') handleLogin();
                        else if (pin.length < 4) setPin(prev => prev + val);
                      }}
                      className={`h-16 rounded-2xl font-black text-xl flex items-center justify-center active:scale-90 transition-all ${
                        val === 'OK' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                      }`}
                    >
                      {val}
                    </button>
                  ))}
                </div>
              </motion.div>
            )}

            {method === 'qr' && (
              <motion.div 
                key="qr"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="text-center space-y-6 py-4"
              >
                <div className="w-48 h-48 bg-slate-100 rounded-3xl mx-auto flex items-center justify-center border-4 border-dashed border-slate-200 relative overflow-hidden group cursor-pointer" onClick={handleLogin}>
                  <QrCode size={80} className="text-slate-300 group-hover:text-blue-500 transition-colors" />
                  <div className="absolute inset-0 bg-blue-600/5 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <p className="text-blue-600 font-bold text-xs uppercase">{t('login.scanBadge')}</p>
                  </div>
                </div>
                <p className="text-sm text-slate-500 font-medium">{t('login.qrInfo')}</p>
              </motion.div>
            )}
          </AnimatePresence>

          {error && (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-6 p-4 bg-red-50 text-red-600 rounded-2xl flex items-center gap-3 text-sm font-bold"
            >
              <AlertCircle size={20} />
              <span>{error}</span>
            </motion.div>
          )}

          {method === 'password' && (
            <button
              onClick={handleLogin}
              disabled={isLoading}
              className="w-full mt-8 bg-slate-900 text-white py-5 rounded-2xl font-black uppercase tracking-widest flex items-center justify-center gap-3 active:scale-95 transition-all disabled:opacity-50 shadow-xl shadow-slate-900/20"
            >
              {isLoading ? (
                <span>{t('login.loading')}</span>
              ) : (
                <span>{t('login.login')}</span>
              )}
            </button>
          )}

          {method === 'qr' && (
            <button
              onClick={handleLogin}
              className="w-full mt-8 bg-slate-900 text-white py-5 rounded-2xl font-black uppercase tracking-widest flex items-center justify-center gap-3 active:scale-95 transition-all shadow-xl shadow-slate-900/20"
            >
              <span>{t('login.scanner')}</span>
              <ChevronRight size={18} />
            </button>
          )}
        </div>
      </div>

      {showConfig && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-4xl rounded-[2rem] bg-white dark:bg-slate-950 shadow-2xl max-h-[90vh] overflow-auto">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 p-5 sticky top-0 bg-white dark:bg-slate-950 z-10">
              <div>
                <h2 className="text-xl font-black text-slate-900 dark:text-white">{t('login.configTitle')}</h2>
                <p className="text-sm text-slate-500 dark:text-slate-400">{t('login.configSubtitle')}</p>
              </div>
              <button
                type="button"
                onClick={handleCloseConfig}
                className="rounded-full p-3 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-6 space-y-6">
              {configStep === 'auth' ? (
                <div className="space-y-4">
                  <p className="text-sm text-slate-600 dark:text-slate-300">{t('login.configAccessTitle')}</p>
                  <div className="space-y-2">
                    <label className="block text-xs uppercase font-bold text-slate-500">{t('login.configPasswordPrompt')}</label>
                    <div className="relative">
                      <Key className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                      <input
                        type="password"
                        value={adminPassword}
                        onChange={(e) => setAdminPassword(e.target.value)}
                        placeholder={t('login.configPasswordPlaceholder')}
                        className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl py-4 pl-12 pr-4 focus:border-blue-500 outline-none transition-all text-slate-900 dark:text-slate-200"
                      />
                    </div>
                  </div>
                  {configError && <p className="text-sm text-rose-600">{configError}</p>}
                  <button
                    type="button"
                    onClick={handleConfigAuth}
                    disabled={!adminPassword || isConfigLoading}
                    className="w-full bg-slate-900 text-white py-4 rounded-2xl font-black uppercase tracking-widest hover:bg-slate-800 transition-all disabled:opacity-50"
                  >
                    {isConfigLoading ? t('login.loading') : t('login.configAuthButton')}
                  </button>
                </div>
              ) : (
                <div className="grid gap-6 lg:grid-cols-2">
                  <div className="space-y-4">
                    <h3 className="text-sm font-black uppercase tracking-[0.25em] text-slate-500">{t('login.configDatabase')}</h3>
                    <div className="space-y-4">
                      <label className="block text-xs uppercase font-bold text-slate-500">{t('login.dbHost')}</label>
                      <input
                        type="text"
                        value={serverConfig.dbHost}
                        onChange={(e) => setServerConfig({ ...serverConfig, dbHost: e.target.value })}
                        className="w-full bg-slate-50 border border-slate-200 rounded-2xl py-3 px-4 focus:border-blue-500 outline-none text-slate-900 dark:text-slate-200 dark:bg-slate-800 dark:border-slate-700"
                      />
                      <label className="block text-xs uppercase font-bold text-slate-500">{t('login.dbPort')}</label>
                      <input
                        type="text"
                        value={serverConfig.dbPort}
                        onChange={(e) => setServerConfig({ ...serverConfig, dbPort: e.target.value })}
                        className="w-full bg-slate-50 border border-slate-200 rounded-2xl py-3 px-4 focus:border-blue-500 outline-none text-slate-900 dark:text-slate-200 dark:bg-slate-800 dark:border-slate-700"
                      />
                      <label className="block text-xs uppercase font-bold text-slate-500">{t('login.dbUser')}</label>
                      <input
                        type="text"
                        value={serverConfig.dbUser}
                        onChange={(e) => setServerConfig({ ...serverConfig, dbUser: e.target.value })}
                        className="w-full bg-slate-50 border border-slate-200 rounded-2xl py-3 px-4 focus:border-blue-500 outline-none text-slate-900 dark:text-slate-200 dark:bg-slate-800 dark:border-slate-700"
                      />
                      <label className="block text-xs uppercase font-bold text-slate-500">{t('login.dbPassword')}</label>
                      <input
                        type="password"
                        value={serverConfig.dbPassword}
                        onChange={(e) => setServerConfig({ ...serverConfig, dbPassword: e.target.value })}
                        className="w-full bg-slate-50 border border-slate-200 rounded-2xl py-3 px-4 focus:border-blue-500 outline-none text-slate-900 dark:text-slate-200 dark:bg-slate-800 dark:border-slate-700"
                      />
                      <label className="block text-xs uppercase font-bold text-slate-500">{t('login.dbName')}</label>
                      <input
                        type="text"
                        value={serverConfig.dbName}
                        onChange={(e) => setServerConfig({ ...serverConfig, dbName: e.target.value })}
                        className="w-full bg-slate-50 border border-slate-200 rounded-2xl py-3 px-4 focus:border-blue-500 outline-none text-slate-900 dark:text-slate-200 dark:bg-slate-800 dark:border-slate-700"
                      />
                    </div>
                  </div>
                  <div className="space-y-4">
                    <h3 className="text-sm font-black uppercase tracking-[0.25em] text-slate-500">{t('login.configApiTitle')}</h3>
                    <div className="space-y-4">
                      <label className="block text-xs uppercase font-bold text-slate-500 dark:text-slate-300">{t('login.apiHost')}</label>
                      <input
                        type="text"
                        value={serverConfig.apiHost}
                        onChange={(e) => setServerConfig({ ...serverConfig, apiHost: e.target.value })}
                        className="w-full bg-slate-50 border border-slate-200 rounded-2xl py-3 px-4 focus:border-blue-500 outline-none text-slate-900 dark:text-slate-200 dark:bg-slate-800 dark:border-slate-700"
                      />
                      <label className="block text-xs uppercase font-bold text-slate-500 dark:text-slate-300">{t('login.apiPort')}</label>
                      <input
                        type="text"
                        value={serverConfig.apiPort}
                        onChange={(e) => setServerConfig({ ...serverConfig, apiPort: e.target.value })}
                        className="w-full bg-slate-50 border border-slate-200 rounded-2xl py-3 px-4 focus:border-blue-500 outline-none text-slate-900 dark:text-slate-200 dark:bg-slate-800 dark:border-slate-700"
                      />
                      <label className="block text-xs uppercase font-bold text-slate-500 dark:text-slate-300">{t('login.apiBaseUrl')}</label>
                      <input
                        type="text"
                        value={serverConfig.apiBaseUrl}
                        onChange={(e) => setServerConfig({ ...serverConfig, apiBaseUrl: e.target.value })}
                        className="w-full bg-slate-50 border border-slate-200 rounded-2xl py-3 px-4 focus:border-blue-500 outline-none text-slate-900 dark:text-slate-200 dark:bg-slate-800 dark:border-slate-700"
                      />
                    </div>
                    <div className="space-y-4 pt-4 border-t border-slate-200 dark:border-slate-800">
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <p className="text-sm font-black text-slate-900 dark:text-white">{t('login.language')}</p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">{language === 'es' ? t('settings.spanish') : language === 'en' ? t('settings.english') : t('settings.korean')}</p>
                        </div>
                        <div className="flex gap-2">
                          {(['es', 'en', 'ko'] as const).map((langOption) => (
                            <button
                              key={langOption}
                              type="button"
                              onClick={() => handleLanguageSelect(langOption)}
                              className={`rounded-2xl px-4 py-2 border ${language === langOption ? 'bg-blue-600 text-white border-blue-600' : 'bg-slate-100 text-slate-700 border-slate-200'}`}
                            >
                              {langOption.toUpperCase()}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <p className="text-sm font-black text-slate-900 dark:text-white">{t('login.theme')}</p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">{darkMode ? t('settings.darkTheme') : t('settings.lightTheme')}</p>
                        </div>
                        <button
                          type="button"
                          onClick={handleThemeToggle}
                          className="rounded-full bg-slate-100 dark:bg-slate-700 p-3"
                        >
                          {darkMode ? <Sun size={18} /> : <Moon size={18} />}
                        </button>
                      </div>
                    </div>
                    <div className="space-y-2 pt-4 border-t border-slate-200 dark:border-slate-800">
                      <div className="flex items-center gap-3">
                        <Info size={20} className="text-slate-500 dark:text-slate-400" />
                        <div>
                          <p className="text-sm font-black text-slate-900 dark:text-white">{t('login.aboutTitle')}</p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">{t('login.aboutCompany')}</p>
                          <p className="text-[10px] text-slate-400 dark:text-slate-500">{t('settings.version')}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
              {configStep === 'edit' && (
                <div className="flex flex-col gap-3 md:flex-row md:justify-end">
                  {configError && <p className="text-sm text-rose-600">{configError}</p>}
                  <button
                    type="button"
                    onClick={handleCloseConfig}
                    className="rounded-2xl border border-slate-200 px-6 py-3 font-bold text-slate-700 hover:bg-slate-100"
                  >
                    {t('login.cancel')}
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveConfig}
                    disabled={isConfigLoading}
                    className="rounded-2xl bg-slate-900 px-6 py-3 font-bold text-white hover:bg-slate-800 disabled:opacity-50"
                  >
                    {isConfigLoading ? t('login.loading') : t('login.configSave')}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};