import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  Camera,
  CheckCircle2,
  IdCard,
  ScanLine,
  ShieldCheck,
  Trash2,
  Upload,
} from "lucide-react";
import { api, ApiError, uploadIdCard } from "../api";
import { useToast } from "../toast";
import type { OcrResult, TenantDetail } from "../types";
import { formatDate, idMeta, isValidIdNumber } from "../utils";
import {
  Button,
  Field,
  IconButton,
  LoadingBlock,
  PageHeader,
} from "../components/UI";

interface TenantForm {
  name: string;
  phone: string;
  idNumber: string;
  emergencyName: string;
  emergencyPhone: string;
  note: string;
}

const emptyForm: TenantForm = {
  name: "",
  phone: "",
  idNumber: "",
  emergencyName: "",
  emergencyPhone: "",
  note: "",
};

export function TenantFormPage() {
  const { id } = useParams();
  const editing = Boolean(id);
  const navigate = useNavigate();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState<TenantForm>(emptyForm);
  const [tenant, setTenant] = useState<TenantDetail | null>(null);
  const [loading, setLoading] = useState(editing);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [idError, setIdError] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [imageFailed, setImageFailed] = useState(false);
  const [imageToken, setImageToken] = useState<string | null>(null);
  const [newImageSelected, setNewImageSelected] = useState(false);
  const [removeExistingImage, setRemoveExistingImage] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [ocr, setOcr] = useState<OcrResult | null>(null);
  const [scanError, setScanError] = useState("");

  useEffect(() => {
    if (!editing) return;
    let active = true;
    api<{ tenant: TenantDetail }>(`/api/tenants/${id}`)
      .then((result) => {
        if (!active) return;
        const data = result.tenant;
        setTenant(data);
        setForm({
          name: data.name,
          phone: data.phone,
          idNumber: "",
          emergencyName: data.emergency_name,
          emergencyPhone: data.emergency_phone,
          note: data.note,
        });
        if (data.has_id_image) {
          setPreview(`/api/tenants/${data.id}/id-image`);
        }
      })
      .catch((err) => {
        if (!active) return;
        toast(err instanceof ApiError ? err.detail : "租客资料加载失败", "error");
        navigate("/tenants", { replace: true });
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [editing, id, navigate, toast]);

  useEffect(() => {
    return () => {
      if (preview?.startsWith("blob:")) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  const setField = (key: keyof TenantForm, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
    if (key === "idNumber") setIdError("");
  };

  const openFilePicker = () => fileRef.current?.click();

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setScanError("请选择图片文件");
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      setScanError("图片不能超过 12MB");
      return;
    }
    setScanError("");
    setOcr(null);
    setImageFailed(false);
    setPreview(URL.createObjectURL(file));
    setImageToken(null);
    setNewImageSelected(true);
    setRemoveExistingImage(false);
    setScanning(true);
    try {
      const result = await uploadIdCard(file);
      setOcr(result);
      setImageToken(result.token);
      if (result.name?.value) {
        setField("name", result.name.value);
      }
      if (result.id_number?.value) {
        setField("idNumber", result.id_number.value.toUpperCase());
      }
      if (result.ok) {
        toast("身份证识别完成，请核对信息", "success");
      } else {
        toast("图片已保存，但识别未完成，可手工填写", "info");
      }
    } catch (err) {
      setImageToken(null);
      setNewImageSelected(false);
      setPreview(
        tenant?.has_id_image && !removeExistingImage ? `/api/tenants/${tenant.id}/id-image` : null,
      );
      setScanError(
        err instanceof ApiError
          ? `${err.detail} 图片未保存，请重试或直接手工填写。`
          : "识别失败，图片未保存；请重试或直接手工填写。",
      );
    } finally {
      setScanning(false);
    }
  };

  const clearImage = () => {
    setImageToken(null);
    setOcr(null);
    setScanError("");
    setImageFailed(false);
    if (newImageSelected) {
      setNewImageSelected(false);
      setPreview(
        tenant?.has_id_image && !removeExistingImage ? `/api/tenants/${tenant.id}/id-image` : null,
      );
      return;
    }
    setPreview(null);
    if (tenant?.has_id_image) {
      setRemoveExistingImage(true);
    }
  };

  const existingMeta = tenant
    ? { gender: tenant.gender, birthDate: tenant.birth_date }
    : { gender: null, birthDate: null };
  const enteredMeta = form.idNumber ? idMeta(form.idNumber) : { gender: null, birthDate: null };
  const displayGender = enteredMeta.gender || existingMeta.gender;
  const displayBirth = enteredMeta.birthDate || existingMeta.birthDate;
  const idLooksValid = form.idNumber ? isValidIdNumber(form.idNumber) : false;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setIdError("");
    if (!form.name.trim()) {
      setError("请填写租客姓名");
      return;
    }
    if (form.idNumber.trim() && !isValidIdNumber(form.idNumber)) {
      setIdError("身份证号格式或校验位不正确，请核对");
      return;
    }
    setSaving(true);
    const payload: Record<string, unknown> = {
      name: form.name.trim(),
      phone: form.phone.trim(),
      emergency_name: form.emergencyName.trim(),
      emergency_phone: form.emergencyPhone.trim(),
      note: form.note,
    };
    if (form.idNumber.trim()) {
      payload.id_number = form.idNumber.trim().toUpperCase();
    }
    if (imageToken) {
      payload.id_image_token = imageToken;
    }
    if (removeExistingImage) {
      payload.remove_id_image = true;
    }
    try {
      const result = await api<{ tenant: TenantDetail }>(
        editing ? `/api/tenants/${id}` : "/api/tenants",
        { method: editing ? "PATCH" : "POST", body: JSON.stringify(payload) },
      );
      toast(editing ? "租客资料已更新" : "租客已添加", "success");
      navigate(`/tenants/${result.tenant.id}`, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "保存失败，请稍后重试");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingBlock text="正在读取租客资料" />;

  return (
    <div className="page tenant-form-page">
      <PageHeader
        eyebrow={editing ? "EDIT RESIDENT" : "NEW RESIDENT"}
        title={editing ? `编辑 ${tenant?.name || "租客"}` : "新增租客"}
        description="上传身份证人像面，姓名和证件号码会在本机自动识别；保存前请人工核对。"
        back={
          <button type="button" className="back-link" onClick={() => navigate(-1)}>
            <ArrowLeft size={16} /> 返回
          </button>
        }
      />

      <form onSubmit={submit} className="tenant-form-layout">
        <div className="form-main">
          <section className="panel form-section">
            <div className="section-heading">
              <div>
                <span className="eyebrow">IDENTITY</span>
                <h2>基本信息</h2>
              </div>
              <span className="section-index">01</span>
            </div>

            <div className="form-grid-2">
              <Field label="姓名" htmlFor="tenant-name" required>
                <input
                  id="tenant-name"
                  className="input"
                  value={form.name}
                  onChange={(event) => setField("name", event.target.value)}
                  placeholder="租客姓名"
                  autoFocus
                />
              </Field>
              <Field label="手机号" htmlFor="tenant-phone">
                <input
                  id="tenant-phone"
                  className="input"
                  type="tel"
                  value={form.phone}
                  onChange={(event) => setField("phone", event.target.value)}
                  placeholder="用于日常联系"
                />
              </Field>
            </div>

            <Field
              label="身份证号"
              htmlFor="tenant-id-number"
              error={idError}
              hint={
                editing && tenant?.has_id_number
                  ? `已登记 ${tenant.id_number_masked}。如不修改请留空；输入新号码将覆盖原号码。`
                  : "可不填；上传身份证后会自动填入。"
              }
            >
              <div className="input-with-icon">
                <IdCard size={18} />
                <input
                  id="tenant-id-number"
                  className="input"
                  value={form.idNumber}
                  onChange={(event) =>
                    setField("idNumber", event.target.value.replace(/\s/g, "").toUpperCase().slice(0, 18))
                  }
                  placeholder={editing && tenant?.has_id_number ? "留空则保持原号码" : "18 位身份证号"}
                  inputMode="text"
                  autoComplete="off"
                  maxLength={18}
                />
                {idLooksValid && (
                  <span className="input-state ok">
                    <CheckCircle2 size={16} />
                  </span>
                )}
              </div>
            </Field>

            <div className="derived-grid">
              <div className="derived-item">
                <span>性别</span>
                <strong>{displayGender || "—"}</strong>
              </div>
              <div className="derived-item">
                <span>出生日期</span>
                <strong>{displayBirth ? formatDate(displayBirth) : "—"}</strong>
              </div>
              <div className="derived-note">
                <ShieldCheck size={15} />
                根据身份证号自动推算
              </div>
            </div>

            <div className="section-divider" />

            <div className="form-grid-2">
              <Field label="紧急联系人" htmlFor="tenant-emergency-name">
                <input
                  id="tenant-emergency-name"
                  className="input"
                  value={form.emergencyName}
                  onChange={(event) => setField("emergencyName", event.target.value)}
                  placeholder="姓名"
                />
              </Field>
              <Field label="紧急联系人电话" htmlFor="tenant-emergency-phone">
                <input
                  id="tenant-emergency-phone"
                  className="input"
                  type="tel"
                  value={form.emergencyPhone}
                  onChange={(event) => setField("emergencyPhone", event.target.value)}
                  placeholder="联系电话"
                />
              </Field>
            </div>

            <Field label="备注" htmlFor="tenant-note">
              <textarea
                id="tenant-note"
                className="input textarea"
                rows={4}
                value={form.note}
                onChange={(event) => setField("note", event.target.value)}
                placeholder="职业、居住人数、特殊约定等"
              />
            </Field>

            {error && <div className="form-error-banner">{error}</div>}
          </section>
        </div>

        <aside className="form-side">
          <section className="panel scan-panel">
            <div className="section-heading">
              <div>
                <span className="eyebrow">LOCAL OCR</span>
                <h2>身份证识别</h2>
              </div>
              <span className="local-badge">
                <ShieldCheck size={14} /> 本机处理
              </span>
            </div>

            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="visually-hidden"
              onChange={handleFile}
            />

            {preview && !imageFailed ? (
              <div className="id-preview">
                <img
                  src={preview}
                  alt="身份证照片预览"
                  onError={() => setImageFailed(true)}
                />
                <div className="id-preview-overlay">
                  {scanning ? (
                    <span className="scan-status">
                      <ScanLine className="scan-pulse" size={20} /> 正在本地识别…
                    </span>
                  ) : (
                    <>
                      <button type="button" className="id-preview-btn" onClick={openFilePicker}>
                        <Camera size={15} /> 更换照片
                      </button>
                      <IconButton type="button" label="移除照片" className="id-remove" onClick={clearImage}>
                        <Trash2 size={16} />
                      </IconButton>
                    </>
                  )}
                </div>
              </div>
            ) : (
              <button type="button" className="id-dropzone" onClick={openFilePicker} disabled={scanning}>
                <span className="dropzone-icon">
                  <Camera size={24} />
                </span>
                <strong>{scanning ? "正在识别身份证…" : "拍照或选择身份证人像面"}</strong>
                <span>JPG、PNG、WebP，最大 12MB</span>
                <span className="dropzone-cta">
                  <Upload size={15} /> 上传图片
                </span>
              </button>
            )}

            <p className="privacy-note">
              <ShieldCheck size={15} />
              照片仅保存在本机，不会发送给云 OCR 服务。
            </p>

            {scanError && (
              <div className="form-error-banner">
                <AlertTriangle size={16} /> {scanError}
              </div>
            )}

            {ocr && (
              <div className={`ocr-result ${ocr.ok ? "ocr-success" : "ocr-warning"}`}>
                <div className="ocr-result-head">
                  {ocr.ok ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
                  <div>
                    <strong>{ocr.ok ? "识别完成" : "识别服务未完成"}</strong>
                    <span>
                      {ocr.name ? `姓名 ${ocr.name.value}` : "姓名未识别"}
                      {ocr.id_number?.checksum_valid ? " · 号码校验通过" : ""}
                    </span>
                  </div>
                </div>
                {ocr.warnings.length > 0 && (
                  <ul className="ocr-warnings">
                    {ocr.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                )}
                {ocr.raw_lines.length > 0 && (
                  <details className="raw-ocr">
                    <summary>查看原始识别文本（{ocr.raw_lines.length} 行）</summary>
                    <div className="raw-ocr-list">
                      {ocr.raw_lines.map((line, index) => (
                        <div className="raw-ocr-line" key={`${line.text}-${index}`}>
                          <span>{line.text}</span>
                          <small>{Math.round(line.score * 100)}%</small>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            )}

            {!ocr && !scanError && (
              <div className="ocr-hint">
                <ScanLine size={18} />
                <p>识别后会把姓名和身份证号填入左侧表单，请逐项核对再保存。</p>
              </div>
            )}
          </section>

          <section className="scan-tips">
            <h3>拍摄小提示</h3>
            <ol>
              <li>使用身份证人像面，四角完整入镜。</li>
              <li>避免反光、阴影和手指遮挡。</li>
              <li>识别失败不影响保存，可以手工录入。</li>
            </ol>
          </section>
        </aside>

        <div className="form-actions-bar">
          <Button type="button" variant="secondary" onClick={() => navigate(-1)}>
            取消
          </Button>
          <Button type="submit" loading={saving} disabled={scanning}>
            {scanning ? "等待识别完成" : editing ? "保存修改" : "保存租客"}
          </Button>
        </div>
      </form>
    </div>
  );
}
