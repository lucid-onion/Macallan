import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api } from "../api/client";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const { user } = await api.get("/api/auth/me");
      setUser(user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const login = async (username, password) => {
    const { user } = await api.post("/api/auth/login", { username, password });
    await refresh();
    return user;
  };
  const logout = async () => {
    await api.post("/api/auth/logout");
    setUser(null);
  };

  const has = useCallback((module, action) => {
    if (!user) return false;
    // SUPER_ADMIN bypasses every permission check.
    if (user.role === "SUPER_ADMIN") return true;
    return user.permissions.includes(`${module}:${action}`);
  }, [user]);

  const hasRole = useCallback((...roles) => {
    if (!user) return false;
    if (user.role === "SUPER_ADMIN") return true;
    return roles.includes(user.role);
  }, [user]);

  /**
   * Single source of truth for "can this user delete rows in <module>?".
   * Only ADMIN and SUPER_ADMIN qualify — never USER or ACCOUNTANT — even
   * if a team grant or role baseline accidentally includes `module:delete`.
   */
  const canDelete = useCallback((module) => {
    if (!user) return false;
    if (user.role !== "ADMIN" && user.role !== "SUPER_ADMIN") return false;
    return has(module, "delete");
  }, [user, has]);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refresh, has, hasRole, canDelete }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);