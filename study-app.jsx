import { useState, useEffect, useRef, useCallback } from "react";
import {
  Home, CalendarClock, Timer as TimerIcon, Camera, BrainCircuit,
  Play, Pause, RotateCcw, Plus, X, Loader2, Sparkles, TrendingUp,
  Upload, CheckCircle2, XCircle, Trash2, BookOpen
} from "lucide-react";

const ACCENTS = ["#E8A33D", "#7FB3B0", "#E0704F", "#A78BC7", "#8FAF7A"];
const STORAGE_KEY = "cheotgong-app-data";

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function formatClock(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  if (h > 0) return `${h}:${pad2(m)}:${pad2(s)}`;
  return `${pad2(m)}:${pad2(s)}`;
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result.split(",")[1]);
    r.onerror = () => reject(new Error("파일을 읽지 못했어요"));
    r.readAsDataURL(file);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callClaude({ system, userContent, maxTokens = 1000 }, attempt = 1) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: userContent }],
    }),
  });
  if (!res.ok) {
    // only retry once, and only for errors that look genuinely transient —
    // retrying aggressively can itself trigger rate limits
    const transient = [408, 425, 500, 502, 503, 504].includes(res.status);
    if (transient && attempt < 2) {
      await sleep(1200);
      return callClaude({ system, userContent, maxTokens }, attempt + 1);
    }
    let detail = "";
    try { detail = (await res.text()).slice(0, 200); } catch (e) {}
    throw new Error(`API 요청 실패 (${res.status}) ${detail}`);
  }
  const data = await res.json();
  const text = (data.content || [])
    .map((b) => (b.type === "text" ? b.text : ""))
    .filter(Boolean)
    .join("\n");
  if (!text) throw new Error("응답 내용이 비어있어요");
  return text;
}

function parseJsonLoose(text) {
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  const slice = start >= 0 && end >= 0 ? cleaned.slice(start, end + 1) : cleaned;
  return JSON.parse(slice);
}

export default function StudyApp() {
  const [tab, setTab] = useState("home");
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saveError, setSaveError] = useState(false);

  const [subjects, setSubjects] = useState([]);
  const [studyInput, setStudyInput] = useState("");
  const [goal, setGoal] = useState("");
  const [dailyHoursTarget, setDailyHoursTarget] = useState(3);
  const [beginner, setBeginner] = useState(true);
  const [plan, setPlan] = useState(null);
  const [records, setRecords] = useState([]);
  const [quizSets, setQuizSets] = useState([]);
  const [bookRecs, setBookRecs] = useState([]);

  // load persisted data (retries once, since a transient failure here must never
  // be treated the same as "brand new user" — that was wiping saved data)
  useEffect(() => {
    let cancelled = false;
    async function attemptLoad(retriesLeft) {
      try {
        const result = await window.storage.get(STORAGE_KEY, false);
        if (cancelled) return;
        if (result && result.value) {
          const d = JSON.parse(result.value);
          setSubjects(d.subjects || []);
          setStudyInput(d.studyInput || "");
          setGoal(d.goal || "");
          setDailyHoursTarget(d.dailyHoursTarget ?? 3);
          setBeginner(d.beginner ?? true);
          setPlan(d.plan || null);
          setRecords(d.records || []);
          setQuizSets(d.quizSets || []);
          setBookRecs(d.bookRecs || []);
        }
        setLoaded(true);
      } catch (e) {
        if (retriesLeft > 0) {
          setTimeout(() => attemptLoad(retriesLeft - 1), 600);
        } else {
          // give up, but remember the load itself failed so we don't
          // let the very next auto-save overwrite real stored data with blanks
          setLoadFailed(true);
          setLoaded(true);
        }
      }
    }
    attemptLoad(2);
    return () => { cancelled = true; };
  }, []);

  // persist on change
  useEffect(() => {
    if (!loaded) return;
    const payload = { subjects, studyInput, goal, dailyHoursTarget, beginner, plan, records, quizSets, bookRecs };
    const isEmptyPayload =
      subjects.length === 0 && !studyInput && !goal && !plan &&
      records.length === 0 && quizSets.length === 0 && bookRecs.length === 0;
    // if loading failed and there's nothing meaningful to save yet, skip the write
    // instead of silently overwriting whatever was previously stored.
    if (loadFailed && isEmptyPayload) return;
    (async () => {
      try {
        const r = await window.storage.set(STORAGE_KEY, JSON.stringify(payload), false);
        setSaveError(!r);
      } catch (e) {
        setSaveError(true);
      }
    })();
  }, [subjects, studyInput, goal, dailyHoursTarget, beginner, plan, records, quizSets, bookRecs, loaded, loadFailed]);

  const addRecord = useCallback((subjectName, minutes) => {
    setRecords((prev) => [
      ...prev,
      { id: uid(), subject: subjectName, minutes, date: todayStr(), ts: Date.now() },
    ]);
  }, []);

  const todayMinutes = records
    .filter((r) => r.date === todayStr())
    .reduce((sum, r) => sum + r.minutes, 0);

  return (
    <div className="app-root">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Gowun+Batang:wght@400;700&family=IBM+Plex+Sans+KR:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500;600&family=Nanum+Pen+Script&display=swap');

        .app-root {
          --bg: #1F3B34;
          --surface: #2A4A41;
          --surface-light: #35594F;
          --ink: #F1EDE3;
          --ink-muted: #A8BEB6;
          --amber: #E8A33D;
          --blue: #7FB3B0;
          --coral: #E0704F;
          --line: rgba(241,237,227,0.14);
          font-family: 'IBM Plex Sans KR', sans-serif;
          background: var(--bg);
          color: var(--ink);
          min-height: 600px;
          max-width: 480px;
          margin: 0 auto;
          border-radius: 20px;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          position: relative;
        }
        .display-font { font-family: 'Gowun Batang', serif; }
        .pen-font { font-family: 'Nanum Pen Script', cursive; }
        .mono-font { font-family: 'IBM Plex Mono', monospace; }

        .header {
          padding: 22px 20px 16px;
          border-bottom: 1px dashed var(--line);
          display: flex;
          align-items: baseline;
          justify-content: space-between;
        }
        .header h1 { font-size: 22px; margin: 0; }
        .header .date { font-size: 12px; color: var(--ink-muted); }

        .content { flex: 1; overflow-y: auto; padding: 18px 18px 90px; }

        .card {
          background: var(--surface);
          border-radius: 14px;
          padding: 16px;
          margin-bottom: 14px;
          border: 1px solid var(--line);
        }
        .card-title {
          font-size: 13px;
          color: var(--ink-muted);
          text-transform: uppercase;
          letter-spacing: 0.06em;
          margin: 0 0 10px;
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .btn {
          border: none;
          border-radius: 10px;
          padding: 11px 16px;
          font-family: 'IBM Plex Sans KR', sans-serif;
          font-weight: 600;
          font-size: 14px;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          justify-content: center;
          transition: transform 0.12s ease, opacity 0.12s ease;
        }
        .btn:active { transform: scale(0.97); }
        .btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .btn-primary { background: var(--amber); color: #1F3B34; }
        .btn-secondary { background: var(--surface-light); color: var(--ink); }
        .btn-ghost { background: transparent; color: var(--ink-muted); border: 1px solid var(--line); }
        .btn-block { width: 100%; }

        input[type="text"], input[type="number"], textarea, select {
          width: 100%;
          background: var(--bg);
          border: 1px solid var(--line);
          border-radius: 8px;
          padding: 10px 12px;
          color: var(--ink);
          font-family: 'IBM Plex Sans KR', sans-serif;
          font-size: 14px;
          box-sizing: border-box;
        }
        textarea { resize: vertical; min-height: 60px; }
        input::placeholder, textarea::placeholder { color: var(--ink-muted); }

        .tag {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 5px 10px;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 600;
          color: #1F3B34;
        }

        .bottom-nav {
          position: absolute;
          bottom: 0; left: 0; right: 0;
          background: var(--surface);
          border-top: 1px solid var(--line);
          display: flex;
          padding: 8px 6px calc(8px + env(safe-area-inset-bottom));
        }
        .nav-btn {
          flex: 1;
          background: none;
          border: none;
          color: var(--ink-muted);
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 3px;
          font-size: 10px;
          padding: 6px 2px;
          border-radius: 10px;
          cursor: pointer;
        }
        .nav-btn.active { color: var(--amber); background: rgba(232,163,61,0.12); }

        .plan-block {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 0;
          border-bottom: 1px dashed var(--line);
        }
        .plan-block:last-child { border-bottom: none; }

        .ring-wrap { display:flex; align-items:center; justify-content:center; margin: 6px 0 16px; }

        .quiz-option {
          display: block;
          width: 100%;
          text-align: left;
          background: var(--bg);
          border: 1px solid var(--line);
          border-radius: 8px;
          padding: 10px 12px;
          color: var(--ink);
          margin-bottom: 8px;
          cursor: pointer;
          font-size: 14px;
          font-family: 'IBM Plex Sans KR', sans-serif;
        }
        .quiz-option.correct { border-color: #8FAF7A; background: rgba(143,175,122,0.15); }
        .quiz-option.wrong { border-color: var(--coral); background: rgba(224,112,79,0.15); }

        .empty {
          text-align: center;
          padding: 30px 10px;
          color: var(--ink-muted);
          font-size: 13px;
        }

        .photo-upload {
          border: 1px dashed var(--line);
          border-radius: 10px;
          padding: 20px;
          text-align: center;
          cursor: pointer;
          color: var(--ink-muted);
          font-size: 13px;
        }
        img.preview { max-width: 100%; border-radius: 8px; margin-top: 10px; display:block; }

        .spin { animation: spin-rotate 0.9s linear infinite; }
        @keyframes spin-rotate { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>

      <div className="header">
        <h1 className="display-font">첫공 플래너</h1>
        <div style={{ textAlign: "right" }}>
          <span className="date mono-font">{todayStr()}</span>
          {saveError && (
            <div style={{ fontSize: 10, color: "var(--coral)", marginTop: 2 }}>저장 실패 · 데이터 유실 위험</div>
          )}
        </div>
      </div>

      <div className="content">
        {tab === "home" && (
          <HomeTab
            subjects={subjects}
            goal={goal}
            dailyHoursTarget={dailyHoursTarget}
            todayMinutes={todayMinutes}
            records={records}
            plan={plan}
            goToPlan={() => setTab("plan")}
            goToTimer={() => setTab("timer")}
          />
        )}
        {tab === "plan" && (
          <PlanTab
            subjects={subjects}
            setSubjects={setSubjects}
            studyInput={studyInput}
            setStudyInput={setStudyInput}
            goal={goal}
            setGoal={setGoal}
            dailyHoursTarget={dailyHoursTarget}
            setDailyHoursTarget={setDailyHoursTarget}
            beginner={beginner}
            setBeginner={setBeginner}
            plan={plan}
            setPlan={setPlan}
          />
        )}
        {tab === "timer" && (
          <TimerTab subjects={subjects} plan={plan} onFinishSession={addRecord} records={records} />
        )}
        {tab === "photo" && <PhotoSolveTab />}
        {tab === "quiz" && <QuizTab quizSets={quizSets} setQuizSets={setQuizSets} />}
        {tab === "books" && <BookRecommendTab bookRecs={bookRecs} setBookRecs={setBookRecs} />}
      </div>

      <div className="bottom-nav">
        <NavBtn icon={Home} label="홈" active={tab === "home"} onClick={() => setTab("home")} />
        <NavBtn icon={CalendarClock} label="계획" active={tab === "plan"} onClick={() => setTab("plan")} />
        <NavBtn icon={TimerIcon} label="타이머" active={tab === "timer"} onClick={() => setTab("timer")} />
        <NavBtn icon={Camera} label="문제풀이" active={tab === "photo"} onClick={() => setTab("photo")} />
        <NavBtn icon={BrainCircuit} label="퀴즈" active={tab === "quiz"} onClick={() => setTab("quiz")} />
        <NavBtn icon={BookOpen} label="책추천" active={tab === "books"} onClick={() => setTab("books")} />
      </div>
    </div>
  );
}

function NavBtn({ icon: Icon, label, active, onClick }) {
  return (
    <button className={`nav-btn ${active ? "active" : ""}`} onClick={onClick}>
      <Icon size={18} />
      <span>{label}</span>
    </button>
  );
}

// ---------------- HOME ----------------
function HomeTab({ subjects, goal, dailyHoursTarget, todayMinutes, records, plan, goToPlan, goToTimer }) {
  const [comparing, setComparing] = useState(false);
  const [comparison, setComparison] = useState(null);
  const [error, setError] = useState("");

  const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
  const weekMinutes = records.filter((r) => r.ts >= weekAgo).reduce((s, r) => s + r.minutes, 0);
  const perSubject = {};
  records.forEach((r) => { perSubject[r.subject] = (perSubject[r.subject] || 0) + r.minutes; });

  async function runComparison() {
    setComparing(true);
    setError("");
    setComparison(null);
    try {
      const system = "너는 학습 코치야. 사용자의 목표와 최근 공부 시간을 보고, 그 목표를 가진 일반적인 학습자들이 보통 하루에 얼마나 공부하는지 참고 범위를 알려주고, 사용자가 그 범위 대비 적은지/적정한지/많은지 짧게 평가해줘. 반드시 순수 JSON만 출력해. 형식: {\"level\":\"부족|적정|많음|과함 중 하나\",\"message\":\"두 문장 이내의 한국어 코멘트\",\"referenceRange\":\"예: 하루 2~4시간\"}";
      const userContent = `목표: ${goal || "미설정"}\n하루 목표 공부시간: ${dailyHoursTarget}시간\n오늘 실제 공부시간: ${(todayMinutes / 60).toFixed(1)}시간\n최근 7일 총 공부시간: ${(weekMinutes / 60).toFixed(1)}시간`;
      const text = await callClaude({ system, userContent, maxTokens: 400 });
      setComparison(parseJsonLoose(text));
    } catch (e) {
      setError("비교 결과를 가져오지 못했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setComparing(false);
    }
  }

  return (
    <div>
      <div className="card">
        <p className="card-title"><TrendingUp size={14} /> 오늘의 공부 시간</p>
        <div style={{ fontSize: 32, fontWeight: 700 }} className="mono-font">
          {(todayMinutes / 60).toFixed(1)}<span style={{ fontSize: 16, color: "var(--ink-muted)" }}> / {dailyHoursTarget}시간</span>
        </div>
        <div style={{ height: 8, background: "var(--bg)", borderRadius: 999, marginTop: 10, overflow: "hidden" }}>
          <div style={{
            height: "100%",
            width: `${Math.min(100, (todayMinutes / 60 / dailyHoursTarget) * 100)}%`,
            background: "var(--amber)",
            borderRadius: 999,
          }} />
        </div>
      </div>

      {!plan ? (
        <div className="card">
          <p className="card-title"><Sparkles size={14} /> 오늘의 계획이 아직 없어요</p>
          <p style={{ fontSize: 13, color: "var(--ink-muted)", marginTop: 0 }}>과목과 목표를 입력하면 AI가 하루 계획을 짜드려요.</p>
          <button className="btn btn-primary btn-block" onClick={goToPlan}>계획 짜러 가기</button>
        </div>
      ) : (
        <div className="card">
          <p className="card-title"><CalendarClock size={14} /> 오늘의 계획</p>
          {plan.blocks.map((b, i) => (
            <div className="plan-block" key={i}>
              <span className="tag" style={{ background: b.type === "break" ? "var(--blue)" : ACCENTS[i % ACCENTS.length] }}>
                {b.type === "break" ? "휴식" : b.subject}
              </span>
              <span style={{ fontSize: 13, color: "var(--ink-muted)" }}>{b.minutes}분</span>
            </div>
          ))}
          <button className="btn btn-secondary btn-block" style={{ marginTop: 10 }} onClick={goToTimer}>타이머로 시작하기</button>
        </div>
      )}

      <div className="card">
        <p className="card-title"><TrendingUp size={14} /> 다른 학습자와 비교</p>
        <p style={{ fontSize: 12, color: "var(--ink-muted)", marginTop: 0 }}>
          * 실시간 다른 사용자 데이터가 아니라, 목표에 맞는 일반적인 권장 범위를 기준으로 한 AI 추정치예요.
        </p>
        {comparison && (
          <div style={{ marginTop: 8 }}>
            <span className="tag" style={{ background: "var(--amber)" }}>{comparison.level}</span>
            <p style={{ fontSize: 14, margin: "8px 0 4px" }}>{comparison.message}</p>
            <p style={{ fontSize: 12, color: "var(--ink-muted)" }}>참고 범위: {comparison.referenceRange}</p>
          </div>
        )}
        {error && <p style={{ fontSize: 13, color: "var(--coral)" }}>{error}</p>}
        <button className="btn btn-ghost btn-block" onClick={runComparison} disabled={comparing}>
          {comparing ? <Loader2 size={14} className="spin" /> : <TrendingUp size={14} />}
          {comparing ? "분석 중..." : "지금 비교해보기"}
        </button>
      </div>
    </div>
  );
}

// ---------------- PLAN ----------------
function PlanTab({ subjects, setSubjects, goal, setGoal, dailyHoursTarget, setDailyHoursTarget, beginner, setBeginner, plan, setPlan, studyInput, setStudyInput }) {
  const [parsedSubjects, setParsedSubjects] = useState(null); // [{id, name, minutes, note}]
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState("");
  const [building, setBuilding] = useState(false);
  const [buildError, setBuildError] = useState("");

  async function analyzeSubjects() {
    if (!studyInput.trim()) {
      setAnalyzeError("지금 하고 있는 공부를 적어 주세요.");
      return;
    }
    setAnalyzing(true);
    setAnalyzeError("");
    setParsedSubjects(null);
    setPlan(null);
    try {
      const system = `너는 학습 코치야. 사용자가 자유롭게 적은 "지금 하는 공부" 텍스트에서 실제 과목/활동 단위를 나눠 추출하고, 각각을 실제로 끝내는 데 걸리는 현실적인 소요시간(분)을 추정해줘.

추정 기준:
- 국어/영어처럼 지문을 읽고 문제를 풀고 채점/오답까지 하는 활동은 보통 35~50분.
- 수학(미적분, 확률과 통계 등) 인강을 보고 바로 관련 문제를 푸는 활동은 보통 50~70분.
- 단순 암기(단어, 개념 정리)처럼 가벼운 활동은 20~30분.
- 사용자 텍스트에 "인강", "문제풀이", "지문", "암기", "복습" 같은 단서가 있으면 그 활동 종류에 맞게 반영하고, 정보가 부족하면 비슷한 유형의 일반적인 학습자 기준으로 추정해.
- 이 추정치는 사용자가 화면에서 직접 고쳐 쓸 수 있는 초안이라는 걸 감안해서, 너무 짧게 잡지 말고 실제 활동 하나를 온전히 끝낼 수 있는 시간으로 추정해.

반드시 순수 JSON만 출력해. 형식:
{"subjects":[{"name":"과목/활동명","minutes":숫자,"note":"왜 이 시간으로 추정했는지 5단어 이내"}]}`;
      const userContent = `지금 하는 공부:\n${studyInput}\n\n왕초보 여부: ${beginner ? "예" : "아니오"}`;
      const text = await callClaude({ system, userContent, maxTokens: 1000 });
      const parsed = parseJsonLoose(text);
      if (!Array.isArray(parsed.subjects) || parsed.subjects.length === 0) {
        throw new Error("과목을 인식하지 못했어요");
      }
      setParsedSubjects(
        parsed.subjects.map((s) => ({ id: uid(), name: s.name, minutes: s.minutes, note: s.note || "" }))
      );
    } catch (e) {
      setAnalyzeError(`과목 분석에 실패했어요. (${e.message}) 다시 시도해 주세요.`);
    } finally {
      setAnalyzing(false);
    }
  }

  function updateMinutes(id, minutes) {
    setParsedSubjects((prev) => prev.map((s) => (s.id === id ? { ...s, minutes } : s)));
  }
  function removeParsedSubject(id) {
    setParsedSubjects((prev) => prev.filter((s) => s.id !== id));
  }

  async function buildSchedule() {
    if (!parsedSubjects || parsedSubjects.length === 0) return;
    setBuilding(true);
    setBuildError("");
    try {
      const listText = parsedSubjects.map((s) => `${s.name}: ${s.minutes}분`).join("\n");
      const system = `너는 하루 학습 스케줄러야. 아래 각 과목/활동의 이름과 사용자가 확정한 소요시간(분)이 주어져. 이 시간은 사용자가 직접 정한 값이므로 절대 임의로 줄이거나 늘리지 말고 그대로 사용해. 한 블록이 60분을 넘으면 그 블록 바로 뒤에 10~15분 휴식을, 60분 이하 블록 뒤에는 5~10분 휴식을 넣어. 과목 순서는 집중력이 많이 필요한 활동을 앞쪽에 배치하는 식으로 합리적으로 정해. 반드시 순수 JSON만 출력해. 형식:
{"totalMinutes":숫자,"advice":"목표 시간과 비교한 한 문장 코멘트","blocks":[{"subject":"과목명 또는 생략(휴식일 때)","type":"study 또는 break","minutes":숫자}]}`;
      const userContent = `확정된 과목별 소요시간:\n${listText}\n\n하루 목표 공부시간: ${dailyHoursTarget}시간\n추가 목표(선택): ${goal || "특별히 없음"}`;
      const text = await callClaude({ system, userContent, maxTokens: 900 });
      const parsed = parseJsonLoose(text);
      setPlan(parsed);
      setSubjects(parsedSubjects.map((s, i) => ({ id: uid(), name: s.name, color: ACCENTS[i % ACCENTS.length] })));
    } catch (e) {
      setBuildError("계획을 만들지 못했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setBuilding(false);
    }
  }

  return (
    <div>
      <div className="card">
        <p className="card-title"><Sparkles size={14} /> 지금 하고 있는 공부</p>
        <p style={{ fontSize: 12, color: "var(--ink-muted)", marginTop: 0 }}>
          과목, 단원, 하고 있는 활동 등을 생각나는 대로 편하게 적어주세요. 먼저 AI가 과목과 예상 소요시간을 뽑아드리고, 그 시간이 맞는지 직접 확인/수정한 뒤에 계획을 짜드려요.
        </p>
        <textarea
          placeholder={"예: 국어 독서 지문 풀이, 미적분 인강 보고 문제풀이, 확률과 통계 문제풀이, 영어 단어 암기..."}
          value={studyInput}
          onChange={(e) => setStudyInput(e.target.value)}
          style={{ minHeight: 100 }}
        />
      </div>

      <div className="card">
        <p className="card-title">추가로 알려줄 목표 (선택)</p>
        <input type="text" placeholder="예: 2개월 뒤 중간고사, 공무원 시험 준비 등" value={goal} onChange={(e) => setGoal(e.target.value)} />
      </div>

      <div className="card">
        <p className="card-title">하루 목표 공부시간</p>
        <input type="number" min="1" max="14" value={dailyHoursTarget}
          onChange={(e) => setDailyHoursTarget(e.target.value === "" ? "" : Number(e.target.value))}
          onBlur={(e) => { if (e.target.value === "" || Number(e.target.value) < 1) setDailyHoursTarget(1); }} />
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, fontSize: 13 }}>
          <input type="checkbox" checked={beginner} onChange={(e) => setBeginner(e.target.checked)} style={{ width: "auto" }} />
          공부 습관이 거의 없는 왕초보예요
        </label>
      </div>

      {analyzeError && <p style={{ color: "var(--coral)", fontSize: 13 }}>{analyzeError}</p>}
      {!parsedSubjects && (
        <button className="btn btn-primary btn-block" onClick={analyzeSubjects} disabled={analyzing}>
          {analyzing ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />}
          {analyzing ? "과목 분석 중..." : "과목 & 예상 시간 분석하기"}
        </button>
      )}

      {parsedSubjects && (
        <div className="card">
          <p className="card-title">예상 소요시간 확인 및 수정</p>
          <p style={{ fontSize: 12, color: "var(--ink-muted)", marginTop: 0 }}>
            실제로 걸리는 시간과 다르면 숫자를 직접 고쳐 주세요. 이 값 그대로 계획에 반영돼요.
          </p>
          {parsedSubjects.map((s) => (
            <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderBottom: "1px dashed var(--line)" }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14 }}>{s.name}</div>
                {s.note && <div style={{ fontSize: 11, color: "var(--ink-muted)" }}>{s.note}</div>}
              </div>
              <input type="number" min="5" max="180" value={s.minutes}
                onChange={(e) => updateMinutes(s.id, e.target.value === "" ? "" : Number(e.target.value))}
                onBlur={(e) => { if (e.target.value === "" || Number(e.target.value) < 5) updateMinutes(s.id, 5); }}
                style={{ width: 70, textAlign: "center" }} />
              <span style={{ fontSize: 12, color: "var(--ink-muted)" }}>분</span>
              <X size={14} style={{ cursor: "pointer", color: "var(--ink-muted)" }} onClick={() => removeParsedSubject(s.id)} />
            </div>
          ))}
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => { setParsedSubjects(null); setPlan(null); }}>
              다시 분석
            </button>
            <button className="btn btn-primary" style={{ flex: 2 }} onClick={buildSchedule} disabled={building || parsedSubjects.length === 0}>
              {building ? <Loader2 size={16} className="spin" /> : <CalendarClock size={16} />}
              {building ? "일정 짜는 중..." : "이 시간으로 계획 만들기"}
            </button>
          </div>
          {buildError && <p style={{ color: "var(--coral)", fontSize: 13, marginTop: 8 }}>{buildError}</p>}
        </div>
      )}

      {plan && (
        <div className="card" style={{ marginTop: 14 }}>
          <p className="card-title"><CalendarClock size={14} /> 오늘의 학습 계획 ({plan.totalMinutes}분)</p>
          {plan.advice && <p style={{ fontSize: 13, color: "var(--ink-muted)" }} className="pen-font">"{plan.advice}"</p>}
          {plan.blocks.map((b, i) => (
            <div className="plan-block" key={i}>
              <span className="tag" style={{ background: b.type === "break" ? "var(--blue)" : ACCENTS[i % ACCENTS.length] }}>
                {b.type === "break" ? "휴식" : b.subject}
              </span>
              <span style={{ fontSize: 13, color: "var(--ink-muted)" }}>{b.minutes}분</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------- TIMER ----------------
function TimerTab({ subjects, plan, onFinishSession, records }) {
  const planSubjects = plan ? plan.blocks.filter((b) => b.type === "study").map((b) => b.subject) : [];
  const allNames = Array.from(new Set([...(subjects.map((s) => s.name)), ...planSubjects]));

  const [selected, setSelected] = useState(allNames[0] || "");
  const [seconds, setSeconds] = useState(0);
  const [running, setRunning] = useState(false);
  const [targetMinutes, setTargetMinutes] = useState(25);
  const intervalRef = useRef(null);

  useEffect(() => {
    if (!selected && allNames.length > 0) setSelected(allNames[0]);
  }, [allNames, selected]);

  useEffect(() => {
    if (running) {
      intervalRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    } else if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }
    return () => intervalRef.current && clearInterval(intervalRef.current);
  }, [running]);

  const safeTargetMinutes = Number(targetMinutes) || 25;
  const pct = Math.min(100, (seconds / (safeTargetMinutes * 60)) * 100);
  const radius = 80;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - pct / 100);

  function finishAndSave() {
    const minutes = Math.round(seconds / 60);
    if (minutes > 0 && selected) onFinishSession(selected, minutes);
    setRunning(false);
    setSeconds(0);
  }

  const todayList = records.filter((r) => r.date === todayStr()).slice().reverse();

  return (
    <div>
      <div className="card">
        <p className="card-title">공부 과목</p>
        <select value={selected} onChange={(e) => setSelected(e.target.value)}>
          {allNames.length === 0 && <option value="">과목을 먼저 추가해 주세요</option>}
          {allNames.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <div style={{ marginTop: 10 }}>
          <p className="card-title" style={{ marginBottom: 6 }}>목표 시간 (분)</p>
          <input type="number" min="5" max="180" value={targetMinutes}
            onChange={(e) => setTargetMinutes(e.target.value === "" ? "" : Number(e.target.value))}
            onBlur={(e) => { if (e.target.value === "" || Number(e.target.value) < 5) setTargetMinutes(25); }}
            disabled={running} />
        </div>
      </div>

      <div className="ring-wrap">
        <svg width="190" height="190" viewBox="0 0 190 190">
          <circle cx="95" cy="95" r={radius} fill="none" stroke="var(--surface-light)" strokeWidth="12" />
          <circle cx="95" cy="95" r={radius} fill="none" stroke="var(--amber)" strokeWidth="12"
            strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={offset}
            transform="rotate(-90 95 95)" style={{ transition: "stroke-dashoffset 1s linear" }} />
          <text x="95" y="90" textAnchor="middle" fontSize="30" fill="var(--ink)" fontFamily="IBM Plex Mono">
            {formatClock(seconds)}
          </text>
          <text x="95" y="115" textAnchor="middle" fontSize="12" fill="var(--ink-muted)" fontFamily="IBM Plex Sans KR">
            목표 {targetMinutes}분
          </text>
        </svg>
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
        <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => setRunning((r) => !r)} disabled={!selected}>
          {running ? <Pause size={16} /> : <Play size={16} />}
          {running ? "일시정지" : "시작"}
        </button>
        <button className="btn btn-secondary" onClick={() => { setRunning(false); setSeconds(0); }}>
          <RotateCcw size={16} />
        </button>
        <button className="btn btn-secondary" onClick={finishAndSave} disabled={seconds === 0}>
          <CheckCircle2 size={16} /> 종료 후 기록
        </button>
      </div>

      <div className="card">
        <p className="card-title">오늘 기록</p>
        {todayList.length === 0 && <p className="empty">아직 기록이 없어요. 타이머를 종료하면 여기에 쌓여요.</p>}
        {todayList.map((r) => (
          <div className="plan-block" key={r.id}>
            <span style={{ fontSize: 14 }}>{r.subject}</span>
            <span style={{ fontSize: 13, color: "var(--ink-muted)" }}>{r.minutes}분</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------- PHOTO SOLVE ----------------
function PhotoSolveTab() {
  const [preview, setPreview] = useState(null);
  const [fileData, setFileData] = useState(null);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    setPreview(URL.createObjectURL(file));
    setAnswer("");
    try {
      const base64 = await fileToBase64(file);
      setFileData({ base64, mediaType: file.type });
    } catch (err) {
      setError("이미지를 불러오지 못했어요.");
    }
  }

  async function solve() {
    if (!fileData) { setError("먼저 문제 사진을 올려 주세요."); return; }
    setLoading(true);
    setError("");
    setAnswer("");
    try {
      const system = "너는 친절한 과외 선생님이야. 사진 속 문제를 읽고, 학생이 이해할 수 있도록 풀이 과정을 단계별로 한국어로 설명해줘. 정답만 알려주지 말고 왜 그런지 이유도 설명해.";
      const userContent = [
        { type: "image", source: { type: "base64", media_type: fileData.mediaType, data: fileData.base64 } },
        { type: "text", text: question.trim() ? `추가 질문: ${question}` : "이 문제를 풀어서 설명해줘." },
      ];
      const text = await callClaude({ system, userContent, maxTokens: 1000 });
      setAnswer(text);
    } catch (e) {
      setError("풀이를 가져오지 못했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="card">
        <p className="card-title"><Camera size={14} /> 모르는 문제 사진 올리기</p>
        <label className="photo-upload">
          <Upload size={20} style={{ marginBottom: 6 }} />
          <div>탭해서 사진 선택</div>
          <input type="file" accept="image/*" onChange={handleFile} style={{ display: "none" }} />
        </label>
        {preview && <img src={preview} alt="업로드한 문제" className="preview" />}
        <textarea placeholder="궁금한 점을 구체적으로 적어도 좋아요 (선택)" value={question}
          onChange={(e) => setQuestion(e.target.value)} style={{ marginTop: 10 }} />
      </div>

      {error && <p style={{ color: "var(--coral)", fontSize: 13 }}>{error}</p>}
      <button className="btn btn-primary btn-block" onClick={solve} disabled={loading}>
        {loading ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />}
        {loading ? "풀이 중..." : "풀이 요청하기"}
      </button>

      {answer && (
        <div className="card" style={{ marginTop: 14, whiteSpace: "pre-wrap", fontSize: 14, lineHeight: 1.6 }}>
          {answer}
        </div>
      )}
    </div>
  );
}

// ---------------- QUIZ ----------------
// ---------------- BOOK RECOMMEND ----------------
function BookRecommendTab({ bookRecs, setBookRecs }) {
  const [subject, setSubject] = useState("");
  const [level, setLevel] = useState("완전 초보");
  const [purpose, setPurpose] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeId, setActiveId] = useState(null);

  const [checkPreview, setCheckPreview] = useState(null);
  const [checkFileData, setCheckFileData] = useState(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState("");
  const [checkResult, setCheckResult] = useState(null);

  const allRecommendedBooks = [];
  bookRecs.forEach((rec) => {
    (rec.books || []).forEach((b) => {
      if (!allRecommendedBooks.some((x) => x.title === b.title)) {
        allRecommendedBooks.push({ title: b.title, author: b.author, subject: rec.subject });
      }
    });
  });

  async function handleCheckFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    setCheckPreview(URL.createObjectURL(file));
    setCheckResult(null);
    setCheckError("");
    try {
      const base64 = await fileToBase64(file);
      setCheckFileData({ base64, mediaType: file.type });
    } catch (err) {
      setCheckError("이미지를 불러오지 못했어요.");
    }
  }

  async function checkPurchasedBook() {
    if (!checkFileData) {
      setCheckError("먼저 구매한 책 사진을 올려 주세요.");
      return;
    }
    setChecking(true);
    setCheckError("");
    setCheckResult(null);
    try {
      const listText = allRecommendedBooks.length > 0
        ? allRecommendedBooks.map((b, i) => `${i + 1}. ${b.title} - ${b.author} (${b.subject})`).join("\n")
        : "아직 추천받은 책이 없음";
      const system = `너는 책 표지 사진을 보고 제목과 저자를 정확히 읽어내는 도우미야. 사용자가 이전에 추천받은 책 목록과 비교해서, 지금 사진 속 책이 그 목록에 포함되는지 판단해. 반드시 순수 JSON만 출력해. 형식:
{"identifiedTitle":"사진에서 읽은 책 제목","identifiedAuthor":"사진에서 읽은 저자 (모르면 빈 문자열)","isRecommended": true 또는 false,"matchedTitle":"목록에 있는 정확한 제목 (없으면 null)","message":"한두 문장 코멘트, 목록에 없으면 어떤 분야의 책인지 짧게 평가"}`;
      const userContent = [
        { type: "image", source: { type: "base64", media_type: checkFileData.mediaType, data: checkFileData.base64 } },
        { type: "text", text: `추천받았던 책 목록:\n${listText}\n\n이 사진 속 책이 위 목록에 있는지 확인해줘.` },
      ];
      const text = await callClaude({ system, userContent, maxTokens: 500 });
      setCheckResult(parseJsonLoose(text));
    } catch (e) {
      setCheckError("책을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setChecking(false);
    }
  }

  async function recommend() {
    if (!subject.trim()) {
      setError("배우고 싶은 과목이나 분야를 입력해 주세요.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const system = `너는 독서 큐레이터야. 사용자가 배우고 싶은 분야와 현재 실력 수준을 알려주면, 그 수준에 딱 맞는 실제로 존재하는 책 3~5권을 추천해줘. 너무 쉽거나 너무 어려운 책은 피하고, 한국 독자가 구하기 쉬운 책(번역서 포함) 위주로 추천해. 반드시 순수 JSON만 출력하고 앞뒤에 다른 설명은 절대 붙이지 마. 형식:
{"books":[{"title":"책 제목","author":"저자","level":"입문|초급|중급|고급 중 하나","reason":"이 사람에게 이 책을 추천하는 이유, 두 문장 이내"}]}`;
      const userContent = `배우고 싶은 분야: ${subject}\n현재 실력: ${level}\n목적(선택): ${purpose || "특별히 없음"}`;
      const text = await callClaude({ system, userContent, maxTokens: 900 });
      const parsed = parseJsonLoose(text);
      const newRec = { id: uid(), subject, level, purpose, books: parsed.books, date: todayStr() };
      setBookRecs((prev) => [newRec, ...prev]);
      setActiveId(newRec.id);
    } catch (e) {
      setError("책 추천을 가져오지 못했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setLoading(false);
    }
  }

  function deleteRec(id) {
    setBookRecs((prev) => prev.filter((r) => r.id !== id));
    if (activeId === id) setActiveId(null);
  }

  const activeRec = bookRecs.find((r) => r.id === activeId);

  if (activeRec) {
    return (
      <div>
        <button className="btn btn-ghost" style={{ marginBottom: 12 }} onClick={() => setActiveId(null)}>← 목록으로</button>
        <div className="card">
          <p className="card-title"><BookOpen size={14} /> {activeRec.subject} · {activeRec.level}</p>
          {activeRec.books.map((b, i) => (
            <div key={i} style={{ padding: "10px 0", borderBottom: i < activeRec.books.length - 1 ? "1px dashed var(--line)" : "none" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <span className="tag" style={{ background: ACCENTS[i % ACCENTS.length] }}>{b.level}</span>
                <span style={{ fontWeight: 600, fontSize: 14 }} className="display-font">{b.title}</span>
              </div>
              <p style={{ fontSize: 12, color: "var(--ink-muted)", margin: "0 0 4px" }}>{b.author}</p>
              <p style={{ fontSize: 13, margin: 0 }}>{b.reason}</p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="card">
        <p className="card-title"><BookOpen size={14} /> 배우고 싶은 분야</p>
        <input type="text" placeholder="예: 파이썬 프로그래밍, 영어 문법, 경제학 기초"
          value={subject} onChange={(e) => setSubject(e.target.value)} />
      </div>

      <div className="card">
        <p className="card-title">현재 실력</p>
        <select value={level} onChange={(e) => setLevel(e.target.value)}>
          <option>완전 초보</option>
          <option>기초는 있음</option>
          <option>중급</option>
          <option>고급</option>
        </select>
      </div>

      <div className="card">
        <p className="card-title">목적 (선택)</p>
        <input type="text" placeholder="예: 취미로 배우고 싶어요, 시험 준비 중이에요"
          value={purpose} onChange={(e) => setPurpose(e.target.value)} />
      </div>

      {error && <p style={{ color: "var(--coral)", fontSize: 13 }}>{error}</p>}
      <button className="btn btn-primary btn-block" onClick={recommend} disabled={loading}>
        {loading ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />}
        {loading ? "추천 받는 중..." : "책 추천받기"}
      </button>

      <div className="card" style={{ marginTop: 14 }}>
        <p className="card-title">지난 추천 목록</p>
        {bookRecs.length === 0 && <p className="empty">아직 받은 책 추천이 없어요.</p>}
        {bookRecs.map((r) => (
          <div className="plan-block" key={r.id}>
            <span style={{ fontSize: 14, cursor: "pointer" }} onClick={() => setActiveId(r.id)}>{r.subject} ({r.level})</span>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 12, color: "var(--ink-muted)" }}>{r.date}</span>
              <Trash2 size={14} style={{ cursor: "pointer", color: "var(--ink-muted)" }} onClick={() => deleteRec(r.id)} />
            </div>
          </div>
        ))}
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <p className="card-title"><Camera size={14} /> 구매한 책이 추천 목록에 있는지 확인</p>
        <p style={{ fontSize: 12, color: "var(--ink-muted)", marginTop: 0 }}>
          구매한 책 표지를 찍어 올리면, 지금까지 AI가 추천했던 책 목록과 비교해줘요.
        </p>
        <label className="photo-upload">
          <Upload size={20} style={{ marginBottom: 6 }} />
          <div>탭해서 책 표지 사진 선택</div>
          <input type="file" accept="image/*" onChange={handleCheckFile} style={{ display: "none" }} />
        </label>
        {checkPreview && <img src={checkPreview} alt="업로드한 책 표지" className="preview" />}

        {checkError && <p style={{ color: "var(--coral)", fontSize: 13, marginTop: 8 }}>{checkError}</p>}
        <button className="btn btn-secondary btn-block" style={{ marginTop: 10 }} onClick={checkPurchasedBook} disabled={checking}>
          {checking ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />}
          {checking ? "확인 중..." : "이 책이 추천 목록에 있는지 확인"}
        </button>

        {checkResult && (
          <div style={{ marginTop: 12, padding: "10px 0", borderTop: "1px dashed var(--line)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              {checkResult.isRecommended
                ? <CheckCircle2 size={16} color="#8FAF7A" />
                : <XCircle size={16} color="var(--coral)" />}
              <span style={{ fontWeight: 600, fontSize: 14 }}>
                {checkResult.isRecommended ? "추천 목록에 있는 책이에요" : "추천 목록에는 없는 책이에요"}
              </span>
            </div>
            <p style={{ fontSize: 13, margin: "0 0 4px" }} className="display-font">
              {checkResult.identifiedTitle} {checkResult.identifiedAuthor ? `· ${checkResult.identifiedAuthor}` : ""}
            </p>
            <p style={{ fontSize: 13, color: "var(--ink-muted)", margin: 0 }}>{checkResult.message}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function QuizTab({ quizSets, setQuizSets }) {
  const [preview, setPreview] = useState(null);
  const [fileData, setFileData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeQuizId, setActiveQuizId] = useState(null);
  const [answers, setAnswers] = useState({});

  async function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    setPreview(URL.createObjectURL(file));
    try {
      const base64 = await fileToBase64(file);
      setFileData({ base64, mediaType: file.type });
    } catch (err) {
      setError("이미지를 불러오지 못했어요.");
    }
  }

  async function makeQuiz() {
    if (!fileData) { setError("먼저 책 페이지 사진을 올려 주세요."); return; }
    setLoading(true);
    setError("");
    try {
      const system = `너는 학습 퀴즈 출제자야. 사진 속 책 내용을 바탕으로 4지선다 퀴즈를 정확히 4문제 만들어. 반드시 순수 JSON만 출력해. 형식:
{"title":"짧은 제목","questions":[{"question":"문제","options":["보기1","보기2","보기3","보기4"],"answerIndex":0,"explanation":"짧은 해설"}]}`;
      const userContent = [
        { type: "image", source: { type: "base64", media_type: fileData.mediaType, data: fileData.base64 } },
        { type: "text", text: "이 페이지 내용으로 퀴즈를 만들어줘." },
      ];
      const text = await callClaude({ system, userContent, maxTokens: 1000 });
      const parsed = parseJsonLoose(text);
      const newQuiz = { id: uid(), title: parsed.title, questions: parsed.questions, date: todayStr() };
      setQuizSets((prev) => [newQuiz, ...prev]);
      setActiveQuizId(newQuiz.id);
      setAnswers({});
      setPreview(null);
      setFileData(null);
    } catch (e) {
      setError("퀴즈를 만들지 못했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setLoading(false);
    }
  }

  const activeQuiz = quizSets.find((q) => q.id === activeQuizId);

  function selectAnswer(qIdx, optIdx) {
    setAnswers((prev) => ({ ...prev, [qIdx]: optIdx }));
  }

  function deleteQuiz(id) {
    setQuizSets((prev) => prev.filter((q) => q.id !== id));
    if (activeQuizId === id) setActiveQuizId(null);
  }

  if (activeQuiz) {
    return (
      <div>
        <button className="btn btn-ghost" style={{ marginBottom: 12 }} onClick={() => setActiveQuizId(null)}>← 목록으로</button>
        <div className="card">
          <p className="card-title display-font" style={{ fontSize: 16, textTransform: "none" }}>{activeQuiz.title}</p>
          {activeQuiz.questions.map((q, qi) => (
            <div key={qi} style={{ marginBottom: 18 }}>
              <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>{qi + 1}. {q.question}</p>
              {q.options.map((opt, oi) => {
                const chosen = answers[qi];
                let cls = "quiz-option";
                if (chosen !== undefined) {
                  if (oi === q.answerIndex) cls += " correct";
                  else if (oi === chosen) cls += " wrong";
                }
                return (
                  <button key={oi} className={cls} onClick={() => selectAnswer(qi, oi)} disabled={chosen !== undefined}>
                    {opt}
                  </button>
                );
              })}
              {answers[qi] !== undefined && (
                <p style={{ fontSize: 13, color: "var(--ink-muted)" }}>{q.explanation}</p>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="card">
        <p className="card-title"><Camera size={14} /> 책 페이지 사진으로 퀴즈 만들기</p>
        <label className="photo-upload">
          <Upload size={20} style={{ marginBottom: 6 }} />
          <div>탭해서 사진 선택</div>
          <input type="file" accept="image/*" onChange={handleFile} style={{ display: "none" }} />
        </label>
        {preview && <img src={preview} alt="업로드한 책 페이지" className="preview" />}
      </div>
      {error && <p style={{ color: "var(--coral)", fontSize: 13 }}>{error}</p>}
      <button className="btn btn-primary btn-block" onClick={makeQuiz} disabled={loading}>
        {loading ? <Loader2 size={16} className="spin" /> : <BrainCircuit size={16} />}
        {loading ? "퀴즈 만드는 중..." : "퀴즈 생성"}
      </button>

      <div className="card" style={{ marginTop: 14 }}>
        <p className="card-title">만든 퀴즈 목록</p>
        {quizSets.length === 0 && <p className="empty">아직 만든 퀴즈가 없어요.</p>}
        {quizSets.map((q) => (
          <div className="plan-block" key={q.id}>
            <span style={{ fontSize: 14, cursor: "pointer" }} onClick={() => { setActiveQuizId(q.id); setAnswers({}); }}>{q.title}</span>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 12, color: "var(--ink-muted)" }}>{q.date}</span>
              <Trash2 size={14} style={{ cursor: "pointer", color: "var(--ink-muted)" }} onClick={() => deleteQuiz(q.id)} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
