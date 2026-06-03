import { useState } from "react";
import { downloadBackupExcelFile } from "./backupExcel";

export const BackupDownloadCard = ({ apiBaseUrl, children }) => {
  const [backupStatus, setBackupStatus] = useState({ state: "idle", message: "" });

  const handleDownloadBackupExcel = async () => {
    if (!apiBaseUrl) {
      setBackupStatus({
        state: "error",
        message: "Missing API URL. Set VITE_API_URL and rebuild.",
      });
      return;
    }

    setBackupStatus({ state: "loading", message: "Preparing backup..." });

    try {
      const response = await fetch(`${apiBaseUrl}/backup/export`);
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        setBackupStatus({ state: "error", message: payload.error || "Could not download backup." });
        return;
      }

      const { fileName } = downloadBackupExcelFile(payload);
      setBackupStatus({ state: "success", message: `Downloaded ${fileName}.` });
    } catch (_error) {
      setBackupStatus({ state: "error", message: "Network error while downloading backup." });
    }
  };

  const isLoading = backupStatus.state === "loading";

  return (
    <section className="card view-switcher-card">
      <div className="view-switcher-header">
        <p className="eyebrow">Views</p>
        <button
          type="button"
          className="backup-download-btn"
          onClick={handleDownloadBackupExcel}
          disabled={isLoading}
          aria-busy={isLoading}
        >
          {isLoading ? "Preparing..." : "Download backup"}
        </button>
      </div>
      {backupStatus.state !== "idle" && <div className={`status ${backupStatus.state}`}>{backupStatus.message}</div>}
      {children}
    </section>
  );
};
