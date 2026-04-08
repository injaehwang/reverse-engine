import { create } from 'zustand';

interface AppState {
  user: string | null;
  theme: 'light' | 'dark';
  notifications: number;
  setUser: (user: string | null) => void;
  toggleTheme: () => void;
  clearNotifications: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  user: null,
  theme: 'light',
  notifications: 0,
  setUser: (user) => set({ user }),
  toggleTheme: () => set((state) => ({ theme: state.theme === 'light' ? 'dark' : 'light' })),
  clearNotifications: () => set({ notifications: 0 }),
}));
