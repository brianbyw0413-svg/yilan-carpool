-- ═══════════════════════════════════════════════════
-- 宜蘭共乘平台 — Supabase Migration
-- carpool.pickyouup.tw
-- ═══════════════════════════════════════════════════

-- 共乘行程表
CREATE TABLE IF NOT EXISTS carpool_rides (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- 乘客資訊 (LIFF 登入)
  passenger_name TEXT NOT NULL,
  passenger_line_uid TEXT NOT NULL,
  passenger_phone TEXT,
  
  -- 行程資訊
  direction TEXT NOT NULL CHECK (direction IN ('to_taipei', 'to_yilan')),  -- 往台北 / 往宜蘭
  ride_date DATE NOT NULL,
  ride_time TIME NOT NULL,
  pickup_location TEXT NOT NULL,       -- 上車地點
  dropoff_location TEXT NOT NULL,      -- 下車地點
  passenger_count INTEGER NOT NULL DEFAULT 1,
  note TEXT,                           -- 備註
  
  -- 狀態管理
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'priority', 'public', 'matched', 'completed', 'cancelled')),
  -- pending: 剛建立
  -- priority: Sam 優先挑單中 (30分鐘)
  -- public: 公開給所有司機
  -- matched: 已被接單
  -- completed: 已完成
  -- cancelled: 已取消
  
  priority_expires_at TIMESTAMPTZ,     -- Sam 優先權到期時間
  matched_driver_uid TEXT,             -- 接單司機 LINE UID
  matched_driver_name TEXT,            -- 接單司機名稱
  matched_at TIMESTAMPTZ              -- 接單時間
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_carpool_rides_date ON carpool_rides (ride_date);
CREATE INDEX IF NOT EXISTS idx_carpool_rides_status ON carpool_rides (status);
CREATE INDEX IF NOT EXISTS idx_carpool_rides_direction ON carpool_rides (direction);

-- RLS (Row Level Security)
ALTER TABLE carpool_rides ENABLE ROW LEVEL SECURITY;

-- 所有人可讀取公開和已配對的行程
CREATE POLICY "Public rides are viewable by everyone"
  ON carpool_rides FOR SELECT
  USING (status IN ('public', 'matched'));

-- 任何人可以新增行程（透過 anon key）
CREATE POLICY "Anyone can insert rides"
  ON carpool_rides FOR INSERT
  WITH CHECK (true);

-- 只有行程擁有者或管理員可以更新
CREATE POLICY "Ride owner or admin can update"
  ON carpool_rides FOR UPDATE
  USING (true);
