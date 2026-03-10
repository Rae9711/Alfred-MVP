import React from "react";

type FinalAnswerProps = {
  message: string;
  status?: "success" | "partial" | "error" | null;
  stepSummary?: Array<{ tool: string; status: string; description?: string }>;
};

export default function FinalAnswer({ message, status, stepSummary }: FinalAnswerProps) {
  const bannerConfig = {
    success: { bg: "#ECFDF5", border: "#A7F3D0", color: "#065F46", icon: "\u2705", label: "任务完成！" },
    partial: { bg: "#FFFBEB", border: "#FDE68A", color: "#92400E", icon: "\u26A0\uFE0F", label: "部分完成" },
    error: { bg: "#FEF2F2", border: "#FECACA", color: "#991B1B", icon: "\u274C", label: "执行失败" },
  };

  const banner = status ? bannerConfig[status] : null;

  return (
    <div
      style={{
        background: "white",
        borderRadius: 12,
        border: "1px solid #E5E7EB",
        padding: 20,
      }}
    >
      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12 }}>
        AI 回复
      </div>

      {!message ? (
        <div style={{ color: "#9CA3AF", fontSize: 13 }}>
          执行完成后将显示回复。
        </div>
      ) : (
        <>
          {banner && (
            <div
              style={{
                background: banner.bg,
                border: `1px solid ${banner.border}`,
                borderRadius: 8,
                padding: "8px 12px",
                marginBottom: 12,
                fontSize: 13,
                color: banner.color,
                fontWeight: 600,
              }}
            >
              {banner.icon} {banner.label}
            </div>
          )}

          <div
            style={{
              whiteSpace: "pre-wrap",
              fontSize: 14,
              lineHeight: 1.7,
              color: "#374151",
            }}
          >
            {message}
          </div>

          {stepSummary && stepSummary.length > 0 && (
            <details style={{ marginTop: 12 }}>
              <summary
                style={{
                  fontSize: 12,
                  color: "#6B7280",
                  cursor: "pointer",
                  userSelect: "none",
                }}
              >
                执行详情（{stepSummary.length} 步）
              </summary>
              <div style={{ marginTop: 8 }}>
                {stepSummary.map((s, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      gap: 8,
                      alignItems: "center",
                      fontSize: 12,
                      padding: "4px 0",
                      color: s.status === "ok" ? "#059669" : s.status === "error" ? "#DC2626" : "#6B7280",
                    }}
                  >
                    <span>{s.status === "ok" ? "\u2713" : s.status === "error" ? "\u2717" : "\u2022"}</span>
                    <span style={{ fontWeight: 500 }}>{s.tool}</span>
                    {s.description && <span style={{ color: "#9CA3AF" }}>— {s.description}</span>}
                  </div>
                ))}
              </div>
            </details>
          )}
        </>
      )}
    </div>
  );
}
