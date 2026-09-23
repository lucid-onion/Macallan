import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError(null); setBusy(true);
    try {
      await login(username, password);
      const to = loc.state?.from?.pathname || "/dashboard";
      nav(to, { replace: true });
    } catch (err) {
      setError(err.message || "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-5"
         style={{ background: "linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%)" }}>
      <div className="bg-white rounded-xl shadow-[0_8px_24px_rgba(0,0,0,0.1)] w-full max-w-[400px] p-10">
        <h2 className="text-[28px] font-semibold text-[#333] mb-2">Welcome Back</h2>
        <p className="text-sm text-[#666] mb-8">Please enter your details to sign in</p>

        <form onSubmit={submit}>
          <div className="mb-5">
            <label htmlFor="username" className="block mb-2 text-sm font-medium text-[#444]">Username</label>
            <input
              id="username" value={username} onChange={e => setUsername(e.target.value)} required
              className="w-full px-4 py-3 border border-[#ccc] rounded-lg text-sm focus:border-[#4a90e2] focus:ring-4 focus:ring-[#4a90e2]/15 outline-none"
              placeholder="enter your username" autoComplete="username"
            />
          </div>
          <div className="mb-5 relative">
            <label htmlFor="password" className="block mb-2 text-sm font-medium text-[#444]">Password</label>
            <input
              id="password" type={showPw ? "text" : "password"} value={password} onChange={e => setPassword(e.target.value)} required
              className="w-full pl-4 pr-12 py-3 border border-[#ccc] rounded-lg text-sm focus:border-[#4a90e2] focus:ring-4 focus:ring-[#4a90e2]/15 outline-none"
              placeholder="••••••••" autoComplete="current-password"
            />
            <button type="button" onClick={() => setShowPw(s => !s)}
              className="absolute right-4 bottom-3 text-[#666] hover:text-[#333] text-base">
              {showPw ? "🙈" : "👁"}
            </button>
          </div>

          {error && (
            <div className="mb-4 text-sm text-negative bg-negative-tint border border-negative-tint rounded-md px-3 py-2">
              {error}
            </div>
          )}

          <button type="submit" disabled={busy}
            className="w-full py-3 bg-[#4a90e2] hover:bg-[#357abd] text-white rounded-lg font-semibold text-base transition disabled:opacity-60">
            {busy ? "Signing in…" : "Login"}
          </button>
        </form>
      </div>
    </div>
  );
}