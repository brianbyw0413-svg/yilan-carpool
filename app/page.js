"use client";
import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";
import liff from "@line/liff";

/* ─── Constants ─── */
const LIFF_ID = "2009262593-SeB2VF83";
const LINE_OA_ID = "@835acfgq";
const LINE_OA_URL = `https://line.me/R/oaMessage/${LINE_OA_ID}/`;
const LIFF_BOOKING_URL = "https://liff.line.me/2009218677-iJIIF1oj";
const YILAN_AREAS = [
  "宜蘭市", "羅東鎮", "頭城鎮", "礁溪鄉", "蘇澳鎮",
  "員山鄉", "壯圍鄉", "五結鄉", "冬山鄉", "三星鄉",
  "大同鄉", "南澳鄉", "其他"
];
const TAIPEI_AREAS = [
  "台北車站", "南港", "信義區", "大安區", "中山區",
  "內湖區", "松山區", "板橋", "中和/永和", "新店",
  "三重/蘆洲", "其他"
];
const TIME_SLOTS = [
  "05:00", "05:30", "06:00", "06:30", "07:00", "07:30",
  "08:00", "08:30", "09:00", "10:00", "11:00", "12:00",
  "14:00", "15:00", "16:00", "17:00", "17:30", "18:00",
  "18:30", "19:00", "19:30", "20:00", "21:00", "22:00",
];

const DISCLAIMER_TEXT = "此共乘平台為無償使用，僅提供乘客與司機媒合空間，本網站不對雙方收取任何費用，共乘行程若產生費用，由司機與乘客雙方自行議定，所衍生之一切糾紛與本網站無涉。";
const PRIORITY_MINUTES = 30;

function getTomorrow() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().split("T")[0];
}
function getToday() { return new Date().toISOString().split("T")[0]; }
function formatDate(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const wd = ["日", "一", "二", "三", "四", "五", "六"][d.getDay()];
  return `${d.getMonth() + 1}/${d.getDate()} (${wd})`;
}

/* ─── 行程層級判斷（僅適用乘客發起的行程） ─── */
function getRideLayer(ride) {
  if (ride.status === "matched") return "matched";
  if (ride.role === "driver") return "public"; // 駕駛行程不走三層，直接公開
  const now = Date.now();
  const expiresAt = ride.priority_expires_at ? new Date(ride.priority_expires_at).getTime() : 0;
  const created = new Date(ride.created_at || ride.priority_expires_at).getTime();
  const hoursSince = (now - created) / 3600000;
  if (expiresAt && now < expiresAt) return "priority";
  if (hoursSince < 48) return "public";
  return "fallback";
}

/* ─── 倒數 ─── */
function PriorityCountdown({ expiresAt }) {
  const [rem, setRem] = useState("");
  useEffect(() => {
    const dl = new Date(expiresAt).getTime();
    const tick = () => {
      const diff = dl - Date.now();
      if (diff <= 0) { setRem(""); return; }
      setRem(`${Math.floor(diff / 60000)}:${String(Math.floor((diff % 60000) / 1000)).padStart(2, "0")}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);
  if (!rem) return null;
  return <span style={{ fontSize: 10, color: "var(--orange)", marginLeft: 6 }}>{rem}</span>;
}

/* ════════════════════════════════════════ */
export default function CarpoolPage() {
  const [direction, setDirection] = useState("to_taipei");
  const [rides, setRides] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showDisclaimer, setShowDisclaimer] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [pendingRide, setPendingRide] = useState(null);

  const [liffReady, setLiffReady] = useState(false);
  const [liffUser, setLiffUser] = useState(null);

  /* 每秒更新（驅動倒數） */
  const [, setTick] = useState(0);
  useEffect(() => { const id = setInterval(() => setTick(t => t + 1), 1000); return () => clearInterval(id); }, []);

  /* LIFF */
  useEffect(() => {
    liff.init({ liffId: LIFF_ID })
      .then(async () => {
        setLiffReady(true);
        if (liff.isLoggedIn()) {
          try {
            const profile = await liff.getProfile();
            let phone = "";
            try {
              const pd = await liff.getPhoneNumber();
              if (pd) {
                let d = pd.replace(/\D/g, "");
                phone = d.startsWith("886") && d.length >= 12 ? "0" + d.slice(3) : d.startsWith("09") ? d.slice(0, 10) : d;
              }
            } catch {}
            setLiffUser({ uid: profile.userId, name: profile.displayName, phone });
          } catch {}
        }
      })
      .catch(() => setLiffReady(true));
  }, []);

  /* Form */
  const [form, setForm] = useState({
    role: "passenger", // passenger | driver
    name: "", phone: "", direction: "to_taipei",
    date: getTomorrow(), time: "07:00",
    pickup: "", dropoff: "", meetingPoint: "",
    passengers: "1", seats: "3", note: "",
  });
  const u = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const pickupAreas = form.direction === "to_taipei" ? YILAN_AREAS : TAIPEI_AREAS;
  const dropoffAreas = form.direction === "to_taipei" ? TAIPEI_AREAS : YILAN_AREAS;

  /* Fetch */
  const fetchRides = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("carpool_rides").select("*")
      .gte("ride_date", getToday())
      .in("status", ["priority", "public", "matched"])
      .order("ride_date", { ascending: true })
      .order("ride_time", { ascending: true });
    if (!error) setRides(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchRides(); const id = setInterval(fetchRides, 30000); return () => clearInterval(id); }, [fetchRides]);

  const filteredRides = rides.filter(r => r.direction === direction);

  /* Open form */
  const openForm = () => {
    setForm(p => ({
      ...p, direction,
      name: p.name || liffUser?.name || "",
      phone: p.phone || liffUser?.phone || "",
    }));
    setShowForm(true);
  };

  /* Submit → disclaimer */
  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.name || !form.pickup || !form.dropoff) return;
    const isDriver = form.role === "driver";
    setPendingRide({
      role: form.role,
      passenger_name: form.name,
      passenger_phone: form.phone || null,
      passenger_line_uid: liffUser?.uid || "web_user",
      direction: form.direction,
      ride_date: form.date,
      ride_time: form.time,
      pickup_location: form.pickup,
      dropoff_location: form.dropoff,
      meeting_point: form.meetingPoint || null,
      passenger_count: isDriver ? parseInt(form.seats) : parseInt(form.passengers),
      note: form.note || null,
      status: isDriver ? "public" : "priority",
      priority_expires_at: isDriver ? null : new Date(Date.now() + PRIORITY_MINUTES * 60000).toISOString(),
    });
    setShowForm(false);
    setShowDisclaimer(true);
  };

  /* Confirm → insert */
  const confirmDisclaimer = async () => {
    if (!pendingRide) return;
    setSubmitting(true);
    const { error } = await supabase.from("carpool_rides").insert([pendingRide]).select();
    if (error) { alert("發布失敗，請稍後再試"); console.error(error); }
    else {
      setForm({ role: "passenger", name: liffUser?.name || "", phone: liffUser?.phone || "", direction: form.direction, date: getTomorrow(), time: "07:00", pickup: "", dropoff: "", meetingPoint: "", passengers: "1", seats: "3", note: "" });
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 4000);
      fetchRides();
    }
    setShowDisclaimer(false); setPendingRide(null); setSubmitting(false);
  };

  /* 聯繫 */
  const handleContact = (ride) => {
    const isDriver = ride.role === "driver";
    const label = isDriver ? "我想搭便車" : "我可以載您";
    const msg = `${label}：\n${formatDate(ride.ride_date)} ${ride.ride_time.slice(0, 5)}\n${ride.pickup_location} → ${ride.dropoff_location}${ride.meeting_point ? `\n地點：${ride.meeting_point}` : ""}\n${isDriver ? `可載${ride.passenger_count}人` : `${ride.passenger_count}位乘客`}`;
    const url = `${LINE_OA_URL}?text=${encodeURIComponent(msg)}`;
    if (liffReady && liff.isInClient()) liff.openWindow({ url, external: true });
    else window.open(url, "_blank");
  };

  const handleProBooking = () => {
    if (liffReady && liff.isInClient()) liff.openWindow({ url: LIFF_BOOKING_URL, external: false });
    else window.open(LIFF_BOOKING_URL, "_blank");
  };

  /* ─── Badge ─── */
  const StatusBadge = ({ ride }) => {
    const layer = getRideLayer(ride);
    const isDriver = ride.role === "driver";
    if (layer === "matched") return <span className="ride-status matched">已媒合</span>;
    if (layer === "priority") return (
      <span className="ride-status priority">司機配對中<PriorityCountdown expiresAt={ride.priority_expires_at} /></span>
    );
    if (layer === "fallback") return <span className="ride-status fallback">推薦專業接送</span>;
    return <span className={`ride-status ${isDriver ? "driver" : "available"}`}>
      {isDriver ? "找乘客" : "找司機"}
    </span>;
  };

  /* ─── 角色標籤 ─── */
  const RoleTag = ({ role }) => (
    <span className={`role-tag ${role}`}>
      {role === "driver" ? "🚗 駕駛" : "🙋 乘客"}
    </span>
  );

  /* ─── Action ─── */
  const RideAction = ({ ride }) => {
    const layer = getRideLayer(ride);
    const isDriver = ride.role === "driver";
    if (layer === "matched") return null;
    if (layer === "priority") return <div className="ride-priority-hint">司機 30 分鐘內優先接單，請稍候</div>;
    if (layer === "fallback") return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <button onClick={() => handleContact(ride)} className="ride-contact-btn secondary">聯繫共乘</button>
        <button onClick={handleProBooking} className="ride-contact-btn">PickYouUP 專業接送</button>
      </div>
    );
    return (
      <button onClick={() => handleContact(ride)} className="ride-contact-btn">
        {isDriver ? "我要搭便車" : "我來載"}
      </button>
    );
  };

  /* ════════════ RENDER ════════════ */
  return (
    <div>
      {/* ─── Header ─── */}
      <header className="header">
        <a href="https://pickyouup.tw" target="_blank" rel="noopener noreferrer">
          <img src="/logo-gold.png" alt="PickYouUP" className="header-logo" style={{ cursor: "pointer" }} />
        </a>
        <div style={{ textAlign: "right" }}>
          <div className="header-title">宜蘭共乘平台</div>
          {liffUser
            ? <div className="header-subtitle" style={{ color: "#4caf50" }}>{liffUser.name}</div>
            : <div className="header-subtitle">YILAN CARPOOL</div>
          }
        </div>
      </header>

      {/* ─── Direction Tabs ─── */}
      <div className="direction-tabs">
        <button className={`direction-tab ${direction === "to_taipei" ? "active" : ""}`} onClick={() => setDirection("to_taipei")}>宜蘭 → 台北</button>
        <button className={`direction-tab ${direction === "to_yilan" ? "active" : ""}`} onClick={() => setDirection("to_yilan")}>台北 → 宜蘭</button>
      </div>

      {/* ─── Ride Cards ─── */}
      <div className="rides-container">
        {loading ? (
          <div className="empty-state">
            <div className="empty-state-icon" style={{ animation: "pulse 1.5s infinite" }}>🔄</div>
            <div className="empty-state-text">載入中...</div>
          </div>
        ) : filteredRides.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">🚗</div>
            <div className="empty-state-text">目前沒有{direction === "to_taipei" ? "往台北" : "往宜蘭"}的共乘</div>
            <div className="empty-state-sub">點右下角 + 發布你的共乘需求</div>
          </div>
        ) : (
          filteredRides.map((ride) => (
            <div key={ride.id} className={`ride-card ride-card-${getRideLayer(ride)}`}>
              <div className="ride-card-header">
                <span className="ride-date">{formatDate(ride.ride_date)} {ride.ride_time.slice(0, 5)}</span>
                <StatusBadge ride={ride} />
              </div>

              <div className="ride-route">
                <span className="ride-location">{ride.pickup_location}</span>
                <span className="ride-arrow">→</span>
                <span className="ride-location">{ride.dropoff_location}</span>
              </div>

              <div className="ride-meta">
                <RoleTag role={ride.role || "passenger"} />
                <span>{ride.passenger_name}</span>
                <span>{ride.role === "driver" ? `可載${ride.passenger_count}人` : `${ride.passenger_count}位乘客`}</span>
              </div>
              {ride.meeting_point && <div className="ride-meeting">📍 {ride.meeting_point}</div>}
              {ride.note && <div className="ride-meeting">{ride.note}</div>}

              <RideAction ride={ride} />
            </div>
          ))
        )}
      </div>

      {/* ─── FAB ─── */}
      <button className="fab" onClick={openForm} aria-label="發布共乘">+</button>

      {/* ─── Form Modal ─── */}
      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-handle" />
            <div className="modal-title">發布共乘需求</div>

            <form onSubmit={handleSubmit}>
              {/* 角色選擇 */}
              <div className="form-group">
                <label className="form-label">我的角色</label>
                <div className="role-selector">
                  <button type="button" className={`role-option ${form.role === "passenger" ? "active" : ""}`} onClick={() => u("role", "passenger")}>
                    <span className="role-option-icon">🙋</span>
                    <span className="role-option-title">我是乘客</span>
                    <span className="role-option-desc">需要找司機載我</span>
                  </button>
                  <button type="button" className={`role-option ${form.role === "driver" ? "active" : ""}`} onClick={() => u("role", "driver")}>
                    <span className="role-option-icon">🚗</span>
                    <span className="role-option-title">我是駕駛</span>
                    <span className="role-option-desc">順路可以載人</span>
                  </button>
                </div>
              </div>

              {/* 方向 */}
              <div className="form-group">
                <label className="form-label">方向</label>
                <div style={{ display: "flex", borderRadius: 8, overflow: "hidden", border: "1px solid var(--border)" }}>
                  {[["to_taipei", "宜蘭 → 台北"], ["to_yilan", "台北 → 宜蘭"]].map(([val, label]) => (
                    <button key={val} type="button" onClick={() => u("direction", val)} style={{
                      flex: 1, padding: 10, border: "none", cursor: "pointer", fontSize: 14, fontWeight: 700,
                      background: form.direction === val ? "var(--gold)" : "transparent",
                      color: form.direction === val ? "#000" : "var(--text-dim)",
                    }}>{label}</button>
                  ))}
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">您的稱呼</label>
                <input type="text" className="form-input" placeholder="例：王小姐" value={form.name} onChange={(e) => u("name", e.target.value)} required />
              </div>

              <div className="form-group">
                <label className="form-label">聯絡電話（選填）</label>
                <input type="tel" className="form-input" placeholder="0912-345-678" value={form.phone} onChange={(e) => u("phone", e.target.value)} />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">日期</label>
                  <input type="date" className="form-input" value={form.date} min={getToday()} onChange={(e) => u("date", e.target.value)} required />
                </div>
                <div className="form-group">
                  <label className="form-label">時間</label>
                  <select className="form-select" value={form.time} onChange={(e) => u("time", e.target.value)}>
                    {TIME_SLOTS.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">上車地區</label>
                  <select className="form-select" value={form.pickup} onChange={(e) => u("pickup", e.target.value)} required>
                    <option value="">請選擇</option>
                    {pickupAreas.map(a => <option key={a} value={a}>{a}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">下車地區</label>
                  <select className="form-select" value={form.dropoff} onChange={(e) => u("dropoff", e.target.value)} required>
                    <option value="">請選擇</option>
                    {dropoffAreas.map(a => <option key={a} value={a}>{a}</option>)}
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">{form.role === "driver" ? "可上車地點" : "詳細上車地點"}</label>
                <input type="text" className="form-input"
                  placeholder={form.role === "driver" ? "例：可在礁溪轉運站、宜蘭火車站接" : "例：礁溪轉運站、宜蘭火車站、南港高鐵站"}
                  value={form.meetingPoint} onChange={(e) => u("meetingPoint", e.target.value)} />
                <div style={{ fontSize: 11, color: "var(--orange)", marginTop: 4, lineHeight: 1.5 }}>
                  {form.role === "driver" ? "填寫您沿途方便停靠的站點" : "請儘量填寫沿途公共運輸站點，方便司機安排路線"}
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">{form.role === "driver" ? "可載人數" : "乘客人數"}</label>
                <select className="form-select"
                  value={form.role === "driver" ? form.seats : form.passengers}
                  onChange={(e) => u(form.role === "driver" ? "seats" : "passengers", e.target.value)}>
                  {(form.role === "driver" ? [1, 2, 3, 4, 5, 6, 7] : [1, 2, 3, 4]).map(n =>
                    <option key={n} value={n}>{n} 位</option>
                  )}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">備註（選填）</label>
                <textarea className="form-textarea"
                  placeholder={form.role === "driver" ? "例：每日固定通勤，歡迎長期共乘" : "例：可在礁溪交流道上車"}
                  value={form.note} onChange={(e) => u("note", e.target.value)} rows={2} />
              </div>

              <button type="submit" className="form-submit" disabled={!form.name || !form.pickup || !form.dropoff}>
                {form.role === "driver" ? "發布駕駛行程" : "送出共乘需求"}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ─── Disclaimer ─── */}
      {showDisclaimer && (
        <div className="modal-overlay">
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-handle" />
            <div className="modal-title">共乘免責聲明</div>
            <div className="disclaimer-box">{DISCLAIMER_TEXT}</div>
            <button className="disclaimer-btn" onClick={confirmDisclaimer} disabled={submitting}>
              {submitting ? "處理中..." : "我已了解，確認送出"}
            </button>
            <button onClick={() => { setShowDisclaimer(false); setPendingRide(null); }} disabled={submitting}
              style={{ width: "100%", padding: 12, marginTop: 8, background: "transparent", border: "1px solid var(--border)", borderRadius: 10, color: "var(--text-dim)", fontSize: 14, cursor: "pointer" }}>
              取消
            </button>
          </div>
        </div>
      )}

      {/* ─── Success ─── */}
      {showSuccess && (
        <div style={{ position: "fixed", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.85)", zIndex: 300 }} onClick={() => setShowSuccess(false)}>
          <div className="success-check">✅</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: "var(--gold)", marginBottom: 16 }}>
            {pendingRide?.role === "driver" ? "駕駛行程已發布！" : "共乘需求已發布！"}
          </div>
          <div style={{ fontSize: 13, color: "var(--text-dim)", textAlign: "center", lineHeight: 2, padding: "0 32px" }}>
            {pendingRide?.role === "driver"
              ? "乘客看到後將透過 LINE 與您聯繫"
              : <>① 司機 30 分鐘內優先接單<br />② 之後開放其他乘客共乘配對<br />③ 媒合結果將透過 LINE 通知您</>
            }
          </div>
        </div>
      )}

      {/* ─── Footer ─── */}
      <footer className="footer">
        <a href="https://pickyouup.tw" target="_blank" rel="noopener noreferrer" className="footer-ad">
          <img src="/logo-gold.png" alt="PickYouUP" style={{ height: 20 }} />
          <span className="footer-ad-text">需要機場接送？PickYouUP 為您服務</span>
        </a>
        <div className="footer-copy">&copy; 2026 PICKYOUUP.TW — 宜蘭共乘平台</div>
      </footer>
    </div>
  );
}
