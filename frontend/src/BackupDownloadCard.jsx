import { useState } from "react";
import { downloadBackupExcelFile } from "./backupExcel";

export const BackupDownloadCard = ({ apiBaseUrl, children }) => {
  const [backupStatus, setBackupStatus] = useState({ state: "idle", message: "" });

  const handleDownloadBackupExcel = async () => {
    if (!apiBaseUrl) {
      setBackupStatus({
        state: "error",
        message: "Missing VITE_API_URL configuration. Set it to your API Gateway URL and rebuild.",
      });
      return;
    }

    setBackupStatus({ state: "loading", message: "Preparing Excel backup..." });

    try {
      const response = await fetch(`${apiBaseUrl}/backup/export`);
      const payload = await response.json();

      if (!response.ok) {
        setBackupStatus({ state: "error", message: payload.error || "Could not download backup." });
        return;
      }

      const { fileName } = downloadBackupExcelFile(payload);
      setBackupStatus({ state: "success", message: `Excel backup downloaded as ${fileName} with one sheet per table.` });
    } catch (_error) {
      setBackupStatus({ state: "error", message: "Network error while downloading backup." });
    }
  };

  return (
    <section className="card view-switcher-card">
      <div className="view-switcher-header">
        <div>
          <p className="eyebrow">Views</p>
          <p className="subtitle">Switch sections or download a complete table backup.</p>
        </div>
        <button type="button" className="backup-download-btn" onClick={handleDownloadBackupExcel} disabled={backupStatus.state === "loading"}>
          {backupStatus.state === "loading" ? "Building Excel..." : "Download all data (Excel)"}
        </button>
      </div>
      {backupStatus.state !== "idle" && <div className={`status ${backupStatus.state}`}>{backupStatus.message}</div>}
      {children}
    </section>
  );
};
