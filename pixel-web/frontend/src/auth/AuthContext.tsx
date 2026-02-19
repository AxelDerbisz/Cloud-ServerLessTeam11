import { createContext, useContext, useState, useEffect } from "react";
import { apiFetch } from "../api/api";

// Here we define the user type.
type User = {
  id: string;
  username: string;
  discriminator: string;
  pixelCount: number;
};

// Here we define the context type.
type AuthContextType = {
  user: User | null;
  loading: boolean;
  refreshUser: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Here we create the provider.
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Here we fetch the user from backend.
  async function refreshUser() {
    try {
      const data = await apiFetch("/auth/me");
      setUser(data);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }

  // Here we load user on app start.
  useEffect(() => {
    refreshUser();
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

// Here we create a hook.
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return ctx;
}