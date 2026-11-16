import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  DatabaseBackup,
  Download,
  FileArchive,
  ShieldAlert,
  Upload,
} from "lucide-react";
import { api, ApiError } from "../api";
import { useToast } from "../toast";
import { Button, ConfirmDialog, PageHeader } from "../components/UI";

interface ImportResult {
  ok: boolean;
  safety_backup: string;
  counts: Record<string, number>;
}

export function BackupPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [exporting, setExporting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    return () => setSelectedFile(null);
  }, []);

  const exportBackup = async () => {
    setExporting(true);
    setError("");
    try {
      const response = await fetch("/api/backup/export", { credentials: "same-origin" });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.detail || "导出失败");
      }
      const blob = await response.blob();
      const date = new Date();
      const stamp = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(
        date.getDate(),
      ).padStart(2, "0")}-${String(date.getHours()).padStart(2, "0")}${String(
        date.getMinutes(),
      ).padStart(2, "0")}`;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `qiyu-backup-${stamp}.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast("备份文件已导出", "success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "导出失败");
    } finally {
      setExporting(false);
    }
  };

  const selectFile = (file: File | null) => {
    setResult(null);
    setError("");
    if (!file) {
      setSelectedFile(null);
      return;
    }
    if (!file.name.toLowerCase().endsWith(".zip")) {
      setError("请选择梁寓导出的 .zip 备份文件");
      return;
    }
    if (file.size > 300 * 1024 * 1024) {
      setError("备份文件不能超过 300MB");
      return;
    }
    setSelectedFile(file);
  };

  const importFile = async () => {
    if (!selectedFile) return;
    setImporting(true);
    setError("");
    try {
      const form = new FormData();
      form.append("file", selectedFile);
      const response = await api<ImportResult>("/api/backup/import", {
        method: "POST",
        body: form,
      });
      setResult(response);
      setSelectedFile(null);
      if (fileRef.current) fileRef.current.value = "";
      toast("备份导入完成", "success");
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "导入失败");
    } finally {
      setImporting(false);
      setConfirmOpen(false);
    }
  };

  return (
    <div className="page">
      <PageHeader
        eyebrow="DATA BACKUP"
        title="数据备份"
        description="导出或恢复系统的完整业务数据。备份文件包含租客证件照片，请妥善保管。"
        back={
          <button type="button" className="back-link" onClick={() => navigate(-1)}>
            <ArrowLeft size={16} /> 返回
          </button>
        }
        actions={
          <Button
            variant="secondary"
            onClick={() => navigate("/accounts")}
            icon={<DatabaseBackup size={16} />}
          >
            租客账号
          </Button>
        }
      />

      <div className="backup-grid">
        <section className="panel backup-card">
          <div className="backup-card-icon export">
            <Download size={23} />
          </div>
          <span className="eyebrow">EXPORT</span>
          <h2>导出完整备份</h2>
          <p>
            包含房屋、租客、合同、租金账单、水电记录、租客账号和身份证照片。
            不包含当前超级管理员的密码。
          </p>
          <div className="backup-includes">
            <span>
              <CheckCircle2 size={14} /> 业务数据
            </span>
            <span>
              <CheckCircle2 size={14} /> 证件照片
            </span>
            <span>
              <CheckCircle2 size={14} /> 租客账号
            </span>
          </div>
          <Button
            icon={<FileArchive size={16} />}
            onClick={exportBackup}
            loading={exporting}
            className="backup-action"
          >
            导出 ZIP 备份
          </Button>
        </section>

        <section className="panel backup-card backup-card-danger">
          <div className="backup-card-icon import">
            <Upload size={23} />
          </div>
          <span className="eyebrow">IMPORT</span>
          <h2>导入备份</h2>
          <p>
            导入会覆盖当前全部业务数据，并恢复备份中的租客账号。当前超级管理员账号会被保留。
          </p>
          <input
            ref={fileRef}
            type="file"
            accept=".zip,application/zip"
            className="visually-hidden"
            onChange={(event) => selectFile(event.target.files?.[0] || null)}
          />
          <button
            type="button"
            className={selectedFile ? "backup-file selected" : "backup-file"}
            onClick={() => fileRef.current?.click()}
          >
            <FileArchive size={18} />
            <span>
              <strong>{selectedFile ? selectedFile.name : "选择备份文件"}</strong>
              <small>
                {selectedFile
                  ? `${(selectedFile.size / 1024 / 1024).toFixed(1)} MB`
                  : "仅支持梁寓导出的 .zip 备份"}
              </small>
            </span>
          </button>
          <Button
            variant="danger"
            icon={<Upload size={16} />}
            onClick={() => setConfirmOpen(true)}
            disabled={!selectedFile}
            className="backup-action"
          >
            导入并覆盖数据
          </Button>
        </section>
      </div>

      <section className="backup-safety">
        <div>
          <span className="backup-safety-icon">
            <ShieldAlert size={20} />
          </span>
          <div>
            <strong>导入前会自动保存当前数据</strong>
            <p>
              导入成功后可以下载“导入前备份”用于恢复。导入会清除所有已登录租客的登录状态，
              租客需要重新登录。
            </p>
          </div>
        </div>
        <div>
          <span className="backup-safety-icon">
            <AlertTriangle size={20} />
          </span>
          <div>
            <strong>备份文件包含敏感信息</strong>
            <p>
              身份证照片、手机号和证件号码都在备份包内。请存放在受控位置，不要通过公开聊天或网盘分享。
            </p>
          </div>
        </div>
      </section>

      {result && (
        <section className="backup-success">
          <CheckCircle2 size={22} />
          <div>
            <strong>备份已恢复</strong>
            <p>
              房屋 {result.counts.properties} 处 · 房间 {result.counts.rooms} 间 · 租客{" "}
              {result.counts.tenants} 位 · 合同 {result.counts.leases} 份 · 租客账号{" "}
              {result.counts.tenant_accounts} 个
            </p>
            <a
              className="text-link"
              href={`/api/backup/safety/${result.safety_backup}`}
            >
              <Download size={14} /> 下载导入前备份
            </a>
          </div>
        </section>
      )}

      {error && <div className="form-error-banner backup-error">{error}</div>}

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={importFile}
        title="确定导入并覆盖当前数据？"
        description="当前房屋、租客、合同、账单、水电记录和租客账号将被备份文件替换。系统会先自动生成一份当前数据备份。此操作不能撤销，除非使用自动备份恢复。"
        confirmLabel="确认覆盖导入"
        danger
        loading={importing}
      />
    </div>
  );
}
