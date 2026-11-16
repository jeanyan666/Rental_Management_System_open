import { useNavigate } from "react-router-dom";
import { Building2, DoorOpen, Wrench } from "lucide-react";
import type { Property, Room } from "../types";
import { cn, leaseEndLabel, roomStatusLabels } from "../utils";
import { Button, EmptyState } from "./UI";

function floorSortValue(floor: string): number {
  const match = floor.match(/\d+/);
  return match ? Number(match[0]) : 999;
}

function floorLabel(floor: string): string {
  return floor.trim() || "未填楼层";
}

function groupRoomsByFloor(rooms: Room[]): { floor: string; rooms: Room[] }[] {
  const groups = new Map<string, Room[]>();
  for (const room of rooms) {
    const key = floorLabel(room.floor);
    const current = groups.get(key) || [];
    current.push(room);
    groups.set(key, current);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => floorSortValue(a) - floorSortValue(b) || a.localeCompare(b, "zh-CN"))
    .map(([floor, floorRooms]) => ({
      floor,
      rooms: floorRooms.sort((a, b) => a.name.localeCompare(b.name, "zh-CN", { numeric: true })),
    }));
}

function roomHint(room: Room): string {
  if (room.current_lease) {
    return `租客：${room.current_lease.tenant_name}；合同至 ${leaseEndLabel(room.current_lease.end_date)}`;
  }
  if (room.status === "vacant") return "空置，点击创建合同";
  if (room.status === "maintenance") return "维修中，点击查看房源";
  return roomStatusLabels[room.status];
}

export function RoomOverview({ properties }: { properties: Property[] }) {
  const navigate = useNavigate();

  const openRoom = (room: Room) => {
    if (room.current_lease?.tenant_id) {
      navigate(`/tenants/${room.current_lease.tenant_id}`);
      return;
    }
    if (room.status === "vacant") {
      navigate(`/leases?new=1&roomId=${room.id}`);
      return;
    }
    navigate("/properties");
  };

  return (
    <section className="panel room-overview-panel">
      <div className="panel-heading room-overview-heading">
        <div>
          <span className="eyebrow">ROOM MAP</span>
          <h2>房态一览</h2>
          <p>按楼层查看每一间房的出租情况。</p>
        </div>
        <div className="room-legend" aria-label="房态图例">
          <span className="room-legend-item">
            <i className="legend-dot occupied" /> 已租
          </span>
          <span className="room-legend-item">
            <i className="legend-dot vacant" /> 空置
          </span>
          <span className="room-legend-item">
            <i className="legend-dot maintenance" /> 维修
          </span>
        </div>
      </div>

      {properties.length ? (
        <div className="room-property-list">
          {properties.map((property) => {
            const floors = groupRoomsByFloor(property.rooms);
            return (
              <div className="room-property" key={property.id}>
                <div className="room-property-heading">
                  <div className="room-property-title">
                    <span className="property-mark small">
                      <Building2 size={17} />
                    </span>
                    <div>
                      <strong>{property.name}</strong>
                      <span>
                        {property.room_count} 间 · 已租 {property.occupied_count} · 空置{" "}
                        {property.vacant_count}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="text-link"
                    onClick={() => navigate("/properties")}
                  >
                    房源管理
                  </button>
                </div>

                {floors.length ? (
                  <div className="floor-list">
                    {floors.map(({ floor, rooms }) => {
                      const occupied = rooms.filter((room) => room.current_lease).length;
                      return (
                        <div className="floor-row" key={floor}>
                          <div className="floor-label">
                            <strong>{floor}</strong>
                            <span>
                              已租 {occupied} / {rooms.length}
                            </span>
                          </div>
                          <div className="floor-rooms">
                            {rooms.map((room) => (
                              <button
                                type="button"
                                key={room.id}
                                className={cn(
                                  "room-chip",
                                  `room-chip-${room.status}`,
                                  room.current_lease?.display_status === "expired" && "room-chip-expired",
                                )}
                                onClick={() => openRoom(room)}
                                title={roomHint(room)}
                                aria-label={`${room.name}，${roomHint(room)}`}
                              >
                                <span className="room-chip-id">{room.name}</span>
                                <span className="room-chip-state">
                                  {room.current_lease?.tenant_name ||
                                    (room.status === "maintenance" ? "维修中" : "空置")}
                                </span>
                                {room.status === "maintenance" && (
                                  <Wrench size={12} className="room-chip-icon" />
                                )}
                                {room.status === "vacant" && (
                                  <DoorOpen size={12} className="room-chip-icon" />
                                )}
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="room-overview-empty">这处房屋还没有房间。</div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon={<Building2 size={28} />}
          title="还没有房源"
          description="添加房屋和房间后，这里会按楼层显示房态。"
          action={
            <Button variant="secondary" size="sm" onClick={() => navigate("/properties")}>
              去添加房源
            </Button>
          }
        />
      )}
    </section>
  );
}
