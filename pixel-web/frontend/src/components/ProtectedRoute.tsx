import { useAuth } from "../auth/AuthContext";
import { Navigate } from "react-router-dom";

// Here we protect routes that require authentication.
export default function ProtectedRoute({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, loading } = useAuth();

  // Here we wait until the user is loaded.
  if (loading) {
    return <p>Loading...</p>;
  }

  // Here we redirect unauthenticated users.
  if (!user) {
    return <Navigate to="/login" />;
  }

  return <>{children}</>;
}
