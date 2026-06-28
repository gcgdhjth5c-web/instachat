import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { MessageCircle, Sun, Moon } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";

export default function Login() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const { theme, toggle } = useTheme();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const onSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (!identifier.trim() || !password) {
      setError("Please fill in both fields.");
      return;
    }
    setSubmitting(true);
    const res = await login(identifier, password);
    setSubmitting(false);
    if (res.ok) {
      toast.success("Welcome back!");
      navigate(res.user.role === "admin" ? "/admin" : "/chat", { replace: true });
    } else {
      setError(res.error);
      toast.error(res.error);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <button
        onClick={toggle}
        data-testid="theme-toggle"
        className="absolute top-4 right-4 p-2 rounded-full hover:bg-accent transition-colors"
        aria-label="Toggle theme"
      >
        {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
      </button>

      <div className="w-full max-w-md space-y-8">
        <div className="text-center space-y-3">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 text-white">
            <MessageCircle className="w-7 h-7" strokeWidth={1.75} />
          </div>
          <h1 className="font-display text-4xl font-bold tracking-tight">InstaChat</h1>
          <p className="text-sm text-muted-foreground">Sign in to continue the conversation</p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4" data-testid="login-form">
          <input
            type="text"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            placeholder="Username or email"
            data-testid="login-identifier-input"
            autoComplete="username"
            className="w-full bg-secondary border border-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-[#0095F6] focus:border-[#0095F6] placeholder:text-muted-foreground"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            autoComplete="current-password"
            data-testid="login-password-input"
            className="w-full bg-secondary border border-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-[#0095F6] focus:border-[#0095F6] placeholder:text-muted-foreground"
          />
          {error ? (
            <p data-testid="login-error" className="text-xs text-red-500 px-1">{error}</p>
          ) : null}
          <button
            type="submit"
            disabled={submitting}
            data-testid="login-submit-button"
            className="w-full py-3 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 text-white font-semibold text-sm hover:opacity-95 transition-opacity disabled:opacity-50"
          >
            {submitting ? "Signing in…" : "Log in"}
          </button>
          <div className="text-center">
            <Link
              to="/forgot-password"
              data-testid="goto-forgot-password-link"
              className="text-xs text-muted-foreground hover:text-foreground hover:underline"
            >
              Forgot password?
            </Link>
          </div>
        </form>

        <div className="text-center text-sm text-muted-foreground">
          Don&apos;t have an account?{" "}
          <Link to="/register" data-testid="goto-register-link" className="text-[#0095F6] font-semibold hover:underline">
            Sign up
          </Link>
        </div>
      </div>
    </div>
  );
}
