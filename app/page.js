"use client";
import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";
import liff from "@line/liff";

/* ─── Constants ─── */
const LIFF_ID = "2009262593-SeB2VF83";
const LINE_OA_ID = "@835acfgq";
const LINE_OA_URL = `https://line.me/R/oaMessage/${LINE_OA_ID}/`;
const LIFF_BOOKING_URL = "https://liff.line.me/2009218677-iJIIF1oj"; // 預約站 LIFF
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

function getToday() {
  return new Date().toISOString().split("T")[0];
}

function formatDate(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const weekday = ["日", "一", "二", "三", "四", "五", "六"][d.getDay()];
  return `${d.getMonth() + 1}/${d.getDate()} (${weekday})`;
}

/* ─── 判斷行程目前所在層級 ─── */
function getRideLayer(ride) {
  if (ride.status === "matched") return "matched";
  const now = Date.now();
  const created = new Date(ride.created_at || ride.priority_expires_at).getTime();
  const expiresAt = ride.priority_expires_at ? new Date(ride.priority_expires_at).getTime() : (created + PRIORITY_MINUTES * 60 * 1000);
  const hoursSinceCreated = (now - created) / (1000 * 60 * 60);

  if (now < expiresAt) return "priority";   // 第一層：司機優先配對中
  if (hoursSinceCreated < 48) return "public"; // 第二層：開放共乘配對
  return "fallback";                          // 第三層：推薦專業接送
}

/* ─── 優先倒數計時 ─── */
function PriorityCountdown({ expiresAt }) {
  const [remaining, setRemaining] = useState("");

  useEffect(() => {
    const deadline = new Date(expiresAt).getTime();
    const tick = () => {
      const diff = deadline - Date.now();
      if (diff <= 0) { setRemaining(""); return; }
      const m = Math.floor(diff / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setRemaining(`${m}:${String(s).padStart(2, "0")}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  if (!remaining) return null;
  return <span style={{ fontSize: 10, color: "var(--orange)", marginLeft: 6 }}>{remaining}</span>;
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
  const [now, setNow] = useState(Date.now());

  /* LIFF state */
  const [liffReady, setLiffReady] = useState(false);
  const [liffUser, setLiffUser] = useState(null);

  /* LIFF 初始化 */
  useEffect(() => {
    liff.init({ liffId: LIFF_ID })
      .then(async () => {
        setLiffReady(true);
        if (liff.isLoggedIn()) {
          try {
            const profile = await liff.getProfile();
            let phone = "";
            try {
              const phoneData = await liff.getPhoneNumber();
              if (phoneData) {
                let digits = phoneData.replace(/\D/g, "");
                if (digits.startsWith("886") && digits.length >= 12) {
                  phone = "0" + digits.slice(3);
                } else if (digits.startsWith("09")) {
                  phone = digits.slice(0, 10);
                } else {
                  phone = digits;
                }
              }
            } catch {}
            setLiffUser({ uid: profile.userId, name: profile.displayName, phone });
          } catch (err) {
            console.error("LIFF profile error:", err);
          }
        }
      })
      .catch((err) => {
        console.error("LIFF init error:", err);
        setLiffReady(true);
      });
  }, []);

  /* 每秒更新 now（驅動倒數計時與層級判斷） */
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  /* Form state */
  const [form, setForm] = useState({
    name: "", phone: "", direction: "to_taipei",
    date: getTomorrow(), time: "07:00",
    pickup: "", dropoff: "", meetingPoint: "",
    passengers: "1", note: "",
  });

  const updateForm = (key, val) => setForm((prev) => ({ ...prev, [key]: val }));

  /* ─── Fetch rides ─── */
  const fetchRides = useCallback(async () => {
    setLoading(true);
    const today = getToday();
    const { data, error } = await supabase
      .from("carpool_rides")
      .select("*")
      .gte("ride_date", today)
      .in("status", ["priority", "public", "matched"])
      .order("ride_date", { ascending: true })
      .order("ride_time", { ascending: true });

    if (error) {
      console.error("Fetch error:", error);
    } else {
      setRides(data || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchRides();
    const interval = setInterval(fetchRides, 30000);
    return () => clearInterval(interval);
  }, [fetchRides]);

  /* Filter */
  const filteredRides = rides.filter((r) => r.direction === direction);
  const pickupAreas = form.direction === "to_taipei" ? YILAN_AREAS : TAIPEI_AREAS;
  const dropoffAreas = form.direction === "to_taipei" ? TAIPEI_AREAS : YILAN_AREAS;

  /* Open form */
  const openForm = () => {
    if (!liff.isLoggedIn() && liffReady) {
      liff.login({ redirectUri: window.location.href });
      return;
    }
    setForm((prev) => ({
      ...prev, direction,
      name: prev.name || liffUser?.name || "",
      phone: prev.phone || liffUser?.phone || "",
    }));
    setShowForm(true);
  };

  /* Submit → disclaimer */
  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.name || !form.pickup || !form.dropoff) return;
    setPendingRide({
      passenger_name: form.name,
      passenger_phone: form.phone || null,
      passenger_line_uid: liffUser?.uid || "web_user",
      direction: form.direction,
      ride_date: form.date,
      ride_time: form.time,
      pickup_location: form.pickup,
      dropoff_location: form.dropoff,
      meeting_point: form.meetingPoint || null,
      passenger_count: parseInt(form.passengers),
      note: form.note || null,
      status: "priority",
      priority_expires_at: new Date(Date.now() + PRIORITY_MINUTES * 60 * 1000).toISOString(),
    });
    setShowForm(false);
    setShowDisclaimer(true);
  };

  /* Confirm disclaimer → insert */
  const confirmDisclaimer = async () => {
    if (!pendingRide) return;
    setSubmitting(true);
    const { error } = await supabase.from("carpool_rides").insert([pendingRide]).select();
    if (error) {
      console.error("Insert error:", error);
      alert("發布失敗，請稍後再試");
    } else {
      setForm({
        name: liffUser?.name || "", phone: liffUser?.phone || "",
        direction: form.direction, date: getTomorrow(), time: "07:00",
        pickup: "", dropoff: "", meetingPoint: "", passengers: "1", note: "",
      });
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 4000);
      fetchRides();
    }
    setShowDisclaimer(false);
    setPendingRide(null);
    setSubmitting(false);
  };

  /* 聯繫共乘（第二層：乘客對乘客） */
  const handlePeerContact = (ride) => {
    const msg = `你好，我想詢問共乘：\n${formatDate(ride.ride_date)} ${ride.ride_time.slice(0, 5)}\n${ride.pickup_location} → ${ride.dropoff_location}${ride.meeting_point ? `\n上車地點：${ride.meeting_point}` : ""}\n${ride.passenger_count}位乘客`;
    const url = `${LINE_OA_URL}?text=${encodeURIComponent(msg)}`;
    if (liffReady && liff.isInClient()) {
      liff.openWindow({ url, external: true });
    } else {
      window.open(url, "_blank");
    }
  };

  /* 專業接送（第三層：PickYouUP 付費） */
  const handleProBooking = () => {
    if (liffReady && liff.isInClient()) {
      liff.openWindow({ url: LIFF_BOOKING_URL, external: false });
    } else {
      window.open(LIFF_BOOKING_URL, "_blank");
    }
  };

  /* ─── 行程卡片狀態 Badge ─── */
  const StatusBadge = ({ ride }) => {
    const layer = getRideLayer(ride);
    if (layer === "matched") return <span className="ride-status matched">已媒合</span>;
    if (layer === "priority") return (
      <span className="ride-status priority">
        司機配對中
        <PriorityCountdown expiresAt={ride.priority_expires_at} />
      </span>
    );
    if (layer === "fallback") return <span className="ride-status fallback">推薦專業接送</span>;
    return <span className="ride-status available">尋找共乘</span>;
  };

  /* ─── 行程卡片按鈕 ─── */
  const RideAction = ({ ride }) => {
    const layer = getRideLayer(ride);
    if (layer === "matched") return null;
    if (layer === "priority") return (
      <div className="ride-priority-hint">司機 30 分鐘內優先接單，請稍候</div>
    );
    if (layer === "fallback") return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <button onClick={() => handlePeerContact(ride)} className="ride-contact-btn secondary">聯繫共乘</button>
        <button onClick={handleProBooking} className="ride-contact-btn">PickYouUP 專業接送</button>
      </div>
    );
    /* public layer */
    return <button onClick={() => handlePeerContact(ride)} className="ride-contact-btn">聯繫共乘</button>;
  };

  /* ════════════ RENDER ════════════ */
  return (
    <div>
      {/* ─── Header ─── */}
      <header className="header">
        <div>
          <a href="https://pickyouup.tw" target="_blank" rel="noopener noreferrer">
            <img src="/logo-gold.png" alt="PickYouUP" className="header-logo" style={{ cursor: "pointer" }} />
          </a>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="header-title">宜蘭共乘平台</div>
          {liffUser ? (
            <div className="header-subtitle" style={{ color: "#4caf50" }}>{liffUser.name}</div>
          ) : (
            <div className="header-subtitle">YILAN CARPOOL</div>
          )}
        </div>
      </header>

      {/* ─── Direction Tabs ─── */}
      <div className="direction-tabs">
        <button className={`direction-tab ${direction === "to_taipei" ? "active" : ""}`} onClick={() => setDirection("to_taipei")}>
          宜蘭 → 台北
        </button>
        <button className={`direction-tab ${direction === "to_yilan" ? "active" : ""}`} onClick={() => setDirection("to_yilan")}>
          台北 → 宜蘭
        </button>
      </div>

      {/* ─── 三層漏斗說明 ─── */}
      <div className="funnel-hint">
        <div className="funnel-step"><span className="funnel-dot priority" />司機 30 分鐘優先接單</div>
        <div className="funnel-step"><span className="funnel-dot public" />開放乘客互相共乘</div>
        <div className="funnel-step"><span className="funnel-dot fallback" />推薦 PickYouUP 專業接送</div>
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
            <div className="empty-state-text">
              目前沒有{direction === "to_taipei" ? "往台北" : "往宜蘭"}的共乘
            </div>
            <div className="empty-state-sub">點右下角 + 發布你的共乘需求</div>
          </div>
        ) : (
          filteredRides.map((ride) => (
            <div key={ride.id} className={`ride-card ride-card-${getRideLayer(ride)}`}>
              <div className="ride-card-header">
                <span className="ride-date">
                  {formatDate(ride.ride_date)} {ride.ride_time.slice(0, 5)}
                </span>
                <StatusBadge ride={ride} />
              </div>

              <div className="ride-route">
                <span className="ride-location">{ride.pickup_location}</span>
                <span className="ride-arrow">→</span>
                <span className="ride-location">{ride.dropoff_location}</span>
              </div>

              <div className="ride-meta">
                <span>{ride.passenger_count}位乘客</span>
                <span>{ride.passenger_name}</span>
              </div>
              {ride.meeting_point && (
                <div className="ride-meeting">📍 {ride.meeting_point}</div>
              )}
              {ride.note && (
                <div className="ride-meeting">{ride.note}</div>
              )}

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
              {/* Direction */}
              <div className="form-group">
                <label className="form-label">方向</label>
                <div style={{ display: "flex", gap: 0, borderRadius: 8, overflow: "hidden", border: "1px solid var(--border)" }}>
                  <button type="button" onClick={() => updateForm("direction", "to_taipei")} style={{
                    flex: 1, padding: "10px", border: "none", cursor: "pointer", fontSize: 14, fontWeight: 700,
                    background: form.direction === "to_taipei" ? "var(--gold)" : "transparent",
                    color: form.direction === "to_taipei" ? "#000" : "var(--text-dim)",
                  }}>宜蘭 → 台北</button>
                  <button type="button" onClick={() => updateForm("direction", "to_yilan")} style={{
                    flex: 1, padding: "10px", border: "none", cursor: "pointer", fontSize: 14, fontWeight: 700,
                    background: form.direction === "to_yilan" ? "var(--gold)" : "transparent",
                    color: form.direction === "to_yilan" ? "#000" : "var(--text-dim)",
                  }}>台北 → 宜蘭</button>
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">您的稱呼</label>
                <input type="text" className="form-input" placeholder="例：王小姐" value={form.name} onChange={(e) => updateForm("name", e.target.value)} required />
              </div>

              <div className="form-group">
                <label className="form-label">聯絡電話（選填）</label>
                <input type="tel" className="form-input" placeholder="0912-345-678" value={form.phone} onChange={(e) => updateForm("phone", e.target.value)} />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">日期</label>
                  <input type="date" className="form-input" value={form.date} min={getToday()} onChange={(e) => updateForm("date", e.target.value)} required />
                </div>
                <div className="form-group">
                  <label className="form-label">時間</label>
                  <select className="form-select" value={form.time} onChange={(e) => updateForm("time", e.target.value)}>
                    {TIME_SLOTS.map((t) => (<option key={t} value={t}>{t}</option>))}
                  </select>
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">上車地區</label>
                  <select className="form-select" value={form.pickup} onChange={(e) => updateForm("pickup", e.target.value)} required>
                    <option value="">請選擇</option>
                    {pickupAreas.map((a) => (<option key={a} value={a}>{a}</option>))}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">下車地區</label>
                  <select className="form-select" value={form.dropoff} onChange={(e) => updateForm("dropoff", e.target.value)} required>
                    <option value="">請選擇</option>
                    {dropoffAreas.map((a) => (<option key={a} value={a}>{a}</option>))}
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">詳細上車地點</label>
                <input type="text" className="form-input" placeholder="例：礁溪轉運站、宜蘭火車站、南港高鐵站" value={form.meetingPoint} onChange={(e) => updateForm("meetingPoint", e.target.value)} />
                <div style={{ fontSize: 11, color: "var(--orange)", marginTop: 4, lineHeight: 1.5 }}>
                  共乘行程請儘量填寫沿途公共運輸站點（車站、捷運站、轉運站），方便司機安排路線接送
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">乘客人數</label>
                <select className="form-select" value={form.passengers} onChange={(e) => updateForm("passengers", e.target.value)}>
                  {[1, 2, 3, 4].map((n) => (<option key={n} value={n}>{n} 位</option>))}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">備註（選填）</label>
                <textarea className="form-textarea" placeholder="例：可在礁溪交流道上車" value={form.note} onChange={(e) => updateForm("note", e.target.value)} rows={2} />
              </div>

              <button type="submit" className="form-submit" disabled={!form.name || !form.pickup || !form.dropoff}>
                送出共乘需求
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ─── Disclaimer Modal ─── */}
      {showDisclaimer && (
        <div className="modal-overlay">
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-handle" />
            <div className="modal-title">共乘免責聲明</div>
            <div className="disclaimer-box">{DISCLAIMER_TEXT}</div>
            <button className="disclaimer-btn" onClick={confirmDisclaimer} disabled={submitting}>
              {submitting ? "處理中..." : "我已了解，確認送出"}
            </button>
            <button
              onClick={() => { setShowDisclaimer(false); setPendingRide(null); }}
              disabled={submitting}
              style={{
                width: "100%", padding: 12, marginTop: 8,
                background: "transparent", border: "1px solid var(--border)",
                borderRadius: 10, color: "var(--text-dim)", fontSize: 14, cursor: "pointer",
              }}
            >取消</button>
          </div>
        </div>
      )}

      {/* ─── Success Toast ─── */}
      {showSuccess && (
        <div
          style={{
            position: "fixed", inset: 0, display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center",
            background: "rgba(0,0,0,0.85)", zIndex: 300,
          }}
          onClick={() => setShowSuccess(false)}
        >
          <div className="success-check">✅</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: "var(--gold)", marginBottom: 16 }}>
            共乘需求已發布！
          </div>
          <div style={{ fontSize: 13, color: "var(--text-dim)", textAlign: "center", lineHeight: 2, padding: "0 32px" }}>
            ① 司機 30 分鐘內優先接單<br />
            ② 之後開放其他乘客共乘配對<br />
            ③ 媒合結果將透過 LINE 通知您
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
