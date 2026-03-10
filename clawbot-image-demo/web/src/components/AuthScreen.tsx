import React, { useState } from "react";
import { getSupabase } from "../api/supabase";

type AuthScreenProps = {
  onAuth: (session: { accessToken: string; userId: string }) => void;
};

export default function AuthScreen({ onAuth }: AuthScreenProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSignUp, setIsSignUp] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    const sb = getSupabase();
    if (!sb || !email.trim() || !password.trim()) return;

    setLoading(true);
    setError("");

    const { data, error: authError } = isSignUp
      ? await sb.auth.signUp({ email: email.trim(), password })
      : await sb.auth.signInWithPassword({ email: email.trim(), password });

    setLoading(false);

    if (authError) {
      setError(authError.message);
      return;
    }

    if (data.session) {
      onAuth({
        accessToken: data.session.access_token,
        userId: data.session.user.id,
      });
    } else if (isSignUp) {
      setError("注册成功！请检查邮箱确认后登录。");
      setIsSignUp(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
        fontFamily: "'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif",
      }}
    >
      <div
        style={{
          background: "white",
          borderRadius: 16,
          padding: "40px 36px",
          width: 400,
          boxShadow: "0 20px 60px rgba(0,0,0,0.15)",
        }}
      >
        <h1 style={{ margin: 0, fontSize: 24, textAlign: "center" }}>
          Alfred (阿福)
        </h1>
        <p
          style={{
            textAlign: "center",
            color: "#6B7280",
            fontSize: 14,
            marginTop: 8,
            marginBottom: 28,
          }}
        >
          {isSignUp ? "创建账户" : "登录你的账户"}
        </p>

        {error && (
          <div
            style={{
              background: "#FEF2F2",
              color: "#DC2626",
              padding: "8px 12px",
              borderRadius: 8,
              fontSize: 13,
              marginBottom: 16,
            }}
          >
            {error}
          </div>
        )}

        <div style={{ marginBottom: 16 }}>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="邮箱"
            type="email"
            style={{
              width: "100%",
              padding: "10px 12px",
              borderRadius: 8,
              border: "1px solid #D1D5DB",
              fontSize: 15,
              outline: "none",
              boxSizing: "border-box",
            }}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
        </div>

        <div style={{ marginBottom: 24 }}>
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="密码"
            type="password"
            style={{
              width: "100%",
              padding: "10px 12px",
              borderRadius: 8,
              border: "1px solid #D1D5DB",
              fontSize: 15,
              outline: "none",
              boxSizing: "border-box",
            }}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
        </div>

        <button
          onClick={submit}
          disabled={loading || !email.trim() || !password.trim()}
          style={{
            width: "100%",
            padding: "12px",
            borderRadius: 10,
            border: "none",
            background:
              !loading && email.trim() && password.trim()
                ? "#4F46E5"
                : "#D1D5DB",
            color: "white",
            fontWeight: 700,
            fontSize: 16,
            cursor:
              !loading && email.trim() && password.trim()
                ? "pointer"
                : "not-allowed",
            transition: "background 0.2s",
            marginBottom: 12,
          }}
        >
          {loading ? "请稍候…" : isSignUp ? "注册" : "登录"}
        </button>

        <button
          onClick={() => {
            setIsSignUp(!isSignUp);
            setError("");
          }}
          style={{
            width: "100%",
            padding: "10px",
            borderRadius: 10,
            border: "1px solid #E5E7EB",
            background: "white",
            color: "#6B7280",
            fontSize: 14,
            cursor: "pointer",
          }}
        >
          {isSignUp ? "已有账号？登录" : "没有账号？注册"}
        </button>
      </div>
    </div>
  );
}
