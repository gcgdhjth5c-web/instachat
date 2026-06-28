import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { MessageCircle, Sun, Moon, KeyRound, ArrowLeft } from "lucide-react";
import { api, formatApiErrorDetail } from "../lib/api";
import { useTheme } from "../context/ThemeContext";

export default function ForgotPassword() {
  const navigate = useNavigate();
  const { theme, toggle } = useTheme();
  const [identifier, setIdentifier] = useState("");
  const [birthday, setBirthday] = useState("");
  const [favoriteColor, setFavoriteColor] = useState("");
  const [favoriteNumber, setFavoriteNumber] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (!identifier.trim()) return setError("Enter your username or email.");
    if (!birthday.trim() || !favoriteColor.trim() || !favoriteNumber.trim()) {
      return setError("Please answer all three recovery questions.");
    }
    if (newPassword.length < 6) return setError("New password must be at least 6 characters.");
    if (newPassword !== confirmPassword) return setError("Passwords do not match.");

    setSubmitting(true);
    try {
      await api.post("/auth/forgot-password", {
        identifier: identifier.trim(),
        birthday: birthday.trim(),
        favorite_color: favoriteColor.trim(),
        favorite_number: favoriteNumber.trim(),
        new_password: newPassword,
      });
      setDone(true);
      toast.success("Password reset! You can now log in.");
    } catch (e) {
      const msg = formatApiErrorDetail(e.response?.data?.detail) || e.message || "Reset failed";
      setError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
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

      <div className="w-full max-w-md space-y-6 py-10" data-testid="forgot-password-page">
        <div className="text-center space-y-3">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 text-white">
            <MessageCircle className="w-7 h-7" strokeWidth={1.75} />
          </div>
          <h1 className="font-display text-3xl font-bold tracking-tight">Reset your password</h1>
          <p className="text-sm text-muted-foreground">
            Answer all three recovery questions you set up when you created your account.
          </p>
        </div>

        {done ? (
          <div className="space-y-4 text-center" data-testid="forgot-password-success">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-emerald-500/20 text-emerald-600">
              <KeyRound className="w-5 h-5" />
            </div>
            <p className="text-sm">Your password has been reset. You can log in with your new password.</p>
            <button
              onClick={() => navigate("/login", { replace: true })}
              data-testid="forgot-password-go-to-login-button"
              className="w-full py-3 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 text-white font-semibold text-sm hover:opacity-95"
            >
              Go to login
            </button>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4" data-testid="forgot-password-form">
            <input
              type="text"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="Username or email"
              data-testid="forgot-identifier-input"
              autoComplete="username"
              className="w-full bg-secondary border border-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-[#0095F6] focus:border-[#0095F6]"
            />

            <div className="border-t border-border pt-4 space-y-3">
              <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
                <KeyRound className="w-3.5 h-3.5" />
                Recovery questions
              </div>
              <input
                type="text"
                value={birthday}
                onChange={(e) => setBirthday(e.target.value)}
                placeholder="When is your birthday?"
                data-testid="forgot-birthday-input"
                autoComplete="off"
                className="w-full bg-secondary border border-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-[#0095F6] focus:border-[#0095F6]"
              />
              <input
                type="text"
                value={favoriteColor}
                onChange={(e) => setFavoriteColor(e.target.value)}
                placeholder="Your favourite color"
                data-testid="forgot-favorite-color-input"
                autoComplete="off"
                className="w-full bg-secondary border border-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-[#0095F6] focus:border-[#0095F6]"
              />
              <input
                type="text"
                value={favoriteNumber}
                onChange={(e) => setFavoriteNumber(e.target.value)}
                placeholder="Your favourite number"
                data-testid="forgot-favorite-number-input"
                autoComplete="off"
                className="w-full bg-secondary border border-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-[#0095F6] focus:border-[#0095F6]"
              />
            </div>

            <div className="border-t border-border pt-4 space-y-3">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">New password</div>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="New password (min 6 characters)"
                data-testid="forgot-new-password-input"
                autoComplete="new-password"
                className="w-full bg-secondary border border-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-[#0095F6] focus:border-[#0095F6]"
              />
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm new password"
                data-testid="forgot-confirm-password-input"
                autoComplete="new-password"
                className="w-full bg-secondary border border-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-[#0095F6] focus:border-[#0095F6]"
              />
            </div>

            {error ? (
              <p data-testid="forgot-password-error" className="text-xs text-red-500 px-1">
                {error}
              </p>
            ) : null}
            <button
              type="submit"
              disabled={submitting}
              data-testid="forgot-password-submit-button"
              className="w-full py-3 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 text-white font-semibold text-sm hover:opacity-95 transition-opacity disabled:opacity-50"
            >
              {submitting ? "Verifying…" : "Reset password"}
            </button>
          </form>
        )}

        <div className="text-center text-sm">
          <Link
            to="/login"
            data-testid="back-to-login-link"
            className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground hover:underline"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to login
          </Link>
        </div>
      </div>
    </div>
  );
}
