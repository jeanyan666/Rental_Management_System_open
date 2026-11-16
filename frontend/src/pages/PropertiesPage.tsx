import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import {
  Building2,
  DoorOpen,
  MapPin,
  Pencil,
  Plus,
  Trash2,
  Wrench,
} from "lucide-react";
import { useAuth } from "../auth";
import { api, ApiError } from "../api";
import { useToast } from "../toast";
import type { Property, Room, RoomStatus } from "../types";
import {
  centsToInput,
  formatMoney,
  leaseEndLabel,
  leaseStatusLabels,
  roomStatusLabels,
  yuanToCents,
} from "../utils";
import {
  Button,
  ConfirmDialog,
  EmptyState,
  Field,
  IconButton,
  LoadingBlock,
  Modal,
  PageHeader,
  StatusPill,
} from "../components/UI";

interface PropertyFormState {
  name: string;
  address: string;
  note: string;
}

export function PropertiesPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const isViewer = user?.role === "viewer";
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [propertyDialog, setPropertyDialog] = useState<{ open: boolean; property: Property | null }>({
    open: false,
    property: null,
  });
  const [roomDialog, setRoomDialog] = useState<{
    open: boolean;
    propertyId: number | null;
    room: Room | null;
  }>({ open: false, propertyId: null, room: null });
  const [deleteTarget, setDeleteTarget] = useState<Property | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await api<{ properties: Property[] }>("/api/properties");
      setProperties(result.properties);
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 401)) {
        toast(error instanceof ApiError ? error.detail : "房源加载失败", "error");
      }
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const removeProperty = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api(`/api/properties/${deleteTarget.id}`, { method: "DELETE" });
      toast("房屋已删除", "success");
      setDeleteTarget(null);
      await load();
    } catch (error) {
      toast(error instanceof ApiError ? error.detail : "删除失败", "error");
    } finally {
      setDeleting(false);
    }
  };

  if (loading) return <LoadingBlock text="正在读取房源" />;

  const roomCount = properties.reduce((total, property) => total + property.room_count, 0);
  const vacantCount = properties.reduce((total, property) => total + property.vacant_count, 0);

  return (
    <div className="page">
      <PageHeader
        eyebrow="PROPERTIES"
        title="房源"
        description={
          roomCount
            ? `共 ${properties.length} 处房屋、${roomCount} 个房间，其中 ${vacantCount} 间待租。`
            : "先把房屋和房间安顿好，租客与合同才好落位。"
        }
        actions={
          isViewer ? undefined : (
            <Button
              icon={<Plus size={17} />}
              onClick={() => setPropertyDialog({ open: true, property: null })}
            >
              新增房屋
            </Button>
          )
        }
      />

      {!properties.length ? (
        <div className="panel">
          <EmptyState
            icon={<Building2 size={30} />}
            title="还没有房源"
            description="添加第一处房屋，再为它建立房间。整租可以只建一个房间，分租则按实际房间添加。"
            action={
              isViewer ? undefined : (
                <Button onClick={() => setPropertyDialog({ open: true, property: null })}>
                  添加第一处房屋
                </Button>
              )
            }
          />
        </div>
      ) : (
        <div className="property-list">
          {properties.map((property) => (
            <section className="property-card" key={property.id}>
              <header className="property-header">
                <div className="property-heading">
                  <span className="property-mark">
                    <Building2 size={20} />
                  </span>
                  <div>
                    <div className="property-title-row">
                      <h2>{property.name}</h2>
                      <span className="mini-badge">{property.room_count} 间</span>
                    </div>
                    <p className="property-address">
                      <MapPin size={14} />
                      {property.address || "未填写地址"}
                    </p>
                  </div>
                </div>
                {!isViewer && (
                  <div className="property-actions">
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={<Plus size={15} />}
                      onClick={() => setRoomDialog({ open: true, propertyId: property.id, room: null })}
                    >
                      房间
                    </Button>
                    <IconButton
                      label="编辑房屋"
                      onClick={() => setPropertyDialog({ open: true, property })}
                    >
                      <Pencil size={16} />
                    </IconButton>
                    <IconButton label="删除房屋" onClick={() => setDeleteTarget(property)}>
                      <Trash2 size={16} />
                    </IconButton>
                  </div>
                )}
              </header>

              {property.note && <p className="property-note">{property.note}</p>}

              {property.rooms.length ? (
                <div className="room-grid">
                  {property.rooms.map((room) => (
                    <article className={`room-card room-${room.status}`} key={room.id}>
                      <div className="room-card-top">
                        <div>
                          <span className="room-name">{room.name}</span>
                          <span className="room-sub">
                            {room.floor || "楼层未填"}
                            {room.area ? ` · ${room.area}㎡` : ""}
                          </span>
                        </div>
                        <StatusPill kind={room.status} label={roomStatusLabels[room.status]} />
                      </div>

                      <div className="room-tenant">
                        {room.current_lease ? (
                          <>
                            <span className="tenant-dot" />
                            <div>
                              <strong>{room.current_lease.tenant_name}</strong>
                              <small>
                                {leaseStatusLabels[room.current_lease.display_status]} · 至{" "}
                                {leaseEndLabel(room.current_lease.end_date).replace(/-/g, ".")}
                              </small>
                            </div>
                          </>
                        ) : room.status === "maintenance" ? (
                          <>
                            <Wrench size={16} />
                            <div>
                              <strong>维修中</strong>
                              <small>暂不可签约</small>
                            </div>
                          </>
                        ) : (
                          <>
                            <DoorOpen size={16} />
                            <div>
                              <strong>等待新租客</strong>
                              <small>可随时创建合同</small>
                            </div>
                          </>
                        )}
                      </div>

                      <div className="room-card-foot">
                        <span className="room-rent">
                          {formatMoney(room.rent_cents)}
                          <small>/月</small>
                        </span>
                        <div className="room-foot-actions">
                          {!isViewer && (
                            <button
                              type="button"
                              className="text-button"
                              onClick={() => setRoomDialog({ open: true, propertyId: property.id, room })}
                            >
                              编辑
                            </button>
                          )}
                          {room.current_lease ? (
                            <button
                              type="button"
                              className="text-button accent"
                              onClick={() => navigate(`/tenants/${room.current_lease?.tenant_id}`)}
                            >
                              查看租客
                            </button>
                          ) : !isViewer && room.status === "vacant" ? (
                            <button
                              type="button"
                              className="text-button accent"
                              onClick={() => navigate(`/leases?new=1&roomId=${room.id}`)}
                            >
                              出租
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </article>
                  ))}
                  {!isViewer && (
                    <button
                      type="button"
                      className="room-add-card"
                      onClick={() => setRoomDialog({ open: true, propertyId: property.id, room: null })}
                    >
                      <Plus size={19} />
                      <span>新增房间</span>
                    </button>
                  )}
                </div>
              ) : isViewer ? (
                <div className="room-empty room-empty-readonly">这处房屋还没有房间</div>
              ) : (
                <button
                  type="button"
                  className="room-empty"
                  onClick={() => setRoomDialog({ open: true, propertyId: property.id, room: null })}
                >
                  <Plus size={17} />
                  这处房屋还没有房间，点击添加
                </button>
              )}
            </section>
          ))}
        </div>
      )}

      <PropertyDialog
        open={propertyDialog.open}
        property={propertyDialog.property}
        onClose={() => setPropertyDialog({ open: false, property: null })}
        onSaved={async () => {
          setPropertyDialog({ open: false, property: null });
          await load();
        }}
      />

      <RoomDialog
        open={roomDialog.open}
        propertyId={roomDialog.propertyId}
        room={roomDialog.room}
        onClose={() => setRoomDialog({ open: false, propertyId: null, room: null })}
        onSaved={async () => {
          setRoomDialog({ open: false, propertyId: null, room: null });
          await load();
        }}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={removeProperty}
        title="删除这处房屋？"
        description={`删除「${deleteTarget?.name || ""}」后无法恢复。如果房屋下还有房间，需要先删除房间。`}
        confirmLabel="删除房屋"
        danger
        loading={deleting}
      />
    </div>
  );
}

function PropertyDialog({
  open,
  property,
  onClose,
  onSaved,
}: {
  open: boolean;
  property: Property | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState<PropertyFormState>({ name: "", address: "", note: "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setForm({
        name: property?.name || "",
        address: property?.address || "",
        note: property?.note || "",
      });
      setError("");
    }
  }, [open, property]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (!form.name.trim()) {
      setError("请填写房屋名称");
      return;
    }
    setSaving(true);
    try {
      if (property) {
        await api(`/api/properties/${property.id}`, {
          method: "PATCH",
          body: JSON.stringify(form),
        });
        toast("房屋信息已更新", "success");
      } else {
        await api("/api/properties", { method: "POST", body: JSON.stringify(form) });
        toast("房屋已添加", "success");
      }
      await onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={property ? "编辑房屋" : "新增房屋"}
      subtitle="一处房屋下可以有多个房间。"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button type="submit" form="property-form" loading={saving}>
            {property ? "保存修改" : "添加房屋"}
          </Button>
        </>
      }
    >
      <form id="property-form" onSubmit={submit} className="stack-form">
        <Field label="房屋名称" htmlFor="property-name" required>
          <input
            id="property-name"
            className="input"
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            placeholder="例如：梧桐公寓"
            autoFocus
          />
        </Field>
        <Field label="地址" htmlFor="property-address">
          <input
            id="property-address"
            className="input"
            value={form.address}
            onChange={(event) => setForm({ ...form, address: event.target.value })}
            placeholder="例如：北京市朝阳区示例路 8 号"
          />
        </Field>
        <Field label="备注" htmlFor="property-note">
          <textarea
            id="property-note"
            className="input textarea"
            value={form.note}
            onChange={(event) => setForm({ ...form, note: event.target.value })}
            placeholder="门禁、停车、物业等备注"
            rows={3}
          />
        </Field>
        {error && <div className="form-error-banner">{error}</div>}
      </form>
    </Modal>
  );
}

interface RoomFormState {
  name: string;
  floor: string;
  area: string;
  rent: string;
  status: RoomStatus;
  note: string;
}

function RoomDialog({
  open,
  propertyId,
  room,
  onClose,
  onSaved,
}: {
  open: boolean;
  propertyId: number | null;
  room: Room | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState<RoomFormState>({
    name: "",
    floor: "",
    area: "",
    rent: "",
    status: "vacant",
    note: "",
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const occupiedLocked = room?.status === "occupied" && Boolean(room.current_lease);

  useEffect(() => {
    if (open) {
      setForm({
        name: room?.name || "",
        floor: room?.floor || "",
        area: room?.area != null ? String(room.area) : "",
        rent: room ? centsToInput(room.rent_cents) : "",
        status: room?.status || "vacant",
        note: room?.note || "",
      });
      setError("");
    }
  }, [open, room]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (!form.name.trim()) {
      setError("请填写房间名称");
      return;
    }
    setSaving(true);
    const payload = {
      name: form.name.trim(),
      floor: form.floor.trim(),
      area: form.area ? Number(form.area) : null,
      rent_cents: yuanToCents(form.rent),
      status: occupiedLocked ? "occupied" : form.status,
      note: form.note,
    };
    try {
      if (room) {
        await api(`/api/rooms/${room.id}`, { method: "PATCH", body: JSON.stringify(payload) });
        toast("房间信息已更新", "success");
      } else {
        await api(`/api/properties/${propertyId}/rooms`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
        toast("房间已添加", "success");
      }
      await onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={room ? `编辑房间 · ${room.name}` : "新增房间"}
      subtitle="整租房源可以只建立一个房间。"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button type="submit" form="room-form" loading={saving}>
            {room ? "保存修改" : "添加房间"}
          </Button>
        </>
      }
    >
      <form id="room-form" onSubmit={submit} className="stack-form">
        <div className="form-grid-2">
          <Field label="房间名称" htmlFor="room-name" required>
            <input
              id="room-name"
              className="input"
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              placeholder="例如：A-201"
              autoFocus
            />
          </Field>
          <Field label="楼层" htmlFor="room-floor">
            <input
              id="room-floor"
              className="input"
              value={form.floor}
              onChange={(event) => setForm({ ...form, floor: event.target.value })}
              placeholder="例如：2 层"
            />
          </Field>
        </div>
        <div className="form-grid-2">
          <Field label="面积（㎡）" htmlFor="room-area">
            <input
              id="room-area"
              className="input"
              type="number"
              min="0"
              step="0.1"
              value={form.area}
              onChange={(event) => setForm({ ...form, area: event.target.value })}
              placeholder="例如：28"
            />
          </Field>
          <Field label="默认月租（元）" htmlFor="room-rent">
            <input
              id="room-rent"
              className="input"
              type="number"
              min="0"
              step="1"
              value={form.rent}
              onChange={(event) => setForm({ ...form, rent: event.target.value })}
              placeholder="例如：3200"
            />
          </Field>
        </div>
        <Field
          label="房间状态"
          htmlFor="room-status"
          hint={occupiedLocked ? "该房间有未结束的合同，办理退租后才会变为空置。" : undefined}
        >
          <select
            id="room-status"
            className="input select"
            value={occupiedLocked ? "occupied" : form.status}
            onChange={(event) => setForm({ ...form, status: event.target.value as RoomStatus })}
            disabled={occupiedLocked}
          >
            {occupiedLocked && <option value="occupied">已租</option>}
            <option value="vacant">空置</option>
            <option value="maintenance">维修中</option>
          </select>
        </Field>
        <Field label="备注" htmlFor="room-note">
          <textarea
            id="room-note"
            className="input textarea"
            value={form.note}
            onChange={(event) => setForm({ ...form, note: event.target.value })}
            placeholder="房间配置、特殊情况等"
            rows={3}
          />
        </Field>
        {error && <div className="form-error-banner">{error}</div>}
      </form>
    </Modal>
  );
}
