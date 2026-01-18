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
        color: "var(--text-secondary)",
        gap: "1rem",
      }}
    >
      <Loader2
        className="animate-spin"
        size={32}
        style={{ animation: "spin 1s linear infinite" }}
      />
      <div style={{ fontSize: "0.9rem" }}>{message}</div>
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};

export default Loading;
