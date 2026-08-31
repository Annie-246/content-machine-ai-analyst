import React, { useMemo, useState } from 'react';
import {
  Radar, Search, Users, AlertCircle, Radio, ArrowLeft, RefreshCw, Sparkles, Inbox,
  Wand2, Loader2, X,
} from 'lucide-react';
import type {
  RadarContent, RadarCreatorCandidate, RadarScanResult, RadarSortMode, RadarTimeWindow,
} from '../types';
import {
  findCreators, formatCount, scanByKeyword, scanCreator, suggestKeywords,
  type KeywordSuggestion,
} from '../services/radarService';
import { RadarContentCard } from './RadarContentCard';
import { RadarCreatorCard } from './RadarCreatorCard';
import { RunStatus } from './WorkspaceShell';
import {
  DEFAULT_RESULT_LIMIT, DEFAULT_SORT_MODE, DEFAULT_TIME_WINDOW,
  RESULT_LIMITS, SORT_MODES, TIME_WINDOWS,
} from '../services/radar/constants.mjs';
import { sortRadarContent } from '../services/radar/sorting.mjs';
import { aggregateCreators } from '../services/radar/aggregation.mjs';

type RadarMode = 'keyword' | 'creator';
type ResultTab = 'content' | 'creators';

const EXAMPLE_KEYWORDS = ['AI Marketing', 'E-commerce', 'Beauty'];

// ---------------------------------------------------------------------------

const Field: React.FC<{ label: string; hint?: string; children: React.ReactNode }> = ({ label, hint, children }) => (
  <label className="block">
    <span className="block text-[13px] font-semibold text-slate-700 mb-1.5">
      {label}
      {hint && <span className="ml-1.5 font-normal text-slate-400">{hint}</span>}
    </span>
    {children}
  </label>
);

const selectClass =
  'w-full rounded-xl border border-slate-200 bg-white py-2.5 px-3 text-sm text-slate-800 ' +
  'focus:outline-none focus:border-[#dc2626] transition-colors disabled:bg-slate-50 disabled:text-slate-400';

// ---------------------------------------------------------------------------

export const ContentRadar: React.FC = () => {
  const [mode, setMode] = useState<RadarMode>('keyword');

  const [keyword, setKeyword] = useState('');
  const [competitor, setCompetitor] = useState('');

  const [timeWindow, setTimeWindow] = useState<RadarTimeWindow>(DEFAULT_TIME_WINDOW as RadarTimeWindow);
  const [limit, setLimit] = useState<number>(DEFAULT_RESULT_LIMIT);
  const [sort, setSort] = useState<RadarSortMode>(DEFAULT_SORT_MODE as RadarSortMode);

  const [running, setRunning] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [error, setError] = useState('');

  const [result, setResult] = useState<RadarScanResult | null>(null);
  // The inputs the current result came from, so the CTA can say "Quét lại" only
  // when nothing has changed since.
  const [scannedWith, setScannedWith] = useState('');

  const [resultTab, setResultTab] = useState<ResultTab>('content');
  // Sorting after a scan is a view concern; it never goes back to the provider.
  const [viewSort, setViewSort] = useState<RadarSortMode>(DEFAULT_SORT_MODE as RadarSortMode);

  // Keyword suggestions. Separate from `running` so asking for ideas never
  // looks like a scan, and never blocks one.
  const [suggesting, setSuggesting] = useState(false);
  const [suggestions, setSuggestions] = useState<KeywordSuggestion[] | null>(null);
  const [suggestError, setSuggestError] = useState('');

  const [candidates, setCandidates] = useState<RadarCreatorCandidate[] | null>(null);
  const [selectedCreator, setSelectedCreator] = useState<RadarCreatorCandidate | null>(null);

  const currentInputs = [mode, mode === 'keyword' ? keyword.trim() : selectedCreator?.ref || '', timeWindow, limit, sort].join('|');
  const isStale = result !== null && currentInputs !== scannedWith;

  const items: RadarContent[] = useMemo(
    () => (result ? sortRadarContent(result.items, viewSort) : []),
    [result, viewSort]
  );

  const creators = useMemo(() => (result ? aggregateCreators(result.items) : []), [result]);

  // -------------------------------------------------------------------------

  const beginRun = () => {
    setRunning(true);
    setStartedAt(Date.now());
    setError('');
  };

  const endRun = () => {
    setRunning(false);
    setStartedAt(null);
  };

  const applyResult = (scan: RadarScanResult) => {
    setResult(scan);
    setViewSort(sort);
    setResultTab('content');
    setScannedWith(currentInputs);
  };

  const runKeywordScan = async () => {
    if (running || !keyword.trim()) return;
    beginRun();
    try {
      applyResult(await scanByKeyword({ query: keyword.trim(), timeWindow, limit, sort }));
    } catch (err: any) {
      setError(err?.message || 'Không quét được lúc này.');
    } finally {
      endRun();
    }
  };

  const runSuggest = async () => {
    if (suggesting || !keyword.trim()) return;
    setSuggesting(true);
    setSuggestError('');
    try {
      const found = await suggestKeywords(keyword.trim());
      setSuggestions(found.suggestions);
      if (found.suggestions.length === 0) {
        setSuggestError('Chưa nghĩ ra từ khoá nào cho chủ đề này. Thử mô tả cụ thể hơn.');
      }
    } catch (err: any) {
      setSuggestError(err?.message || 'Không gợi ý được lúc này.');
    } finally {
      setSuggesting(false);
    }
  };

  const runCreatorLookup = async () => {
    if (running || !competitor.trim()) return;
    beginRun();
    try {
      const found = await findCreators(competitor.trim());
      if (found.resolved && found.candidates[0]) {
        // A pasted profile URL needs no disambiguation.
        setSelectedCreator(found.candidates[0]);
        setCandidates(null);
      } else if (found.candidates.length === 0) {
        setError('Không tìm thấy đối thủ nào khớp. Thử tên khác hoặc dán link trang cá nhân Douyin.');
      } else {
        setCandidates(found.candidates);
      }
    } catch (err: any) {
      setError(err?.message || 'Không tìm được đối thủ lúc này.');
    } finally {
      endRun();
    }
  };

  const runCreatorScan = async () => {
    if (running || !selectedCreator) return;
    beginRun();
    try {
      applyResult(await scanCreator({ ref: selectedCreator.ref, query: '', timeWindow, limit, sort }));
    } catch (err: any) {
      setError(err?.message || 'Không quét được đối thủ lúc này.');
    } finally {
      endRun();
    }
  };

  const resetCompetitor = () => {
    setSelectedCreator(null);
    setCandidates(null);
    setResult(null);
    setError('');
  };

  const switchMode = (next: RadarMode) => {
    if (next === mode) return;
    setMode(next);
    // Results belong to the mode that produced them.
    setResult(null);
    setError('');
  };

  // -------------------------------------------------------------------------

  const filters = (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <Field label="Khoảng thời gian">
        <select
          value={timeWindow}
          onChange={(e) => setTimeWindow(e.target.value as RadarTimeWindow)}
          disabled={running}
          className={selectClass}
        >
          {TIME_WINDOWS.map((w) => (
            <option key={w.id} value={w.id}>{w.label}</option>
          ))}
        </select>
      </Field>

      <Field label="Số kết quả tối đa" hint="không cam kết đủ">
        <select
          value={limit}
          onChange={(e) => setLimit(Number(e.target.value))}
          disabled={running}
          className={selectClass}
        >
          {RESULT_LIMITS.map((n) => (
            <option key={n} value={n}>{n} kết quả</option>
          ))}
        </select>
      </Field>

      <Field label="Sắp xếp">
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as RadarSortMode)}
          disabled={running}
          className={selectClass}
        >
          {SORT_MODES.map((s) => (
            <option key={s.id} value={s.id}>{s.label}</option>
          ))}
        </select>
      </Field>
    </div>
  );

  const ctaClass =
    'inline-flex items-center justify-center gap-2.5 px-7 py-3.5 rounded-xl font-semibold transition-colors ' +
    'bg-[#dc2626] hover:bg-[#c70045] text-white disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed';

  return (
    <div className="max-w-[1080px]">
      <div className="flex items-start gap-5">
        <div className="w-[68px] h-[68px] rounded-2xl bg-[#fef2f2] border border-[#f8d3e0] flex items-center justify-center shrink-0">
          <Radar className="w-9 h-9 text-[#dc2626]" strokeWidth={1.5} />
        </div>
        <div>
          <h1 className="text-[34px] leading-tight font-bold text-slate-900">Content Radar</h1>
          <p className="mt-1.5 text-[15px] text-slate-600">
            Tìm những nội dung đang hoạt động tốt trong ngành của bạn.
          </p>
        </div>
      </div>

      {/* MODE TABS */}
      <div className="mt-7 grid grid-cols-2 gap-2 p-1 rounded-xl bg-slate-50 border border-slate-200 max-w-md">
        {([['keyword', 'Theo chủ đề', Search], ['creator', 'Theo đối thủ', Users]] as const).map(([id, label, Icon]) => {
          const active = mode === id;
          return (
            <button
              key={id}
              onClick={() => switchMode(id)}
              disabled={running}
              className={`inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-colors disabled:opacity-60
                ${active ? 'bg-white border border-[#dc2626] text-[#dc2626] shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
            >
              <Icon className={`w-4 h-4 ${active ? 'text-[#dc2626]' : 'text-slate-400'}`} />
              {label}
            </button>
          );
        })}
      </div>

      {/* SCAN FORM */}
      <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-6 space-y-5">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#fef2f2] border border-[#f8d3e0] text-[12px] font-semibold text-[#dc2626]">
            <Radio className="w-3.5 h-3.5" /> Douyin
          </span>
          <span className="text-[12px] text-slate-400">Nền tảng khác sẽ được bổ sung sau</span>
        </div>

        {mode === 'keyword' ? (
          <>
            <Field label="Chủ đề hoặc từ khoá">
              <div className="flex gap-2.5 flex-wrap">
                <input
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') runKeywordScan(); }}
                  placeholder="AI Marketing · Mỹ phẩm · Thương mại điện tử · 人工智能"
                  disabled={running}
                  className="flex-1 min-w-[240px] rounded-xl border border-slate-200 bg-white py-3 px-4 text-[15px] text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-[#dc2626] transition-colors disabled:bg-slate-50"
                />
                {/* Costs an LLM call, not an Apify run - safe to press while exploring. */}
                <button
                  onClick={runSuggest}
                  disabled={suggesting || running || !keyword.trim()}
                  title="Nhờ AI gợi ý từ khoá tiếng Trung sát với chủ đề này"
                  className="shrink-0 inline-flex items-center gap-2 px-4 py-3 rounded-xl border border-slate-200 bg-white text-[14px] font-semibold text-slate-700 hover:border-[#dc2626] hover:text-[#dc2626] disabled:opacity-40 disabled:hover:border-slate-200 disabled:hover:text-slate-700 transition-colors"
                >
                  {suggesting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                  {suggesting ? 'Đang nghĩ…' : 'AI gợi ý từ khoá'}
                </button>
              </div>
            </Field>

            {suggestError && (
              <p className="text-[13px] text-amber-700 -mt-2">{suggestError}</p>
            )}

            {suggestions && suggestions.length > 0 && (
              <div className="-mt-2 rounded-xl border border-[#f0c9d8] bg-[#fef7f8] p-4">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-[13px] font-semibold text-slate-700">
                    Chọn một từ khoá để điền vào ô tìm kiếm
                    <span className="ml-1.5 font-normal text-slate-500">
                      · Douyin cho kết quả tốt nhất với tiếng Trung
                    </span>
                  </p>
                  <button
                    onClick={() => { setSuggestions(null); setSuggestError(''); }}
                    className="shrink-0 text-slate-400 hover:text-slate-700 transition-colors"
                    title="Đóng gợi ý"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  {suggestions.map((s) => (
                    <button
                      key={s.keyword}
                      // Fills the input only. The user still decides when to spend a scan.
                      onClick={() => setKeyword(s.keyword)}
                      className="group px-3.5 py-2 rounded-xl border border-slate-200 bg-white text-left hover:border-[#dc2626] transition-colors"
                    >
                      <span className="block text-[14px] font-semibold text-slate-900 group-hover:text-[#dc2626]">
                        {s.keyword}
                      </span>
                      {s.note && <span className="block text-[11px] text-slate-500 mt-0.5">{s.note}</span>}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {filters}

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button onClick={runKeywordScan} disabled={running || !keyword.trim()} className={ctaClass}>
                {isStale || !result ? <Search className="w-4 h-4" /> : <RefreshCw className="w-4 h-4" />}
                {running ? 'Đang quét…' : result && !isStale ? 'Quét lại' : 'Quét nội dung'}
              </button>
              <span className="text-[12px] text-slate-400">
                Mỗi lần quét gọi nhà cung cấp một lần và được tính phí theo số kết quả.
              </span>
            </div>
          </>
        ) : (
          <>
            {selectedCreator ? (
              <div className="rounded-xl border border-[#f0c9d8] bg-[#fef7f8] p-4 flex items-center gap-3">
                {selectedCreator.avatarUrl ? (
                  <img src={selectedCreator.avatarUrl} alt="" referrerPolicy="no-referrer" className="w-10 h-10 rounded-full object-cover shrink-0" />
                ) : (
                  <span className="w-10 h-10 rounded-full bg-white border border-[#f8d3e0] shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-[15px] font-bold text-slate-900 truncate">
                    {selectedCreator.nickname || selectedCreator.username || 'Đối thủ đã chọn'}
                  </p>
                  <p className="text-[12px] text-slate-500 truncate">
                    {selectedCreator.followerCount !== null ? `${formatCount(selectedCreator.followerCount)} follower` : selectedCreator.ref}
                  </p>
                </div>
                <button
                  onClick={resetCompetitor}
                  disabled={running}
                  className="shrink-0 inline-flex items-center gap-1.5 text-[13px] text-slate-500 hover:text-[#dc2626] transition-colors disabled:opacity-50"
                >
                  <ArrowLeft className="w-3.5 h-3.5" /> Đổi đối thủ
                </button>
              </div>
            ) : (
              <Field label="Đối thủ" hint="link trang cá nhân Douyin hoặc tên creator">
                <input
                  value={competitor}
                  onChange={(e) => setCompetitor(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') runCreatorLookup(); }}
                  placeholder="https://www.douyin.com/user/... hoặc tên creator"
                  disabled={running}
                  className="w-full rounded-xl border border-slate-200 bg-white py-3 px-4 text-[15px] text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-[#dc2626] transition-colors disabled:bg-slate-50"
                />
              </Field>
            )}

            {selectedCreator && filters}

            <div className="flex flex-wrap items-center gap-3 pt-1">
              {selectedCreator ? (
                <button onClick={runCreatorScan} disabled={running} className={ctaClass}>
                  {isStale || !result ? <Search className="w-4 h-4" /> : <RefreshCw className="w-4 h-4" />}
                  {running ? 'Đang quét…' : result && !isStale ? 'Quét lại' : 'Quét đối thủ'}
                </button>
              ) : (
                <button onClick={runCreatorLookup} disabled={running || !competitor.trim()} className={ctaClass}>
                  <Users className="w-4 h-4" />
                  {running ? 'Đang tìm…' : 'Tìm đối thủ'}
                </button>
              )}
              <span className="text-[12px] text-slate-400">
                Chọn đúng đối thủ trước, sau đó mới quét nội dung của họ.
              </span>
            </div>

            {/* Candidates are never auto-picked: the wrong creator would be a wasted run. */}
            {candidates && candidates.length > 0 && !selectedCreator && (
              <div className="pt-2">
                <p className="text-[13px] font-semibold text-slate-700 mb-2.5">
                  Chọn đúng đối thủ ({candidates.length} kết quả)
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {candidates.map((c) => (
                    <button
                      key={c.ref}
                      onClick={() => setSelectedCreator(c)}
                      className="text-left rounded-xl border border-slate-200 bg-white p-3 flex items-center gap-3 hover:border-[#dc2626] hover:bg-[#fef7f8] transition-all"
                    >
                      {c.avatarUrl ? (
                        <img src={c.avatarUrl} alt="" referrerPolicy="no-referrer" className="w-9 h-9 rounded-full object-cover shrink-0" />
                      ) : (
                        <span className="w-9 h-9 rounded-full bg-slate-100 shrink-0" />
                      )}
                      <span className="flex-1 min-w-0">
                        <span className="block text-[14px] font-semibold text-slate-900 truncate">
                          {c.nickname || c.username || 'Không rõ'}
                        </span>
                        <span className="block text-[12px] text-slate-500 truncate">
                          {formatCount(c.followerCount)} follower
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </section>

      {running && (
        <div className="mt-5">
          <RunStatus
            message="Đang quét Douyin…"
            startedAt={startedAt}
            expectation="Quá trình này thường mất khoảng 10–20 giây. Đừng đóng tab này."
          />
        </div>
      )}

      {error && (
        <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-5 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-slate-900">Không quét được</p>
            <p className="text-[13px] text-slate-700 mt-1 leading-relaxed">{error}</p>
          </div>
        </div>
      )}

      {/* EMPTY STATE - before the first scan */}
      {!result && !running && !error && (
        <div className="mt-5 rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 p-10 text-center">
          <Sparkles className="w-8 h-8 text-[#dc2626] mx-auto" strokeWidth={1.5} />
          <p className="mt-3.5 text-[17px] font-bold text-slate-900">
            Tìm những nội dung đang hoạt động tốt trên Douyin
          </p>
          <p className="mt-1.5 text-[14px] text-slate-600">Nhập chủ đề hoặc đối thủ để bắt đầu.</p>

          {mode === 'keyword' && (
            <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
              {EXAMPLE_KEYWORDS.map((example) => (
                <button
                  key={example}
                  // Fills the input only - the user still decides when to spend a scan.
                  onClick={() => setKeyword(example)}
                  className="px-3.5 py-1.5 rounded-full border border-slate-200 bg-white text-[13px] text-slate-700 hover:border-[#dc2626] hover:text-[#dc2626] transition-colors"
                >
                  {example}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* RESULTS */}
      {result && !running && (
        <div className="mt-7">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="text-[22px] font-bold text-slate-900">
                {result.mode === 'keyword' ? result.query.original : selectedCreator?.nickname || 'Đối thủ'}
              </h2>
              <p className="text-[13px] text-slate-500 mt-1">
                Douyin
                {result.query.translated && (
                  <> · tìm bằng <span className="text-slate-700 font-medium">{result.query.effective}</span></>
                )}
                {result.cached && <> · dùng lại kết quả vừa quét</>}
              </p>
              <p className="text-[15px] text-slate-800 mt-2">
                <strong>{result.items.length}</strong> nội dung được tìm thấy
                <span className="text-slate-500">
                  {' '}· Trong {TIME_WINDOWS.find((w) => w.id === result.timeWindow)?.label} gần nhất
                </span>
              </p>
              {result.fetchedCount > result.items.length && (
                <p className="text-[12px] text-slate-400 mt-1">
                  Đã quét {result.fetchedCount} kết quả, {result.items.length} nằm trong khoảng thời gian đã chọn.
                </p>
              )}
            </div>

            {/* Local re-sort. Never triggers another provider run. */}
            <div className="min-w-[190px]">
              <Field label="Sắp xếp kết quả">
                <select value={viewSort} onChange={(e) => setViewSort(e.target.value as RadarSortMode)} className={selectClass}>
                  {SORT_MODES.map((s) => (
                    <option key={s.id} value={s.id}>{s.label}</option>
                  ))}
                </select>
              </Field>
            </div>
          </div>

          {result.items.length === 0 ? (
            <div className="mt-5 rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 p-10 text-center">
              <Inbox className="w-8 h-8 text-slate-300 mx-auto" strokeWidth={1.5} />
              <p className="mt-3.5 text-[16px] font-bold text-slate-900">
                Không tìm thấy nội dung phù hợp trong khoảng thời gian này.
              </p>
              <p className="mt-2 text-[14px] text-slate-600">
                Thử tăng khoảng thời gian, hoặc dùng một từ khoá khác rồi quét lại.
              </p>
            </div>
          ) : (
            <>
              <div className="mt-5 inline-flex gap-2 p-1 rounded-xl bg-slate-50 border border-slate-200">
                {([['content', `Nội dung (${result.items.length})`], ['creators', `Creator (${creators.length})`]] as const).map(
                  ([id, label]) => {
                    const active = resultTab === id;
                    return (
                      <button
                        key={id}
                        // Switching tabs only re-reads data already on screen.
                        onClick={() => setResultTab(id)}
                        className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors
                          ${active ? 'bg-white border border-[#dc2626] text-[#dc2626] shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
                      >
                        {label}
                      </button>
                    );
                  }
                )}
              </div>

              {resultTab === 'content' ? (
                <div className="mt-4 grid grid-cols-1 xl:grid-cols-2 gap-4">
                  {items.map((content) => (
                    <RadarContentCard key={content.id} content={content} />
                  ))}
                </div>
              ) : (
                <>
                  <p className="mt-4 text-[12px] text-slate-400">
                    Tổng hợp từ chính kết quả trên, không quét thêm.
                  </p>
                  <div className="mt-2.5 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {creators.map((creator) => (
                      <RadarCreatorCard key={creator.key} creator={creator} />
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};
