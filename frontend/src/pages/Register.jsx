import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { MessageCircle, Sun, Moon } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";

export default function Register() {
  const navigate = useNavigate();
  const { register } = useAuth();
  const { theme, toggle } = useTheme();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const onSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (username.trim().length < 3) return setError("Username must be at least 3 characters.");
    if (!email.includes("@")) return setError("Enter a valid email.");
    if (password.length < 6) return setError("Password must be at least 6 characters.");

    setSubmitting(true);
    const res = await register(username, email, password);
    setSubmitting(false);
    if (res.ok) {
      toast.success("Account created!");
      navigate("/chat", { replace: true });
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
      >
        {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
      </button>

      <div className="w-full max-w-md space-y-8">
        <div className="text-center space-y-3">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 text-white">
            <MessageCircle className="w-7 h-7" strokeWidth={1.75} />
          </div>
          <h1 className="font-display text-4xl font-bold tracking-tight">Join InstaChat</h1>
          <p className="text-sm text-muted-foreground">Create your account in seconds</p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4" data-testid="register-form">
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Username"
            data-testid="register-username-input"
            autoComplete="username"
            className="w-full bg-secondary border border-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-[#0095F6] focus:border-[#0095F6]"
          />
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            data-testid="register-email-input"
            autoComplete="email"
            className="w-full bg-secondary border border-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-[#0095F6] focus:border-[#0095F6]"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password (min 6 characters)"
            data-testid="register-password-input"
            autoComplete="new-password"
            className="w-full bg-secondary border border-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-[#0095F6] focus:border-[#0095F6]"
          />
          {error ? (
            <p data-testid="register-error" className="text-xs text-red-500 px-1">{error}</p>
          ) : null}
          <button
            type="submit"
            disabled={submitting}
            data-testid="register-submit-button"
            className="w-full py-3 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 text-white font-semibold text-sm hover:opacity-95 transition-opacity disabled:opacity-50"
          >
            {submitting ? "Creating…" : "Sign up"}
          </button>
        </form>

        <div className="text-center text-sm text-muted-foreground">
          Have an account?{" "}
          <Link to="/login" data-testid="goto-login-link" className="text-[#0095F6] font-semibold hover:underline">
            Log in
          </Link>
        </div>
      </div>
    </div>
  );
}
