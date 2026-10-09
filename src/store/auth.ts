import { create } from "zustand";
import { api, getToken, setToken } from "../api/client";
import type { Role, TokenOut, User } from "../api/types";

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  restore: () => Promise<void>;
}

export const useAuth = create<AuthState>((set) => ({
  user: null,
  loading: true,
  login: async (email, password) => {
    const t = await api<TokenOut>("POST", "/api/v1/auth/login", { email, password });
    setToken(t.access_token);
    set({ user: t.user });
  },
  logout: () => {
    setToken(null);
    set({ user: null });
  },
  restore: async () => {
    if (!getToken()) {
      set({ loading: false });
      return;
    }
    try {
      const u = await api<User>("GET", "/api/v1/auth/me");
      set({ user: u, loading: false });
    } catch {
      setToken(null);
      set({ user: null, loading: false });
    }
  },
}));

export function can(user: User | null, ...roles: Role[]): boolean {
  return !!user && roles.includes(user.role);
}
