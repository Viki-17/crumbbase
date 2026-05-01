import React from "react";
import { Loader2 } from "lucide-react";

const Loading = ({ message = "Loading..." }) => {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        color: "var(--text-tertiary)",
        gap: "1rem",
      }}
    >
      <div style={{ position: "relative" }}>
        {/* Pulsing ring */}
        <div
          style={{
            position: "absolute",
            inset: "-8px",
            borderRadius: "50%",
            border: "2px solid var(--primary-light)",
            animation: "pulseRing 1.5s ease-out infinite",
          }}
        />
        <Loader2
          size={28}
          style={{
            animation: "spin 1s linear infinite",
            color: "var(--primary)",
          }}
        />
      </div>
      <div style={{ fontSize: "var(--font-size-sm)", opacity: 0.7 }}>{message}</div>
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes pulseRing {
          0% { transform: scale(0.8); opacity: 0.8; }
          100% { transform: scale(1.4); opacity: 0; }
        }
      `}</style>
    </div>
  );
};

export default Loading;
