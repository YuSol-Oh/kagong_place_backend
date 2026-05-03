// ================================================================
// 카공지도 백엔드 서버 — server.js
// ================================================================
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = process.env.PORT || 3000;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

app.use(express.json());

const ALLOWED_ORIGINS = [
  "https://yusol-oh.github.io",
  "http://localhost:3000",
  "http://localhost:5500",
  "http://127.0.0.1:5500",
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) callback(null, true);
    else callback(new Error(`CORS 차단: ${origin}`));
  },
  methods: ["GET", "POST", "DELETE", "PATCH", "PUT"],
}));

// 헬스체크
app.get("/", (req, res) => {
  res.json({ status: "ok", service: "kagong-backend", time: new Date().toISOString() });
});

// ================================================================
// 유저 API (닉네임 + PIN 기반)
// ================================================================

const hashPin = (pin) => crypto.createHash("sha256").update(pin).digest("hex");

// POST /api/users/register — 회원가입
app.post("/api/users/register", async (req, res) => {
  try {
    const { nickname, pin } = req.body;
    if (!nickname || !pin) return res.status(400).json({ error: "닉네임과 PIN이 필요합니다" });
    if (nickname.length < 2 || nickname.length > 20) return res.status(400).json({ error: "닉네임은 2~20자여야 합니다" });
    if (!/^\d{4}$/.test(pin)) return res.status(400).json({ error: "PIN은 숫자 4자리여야 합니다" });

    // 닉네임 중복 확인
    const { data: existing } = await supabase.from("kagong_users").select("id").eq("nickname", nickname).single();
    if (existing) return res.status(409).json({ error: "이미 사용 중인 닉네임이에요" });

    const { data, error } = await supabase.from("kagong_users")
      .insert({ nickname, pin_hash: hashPin(pin), favorites: [] })
      .select("id, nickname, favorites").single();
    if (error) throw error;

    res.json({ ok: true, user: data });
  } catch (err) {
    console.error("[register error]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/users/login — 로그인
app.post("/api/users/login", async (req, res) => {
  try {
    const { nickname, pin } = req.body;
    if (!nickname || !pin) return res.status(400).json({ error: "닉네임과 PIN이 필요합니다" });

    const { data: user } = await supabase.from("kagong_users")
      .select("id, nickname, favorites, pin_hash").eq("nickname", nickname).single();

    if (!user) return res.status(404).json({ error: "존재하지 않는 닉네임이에요" });
    if (user.pin_hash !== hashPin(pin)) return res.status(401).json({ error: "PIN이 틀렸어요" });

    res.json({ ok: true, user: { id: user.id, nickname: user.nickname, favorites: user.favorites || [] } });
  } catch (err) {
    console.error("[login error]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/users/:userId/favorites — 즐겨찾기 동기화
app.put("/api/users/:userId/favorites", async (req, res) => {
  try {
    const { userId } = req.params;
    const { favorites, pin } = req.body;
    if (!pin || !Array.isArray(favorites)) return res.status(400).json({ error: "pin과 favorites가 필요합니다" });

    const { data: user } = await supabase.from("kagong_users").select("pin_hash").eq("id", userId).single();
    if (!user) return res.status(404).json({ error: "유저를 찾을 수 없어요" });
    if (user.pin_hash !== hashPin(pin)) return res.status(401).json({ error: "PIN이 틀렸어요" });

    const { error } = await supabase.from("kagong_users").update({ favorites }).eq("id", userId);
    if (error) throw error;

    res.json({ ok: true });
  } catch (err) {
    console.error("[favorites sync error]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ================================================================
// 이벤트 수집
// ================================================================
app.post("/api/track", async (req, res) => {
  try {
    const { event, cafe_id, cafe_name, value, meta } = req.body;
    if (!event || typeof event !== "string") {
      return res.status(400).json({ error: "event 필드가 필요합니다" });
    }
    const ALLOWED_EVENTS = [
      "app_open", "cafe_click", "cafe_detail_view",
      "search", "filter_apply", "filter_button_tap", "quick_filter_toggle",
      "favorite_add", "favorite_remove", "favorites_screen_view",
      "review_start", "review_submit", "review_edit", "review_like", "review_delete",
      "naver_map_open",
    ];
    if (!ALLOWED_EVENTS.includes(event)) {
      return res.status(400).json({ error: `허용되지 않는 이벤트: ${event}` });
    }
    const { error } = await supabase.from("events").insert({
      event, cafe_id: cafe_id ?? null, cafe_name: cafe_name ?? null,
      value: value ?? null, meta: meta ?? null,
    });
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    console.error("[track error]", err.message);
    res.status(200).json({ ok: false });
  }
});

// ================================================================
// 리뷰 API
// ================================================================

// GET /api/reviews/:cafeId — 카페별 리뷰 조회
app.get("/api/reviews/:cafeId", async (req, res) => {
  try {
    const { cafeId } = req.params;
    const { data, error } = await supabase
      .from("reviews")
      .select("id, cafe_id, cafe_name, user_name, tags, text, likes, session_id, is_owner, is_edited, created_at, updated_at")
      .eq("cafe_id", cafeId)
      .eq("is_hidden", false)
      .order("created_at", { ascending: false });
    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error("[reviews GET error]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/reviews — 리뷰 작성
app.post("/api/reviews", async (req, res) => {
  try {
    const { cafe_id, cafe_name, user_name, tags, text, session_id, is_owner } = req.body;
    if (!cafe_id || !text || !session_id) {
      return res.status(400).json({ error: "cafe_id, text, session_id는 필수입니다" });
    }
    if (text.trim().length === 0 || text.length > 100) {
      return res.status(400).json({ error: "리뷰는 1~100자 사이여야 합니다" });
    }
    const { data, error } = await supabase
      .from("reviews")
      .insert({
        cafe_id, cafe_name: cafe_name ?? "",
        user_name: user_name ?? "익명",
        tags: tags ?? [], text: text.trim(),
        session_id, is_owner: is_owner ?? false, likes: 0,
      })
      .select().single();
    if (error) throw error;
    res.json({ ok: true, review: data });
  } catch (err) {
    console.error("[reviews POST error]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/reviews/:reviewId — 리뷰 수정 (session_id 본인 확인)
app.put("/api/reviews/:reviewId", async (req, res) => {
  try {
    const { reviewId } = req.params;
    const { session_id, tags, text, user_name } = req.body;

    if (!session_id) {
      return res.status(400).json({ error: "session_id가 필요합니다" });
    }
    if (!text || text.trim().length === 0 || text.length > 100) {
      return res.status(400).json({ error: "리뷰는 1~100자 사이여야 합니다" });
    }

    // 본인 확인
    const { data: review, error: fetchError } = await supabase
      .from("reviews").select("id, session_id").eq("id", reviewId).single();
    if (fetchError || !review) {
      return res.status(404).json({ error: "리뷰를 찾을 수 없습니다" });
    }
    if (review.session_id !== session_id) {
      return res.status(403).json({ error: "본인이 작성한 리뷰만 수정할 수 있습니다" });
    }

    const { data, error } = await supabase
      .from("reviews")
      .update({
        tags: tags ?? [],
        text: text.trim(),
        user_name: user_name ?? "익명",
        is_edited: true,
        updated_at: new Date().toISOString(),
      })
      .eq("id", reviewId)
      .select().single();

    if (error) throw error;
    res.json({ ok: true, review: data });
  } catch (err) {
    console.error("[reviews PUT error]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/reviews/:reviewId — 리뷰 삭제
app.delete("/api/reviews/:reviewId", async (req, res) => {
  try {
    const { reviewId } = req.params;
    const { session_id } = req.body;
    if (!session_id) {
      return res.status(400).json({ error: "session_id가 필요합니다" });
    }
    const { data: review, error: fetchError } = await supabase
      .from("reviews").select("id, session_id").eq("id", reviewId).single();
    if (fetchError || !review) {
      return res.status(404).json({ error: "리뷰를 찾을 수 없습니다" });
    }
    if (review.session_id !== session_id) {
      return res.status(403).json({ error: "본인이 작성한 리뷰만 삭제할 수 있습니다" });
    }
    const { error: deleteError } = await supabase
      .from("reviews").delete().eq("id", reviewId);
    if (deleteError) throw deleteError;
    res.json({ ok: true });
  } catch (err) {
    console.error("[reviews DELETE error]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/reviews/:reviewId/like — 좋아요 (session_id 기준 중복 방지)
app.patch("/api/reviews/:reviewId/like", async (req, res) => {
  try {
    const { reviewId } = req.params;
    const { session_id } = req.body;
    if (!session_id) return res.status(400).json({ error: "session_id가 필요합니다" });

    const { data: existing } = await supabase
      .from("review_likes").select("id").eq("review_id", reviewId).eq("session_id", session_id).single();
    if (existing) return res.status(409).json({ error: "이미 좋아요한 리뷰입니다", already_liked: true });

    await supabase.from("review_likes").insert({ review_id: reviewId, session_id });

    const { data: review } = await supabase.from("reviews").select("likes").eq("id", reviewId).single();
    if (!review) return res.status(404).json({ error: "리뷰를 찾을 수 없습니다" });

    const newLikes = (review.likes || 0) + 1;
    const { error } = await supabase.from("reviews").update({ likes: newLikes }).eq("id", reviewId);
    if (error) throw error;
    res.json({ ok: true, likes: newLikes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================================================================
// 즐겨찾기 수 API
// ================================================================
app.get("/api/favorites/counts", async (req, res) => {
  try {
    const { data: adds, error: addError } = await supabase
      .from("events").select("cafe_id").eq("event", "favorite_add").not("cafe_id", "is", null);
    if (addError) throw addError;
    const { data: removes, error: removeError } = await supabase
      .from("events").select("cafe_id").eq("event", "favorite_remove").not("cafe_id", "is", null);
    if (removeError) throw removeError;
    const counts = {};
    adds.forEach(({ cafe_id }) => { counts[cafe_id] = (counts[cafe_id] || 0) + 1; });
    removes.forEach(({ cafe_id }) => { counts[cafe_id] = (counts[cafe_id] || 0) - 1; });
    Object.keys(counts).forEach(k => { if (counts[k] < 0) counts[k] = 0; });
    res.json(counts);
  } catch (err) {
    console.error("[favorites/counts error]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ================================================================
// 통계 API
// ================================================================
app.get("/api/stats/top-cafes", async (req, res) => {
  try { const { data, error } = await supabase.from("top_cafe_clicks").select("*").limit(10); if (error) throw error; res.json(data); }
  catch (err) { res.status(500).json({ error: err.message }); }
});
app.get("/api/stats/top-searches", async (req, res) => {
  try { const { data, error } = await supabase.from("top_searches").select("*").limit(20); if (error) throw error; res.json(data); }
  catch (err) { res.status(500).json({ error: err.message }); }
});
app.get("/api/stats/top-favorites", async (req, res) => {
  try { const { data, error } = await supabase.from("top_favorites").select("*").limit(10); if (error) throw error; res.json(data); }
  catch (err) { res.status(500).json({ error: err.message }); }
});
app.get("/api/stats/top-filters", async (req, res) => {
  try { const { data, error } = await supabase.from("top_filters").select("*").limit(20); if (error) throw error; res.json(data); }
  catch (err) { res.status(500).json({ error: err.message }); }
});
app.get("/api/stats/daily-visits", async (req, res) => {
  try { const { data, error } = await supabase.from("daily_visits").select("*").limit(30); if (error) throw error; res.json(data); }
  catch (err) { res.status(500).json({ error: err.message }); }
});
app.get("/api/stats/summary", async (req, res) => {
  try {
    const { count: totalVisits } = await supabase.from("events").select("*", { count: "exact", head: true }).eq("event", "app_open");
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const { count: todayVisits } = await supabase.from("events").select("*", { count: "exact", head: true }).eq("event", "app_open").gte("created_at", today.toISOString());
    const { count: totalReviews } = await supabase.from("reviews").select("*", { count: "exact", head: true });
    const { count: totalFavorites } = await supabase.from("events").select("*", { count: "exact", head: true }).eq("event", "favorite_add");
    res.json({ total_visits: totalVisits, today_visits: todayVisits, total_reviews: totalReviews, total_favorites: totalFavorites, generated_at: new Date().toISOString() });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.listen(PORT, () => {
  console.log(`✅ 카공지도 백엔드 서버 실행 중: http://localhost:${PORT}`);
  console.log(`   Supabase URL: ${process.env.SUPABASE_URL ? "✅ 설정됨" : "❌ 미설정"}`);
});
