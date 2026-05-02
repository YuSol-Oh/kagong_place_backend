// ================================================================
// 카공지도 백엔드 서버 — server.js
// ================================================================
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------
// Supabase 클라이언트 (service_role 키 사용 — 서버에서만!)
// ---------------------------------------------------------------
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY  // ← anon 키가 아닌 service_role 키
);

// ---------------------------------------------------------------
// 미들웨어 설정
// ---------------------------------------------------------------
app.use(express.json());

// CORS: 카공지도 GitHub Pages 도메인만 허용
// 로컬 테스트를 위해 localhost도 허용
const ALLOWED_ORIGINS = [
  "https://yusol-oh.github.io",   // ← 본인 GitHub Pages 주소
  "http://localhost:3000",
  "http://localhost:5500",
  "http://127.0.0.1:5500",
];

app.use(cors({
  origin: (origin, callback) => {
    // origin이 없는 경우(서버-서버, Postman 등) 허용
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS 차단: ${origin}`));
    }
  },
  methods: ["GET", "POST"],
}));

// ---------------------------------------------------------------
// 헬스체크 — Railway가 서버 상태 확인할 때 사용
// ---------------------------------------------------------------
app.get("/", (req, res) => {
  res.json({ status: "ok", service: "kagong-backend", time: new Date().toISOString() });
});

// ================================================================
// POST /api/track  — 이벤트 수집
// ================================================================
// 요청 형식:
// {
//   "event": "cafe_click",
//   "cafe_id": 1,
//   "cafe_name": "슬랩커먼즈",
//   "value": "map_marker",   (선택)
//   "meta": { ... }          (선택)
// }
app.post("/api/track", async (req, res) => {
  try {
    const { event, cafe_id, cafe_name, value, meta } = req.body;

    // 필수값 검증
    if (!event || typeof event !== "string") {
      return res.status(400).json({ error: "event 필드가 필요합니다" });
    }

    // 이벤트명 허용 목록 (예상치 못한 값 차단)
    const ALLOWED_EVENTS = [
      "app_open",
      "cafe_click",
      "cafe_detail_view",
      "search",
      "filter_apply",
      "filter_button_tap",
      "quick_filter_toggle",
      "favorite_add",
      "favorite_remove",
      "favorites_screen_view",
      "review_start",
      "review_submit",
      "review_like",
      "naver_map_open",
    ];

    if (!ALLOWED_EVENTS.includes(event)) {
      return res.status(400).json({ error: `허용되지 않는 이벤트: ${event}` });
    }

    const { error } = await supabase.from("events").insert({
      event,
      cafe_id:   cafe_id   ?? null,
      cafe_name: cafe_name ?? null,
      value:     value     ?? null,
      meta:      meta      ?? null,
    });

    if (error) throw error;

    res.json({ ok: true });
  } catch (err) {
    console.error("[track error]", err.message);
    // 클라이언트에는 세부 에러 숨김 — 앱 동작에 영향 없도록 200 반환
    res.status(200).json({ ok: false, message: "이벤트 저장 실패 (앱은 정상 동작)" });
  }
});

// ================================================================
// GET /api/stats/*  — 통계 조회 API들
// ================================================================

// 카페별 클릭 순위
app.get("/api/stats/top-cafes", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("top_cafe_clicks")
      .select("*")
      .limit(10);
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 인기 검색어
app.get("/api/stats/top-searches", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("top_searches")
      .select("*")
      .limit(20);
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 즐겨찾기 많은 카페
app.get("/api/stats/top-favorites", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("top_favorites")
      .select("*")
      .limit(10);
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 인기 필터 태그
app.get("/api/stats/top-filters", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("top_filters")
      .select("*")
      .limit(20);
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 일별 방문자 (최근 30일)
app.get("/api/stats/daily-visits", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("daily_visits")
      .select("*")
      .limit(30);
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 카페 상세 조회수 순위
app.get("/api/stats/top-detail-views", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("top_cafe_detail_views")
      .select("*")
      .limit(10);
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 전체 요약 통계 — 대시보드용
app.get("/api/stats/summary", async (req, res) => {
  try {
    // 총 방문자 수
    const { count: totalVisits } = await supabase
      .from("events")
      .select("*", { count: "exact", head: true })
      .eq("event", "app_open");

    // 오늘 방문자 수
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const { count: todayVisits } = await supabase
      .from("events")
      .select("*", { count: "exact", head: true })
      .eq("event", "app_open")
      .gte("created_at", today.toISOString());

    // 총 이벤트 수
    const { count: totalEvents } = await supabase
      .from("events")
      .select("*", { count: "exact", head: true });

    // 총 즐겨찾기 추가 수
    const { count: totalFavorites } = await supabase
      .from("events")
      .select("*", { count: "exact", head: true })
      .eq("event", "favorite_add");

    // 총 리뷰 작성 수
    const { count: totalReviews } = await supabase
      .from("events")
      .select("*", { count: "exact", head: true })
      .eq("event", "review_submit");

    res.json({
      total_visits:   totalVisits,
      today_visits:   todayVisits,
      total_events:   totalEvents,
      total_favorites: totalFavorites,
      total_reviews:  totalReviews,
      generated_at:   new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------
// 서버 시작
// ---------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`✅ 카공지도 백엔드 서버 실행 중: http://localhost:${PORT}`);
  console.log(`   Supabase URL: ${process.env.SUPABASE_URL ? "✅ 설정됨" : "❌ 미설정"}`);
});
