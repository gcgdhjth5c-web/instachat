import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function ProtectedRoute({ children, adminOnly = false }) {
  const { user } = useAuth();

  if (user === null) {
    return (
      <div className="h-screen flex items-center justify-center bg-background" data-testid="auth-loading">
        <div className="flex items-center gap-3 text-foreground">
          <div className="w-2 h-2 bg-[#0095F6] rounded-full animate-pulse" />
          <span className="text-xs tracking-[0.2em] uppercase">Loading</span>
        </div>
      </div>
    );
  }
  if (user === false) return <Navigate to="/login" replace />;
  if (adminOnly && user.role !== "admin") return <Navigate to="/chat" replace />;
  return children;
}
