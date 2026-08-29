import { useState, useEffect, useMemo, useCallback, useRef } from "react";

// ============================================================
// サロン設定（本番公開時に実際の値へ差し替える）
// ============================================================
const SALON_NAME = "整えサロン";
const BUSINESS_HOURS = { start: 13, end: 17 };
const CLOSED_WEEKDAYS = [0]; // 日曜定休
const SLOT_INTERVAL = 30;
// サロン管理画面のパスコード。運用前に必ず変更してください（本番は Supabase Auth 等で保護：要件書7章）。
const ADMIN_PIN = "0000";

// 管理画面で編集できる項目の初期値（実際の連絡先・お知らせは運用時に設定）
const DEFAULT_SETTINGS = {
  announcement: "",
  contactInfo: {
    phone: "03-0000-0000",
    email: "info@totonoe-salon.example.com",
    instagram: "https://www.instagram.com/totonoe_salon/",
    website: "https://totonoe-salon.example.com",
  },
  textSize: "base",
};

const CATEGORIES = [
  { id: "all", label: "すべて" },
  { id: "first", label: "初回限定" },
  { id: "full", label: "しっかりケア" },
  { id: "part", label: "部位別ケア" },
];

const MENU_ITEMS = [
  { id: "f1", cat: "first", name: "【初回限定】おためし相談＆肩こり改善コース", duration: 60, price: 2000, desc: "肩こりのお悩みを丁寧にヒアリングし、原因を評価します" },
  { id: "f2", cat: "first", name: "【初回限定】おためし相談＆腰痛改善コース", duration: 60, price: 2000, desc: "腰痛のお悩みを丁寧にヒアリングし、原因を評価します" },
  { id: "f3", cat: "first", name: "【初回限定】おためし相談＆その他改善コース", duration: 60, price: 2000, desc: "気になる不調を丁寧にヒアリングし、原因を評価します" },
  { id: "m1", cat: "full", name: "体の不調しっかり改善コース", duration: 60, price: 6000, desc: "全身の状態を評価し、根本原因からしっかり整えます" },
  { id: "m2", cat: "full", name: "全身リラクゼーションコース", duration: 60, price: 6000, desc: "全身の緊張をゆるめ、リラックスへ導きます" },
  { id: "m3", cat: "part", name: "肩こり・痛み軽減コース", duration: 30, price: 3000, desc: "肩まわりの張りとこりに集中的にアプローチ" },
  { id: "m4", cat: "part", name: "腰痛・腰の張り軽減コース", duration: 30, price: 3000, desc: "腰まわりの張りと痛みに集中的にアプローチ" },
  { id: "m5", cat: "part", name: "足の痛み・張り軽減コース", duration: 30, price: 3000, desc: "足のむくみ・張り・痛みに集中的にアプローチ" },
  { id: "m6", cat: "full", name: "パーソナル・リハビリコース", duration: 60, price: 8000, desc: "作業療法士による本格的な評価と個別リハビリ" },
  { id: "m7", cat: "part", name: "その他の整えコース", duration: 30, price: 3000, desc: "気になる部位を自由にお伝えください" },
];

// ---- 予約ステータス ----
// pending: 承認待ち / confirmed: 確定 / cancelled: キャンセル済み（サロンの却下・お客様のキャンセルとも cancelled）
// pending・confirmed の枠は「予約済み」として他のお客様が選べなくなる。cancelled は自動的に空きへ戻る。
function isBlocking(b) { return b.status === "pending" || b.status === "confirmed"; }

// ============================================================
// 日付・時刻ユーティリティ
// ============================================================
function pad(n) { return String(n).padStart(2, "0"); }
function toDateKey(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function toMinutes(hhmm) { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; }
function addMinutes(hhmm, mins) {
  const total = toMinutes(hhmm) + mins;
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}
const DOW = ["日", "月", "火", "水", "木", "金", "土"];
function dowJP(d) { return DOW[d.getDay()]; }
function formatDateJP(d) { return `${d.getMonth() + 1}月${d.getDate()}日（${dowJP(d)}）`; }
function daysFromNow(n) { const d = new Date(); d.setDate(d.getDate() + n); d.setHours(0, 0, 0, 0); return d; }
function normPhone(p) { return (p || "").replace(/[^0-9]/g, ""); }
// 予約IDと作成時刻。impure な呼び出しをモジュール側に隔離しておく。
function makeBookingId(dateKey, time) {
  return `${dateKey.replace(/-/g, "")}-${time.replace(":", "")}-${Math.random().toString(36).slice(2, 6)}`;
}
function nowMillis() { return Date.now(); }
// キャンセル可能期限：予約日の前日24:00（＝予約日当日の0:00）まで
function cancelDeadlinePassed(dateKey) { return new Date() >= new Date(`${dateKey}T00:00:00`); }
function isFuture(dateKey) { return dateKey >= toDateKey(new Date()); }
function statusLabel(status) {
  return { pending: "承認待ち", confirmed: "確定", cancelled: "キャンセル済み" }[status] || status;
}
function statusPillClass(status, dateKey) {
  if (status === "cancelled") return "pill-cancelled";
  if (status === "pending") return "pill-pending";
  if (status === "confirmed" && dateKey < toDateKey(new Date())) return "pill-done";
  return "pill-confirmed";
}

// 予約枠が選べない理由を返す。null なら予約可能。
function slotReason(menu, dayBookings, d, t) {
  if (!menu) return "closed";
  const today = new Date(); today.setHours(0, 0, 0, 0);
  if (d < today || CLOSED_WEEKDAYS.includes(d.getDay())) return "closed";
  const startMin = toMinutes(t);
  const endMin = startMin + menu.duration;
  if (endMin > BUSINESS_HOURS.end * 60) return "closed";
  const now = new Date();
  if (toDateKey(now) === toDateKey(d) && startMin <= now.getHours() * 60 + now.getMinutes()) return "past";
  for (const b of dayBookings) {
    if (b.status !== "cancelled" && startMin < toMinutes(b.end) && endMin > toMinutes(b.start)) return "taken";
  }
  return null;
}
function isPastOrClosed(d) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return d < today || CLOSED_WEEKDAYS.includes(d.getDay());
}

// ============================================================
// アイコン（依存を増やさないためインラインSVG）
// ============================================================
function Svg({ children, size = 20, className, style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={className} style={style}>
      {children}
    </svg>
  );
}
const IconHome = (p) => <Svg {...p}><path d="M3 11l9-7 9 7" /><path d="M5 10v9a1 1 0 001 1h4v-6h4v6h4a1 1 0 001-1v-9" /></Svg>;
const IconCalendar = (p) => <Svg {...p}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></Svg>;
const IconUser = (p) => <Svg {...p}><circle cx="12" cy="8" r="3.4" /><path d="M5 20c1.2-3.6 4-5.4 7-5.4s5.8 1.8 7 5.4" /></Svg>;
const IconPhone = (p) => <Svg {...p}><path d="M5 4h3l2 5-2.5 1.5a11 11 0 005 5L14 13l5 2v3a2 2 0 01-2 2C10.5 20 4 13.5 4 6a2 2 0 011-2z" /></Svg>;
const IconChevronLeft = (p) => <Svg {...p}><path d="M15 6l-6 6 6 6" /></Svg>;
const IconAlert = (p) => <Svg {...p}><path d="M10.3 3.9L2.7 17.5c-.5.9.1 2 1.2 2h16.2c1 0 1.7-1.1 1.2-2L13.7 3.9c-.5-.9-1.9-.9-2.4 0z" /><path d="M12 9v4M12 16.5h.01" /></Svg>;
const IconCheck = (p) => <Svg {...p}><path d="M5 12l5 5 9-11" /></Svg>;
const IconShield = (p) => <Svg {...p}><path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z" /></Svg>;
const IconSpinner = ({ size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className="animate-spin">
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
    <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
  </svg>
);
const CheckMark = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 13l4 4 10-10" />
  </svg>
);
function LeafDeco() {
  return (
    <svg className="banner-leaf" viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d="M50 95C50 60 60 30 90 8" /><path d="M50 95C50 55 40 25 12 5" />
      <path d="M50 70C58 62 66 58 76 56" /><path d="M50 55C57 48 63 45 71 43" />
      <path d="M50 70C42 62 34 58 24 56" /><path d="M50 55C43 48 37 45 29 43" />
    </svg>
  );
}

function Eyebrow({ children, style }) {
  return <p className="eyebrow" style={style}>{children}</p>;
}
function StatusPill({ status, dateKey }) {
  return <span className={`pill ${statusPillClass(status, dateKey)}`}>{statusLabel(status)}</span>;
}
function TextSizeToggle({ value, onChange }) {
  return (
    <div className="topbar">
      <div className="textsize-toggle" role="group" aria-label="文字サイズ">
        <button className={value === "base" ? "active" : ""} onClick={() => onChange("base")} aria-pressed={value === "base"}>文字 標準</button>
        <button className={value === "large" ? "active" : ""} onClick={() => onChange("large")} aria-pressed={value === "large"}>文字 大</button>
      </div>
    </div>
  );
}

// URLハッシュで お客様用 / サロン管理 を切り替え
function readRoute() {
  return typeof window !== "undefined" && window.location.hash === "#admin" ? "admin" : "app";
}

export default function TotonoeApp() {
  const [route, setRoute] = useState(readRoute());
  const [tab, setTab] = useState("home");
  const [flowStep, setFlowStep] = useState(0);
  const [menuId, setMenuId] = useState(null);
  const [category, setCategory] = useState("all");
  const [date, setDate] = useState(null);
  const [time, setTime] = useState(null);
  const [dateOffset, setDateOffset] = useState(0);
  const [form, setForm] = useState({ name: "", phone: "", email: "" });
  const [bookings, setBookings] = useState({});
  const [profile, setProfile] = useState({ name: "", phone: "", email: "" });
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [confirmedId, setConfirmedId] = useState(null);
  const [confirmCancelId, setConfirmCancelId] = useState(null);
  const [adminAuthed, setAdminAuthed] = useState(false);
  const [adminNotice, setAdminNotice] = useState(null);

  const scrollRef = useRef(null);
  const timeHeadingRef = useRef(null);

  const menu = MENU_ITEMS.find((m) => m.id === menuId);
  const textSize = settings.textSize === "large" ? "large" : "base";

  useEffect(() => {
    const onHash = () => setRoute(readRoute());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const b = await window.storage.get("bookings", true);
        if (b?.value) setBookings(JSON.parse(b.value));
      } catch { /* 未保存 */ }
      try {
        const p = await window.storage.get("profile", false);
        if (p?.value) {
          const parsed = JSON.parse(p.value);
          setProfile({ name: parsed.name || "", phone: parsed.phone || "", email: parsed.email || "" });
          setForm({ name: parsed.name || "", phone: parsed.phone || "", email: parsed.email || "" });
        }
      } catch { /* 未保存 */ }
      try {
        const s = await window.storage.get("settings", true);
        if (s?.value) {
          const parsed = JSON.parse(s.value);
          setSettings({
            announcement: parsed.announcement || "",
            contactInfo: { ...DEFAULT_SETTINGS.contactInfo, ...(parsed.contactInfo || {}) },
            textSize: parsed.textSize === "large" ? "large" : "base",
          });
        }
      } catch { /* 未保存 */ }
      try {
        const a = await window.storage.get("adminAuthed", false);
        if (a?.value === "1") setAdminAuthed(true);
      } catch { /* 未保存 */ }
      setLoading(false);
    })();
  }, []);

  // タブ・ステップの切り替え時はスクロール位置を先頭へ戻す（選択操作では戻さない）
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [tab, flowStep, confirmedId, route]);

  const saveBookings = useCallback(async (next) => {
    setBookings(next);
    try { await window.storage.set("bookings", JSON.stringify(next), true); }
    catch { setError("保存に失敗しました。もう一度お試しください。"); }
  }, []);

  const saveProfile = useCallback(async (next) => {
    setProfile(next);
    try { await window.storage.set("profile", JSON.stringify(next), false); } catch { /* 黙認 */ }
  }, []);

  const saveSettings = useCallback(async (next) => {
    setSettings(next);
    try { await window.storage.set("settings", JSON.stringify(next), true); } catch { /* 黙認 */ }
  }, []);

  const setBookingStatus = useCallback(async (id, status) => {
    const next = {};
    for (const [key, list] of Object.entries(bookings)) {
      next[key] = list.map((b) => (b.id === id ? { ...b, status } : b));
    }
    await saveBookings(next);
  }, [bookings, saveBookings]);

  const allBookings = useMemo(() => Object.values(bookings).flat(), [bookings]);

  // お客様自身の来店履歴（電話番号で予約データに紐付け）
  const myHistory = useMemo(() => {
    const mine = normPhone(profile.phone);
    if (!mine) return [];
    return allBookings
      .filter((b) => normPhone(b.phone) === mine)
      .sort((a, b) => (a.dateKey + a.start).localeCompare(b.dateKey + b.start));
  }, [allBookings, profile.phone]);

  const nextBooking = useMemo(() => {
    const todayKey = toDateKey(new Date());
    return myHistory.find((b) => b.dateKey >= todayKey && b.status !== "cancelled");
  }, [myHistory]);

  const lastVisit = useMemo(() => {
    const todayKey = toDateKey(new Date());
    const past = myHistory.filter((b) => b.status !== "cancelled" && b.dateKey < todayKey);
    return past.length ? past[past.length - 1] : null;
  }, [myHistory]);
  const lastMenu = lastVisit ? MENU_ITEMS.find((m) => m.name === lastVisit.menuName) : null;

  const dateCards = useMemo(
    () => Array.from({ length: 12 }, (_, i) => daysFromNow(dateOffset + i)),
    [dateOffset],
  );
  const timeRows = useMemo(() => {
    const rows = [];
    for (let m = BUSINESS_HOURS.start * 60; m <= BUSINESS_HOURS.end * 60 - SLOT_INTERVAL; m += SLOT_INTERVAL) {
      rows.push(`${pad(Math.floor(m / 60))}:${pad(m % 60)}`);
    }
    return rows;
  }, []);

  const isReturning = !!(profile.name && profile.phone);

  const startFlow = (presetMenuId) => {
    setMenuId(presetMenuId || null);
    setDate(null); setTime(null); setError(""); setConfirmedId(null);
    setFlowStep(presetMenuId ? 1 : 0);
    setTab("book");
  };
  const changeTab = (t) => {
    if (t === "book" && !confirmedId) { setFlowStep(0); setMenuId(null); setDate(null); setTime(null); setError(""); }
    setTab(t);
  };
  const selectDate = (d) => {
    setDate(d); setTime(null);
    setTimeout(() => timeHeadingRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  };
  const shiftDate = (delta) => setDateOffset((o) => Math.max(0, o + delta * 12));

  const canNext = flowStep === 0 ? !!menuId
    : flowStep === 1 ? !!(date && time)
    : flowStep === 2 ? !!(form.name.trim() && form.phone.trim())
    : true;

  const goNext = () => {
    if (flowStep === 1 && isReturning) {
      setForm({ name: profile.name, phone: profile.phone, email: profile.email || "" });
      setFlowStep(3);
      return;
    }
    setFlowStep((s) => s + 1);
  };

  const submitRequest = async () => {
    if (!menu || !date || !time) return;
    setSaving(true); setError("");
    const key = toDateKey(date);
    const end = addMinutes(time, menu.duration);
    const dayList = bookings[key] || [];
    const overlap = dayList.some((b) => isBlocking(b) && toMinutes(time) < toMinutes(b.end) && toMinutes(end) > toMinutes(b.start));
    if (overlap) {
      setError("申し訳ありません。この時間は直前に埋まりました。別の時間をお選びください。");
      setSaving(false); setTime(null); setFlowStep(1);
      return;
    }
    const entry = {
      id: makeBookingId(key, time), dateKey: key, start: time, end,
      name: form.name.trim(), phone: form.phone.trim(), email: form.email.trim(),
      menuName: menu.name, price: menu.price, createdAt: nowMillis(), status: "pending",
    };
    await saveBookings({ ...bookings, [key]: [...dayList, entry] });
    await saveProfile({ name: form.name.trim(), phone: form.phone.trim(), email: form.email.trim() });
    setConfirmedId(entry.id);
    setSaving(false);
  };

  const resetFlow = () => {
    setFlowStep(0); setMenuId(null); setDate(null); setTime(null); setConfirmedId(null); setError(""); setTab("home");
  };

  const cancelBooking = async (id) => {
    await setBookingStatus(id, "cancelled");
    setConfirmCancelId(null);
  };

  const filteredMenu = category === "all" ? MENU_ITEMS : MENU_ITEMS.filter((m) => m.cat === category);

  // ---- 管理画面のアクション ----
  const noticeFor = (id, status) => {
    const b = allBookings.find((x) => x.id === id);
    return b ? { ...b, status } : null;
  };
  const adminApprove = async (id) => {
    setAdminNotice({ type: "approved", booking: noticeFor(id, "confirmed") });
    await setBookingStatus(id, "confirmed");
  };
  const adminReject = async (id) => {
    setAdminNotice({ type: "rejected", booking: noticeFor(id, "cancelled") });
    await setBookingStatus(id, "cancelled");
  };
  const adminCancelConfirmed = async (id) => { await setBookingStatus(id, "cancelled"); };

  const goAdmin = () => { window.location.hash = "#admin"; };
  const leaveAdmin = () => { window.location.hash = ""; };
  const doAdminLogin = async (pin) => {
    if (pin !== ADMIN_PIN) return false;
    setAdminAuthed(true);
    try { await window.storage.set("adminAuthed", "1", false); } catch { /* noop */ }
    return true;
  };
  const adminLogout = async () => {
    setAdminAuthed(false);
    setAdminNotice(null);
    try { await window.storage.delete("adminAuthed"); } catch { /* noop */ }
  };
  const setTextSize = (v) => saveSettings({ ...settings, textSize: v });

  if (loading) {
    return (
      <div className="totonoe totonoe-loading" data-textsize={textSize}><IconSpinner /></div>
    );
  }

  if (route === "admin") {
    return (
      <div className="totonoe" data-textsize={textSize}>
        <AdminScreen
          authed={adminAuthed}
          onLogin={doAdminLogin}
          onLogout={adminLogout}
          onLeave={leaveAdmin}
          bookings={allBookings}
          notice={adminNotice}
          onDismissNotice={() => setAdminNotice(null)}
          onApprove={adminApprove}
          onReject={adminReject}
          onCancelConfirmed={adminCancelConfirmed}
          settings={settings}
          onSaveAnnouncement={(text) => saveSettings({ ...settings, announcement: text })}
          onSaveContact={(ci) => saveSettings({ ...settings, contactInfo: ci })}
        />
      </div>
    );
  }

  const ci = settings.contactInfo;

  return (
    <div className="totonoe" data-textsize={textSize}>
      <div className="totonoe-shell">
        <div className="screen">
          <div className="screen-scroll" ref={scrollRef}>
            <TextSizeToggle value={textSize} onChange={setTextSize} />

            {/* ===== HOME ===== */}
            {tab === "home" && (
              <div className="screen-body">
                {settings.announcement.trim() && (
                  <div className="notice">
                    <span className="notice-icon"><IconAlert size={20} /></span>
                    <div className="notice-body">
                      <p className="lbl">お知らせ</p>
                      <p className="msg">{settings.announcement}</p>
                    </div>
                  </div>
                )}
                <Eyebrow>WELCOME</Eyebrow>
                <h1 className="serif">{SALON_NAME}</h1>
                <p className="tagline">作業療法士が、根本から丁寧に整えます。</p>

                <div className="card" style={{ display: "flex", alignItems: "center", gap: 13, marginTop: 18 }}>
                  <div className="avatar">{profile.name ? profile.name[0] : <IconUser size={20} />}</div>
                  <p style={{ fontSize: "var(--fs-base)", fontWeight: 500 }}>
                    こんにちは、{profile.name ? `${profile.name}様` : "ゲスト様"}
                  </p>
                </div>

                {nextBooking && (
                  <div className="card" style={{ background: "var(--moss-tint)", borderColor: "var(--moss-tint)" }}>
                    <Eyebrow style={{ marginBottom: 8 }}>つぎのご予約</Eyebrow>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                      <p style={{ fontSize: "var(--fs-base)", lineHeight: 1.6, fontWeight: 500 }}>
                        {nextBooking.dateKey.replace(/-/g, "/")} {nextBooking.start} 〜<br />{nextBooking.menuName}
                      </p>
                      <StatusPill status={nextBooking.status} dateKey={nextBooking.dateKey} />
                    </div>
                    <button className="btn btn-outline" style={{ marginTop: 14, width: "100%" }} onClick={() => setTab("mypage")}>詳しく見る</button>
                  </div>
                )}

                <div className="banner" style={{ marginTop: 12 }}>
                  <LeafDeco />
                  {lastMenu ? (
                    <>
                      <p className="eyebrow" style={{ color: "#fff", opacity: 0.8 }}>前回のご利用メニュー</p>
                      <p className="serif" style={{ fontSize: "var(--fs-lg)", lineHeight: 1.4, color: "#fff" }}>{lastMenu.name}</p>
                      <p style={{ fontSize: "var(--fs-sm)", opacity: 0.9, marginTop: 8 }}>{lastMenu.duration}分 ／ ¥{lastMenu.price.toLocaleString()}</p>
                      <button className="btn" style={{ marginTop: 16, background: "#fff", color: "var(--moss-deep)" }} onClick={() => startFlow(lastMenu.id)}>同じメニューでもう一度予約</button>
                    </>
                  ) : (
                    <>
                      <p className="eyebrow" style={{ color: "#fff", opacity: 0.8 }}>はじめての方に</p>
                      <p className="serif" style={{ fontSize: "var(--fs-xl)", lineHeight: 1.4, color: "#fff" }}>おためし相談<br />コース</p>
                      <p style={{ fontSize: "var(--fs-sm)", opacity: 0.9, marginTop: 8 }}>60分 ／ ¥2,000</p>
                      <button className="btn" style={{ marginTop: 16, background: "#fff", color: "var(--moss-deep)" }} onClick={() => startFlow("f1")}>ご予約はこちら</button>
                    </>
                  )}
                </div>

                <button className="card" style={{ width: "100%", textAlign: "left", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", marginTop: 12, fontFamily: "inherit", minHeight: "var(--tap)" }} onClick={() => setTab("mypage")}>
                  <span style={{ fontSize: "var(--fs-base)", fontWeight: 500 }}>ご来店履歴を見る</span>
                  <span className="muted" style={{ fontSize: 20 }}>›</span>
                </button>
              </div>
            )}

            {/* ===== CONTACT ===== */}
            {tab === "contact" && (
              <div className="screen-body">
                <Eyebrow>CONTACT</Eyebrow>
                <h2 className="serif">お問合せ</h2>
                <p className="muted" style={{ fontSize: "var(--fs-sm)", margin: "8px 0 18px", lineHeight: 1.7 }}>
                  ご予約前のご相談やご不明な点は、お電話・メールにてお気軽にご連絡ください
                </p>

                <div className="card">
                  <Eyebrow>お電話</Eyebrow>
                  <p className="serif" style={{ fontSize: "var(--fs-xl)", margin: "2px 0 8px", color: "var(--moss)" }}>{ci.phone}</p>
                  <p className="muted" style={{ fontSize: "var(--fs-sm)", marginBottom: 16 }}>
                    受付時間　{pad(BUSINESS_HOURS.start)}:00〜{pad(BUSINESS_HOURS.end)}:00（日曜定休）
                  </p>
                  <a href={`tel:${normPhone(ci.phone)}`} className="btn btn-primary" style={{ textDecoration: "none" }}>電話をかける</a>
                </div>

                <div className="card">
                  <Eyebrow>メール</Eyebrow>
                  <p style={{ fontSize: "var(--fs-base)", margin: "2px 0 14px", wordBreak: "break-all" }}>{ci.email}</p>
                  <a href={`mailto:${ci.email}?subject=${encodeURIComponent("お問合せ")}`} className="btn btn-outline" style={{ textDecoration: "none", width: "100%" }}>メールを送る</a>
                </div>

                <div className="card">
                  <Eyebrow>SNS・ホームページ</Eyebrow>
                  <p className="muted" style={{ fontSize: "var(--fs-sm)", marginBottom: 14 }}>日々の施術の様子やお知らせも発信しています</p>
                  <a href={ci.instagram} target="_blank" rel="noopener noreferrer" className="btn btn-outline" style={{ textDecoration: "none", width: "100%", marginBottom: 8 }}>Instagramを見る</a>
                  <a href={ci.website} target="_blank" rel="noopener noreferrer" className="btn btn-outline" style={{ textDecoration: "none", width: "100%" }}>ホームページを見る</a>
                </div>

                <p className="muted" style={{ fontSize: "var(--fs-xs)", marginTop: 12 }}>※連絡先・SNS等のリンクは仮の値です（本番公開時に差し替え）</p>
                <button className="btn-text" style={{ marginTop: 10, color: "var(--ink-soft)", display: "block" }} onClick={goAdmin}>サロン管理者の方はこちら</button>
              </div>
            )}

            {/* ===== BOOK FLOW ===== */}
            {tab === "book" && (
              confirmedId ? (
                <div className="screen-body">
                  <div className="card" style={{ textAlign: "center", padding: "30px 18px", marginTop: 4 }}>
                    <div style={{ width: 52, height: 52, borderRadius: "50%", background: "var(--pending-bg)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px", color: "var(--pending-text)" }}>
                      <IconCheck size={24} />
                    </div>
                    <h2 className="serif">予約リクエストを送信しました</h2>
                    <p className="pill pill-pending" style={{ margin: "12px 0 18px" }}>承認待ち</p>
                    <div className="card" style={{ textAlign: "left" }}>
                      <div className="row"><span className="k">メニュー</span><span className="v">{menu?.name}</span></div>
                      <div className="row"><span className="k">日時</span><span className="v">{date && formatDateJP(date)} {time}〜{time && addMinutes(time, menu.duration)}</span></div>
                      <div className="row"><span className="k">お名前</span><span className="v">{form.name}様</span></div>
                      <div className="row"><span className="k">料金</span><span className="v">¥{menu?.price.toLocaleString()}</span></div>
                    </div>
                    {form.email ? (
                      <p className="note note-moss" style={{ marginTop: 14, textAlign: "left" }}>サロンの確認後、確定のご連絡をメールでお送りします。</p>
                    ) : (
                      <p className="note note-warn" style={{ marginTop: 14, textAlign: "left" }}>メールアドレスのご登録がないため、確定のご連絡はお電話にて行います。</p>
                    )}
                    <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={resetFlow}>ホームに戻る</button>
                  </div>
                </div>
              ) : (
                <div className="screen-body">
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    {flowStep > 0 && (
                      <button onClick={() => setFlowStep(flowStep - 1)} aria-label="戻る"
                        style={{ background: "none", border: "none", padding: 0, color: "var(--ink-soft)", cursor: "pointer", minHeight: 36, width: 36, display: "flex", alignItems: "center" }}>
                        <IconChevronLeft size={24} />
                      </button>
                    )}
                    <Eyebrow style={{ margin: 0 }}>STEP {flowStep + 1} / 4</Eyebrow>
                  </div>
                  <h2 className="serif" style={{ marginBottom: 16 }}>{["メニューを選ぶ", "日時を選ぶ", "お客様情報", "内容の確認"][flowStep]}</h2>
                  <div className="steps">
                    {[0, 1, 2, 3].map((i) => <div key={i} className={`step ${i <= flowStep ? "on" : ""}`} />)}
                  </div>

                  {error && <p className="note note-warn" style={{ marginBottom: 14 }}>{error}</p>}

                  {flowStep === 0 && (
                    <div>
                      <div style={{ display: "flex", gap: 8, overflowX: "auto", marginBottom: 14, paddingBottom: 2 }}>
                        {CATEGORIES.map((c) => (
                          <button key={c.id} className={`chip ${category === c.id ? "active" : ""}`} onClick={() => setCategory(c.id)}>{c.label}</button>
                        ))}
                      </div>
                      {filteredMenu.map((m) => (
                        <button key={m.id} className={`menuitem ${menuId === m.id ? "sel" : ""}`} onClick={() => setMenuId(m.id)} aria-pressed={menuId === m.id}>
                          <span className="menuitem-check"><CheckMark /></span>
                          <span className="menuitem-body">
                            <span className="menuitem-name">{m.name}</span>
                            <span className="menuitem-meta">所要時間　{m.duration}分</span>
                            <span className="menuitem-desc">{m.desc}</span>
                            <span className="menuitem-price">¥{m.price.toLocaleString()}</span>
                          </span>
                        </button>
                      ))}
                    </div>
                  )}

                  {flowStep === 1 && (
                    !menuId ? (
                      <p className="note note-warn">先にメニューを選んでください。</p>
                    ) : (
                      <div>
                        <p style={{ fontSize: "var(--fs-base)", fontWeight: 600, marginBottom: 10 }}>日付を選ぶ</p>
                        <div className="datewrap">
                          {dateCards.map((d) => {
                            const off = isPastOrClosed(d);
                            const sel = date && toDateKey(date) === toDateKey(d);
                            return (
                              <button key={d.toISOString()} className={`datecard${sel ? " sel" : ""}${off ? " off" : ""}`}
                                disabled={off} onClick={() => selectDate(d)}>
                                <span className="dow">{dowJP(d)}</span>
                                <span className="num">{d.getDate()}</span>
                                {off && <span className="dow">{CLOSED_WEEKDAYS.includes(d.getDay()) ? "定休日" : "—"}</span>}
                              </button>
                            );
                          })}
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12 }}>
                          <button className="btn btn-outline" style={{ padding: "0 16px", minHeight: 44, fontSize: "var(--fs-sm)" }} disabled={dateOffset === 0} onClick={() => shiftDate(-1)}>‹ 直近の日程</button>
                          <button className="btn btn-outline" style={{ padding: "0 16px", minHeight: 44, fontSize: "var(--fs-sm)" }} onClick={() => shiftDate(1)}>さらに先の日程 ›</button>
                        </div>

                        {date && (
                          <>
                            <p ref={timeHeadingRef} style={{ scrollMarginTop: 12, fontSize: "var(--fs-base)", fontWeight: 600, marginTop: 24, marginBottom: 10 }}>
                              時間を選ぶ　{formatDateJP(date)}
                            </p>
                            <div className="timelist">
                              {timeRows.map((t) => {
                                const reason = slotReason(menu, bookings[toDateKey(date)] || [], date, t);
                                const avail = reason === null;
                                const sel = time === t;
                                const label = sel ? "選択中" : avail ? "予約できます" : reason === "taken" ? "予約済み" : reason === "past" ? "受付終了" : "対象外";
                                return (
                                  <button key={t} className={`timerow${sel ? " sel" : ""}${!avail ? " off" : ""}`} disabled={!avail} onClick={() => setTime(t)}>
                                    <span>{t} 〜 {addMinutes(t, menu.duration)}</span>
                                    <span className="badge">{label}</span>
                                  </button>
                                );
                              })}
                            </div>
                          </>
                        )}
                      </div>
                    )
                  )}

                  {flowStep === 2 && (
                    <div>
                      {isReturning && (
                        <p className="note note-moss" style={{ marginBottom: 16 }}>前回のご来店情報を自動で入力しています。変更があれば書き換えてください。</p>
                      )}
                      <label className="field">
                        <span className="lbl">お名前 <span className="req">必須</span></span>
                        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="山田 太郎" />
                      </label>
                      <label className="field">
                        <span className="lbl">電話番号 <span className="req">必須</span></span>
                        <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="090-1234-5678" inputMode="tel" />
                      </label>
                      <label className="field">
                        <span className="lbl">メールアドレス <span className="opt">任意</span></span>
                        <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="example@mail.com" inputMode="email" />
                      </label>
                    </div>
                  )}

                  {flowStep === 3 && (
                    <div>
                      <div className="card">
                        <div className="row"><span className="k">メニュー</span><span className="v">{menu?.name}</span></div>
                        <div className="row"><span className="k">日時</span><span className="v">{date && formatDateJP(date)} {time}〜{time && addMinutes(time, menu.duration)}</span></div>
                        <div className="row"><span className="k">お名前</span><span className="v">{form.name}様</span></div>
                        <div className="row" style={{ borderTop: "1px solid var(--line)", paddingTop: 10, marginTop: 10 }}><span className="k">料金</span><span className="v">¥{menu?.price.toLocaleString()}</span></div>
                      </div>
                      <p className="note note-warn" style={{ marginTop: 14 }}>この時点ではまだ確定ではありません。サロン側で内容を確認のうえ承認いたします。</p>
                      {isReturning && <button className="btn-text" onClick={() => setFlowStep(2)}>お客様情報を変更する</button>}
                    </div>
                  )}
                </div>
              )
            )}

            {/* ===== MYPAGE ===== */}
            {tab === "mypage" && (
              <div className="screen-body flush">
                <div className="banner" style={{ borderRadius: 0, padding: "22px 22px 30px" }}>
                  <LeafDeco />
                  <p className="eyebrow" style={{ color: "#fff", opacity: 0.75 }}>マイページ</p>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 4 }}>
                    <div style={{ width: 44, height: 44, borderRadius: "50%", background: "rgba(255,255,255,0.18)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "var(--fs-md)", color: "#fff" }}>
                      {profile.name ? profile.name[0] : <IconUser size={20} />}
                    </div>
                    <p style={{ fontSize: "var(--fs-md)", color: "#fff", fontWeight: 500 }}>{profile.name ? `${profile.name} 様` : "ゲスト様"}</p>
                  </div>
                </div>
                <div style={{ padding: "0 22px", marginTop: -16, paddingBottom: 26 }}>
                  <div className="card">
                    <p style={{ fontSize: "var(--fs-base)", fontWeight: 600, marginBottom: 6 }}>ご来店履歴</p>
                    {myHistory.length === 0 ? (
                      <p className="empty">まだ来店履歴がありません</p>
                    ) : (
                      myHistory.slice().reverse().map((b) => {
                        const future = isFuture(b.dateKey);
                        const active = b.status === "pending" || b.status === "confirmed";
                        const cancellable = future && active && !cancelDeadlinePassed(b.dateKey);
                        return (
                          <div key={b.id} className="histrow">
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                              <div>
                                <p style={{ fontSize: "var(--fs-base)", fontWeight: 500 }}>{b.dateKey.replace(/-/g, "/")} {b.start}</p>
                                <p className="muted" style={{ fontSize: "var(--fs-sm)", marginTop: 4 }}>{b.menuName}　¥{b.price.toLocaleString()}</p>
                              </div>
                              <StatusPill status={b.status} dateKey={b.dateKey} />
                            </div>
                            {future && active && (
                              cancellable ? (
                                confirmCancelId === b.id ? (
                                  <div style={{ marginTop: 12 }}>
                                    <p className="muted" style={{ fontSize: "var(--fs-sm)", marginBottom: 8 }}>この予約をキャンセルします。よろしいですか？</p>
                                    <div style={{ display: "flex", gap: 8 }}>
                                      <button className="btn btn-cancel" onClick={() => cancelBooking(b.id)}>キャンセルする</button>
                                      <button className="btn btn-outline" onClick={() => setConfirmCancelId(null)}>やめる</button>
                                    </div>
                                  </div>
                                ) : (
                                  <button className="btn btn-cancel" style={{ marginTop: 12 }} onClick={() => setConfirmCancelId(b.id)}>この予約をキャンセルする</button>
                                )
                              ) : (
                                <p className="muted" style={{ fontSize: "var(--fs-xs)", marginTop: 12, lineHeight: 1.6 }}>
                                  キャンセル期限（前日24:00）を過ぎています。ご変更はお電話にてご連絡ください
                                </p>
                              )
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                  <p className="muted" style={{ fontSize: "var(--fs-xs)", margin: "10px 2px 0", lineHeight: 1.6 }}>
                    予約内容（日時・メニュー）のご変更は、お電話にてサロンへご連絡ください。
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* ===== 下部固定ドック ===== */}
          <div className="bottomdock">
            {tab === "book" && !confirmedId && (
              <div className="actionbar">
                {flowStep < 3 ? (
                  <button className="btn btn-primary" disabled={!canNext} onClick={goNext}>次へ</button>
                ) : (
                  <button className="btn btn-primary" disabled={saving} onClick={submitRequest}>
                    {saving ? <IconSpinner size={18} /> : null}予約リクエストを送信
                  </button>
                )}
              </div>
            )}
            <div className="navbar">
              {[
                { id: "home", label: "ホーム", Icon: IconHome },
                { id: "book", label: "予約", Icon: IconCalendar },
                { id: "mypage", label: "マイページ", Icon: IconUser },
                { id: "contact", label: "お問合せ", Icon: IconPhone },
              ].map((t) => (
                <button key={t.id} className={`navbtn ${tab === t.id ? "active" : ""}`} onClick={() => changeTab(t.id)}>
                  <t.Icon className="navicon" size={25} />
                  <span>{t.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// サロン管理画面（#admin）
// ============================================================
function AdminScreen({ authed, onLogin, onLogout, onLeave, bookings, notice, onDismissNotice, onApprove, onReject, onCancelConfirmed, settings, onSaveAnnouncement, onSaveContact }) {
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState(false);
  const [announceDraft, setAnnounceDraft] = useState(settings.announcement);
  const [contactDraft, setContactDraft] = useState(settings.contactInfo);
  const [confirmCancelId, setConfirmCancelId] = useState(null);
  const [savedFlash, setSavedFlash] = useState("");

  const flash = (msg) => { setSavedFlash(msg); setTimeout(() => setSavedFlash(""), 2000); };

  if (!authed) {
    return (
      <div className="totonoe-shell">
        <div className="screen-scroll">
          <div className="pin-wrap">
            <span style={{ color: "var(--moss)" }}><IconShield size={28} /></span>
            <Eyebrow>SALON ADMIN</Eyebrow>
            <h2 className="serif" style={{ marginBottom: 6 }}>サロン管理画面</h2>
            <p className="muted" style={{ fontSize: "var(--fs-sm)", marginBottom: 20 }}>パスコードを入力してください</p>
            <label className="field">
              <input type="password" inputMode="numeric" value={pin} placeholder="パスコード"
                style={{ letterSpacing: "0.3em", borderColor: pinError ? "#E3B08C" : undefined }}
                onChange={(e) => { setPin(e.target.value); setPinError(false); }} />
            </label>
            {pinError && <p style={{ fontSize: "var(--fs-sm)", color: "var(--cancel-text)", margin: "-8px 0 12px" }}>パスコードが違います</p>}
            <button className="btn btn-primary" onClick={async () => { if (!(await onLogin(pin.trim()))) setPinError(true); }}>ログイン</button>
            <p className="note note-moss" style={{ marginTop: 16 }}>
              本番公開時は、この画面に必ずログイン保護を設けます（要件書7章）。現在は暫定のパスコード方式です。
            </p>
            <button className="btn-text" style={{ marginTop: 14, color: "var(--ink-soft)", display: "block" }} onClick={onLeave}>予約アプリに戻る</button>
          </div>
        </div>
      </div>
    );
  }

  const todayKey = toDateKey(new Date());
  const asc = (a, b) => (a.dateKey + a.start).localeCompare(b.dateKey + b.start);
  const pending = bookings.filter((b) => b.status === "pending").sort(asc);
  const upcoming = bookings.filter((b) => b.status === "confirmed" && b.dateKey >= todayKey).sort(asc);
  const past = bookings
    .filter((b) => b.status === "cancelled" || (b.status === "confirmed" && b.dateKey < todayKey))
    .sort((a, b) => asc(b, a))
    .slice(0, 6);
  const todayCount = bookings.filter((b) => b.dateKey === todayKey && b.status !== "cancelled").length;

  const Row = ({ b, children }) => (
    <div className={`admin-row${b.status === "pending" ? " pending" : ""}`}>
      <p className="when">{b.dateKey.replace(/-/g, "/")}（{dowJP(new Date(`${b.dateKey}T00:00:00`))}） {b.start}〜{b.end}</p>
      <p className="menu">{b.menuName}　¥{b.price.toLocaleString()}</p>
      <p className="cust">
        {b.name || "—"} 様　<a href={`tel:${normPhone(b.phone)}`}>{b.phone}</a>
        {b.email && <> 　<a href={`mailto:${b.email}`}>{b.email}</a></>}
      </p>
      {children}
    </div>
  );

  return (
    <div className="totonoe-shell">
      <div className="screen-scroll">
        <div className="screen-body">
          <div className="admin-head">
            <div>
              <Eyebrow>SALON ADMIN</Eyebrow>
              <h2 className="serif">予約リクエスト管理</h2>
            </div>
            <div className="links">
              <button className="btn-text" style={{ fontSize: "var(--fs-xs)", color: "var(--ink-soft)" }} onClick={onLeave}>アプリ表示</button>
              <button className="btn-text" style={{ fontSize: "var(--fs-xs)", color: "var(--ink-soft)" }} onClick={onLogout}>ログアウト</button>
            </div>
          </div>
          <p className="muted" style={{ fontSize: "var(--fs-sm)", marginTop: 6, lineHeight: 1.6 }}>
            承認・却下、確定予約の取り消しができます。この一覧で埋まっている時間は、お客様側では自動的に選べなくなります。
          </p>

          <div className="admin-stats">
            <div className="admin-stat"><div className="n">{pending.length}</div><div className="l">承認待ち</div></div>
            <div className="admin-stat"><div className="n">{upcoming.length}</div><div className="l">確定（今後）</div></div>
            <div className="admin-stat"><div className="n">{todayCount}</div><div className="l">本日のご来店</div></div>
          </div>

          {savedFlash && <p className="note note-moss" style={{ marginTop: 12 }}>{savedFlash}</p>}

          {/* 承認・却下の通知プレビュー */}
          {notice && notice.booking && (
            <div style={{ marginTop: 14 }}>
              <NotificationPreview notice={notice} />
              <button className="btn-text" style={{ color: "var(--ink-soft)" }} onClick={onDismissNotice}>閉じる</button>
            </div>
          )}

          {/* お知らせ編集 */}
          <div className="admin-section-title">お知らせ編集（ホーム画面の上部に表示）</div>
          <div className="admin-row">
            <textarea className="admin-textarea" value={announceDraft} placeholder="例：8月13日（木）は臨時休業とさせていただきます"
              onChange={(e) => setAnnounceDraft(e.target.value)} />
            <div className="admin-actions">
              <button className="admin-btn admin-btn-approve" onClick={() => { onSaveAnnouncement(announceDraft); flash("お知らせを更新しました"); }}>更新する</button>
              <button className="admin-btn admin-btn-cancel" onClick={() => { setAnnounceDraft(""); onSaveAnnouncement(""); flash("お知らせを消しました"); }}>お知らせを消す</button>
            </div>
          </div>

          {/* 承認待ち */}
          <div className="admin-section-title">承認待ちの予約リクエスト</div>
          {pending.length === 0 ? (
            <p className="admin-empty">現在、承認待ちのリクエストはありません。</p>
          ) : pending.map((b) => (
            <Row key={b.id} b={b}>
              <div className="admin-actions">
                <button className="admin-btn admin-btn-approve" onClick={() => onApprove(b.id)}>承認</button>
                <button className="admin-btn admin-btn-reject" onClick={() => onReject(b.id)}>却下</button>
              </div>
            </Row>
          ))}

          {/* 確定済み（今後） */}
          <div className="admin-section-title">確定済みの予約（今後）</div>
          {upcoming.length === 0 ? (
            <p className="admin-empty">今後の確定予約はありません。</p>
          ) : upcoming.map((b) => (
            <Row key={b.id} b={b}>
              {confirmCancelId === b.id ? (
                <div className="admin-actions">
                  <button className="admin-btn admin-btn-reject" onClick={() => { onCancelConfirmed(b.id); setConfirmCancelId(null); }}>取り消す</button>
                  <button className="admin-btn admin-btn-cancel" onClick={() => setConfirmCancelId(null)}>やめる</button>
                </div>
              ) : (
                <div className="admin-actions">
                  <button className="admin-btn admin-btn-cancel" onClick={() => setConfirmCancelId(b.id)}>この予約を取り消す</button>
                </div>
              )}
            </Row>
          ))}

          {/* 過去・キャンセル済み */}
          <div className="admin-section-title">過去・キャンセル済み</div>
          {past.length === 0 ? (
            <p className="admin-empty">履歴はまだありません。</p>
          ) : past.map((b) => (
            <Row key={b.id} b={b}>
              <div style={{ marginTop: 10 }}><StatusPill status={b.status} dateKey={b.dateKey} /></div>
            </Row>
          ))}

          {/* 連絡先・SNS編集 */}
          <div className="admin-section-title">連絡先・SNSリンクの編集</div>
          <p className="muted" style={{ fontSize: "var(--fs-xs)", margin: "-4px 0 10px" }}>頻繁に変更するものではないため、一番下にまとめています</p>
          <div className="admin-row">
            {[
              ["phone", "電話番号"],
              ["email", "メールアドレス"],
              ["instagram", "Instagram URL"],
              ["website", "ホームページ URL"],
            ].map(([key, label]) => (
              <label key={key} style={{ display: "block", marginBottom: 10 }}>
                <span className="admin-fieldlabel">{label}</span>
                <input className="admin-input" value={contactDraft[key] || ""} onChange={(e) => setContactDraft({ ...contactDraft, [key]: e.target.value })} />
              </label>
            ))}
            <div className="admin-actions">
              <button className="admin-btn admin-btn-approve" onClick={() => { onSaveContact(contactDraft); flash("連絡先を更新しました"); }}>連絡先を更新する</button>
            </div>
          </div>

          <p className="muted" style={{ fontSize: "var(--fs-xs)", lineHeight: 1.7, marginTop: 20 }}>
            ※このプロトタイプでは予約データはこの端末のブラウザ内（localStorage）にのみ保存され、他の端末とは同期しません。
            本番公開時は Supabase 等のデータベースに置き換える想定です（要件書7章）。
          </p>
        </div>
      </div>
    </div>
  );
}

// 承認・却下時に、お客様へ自動送信される通知メールの文面プレビュー
function NotificationPreview({ notice }) {
  const b = notice.booking;
  const approved = notice.type === "approved";
  if (b.email) {
    return (
      <>
        <div className="mailcard">
          <div className="mailcard-head">
            <span>通知メール（本番で自動送信される内容）</span>
            <span>宛先: {b.name || "お客様"} 様</span>
          </div>
          <div className="mailcard-body">
            {approved ? (
              <>
                <p className="mailcard-subject">【整えサロン】ご予約が確定しました</p>
                <p className="mailcard-line">{b.name} 様</p>
                <p className="mailcard-line">以下の内容でご予約が確定しましたのでご連絡いたします。</p>
                <p className="mailcard-line">日時：{b.dateKey.replace(/-/g, "/")} {b.start}〜{b.end}</p>
                <p className="mailcard-line">メニュー：{b.menuName}（¥{b.price.toLocaleString()}）</p>
                <p className="pill pill-confirmed" style={{ marginTop: 10 }}>確定</p>
              </>
            ) : (
              <>
                <p className="mailcard-subject">【整えサロン】ご予約についてのご連絡</p>
                <p className="mailcard-line">{b.name} 様</p>
                <p className="mailcard-line">大変申し訳ございませんが、下記のご希望日時でのご予約をお受けすることができませんでした。</p>
                <p className="mailcard-line">日時：{b.dateKey.replace(/-/g, "/")} {b.start}〜{b.end}</p>
                <p className="mailcard-line">メニュー：{b.menuName}</p>
                <p className="mailcard-line">お手数ですが、別の日時にて再度ご予約をお願いいたします。</p>
                <p className="pill pill-cancelled" style={{ marginTop: 10 }}>お受けできませんでした</p>
              </>
            )}
          </div>
        </div>
        <p className="mailcard-hint">
          {approved
            ? "承認と同時に、お客様へ確定のご連絡メールが自動送信される想定です（本番の Resend で実装）。"
            : "却下と同時に、お客様へその旨をお伝えするメールが自動送信される想定です（「却下」の語は文面では使いません）。"}
        </p>
      </>
    );
  }
  return (
    <>
      <div className="mailcard">
        <div className="mailcard-head"><span>ご連絡方法</span><span>{b.name || "お客様"} 様</span></div>
        <div className="mailcard-body">
          <p className="mailcard-line">メールアドレスのご登録がないため、メールでの自動通知はできません。</p>
          <p className="mailcard-line">電話（{b.phone || "未登録"}）にて、{approved ? "確定" : "お受けできない旨"}をご連絡ください。</p>
        </div>
      </div>
      <p className="mailcard-hint">メールアドレス未登録のお客様への通知手段は、要件書8章のとおりまだ確定していません。</p>
    </>
  );
}
