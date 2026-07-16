import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type UserRole = 'admin' | 'supervisor' | 'operator' | 'auditor';

interface User {
  id: string;
  name: string;
  role: UserRole;
  employeeId: string;
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isOffline: boolean;
  darkMode: boolean;
  language: 'es' | 'en' | 'ko';
  login: (user: User) => void;
  logout: () => void;
  setOffline: (status: boolean) => void;
  setDarkMode: (status: boolean) => void;
  setLanguage: (lang: 'es' | 'en' | 'ko') => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      isAuthenticated: false,
      isOffline: false,
      darkMode: true,
      language: 'es',
      login: (user) => set({ user, isAuthenticated: true }),
      logout: () => set({ user: null, isAuthenticated: false }),
      setOffline: (status) => set({ isOffline: status }),
      setDarkMode: (status) => set({ darkMode: status }),
      setLanguage: (lang) => set({ language: lang }),
    }),
    {
      name: 'auth-storage',
    }
  )
);

export default useAuthStore;
