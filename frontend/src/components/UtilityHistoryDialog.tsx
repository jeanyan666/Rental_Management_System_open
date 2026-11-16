import { useEffect, useState } from "react";
import { ArrowRight, Droplets, History, Zap } from "lucide-react";
import { api, ApiError } from "../api";
import { useToast } from "../toast";
import type { UtilityHistory, UtilityRoomRow } from "../types";
import {
  formatDate,
  formatMoney,
  formatPeriod,
  formatUsage,
  milliToInput,
} from "../utils";
import { EmptyState, LoadingBlock, Modal } from "./UI";

export function UtilityHistoryDialog({
  room,
  onClose,
}: {
  room: UtilityRoomRow | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [data, setData] = useState<UtilityHistory | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!room) {
      setData(null);
      return;
    }
    let active = true;
    setLoading(true);
    api<UtilityHistory>(`/api/utilities/rooms/${room.room_id}/history`)
      .then((result) => {
        if (active) setData(result);
      })
      .catch((error) => {
        if (active) {
          toast(error instanceof ApiError ? error.detail : "历史记录加载失败", "error");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [room, toast]);

  const records = data?.records || [];
  const recent = records[0];

  return (
    <Modal
      open={Boolean(room)}
      onClose={onClose}
      title={room ? `${room.property_name} · ${room.room_name}` : "历史记录"}
      subtitle={room ? `${room.floor || "未填楼层"} · 最近 36 个月抄表记录` : undefined}
      width={800}
    >
      {loading ? (
        <LoadingBlock text="正在读取历史抄表" />
      ) : records.length ? (
        <div className="utility-history">
          {recent && (
            <div className="utility-history-summary">
              <div>
                <span>最近一次抄表</span>
                <strong>{formatPeriod(recent.period)}</strong>
              </div>
              <div>
                <span>水费</span>
                <strong>{formatMoney(recent.water_amount_cents)}</strong>
              </div>
              <div>
                <span>电费</span>
                <strong>{formatMoney(recent.electricity_amount_cents)}</strong>
              </div>
              <div>
                <span>合计</span>
                <strong>{formatMoney(recent.total_cents)}</strong>
              </div>
            </div>
          )}

          <div className="table-panel utility-history-table">
            <table className="data-table">
              <thead>
                <tr>
                  <th>月份</th>
                  <th>水表</th>
                  <th>电表</th>
                  <th>合计</th>
                  <th>收款</th>
                </tr>
              </thead>
              <tbody>
                {records.map((record) => (
                  <tr key={record.id}>
                    <td data-label="月份">
                      <div className="cell-stack">
                        <strong>{formatPeriod(record.period)}</strong>
                        <small>{formatDate(record.reading_date)}</small>
                        {record.note && <small className="history-note">{record.note}</small>}
                      </div>
                    </td>
                    <td data-label="水表">
                      <div className="history-meter">
                        <span>
                          <Droplets size={12} />
                          {milliToInput(record.water_prev_milli)}
                          <ArrowRight size={11} />
                          {milliToInput(record.water_current_milli)}
                        </span>
                        <small>
                          用量 {formatUsage(record.water_usage_milli)} 吨 ·{" "}
                          {formatMoney(record.water_amount_cents)}
                        </small>
                      </div>
                    </td>
                    <td data-label="电表">
                      <div className="history-meter">
                        <span>
                          <Zap size={12} />
                          {milliToInput(record.electricity_prev_milli)}
                          <ArrowRight size={11} />
                          {milliToInput(record.electricity_current_milli)}
                        </span>
                        <small>
                          用量 {formatUsage(record.electricity_usage_milli)} 度 ·{" "}
                          {formatMoney(record.electricity_amount_cents)}
                        </small>
                      </div>
                    </td>
                    <td data-label="合计">
                      <strong className="utility-total">{formatMoney(record.total_cents)}</strong>
                    </td>
                    <td data-label="收款">
                      {record.is_paid ? (
                        <span className="utility-pay utility-pay-paid">已收</span>
                      ) : (
                        <span className="utility-pay utility-pay-unpaid">未收</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <EmptyState
          icon={<History size={26} />}
          title="还没有历史记录"
          description="完成第一次抄表后，历史记录会出现在这里。"
        />
      )}
    </Modal>
  );
}
