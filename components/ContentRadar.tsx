import React, { useMemo, useState } from 'react';
import {
  Radar, Search, Users, AlertCircle, Radio, ArrowLeft, RefreshCw, Sparkles, Inbox,
  Wand2, Loader2, X, Check, Download, Table2, LayoutGrid, FileSpreadsheet, ExternalLink,
} from 'lucide-react';
import type {
  BrandProfile, RadarContent, RadarCreatorCandidate, RadarPlatform, RadarScanResult,
  RadarSortMode, RadarTimeWindow,
} from '../types';
import {
  findCreators, formatCount, scanByKeyword, scanCreator, suggestKeywords,
  type KeywordSuggestion,
} from '../services/radarService';
import { RadarContentCard } from './RadarContentCard';
import { RadarResultsTable } from './RadarResultsTable';
import { RunStatus } from './WorkspaceShell';
import {
  CREATOR_SCAN_MODES, DEFAULT_CREATOR_SCAN_MODE,
  DEFAULT_RESULT_LIMIT, DEFAULT_SORT_MODE, DEFAULT_TIME_WINDOW,
  MAX_KEYWORDS, MAX_RESULT_LIMIT, MIN_RESULT_LIMIT, PLATFORMS,
  RESULT_LIMITS, SORT_MODES, TIME_WINDOWS, clampLimit, pagesNeeded,
} from '../services/radar/constants.mjs';
import { sortRadarContent } from '../services/radar/sorting.mjs';
import { SUGGESTION_TIERS } from '../services/radar/constants.mjs';
import { buildCsv, buildExportTable, exportFilename } from '../services/radar/exportRows.mjs';
import { exportToGoogleSheet, getGoogleClientId } from '../services/googleDrive';
import { recordAndBackup } from '../services/historyBackup';
import { buildTableHtml } from '../services/historyExport';

type RadarMode = 'keyword' | 'creator';

/** Inside competitor mode: their best videos, or only the ones on a topic. */
type CreatorScanMode = 'best' | 'keyword';

const EXAMPLE_KEYWORDS = ['AI Marketing', 'E-commerce', 'Beauty'];

/**
 * A creator picked by pasting a link has the link as its nickname, which reads
 * badly as a heading and is useless as a topic for the suggester.
 */
const creatorLabel = (c: RadarCreatorCandidate | null): string => {
  if (!c) return 'Đối thủ';
  if (c.nickname && !/^https?:/i.test(c.nickname)) return c.nickname;
  if (c.username) return `@${c.username.replace(/^@/, '')}`;
  const handle = c.ref.match(/@([\w.-]+)/)?.[1];
  return handle ? `@${handle}` : 'Đối thủ';
};

/** Each platform addresses a creator differently, so the hint has to match. */
const COMPETITOR_PLACEHOLDER: Record<string, string> = {
  douyin: 'https://www.douyin.com/user/... hoặc tên creator',
  tiktok: 'https://www.tiktok.com/@ten-kenh hoặc tên creator',
  youtube: 'https://www.youtube.com/channel/UC... hoặc tên kênh',
  instagram: 'https://www.instagram.com/ten-tai-khoan/ hoặc tên tài khoản',
};

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
  'focus:outline-none focus:border-[#A4145E] transition-colors disabled:bg-slate-50 disabled:text-slate-400';

// ---------------------------------------------------------------------------

export const ContentRadar: React.FC<{ brand?: BrandProfile | null }> = ({ brand }) => {
  const [mode, setMode] = useState<RadarMode>('keyword');
  const [platform, setPlatform] = useState<RadarPlatform>('douyin');

  // The committed keyword chips, plus whatever is half-typed in the box.
  const [keywords, setKeywords] = useState<string[]>([]);
  const [keyword, setKeyword] = useState('');
  const [competitor, setCompetitor] = useState('');
  // Competitor mode reads a creator one of two ways, and the keyword is kept
  // when the user switches back and forth so they do not retype it.
  const [creatorScan, setCreatorScan] = useState<CreatorScanMode>(DEFAULT_CREATOR_SCAN_MODE as CreatorScanMode);
  const [creatorKeyword, setCreatorKeyword] = useState('');
  // Floors on the numbers - "their videos from the last 7 days that broke 100k
  // views". Held as text so the fields can be emptied while typing.
  const [minViewsText, setMinViewsText] = useState('');
  const [minLikesText, setMinLikesText] = useState('');

  const [timeWindow, setTimeWindow] = useState<RadarTimeWindow>(DEFAULT_TIME_WINDOW as RadarTimeWindow);
  // Held as text so the field can be cleared and retyped; clamped on blur.
  const [limitText, setLimitText] = useState<string>(String(DEFAULT_RESULT_LIMIT));
  const limit = clampLimit(limitText);
  const [sort, setSort] = useState<RadarSortMode>(DEFAULT_SORT_MODE as RadarSortMode);

  const [running, setRunning] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [error, setError] = useState('');

  const [result, setResult] = useState<RadarScanResult | null>(null);
  // The inputs the current result came from, so the CTA can say "Quét lại" only
  // when nothing has changed since.
  const [scannedWith, setScannedWith] = useState('');
  // Sorting after a scan is a view concern; it never goes back to the provider.
  const [viewSort, setViewSort] = useState<RadarSortMode>(DEFAULT_SORT_MODE as RadarSortMode);

  // Keyword suggestions. Separate from `running` so asking for ideas never
  // looks like a scan, and never blocks one.
  const [suggesting, setSuggesting] = useState(false);
  const [suggestions, setSuggestions] = useState<KeywordSuggestion[] | null>(null);
  const [suggestError, setSuggestError] = useState('');

  // How the results are shown, and the state of the two export buttons.
  const [view, setView] = useState<'cards' | 'table'>('cards');
  const [exporting, setExporting] = useState<'' | 'csv' | 'sheet'>('');
  const [exportNote, setExportNote] = useState('');
  const [exportError, setExportError] = useState('');
  const [sheetUrl, setSheetUrl] = useState('');

  const [candidates, setCandidates] = useState<RadarCreatorCandidate[] | null>(null);
  const [selectedCreator, setSelectedCreator] = useState<RadarCreatorCandidate | null>(null);

  // Suggestions for the competitor filter are their own thing: one keyword is
  // picked here, not a list, and the ideas come from that creator's captions.
  const [creatorSuggesting, setCreatorSuggesting] = useState(false);
  const [creatorSuggestions, setCreatorSuggestions] = useState<KeywordSuggestion[] | null>(null);
  const [creatorSuggestError, setCreatorSuggestError] = useState('');

  /**
   * What a scan would actually run: the committed chips plus anything still in
   * the box, so a user who types one keyword and hits the button does not have
   * to press Enter first.
   */
  const pendingKeywords = useMemo(() => {
    const typed = keyword.trim();
    if (!typed) return keywords;
    if (keywords.some((k) => k.toLowerCase() === typed.toLowerCase())) return keywords;
    return [...keywords, typed].slice(0, MAX_KEYWORDS);
  }, [keywords, keyword]);

  // Suggestions need a topic; use the box, or the last chip once it is empty.
  const suggestSeed = keyword.trim() || keywords[keywords.length - 1] || '';

  const addKeyword = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    setKeywords((current) => {
      if (current.length >= MAX_KEYWORDS) return current;
      if (current.some((k) => k.toLowerCase() === trimmed.toLowerCase())) return current;
      return [...current, trimmed];
    });
    setKeyword('');
  };

  const removeKeyword = (value: string) => {
    setKeywords((current) => current.filter((k) => k !== value));
  };

  /** Empty unless the user asked to narrow the creator's videos by topic. */
  const creatorQuery = creatorScan === 'keyword' ? creatorKeyword.trim() : '';

  /** 0 means "no floor" - both here and on the server. */
  const readThreshold = (text: string) => {
    const n = Math.trunc(Number(text));
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  const minViews = readThreshold(minViewsText);
  const minLikes = readThreshold(minLikesText);

  const currentInputs = [
    platform,
    mode,
    mode === 'keyword'
      ? pendingKeywords.join(',')
      : [selectedCreator?.ref || '', creatorScan, creatorQuery, minViews, minLikes].join('~'),
    timeWindow,
    limit,
    sort,
  ].join('|');
  const isStale = result !== null && currentInputs !== scannedWith;

  const items: RadarContent[] = useMemo(
    () => (result ? sortRadarContent(result.items, viewSort) : []),
    [result, viewSort]
  );

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
    setScannedWith(currentInputs);
    recordScan(scan);
  };

  /**
   * Files the scan into the history as a readable table.
   *
   * The rows go in as HTML rather than only as JSON so an old scan can be read
   * back, downloaded and turned into a Google Doc like everything else. The raw
   * result rides along in `data` for anything that later wants the numbers.
   */
  const recordScan = (scan: RadarScanResult) => {
    if (!scan.items?.length) return;

    const label = scan.mode === 'creator'
      ? (scan.items[0]?.creator?.nickname || scan.query?.original || 'Creator')
      : ((scan.queries || []).map((q) => q.original).filter(Boolean).join(', ') || scan.query?.original || 'Từ khoá');

    const { headers, rows } = buildExportTable(scan.items);
    const summary = `<p>Quét ${scan.platform} · ${scan.items.length} video · khung thời gian ${scan.timeWindow}`
      + `${scan.mode === 'creator' ? ' · chế độ đối thủ' : ''}.</p>`;

    recordAndBackup({
      brandId: brand?.id || '',
      brandName: brand?.name || 'Chưa gắn thương hiệu',
      kind: 'radar',
      modeLabel: 'Content Radar',
      title: `Radar ${scan.platform} — ${label}`.slice(0, 90),
      html: summary + buildTableHtml(headers, rows),
      data: scan,
    });
  };

  const runKeywordScan = async () => {
    if (running || !pendingKeywords.length) return;
    // Commit whatever is still in the box so the chips match what was scanned.
    setKeywords(pendingKeywords);
    setKeyword('');
    beginRun();
    try {
      applyResult(await scanByKeyword({ platform, queries: pendingKeywords, timeWindow, limit, sort }));
    } catch (err: any) {
      setError(err?.message || 'Không quét được lúc này.');
    } finally {
      endRun();
    }
  };

  const runSuggest = async () => {
    if (suggesting || !suggestSeed) return;
    setSuggesting(true);
    setSuggestError('');
    try {
      const found = await suggestKeywords({ query: suggestSeed, platform, timeWindow, brand });
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

  /**
   * Keyword ideas for filtering this creator. Costs an LLM call, never a
   * provider run, and feeds the model the captions already on screen so the
   * ideas come from what this creator actually posts.
   */
  const runCreatorSuggest = async () => {
    if (creatorSuggesting || !selectedCreator) return;

    const seed = creatorKeyword.trim() || brand?.industry?.trim() || creatorLabel(selectedCreator);
    setCreatorSuggesting(true);
    setCreatorSuggestError('');
    try {
      const samples = result?.mode === 'creator'
        ? result.items.map((i) => i.caption || '').filter(Boolean).slice(0, 12)
        : [];

      const found = await suggestKeywords({
        query: seed, platform, timeWindow, brand, scope: 'creator', samples,
      });
      setCreatorSuggestions(found.suggestions);
      if (!found.suggestions.length) {
        setCreatorSuggestError('Chưa nghĩ ra từ khoá nào. Gõ vài chữ về chủ đề rồi thử lại.');
      }
    } catch (err: any) {
      setCreatorSuggestError(err?.message || 'Không gợi ý được lúc này.');
    } finally {
      setCreatorSuggesting(false);
    }
  };

  const runCreatorLookup = async () => {
    if (running || !competitor.trim()) return;
    beginRun();
    try {
      const found = await findCreators(platform, competitor.trim());
      if (found.resolved && found.candidates[0]) {
        // A pasted profile URL needs no disambiguation.
        setSelectedCreator(found.candidates[0]);
        setCandidates(null);
      } else if (found.candidates.length === 0) {
        setError('Không tìm thấy đối thủ nào khớp. Thử tên khác hoặc dán link trang cá nhân.');
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
    // "Theo từ khoá" without a keyword would silently run the other scan.
    if (creatorScan === 'keyword' && !creatorQuery) return;
    beginRun();
    try {
      applyResult(await scanCreator({
        platform, ref: selectedCreator.ref, query: creatorQuery,
        minViews, minLikes, timeWindow, limit, sort,
      }));
    } catch (err: any) {
      setError(err?.message || 'Không quét được đối thủ lúc này.');
    } finally {
      endRun();
    }
  };

  /** What this scan should be called in a filename or a sheet title. */
  const exportLabel = () =>
    (result?.mode === 'creator'
      ? [creatorLabel(selectedCreator), result.query?.original].filter(Boolean).join(' ')
      : (result?.queries || []).map((q) => q.original).join(' ') || 'content-radar');

  const downloadCsv = () => {
    if (!items.length) return;
    setExporting('csv');
    setExportError('');
    setExportNote('');
    try {
      // Exports what is on screen, in the order on screen - the current sort is
      // part of what the user is exporting.
      const blob = new Blob([buildCsv(items)], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = exportFilename(exportLabel(), 'csv');
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      // Revoking immediately can cancel the download in some browsers.
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setExportNote(`Đã tải ${items.length} dòng về máy.`);
    } catch (err: any) {
      setExportError(err?.message || 'Không xuất được CSV.');
    } finally {
      setExporting('');
    }
  };

  const exportSheet = async () => {
    if (!items.length) return;
    if (!getGoogleClientId()) {
      setExportError('Chưa kết nối Google Drive. Vào mục Tích hợp, phần Google Drive, để thiết lập.');
      return;
    }

    setExporting('sheet');
    setExportError('');
    setExportNote('');
    setSheetUrl('');
    try {
      const { headers, rows } = buildExportTable(items);
      const url = await exportToGoogleSheet(`Content Radar — ${exportLabel()}`, headers, rows);
      setSheetUrl(url);
      setExportNote(`Đã tạo bảng tính với ${items.length} dòng trong Drive của bạn.`);
    } catch (err: any) {
      setExportError(err?.message || 'Không xuất được Google Sheet.');
    } finally {
      setExporting('');
    }
  };

  const resetCompetitor = () => {
    setSelectedCreator(null);
    setCandidates(null);
    setResult(null);
    // Ideas drawn from one creator's captions say nothing about the next one.
    setCreatorSuggestions(null);
    setCreatorSuggestError('');
    setError('');
  };

  const switchPlatform = (next: RadarPlatform) => {
    if (next === platform) return;
    setPlatform(next);
    // Results, suggestions and a chosen competitor all belong to the platform
    // they came from - a Chinese suggestion is useless on YouTube.
    setSuggestions(null);
    setSuggestError('');
    setResult(null);
    setSelectedCreator(null);
    setCandidates(null);
    // A Douyin keyword is worthless on YouTube, and the reverse.
    setCreatorKeyword('');
    setCreatorSuggestions(null);
    setCreatorSuggestError('');
    setMinViewsText('');
    setMinLikesText('');
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

      <Field
        label={mode === 'keyword' ? 'Số kết quả mỗi từ khoá' : 'Số kết quả tối đa'}
        hint={`${MIN_RESULT_LIMIT}–${MAX_RESULT_LIMIT}, không cam kết đủ`}
      >
        <div className="flex gap-1.5">
          <input
            type="number"
            min={MIN_RESULT_LIMIT}
            max={MAX_RESULT_LIMIT}
            value={limitText}
            onChange={(e) => setLimitText(e.target.value)}
            // Clamped on blur, not on every keystroke, so typing "35" is not
            // rewritten to "3" the moment the first digit lands.
            onBlur={() => setLimitText(String(clampLimit(limitText)))}
            disabled={running}
            className={selectClass + ' flex-1 min-w-0 tabular-nums'}
          />
          {RESULT_LIMITS.map((n) => (
            <button
              key={n}
              onClick={() => setLimitText(String(n))}
              disabled={running}
              className={`shrink-0 px-2.5 rounded-xl border text-[13px] font-semibold transition-colors disabled:opacity-40
                ${limit === n
                  ? 'border-[#A4145E] bg-[#FDF2F7] text-[#A4145E]'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'}`}
            >
              {n}
            </button>
          ))}
        </div>
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
    'bg-[#A4145E] hover:bg-[#86104D] text-white disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed';

  return (
    <div className="max-w-[1080px]">
      <div className="flex items-start gap-5">
        <div className="w-[68px] h-[68px] rounded-2xl bg-[#FDF2F7] border border-[#f8d3e0] flex items-center justify-center shrink-0">
          <Radar className="w-9 h-9 text-[#A4145E]" strokeWidth={1.5} />
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
                ${active ? 'bg-white border border-[#A4145E] text-[#A4145E] shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
            >
              <Icon className={`w-4 h-4 ${active ? 'text-[#A4145E]' : 'text-slate-400'}`} />
              {label}
            </button>
          );
        })}
      </div>

      {/* SCAN FORM */}
      <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-6 space-y-5">
        <div className="flex items-center gap-2">
          <Radio className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          {PLATFORMS.map((p) => {
            const active = platform === p.id;
            return (
              <button
                key={p.id}
                onClick={() => switchPlatform(p.id as RadarPlatform)}
                disabled={running}
                className={`px-3 py-1.5 rounded-lg border text-[12px] font-semibold transition-colors disabled:opacity-50
                  ${active
                    ? 'bg-[#FDF2F7] border-[#f8d3e0] text-[#A4145E]'
                    : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'}`}
              >
                {p.label}
              </button>
            );
          })}
        </div>

        {mode === 'keyword' ? (
          <>
            <Field
              label="Chủ đề hoặc từ khoá"
              hint={`tối đa ${MAX_KEYWORDS}, mỗi từ khoá là một lần quét riêng`}
            >
              <div className="flex gap-2.5 flex-wrap">
                <div
                  className={`flex-1 min-w-[240px] flex flex-wrap items-center gap-2 rounded-xl border bg-white py-2 px-2.5 transition-colors
                    ${running ? 'border-slate-200 bg-slate-50' : 'border-slate-200 focus-within:border-[#A4145E]'}`}
                >
                  {keywords.map((kw) => (
                    <span
                      key={kw}
                      className="inline-flex items-center gap-1.5 pl-3 pr-2 py-1.5 rounded-lg bg-[#FDF2F7] border border-[#f8d3e0] text-[14px] font-medium text-[#A4145E]"
                    >
                      {kw}
                      <button
                        onClick={() => removeKeyword(kw)}
                        disabled={running}
                        className="text-[#A4145E]/60 hover:text-[#A4145E] disabled:opacity-40"
                        title="Bỏ từ khoá này"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </span>
                  ))}

                  <input
                    value={keyword}
                    onChange={(e) => setKeyword(e.target.value)}
                    onKeyDown={(e) => {
                      // Enter adds a keyword; it only starts a scan when the box
                      // is empty, so a half-typed word is never scanned by accident.
                      if (e.key === 'Enter') {
                        if (keyword.trim()) { e.preventDefault(); addKeyword(keyword); }
                        else runKeywordScan();
                      }
                      if (e.key === ',') { e.preventDefault(); addKeyword(keyword); }
                      if (e.key === 'Backspace' && !keyword && keywords.length) {
                        removeKeyword(keywords[keywords.length - 1]);
                      }
                    }}
                    onBlur={() => addKeyword(keyword)}
                    placeholder={keywords.length ? 'Thêm từ khoá…' : 'AI Marketing · Mỹ phẩm · 人工智能  (Enter để thêm)'}
                    disabled={running || keywords.length >= MAX_KEYWORDS}
                    className="flex-1 min-w-[160px] bg-transparent py-1.5 px-1.5 text-[15px] text-slate-800 placeholder:text-slate-400 focus:outline-none disabled:cursor-not-allowed"
                  />
                </div>

                {/* Costs an LLM call, not a provider run - safe to press while exploring. */}
                <button
                  onClick={runSuggest}
                  disabled={suggesting || running || !suggestSeed}
                  title="Nhờ AI gợi ý từ khoá tiếng Trung sát với chủ đề này"
                  className="shrink-0 self-start inline-flex items-center gap-2 px-4 py-3 rounded-xl border border-slate-200 bg-white text-[14px] font-semibold text-slate-700 hover:border-[#A4145E] hover:text-[#A4145E] disabled:opacity-40 disabled:hover:border-slate-200 disabled:hover:text-slate-700 transition-colors"
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
                    Bấm để chọn từ khoá, chọn được nhiều
                    {brand?.industry && (
                      <span className="ml-1.5 font-normal text-slate-500">
                        · gợi ý theo ngành "{brand.industry}"
                      </span>
                    )}
                    <span className="ml-1.5 font-normal text-slate-500">
                      {platform === 'douyin' ? ' · Douyin cho kết quả tốt nhất với tiếng Trung' : ' · bấm để thêm vào danh sách'}
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

                {/* Grouped, so it is clear which keyword is broad and which is a
                    niche bet - the thing a user cannot tell by looking. */}
                <div className="mt-3 space-y-3">
                  {SUGGESTION_TIERS.map((tier) => {
                    const inTier = suggestions.filter((s) => s.tier === tier.id);
                    if (!inTier.length) return null;

                    return (
                      <div key={tier.id}>
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                          {tier.label}
                          <span className="ml-1.5 font-normal normal-case tracking-normal text-slate-400">
                            {tier.hint}
                          </span>
                        </p>

                        <div className="mt-1.5 flex flex-wrap gap-2">
                          {inTier.map((s) => {
                            const picked = keywords.includes(s.keyword);
                            const full = !picked && keywords.length >= MAX_KEYWORDS;
                            return (
                              <button
                                key={s.keyword}
                                // Only edits the keyword list. The user still
                                // decides when to spend a scan.
                                onClick={() => (picked ? removeKeyword(s.keyword) : addKeyword(s.keyword))}
                                disabled={full || running}
                                title={s.why || (full ? `Đã đủ ${MAX_KEYWORDS} từ khoá` : picked ? 'Bỏ chọn' : 'Thêm vào danh sách')}
                                className={`group px-3.5 py-2 rounded-xl border text-left transition-colors disabled:opacity-40 max-w-[300px]
                                  ${picked
                                    ? 'border-[#A4145E] bg-[#FDF2F7]'
                                    : 'border-slate-200 bg-white hover:border-[#A4145E]'}`}
                              >
                                <span className="flex items-center gap-1.5">
                                  {picked && <Check className="w-3.5 h-3.5 text-[#A4145E] shrink-0" />}
                                  <span className={`text-[14px] font-semibold truncate ${picked ? 'text-[#A4145E]' : 'text-slate-900 group-hover:text-[#A4145E]'}`}>
                                    {s.keyword}
                                  </span>
                                </span>
                                {s.note && <span className="block text-[11px] text-slate-500 mt-0.5 truncate">{s.note}</span>}
                                {s.why && <span className="block text-[11px] text-slate-400 mt-0.5 line-clamp-2">{s.why}</span>}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {filters}

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button onClick={runKeywordScan} disabled={running || !pendingKeywords.length} className={ctaClass}>
                {isStale || !result ? <Search className="w-4 h-4" /> : <RefreshCw className="w-4 h-4" />}
                {running ? 'Đang quét…' : result && !isStale ? 'Quét lại' : 'Quét nội dung'}
              </button>
              <span className="text-[12px] text-slate-400">
                {pendingKeywords.length
                  ? `${pendingKeywords.length} từ khoá × tối đa ${limit} kết quả — khoảng ${pendingKeywords.length * pagesNeeded(limit)} lần gọi nhà cung cấp được tính phí.`
                  : 'Nhập ít nhất một từ khoá. Mỗi từ khoá là một lần gọi nhà cung cấp và được tính phí.'}
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
                    {creatorLabel(selectedCreator)}
                  </p>
                  <p className="text-[12px] text-slate-500 truncate">
                    {selectedCreator.followerCount !== null ? `${formatCount(selectedCreator.followerCount)} follower` : selectedCreator.ref}
                  </p>
                </div>
                <button
                  onClick={resetCompetitor}
                  disabled={running}
                  className="shrink-0 inline-flex items-center gap-1.5 text-[13px] text-slate-500 hover:text-[#A4145E] transition-colors disabled:opacity-50"
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
                  placeholder={COMPETITOR_PLACEHOLDER[platform]}
                  disabled={running}
                  className="w-full rounded-xl border border-slate-200 bg-white py-3 px-4 text-[15px] text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-[#A4145E] transition-colors disabled:bg-slate-50"
                />
              </Field>
            )}

            {/* Two ways to read the same creator, chosen before the filters
                because it changes what the filters apply to. */}
            {selectedCreator && (
              <div className="space-y-3">
                <div className="inline-flex gap-1 p-1 rounded-xl bg-slate-50 border border-slate-200">
                  {CREATOR_SCAN_MODES.map((m) => {
                    const active = creatorScan === m.id;
                    return (
                      <button
                        key={m.id}
                        onClick={() => setCreatorScan(m.id as CreatorScanMode)}
                        disabled={running}
                        title={m.hint}
                        className={`px-3.5 py-2 rounded-lg text-[13px] font-semibold transition-colors disabled:opacity-50
                          ${active ? 'bg-white border border-[#A4145E] text-[#A4145E] shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
                      >
                        {m.label}
                      </button>
                    );
                  })}
                </div>

                {creatorScan === 'keyword' && (
                  <>
                    <Field label="Từ khoá trong nội dung đối thủ" hint="ngắn 1–2 từ khớp caption tốt hơn cả câu">
                      <div className="flex flex-col sm:flex-row gap-2">
                        <input
                          value={creatorKeyword}
                          onChange={(e) => setCreatorKeyword(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') runCreatorScan(); }}
                          placeholder="VD: kịch bản · ý tưởng · chốt đơn"
                          disabled={running}
                          className="flex-1 rounded-xl border border-slate-200 bg-white py-3 px-4 text-[15px] text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-[#A4145E] transition-colors disabled:bg-slate-50"
                        />
                        {/* Costs an LLM call, not a provider run. */}
                        <button
                          onClick={runCreatorSuggest}
                          disabled={creatorSuggesting || running}
                          title="Nhờ AI gợi ý từ khoá hợp với nội dung của đối thủ này"
                          className="shrink-0 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-slate-200 bg-white text-[14px] font-semibold text-slate-700 hover:border-[#A4145E] hover:text-[#A4145E] disabled:opacity-40 transition-colors"
                        >
                          {creatorSuggesting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                          {creatorSuggesting ? 'Đang nghĩ…' : 'AI gợi ý từ khoá'}
                        </button>
                      </div>
                    </Field>

                    {creatorSuggestError && (
                      <p className="text-[13px] text-amber-700">{creatorSuggestError}</p>
                    )}

                    {creatorSuggestions && creatorSuggestions.length > 0 && (
                      <div className="rounded-xl border border-[#f0c9d8] bg-[#fef7f8] p-4">
                        <div className="flex items-start justify-between gap-3">
                          <p className="text-[13px] font-semibold text-slate-700">
                            Bấm để chọn một từ khoá
                            <span className="ml-1.5 font-normal text-slate-500">
                              {result?.mode === 'creator' && result.items.length
                                ? '· gợi ý dựa trên nội dung đối thủ đã quét'
                                : '· quét “Video tốt nhất” trước để gợi ý bám sát hơn'}
                            </span>
                          </p>
                          <button
                            onClick={() => { setCreatorSuggestions(null); setCreatorSuggestError(''); }}
                            className="shrink-0 text-slate-400 hover:text-slate-700 transition-colors"
                            title="Đóng gợi ý"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>

                        <div className="mt-3 flex flex-wrap gap-2">
                          {creatorSuggestions.map((s) => {
                            const picked = creatorKeyword.trim().toLowerCase() === s.keyword.toLowerCase();
                            return (
                              <button
                                key={s.keyword}
                                // Fills the box only; the scan still waits for the user.
                                onClick={() => setCreatorKeyword(s.keyword)}
                                disabled={running}
                                title={s.why || 'Dùng từ khoá này'}
                                className={`group px-3.5 py-2 rounded-xl border text-left transition-colors disabled:opacity-40 max-w-[300px]
                                  ${picked ? 'border-[#A4145E] bg-[#FDF2F7]' : 'border-slate-200 bg-white hover:border-[#A4145E]'}`}
                              >
                                <span className="flex items-center gap-1.5">
                                  {picked && <Check className="w-3.5 h-3.5 text-[#A4145E] shrink-0" />}
                                  <span className={`text-[14px] font-semibold truncate ${picked ? 'text-[#A4145E]' : 'text-slate-900 group-hover:text-[#A4145E]'}`}>
                                    {s.keyword}
                                  </span>
                                </span>
                                {s.note && <span className="block text-[11px] text-slate-500 mt-0.5 truncate">{s.note}</span>}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {selectedCreator && filters}

            {/* Floors on the numbers. Applied after the time window, so the two
                read as one question: "in the last 7 days, above 100k views". */}
            {selectedCreator && (
              <div className="space-y-2">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label="Lượt xem tối thiểu" hint="bỏ trống là không lọc">
                    <input
                      type="number"
                      min={0}
                      step={1000}
                      value={minViewsText}
                      onChange={(e) => setMinViewsText(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') runCreatorScan(); }}
                      placeholder="VD: 100000"
                      disabled={running}
                      className={selectClass}
                    />
                  </Field>
                  <Field label="Lượt thích tối thiểu" hint="bỏ trống là không lọc">
                    <input
                      type="number"
                      min={0}
                      step={100}
                      value={minLikesText}
                      onChange={(e) => setMinLikesText(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') runCreatorScan(); }}
                      placeholder="VD: 5000"
                      disabled={running}
                      className={selectClass}
                    />
                  </Field>
                </div>

                {minViews > 0 && platform !== 'youtube' && (
                  <p className="text-[12px] text-amber-700">
                    {PLATFORMS.find((p) => p.id === platform)?.label} không phải lúc nào cũng trả lượt xem.
                    Video không có số liệu sẽ bị loại — nếu kết quả trống, hãy lọc bằng lượt thích.
                  </p>
                )}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3 pt-1">
              {selectedCreator ? (
                <button
                  onClick={runCreatorScan}
                  disabled={running || (creatorScan === 'keyword' && !creatorQuery)}
                  className={ctaClass}
                >
                  {isStale || !result ? <Search className="w-4 h-4" /> : <RefreshCw className="w-4 h-4" />}
                  {running
                    ? 'Đang quét…'
                    : result && !isStale
                      ? 'Quét lại'
                      : creatorScan === 'keyword' ? 'Tìm trong nội dung đối thủ' : 'Quét đối thủ'}
                </button>
              ) : (
                <button onClick={runCreatorLookup} disabled={running || !competitor.trim()} className={ctaClass}>
                  <Users className="w-4 h-4" />
                  {running ? 'Đang tìm…' : 'Tìm đối thủ'}
                </button>
              )}
              <span className="text-[12px] text-slate-400">
                {!selectedCreator
                  ? 'Chọn đúng đối thủ trước, sau đó mới quét nội dung của họ.'
                  : minViews > 0 || minLikes > 0
                    ? `Đọc nhiều trang video của đối thủ rồi chỉ giữ video đạt ${[
                        minViews > 0 ? `${formatCount(minViews)} lượt xem` : '',
                        minLikes > 0 ? `${formatCount(minLikes)} lượt thích` : '',
                      ].filter(Boolean).join(' và ')} trở lên.`
                    : creatorScan === 'keyword'
                    ? platform === 'youtube'
                      ? 'Tìm từ khoá trong toàn bộ kênh của đối thủ. Một lần gọi nhà cung cấp.'
                      : 'Đọc trang video gần nhất của đối thủ rồi lọc theo từ khoá — số video đọc được hiện ngay trong kết quả. Một lần gọi nhà cung cấp.'
                    : 'Lấy video gần đây của đối thủ và xếp theo sức hút. Một lần gọi nhà cung cấp.'}
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
                      className="text-left rounded-xl border border-slate-200 bg-white p-3 flex items-center gap-3 hover:border-[#A4145E] hover:bg-[#fef7f8] transition-all"
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
          <Sparkles className="w-8 h-8 text-[#A4145E] mx-auto" strokeWidth={1.5} />
          <p className="mt-3.5 text-[17px] font-bold text-slate-900">
            Tìm những nội dung đang hoạt động tốt trên mạng xã hội
          </p>
          <p className="mt-1.5 text-[14px] text-slate-600">Nhập chủ đề hoặc đối thủ để bắt đầu.</p>

          {mode === 'keyword' && (
            <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
              {EXAMPLE_KEYWORDS.map((example) => (
                <button
                  key={example}
                  // Fills the input only - the user still decides when to spend a scan.
                  onClick={() => addKeyword(example)}
                  className="px-3.5 py-1.5 rounded-full border border-slate-200 bg-white text-[13px] text-slate-700 hover:border-[#A4145E] hover:text-[#A4145E] transition-colors"
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
            <div className="min-w-0">
              <h2 className="text-[22px] font-bold text-slate-900">
                {result.mode === 'keyword'
                  ? (result.queries || []).map((q) => q.original).join(' · ') || result.query?.original || 'Kết quả'
                  : creatorLabel(selectedCreator)}
                {result.mode === 'creator' && result.query && (
                  <span className="text-slate-400"> · {result.query.original}</span>
                )}
              </h2>
              <p className="text-[13px] text-slate-500 mt-1">
                {PLATFORMS.find((p) => p.id === result.platform)?.label || result.platform}
                {result.cached && <> · dùng lại kết quả vừa quét, không tốn thêm</>}
              </p>

              {/* Per keyword, so it is clear which one actually found anything. */}
              {result.mode === 'keyword' && (result.queries?.length || 0) > 1 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {result.queries!.map((q) => (
                    <span
                      key={q.original}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[12px]
                        ${q.failed
                          ? 'border-red-200 bg-red-50 text-red-700'
                          : 'border-slate-200 bg-slate-50 text-slate-600'}`}
                      title={q.translated ? `tìm bằng ${q.effective}` : undefined}
                    >
                      <span className="font-medium">{q.original}</span>
                      {q.translated && <span className="text-slate-400">→ {q.effective}</span>}
                      <span className={q.failed ? '' : 'text-slate-500'}>
                        {q.failed ? 'lỗi' : `${q.matched} video`}
                      </span>
                    </span>
                  ))}
                </div>
              )}

              {result.mode === 'keyword' && (result.queries?.length || 0) === 1 && result.queries![0].translated && (
                <p className="text-[12px] text-slate-400 mt-1">
                  Tìm bằng <span className="text-slate-600 font-medium">{result.queries![0].effective}</span>
                </p>
              )}

              <p className="text-[15px] text-slate-800 mt-2">
                <strong>{result.items.length}</strong> nội dung được tìm thấy
                <span className="text-slate-500">
                  {' '}· Trong {TIME_WINDOWS.find((w) => w.id === result.timeWindow)?.label} gần nhất
                </span>
              </p>

              {result.mode === 'creator' && result.thresholds && (
                <p className="text-[13px] text-slate-600 mt-1">
                  Chỉ giữ video đạt{' '}
                  <span className="font-semibold text-slate-800">
                    {[
                      result.thresholds.minViews > 0 ? `${formatCount(result.thresholds.minViews)} lượt xem` : '',
                      result.thresholds.minLikes > 0 ? `${formatCount(result.thresholds.minLikes)} lượt thích` : '',
                    ].filter(Boolean).join(' và ')}
                  </span>{' '}trở lên.
                </p>
              )}

              {/* Competitor + keyword: how much of their page was read to find
                  these, so a thin result reads as "they rarely post about it"
                  rather than "the scan failed". */}
              {result.mode === 'creator' && result.query && typeof result.scannedCount === 'number' && (
                <p className="text-[12px] text-slate-400 mt-1">
                  Đã đọc {result.scannedCount} video gần nhất của đối thủ, {result.fetchedCount} video nhắc tới
                  {' '}<span className="text-slate-600 font-medium">{result.query.effective}</span>.
                  {result.query.translated && <> Từ khoá được dịch từ “{result.query.original}”.</>}
                </p>
              )}

              {result.fetchedCount > result.items.length && (
                <p className="text-[12px] text-slate-400 mt-1">
                  Đã lấy về {result.fetchedCount} kết quả; còn {result.items.length} sau khi lọc thời gian và bỏ trùng.
                </p>
              )}

              {/* A bounded window drops undated rows without saying so, which is
                  how a scan of an active creator reports zero. */}
              {(result.undatedCount || 0) > 0 && result.timeWindow !== 'all' && (
                <p className="text-[12px] text-amber-700 mt-1">
                  {result.undatedCount} video không có ngày đăng nên bị khung thời gian loại.
                  Chọn “Không giới hạn” để xem chúng.
                </p>
              )}

              {(result.missingViews || 0) > 0 && (
                <p className="text-[12px] text-amber-700 mt-1">
                  {result.missingViews} video không được nền tảng trả lượt xem nên không qua được ngưỡng.
                  Lọc bằng lượt thích sẽ chắc ăn hơn.
                </p>
              )}

              {typeof result.billedCalls === 'number' && (
                <p className="text-[12px] text-slate-400 mt-0.5">
                  {result.billedCalls === 0
                    ? 'Không gọi nhà cung cấp lần nào — dùng lại kết quả đã lưu.'
                    : `${result.billedCalls} lần gọi nhà cung cấp được tính phí.`}
                </p>
              )}

              {(result.failures?.length || 0) > 0 && (
                <p className="text-[12px] text-amber-700 mt-1">
                  {result.failures!.length} từ khoá lỗi: {result.failures![0].error}
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
                {result.mode === 'creator' && result.query
                  ? `Đối thủ này không có video nào nhắc tới “${result.query.original}”.`
                  : result.mode === 'creator' && result.thresholds
                    ? 'Không có video nào của đối thủ đạt mức bạn đặt trong khoảng thời gian này.'
                    : 'Không tìm thấy nội dung phù hợp trong khoảng thời gian này.'}
              </p>
              <p className="mt-2 text-[14px] text-slate-600">
                {result.mode === 'creator' && result.query
                  ? `Đã đọc ${result.scannedCount ?? 0} video gần nhất của họ. Bộ lọc chỉ đọc được caption và hashtag — nội dung nói trong video thì không thấy. Thử từ khoá ngắn 1–2 từ, hoặc chuyển sang “Video tốt nhất” để xem toàn bộ.`
                  : result.mode === 'creator' && result.thresholds
                    ? `Đã đọc ${result.scannedCount ?? 0} video gần nhất của họ. Thử hạ ngưỡng, nới khoảng thời gian, hoặc bỏ trống hai ô ngưỡng để xem tất cả.`
                    : 'Thử tăng khoảng thời gian, hoặc dùng một từ khoá khác rồi quét lại.'}
              </p>
            </div>
          ) : (
            <>
              <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                {/* View and export both act on data already in the browser. */}
                <div className="inline-flex gap-1 p-1 rounded-xl bg-slate-50 border border-slate-200">
                  {([['cards', 'Thẻ', LayoutGrid], ['table', 'Bảng', Table2]] as const).map(([id, label, Icon]) => {
                    const active = view === id;
                    return (
                      <button
                        key={id}
                        onClick={() => setView(id)}
                        className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[13px] font-semibold transition-colors
                          ${active ? 'bg-white border border-[#A4145E] text-[#A4145E] shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
                      >
                        <Icon className="w-3.5 h-3.5" />
                        {label}
                      </button>
                    );
                  })}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={downloadCsv}
                    disabled={!!exporting}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-[13px] font-semibold text-slate-700 hover:border-[#A4145E] hover:text-[#A4145E] disabled:opacity-40 transition-colors"
                  >
                    {exporting === 'csv' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                    Tải CSV
                  </button>

                  <button
                    onClick={exportSheet}
                    disabled={!!exporting}
                    title="Tạo một Google Sheet mới trong Drive của bạn"
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-[13px] font-semibold text-slate-700 hover:border-[#A4145E] hover:text-[#A4145E] disabled:opacity-40 transition-colors"
                  >
                    {exporting === 'sheet' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
                    {exporting === 'sheet' ? 'Đang tạo…' : 'Xuất Google Sheet'}
                  </button>
                </div>
              </div>

              {(exportNote || exportError) && (
                <div className="mt-3">
                  {exportNote && (
                    <p className="text-[13px] text-emerald-700 flex items-center gap-1.5 flex-wrap">
                      <Check className="w-4 h-4 shrink-0" />
                      {exportNote}
                      {sheetUrl && (
                        <a
                          href={sheetUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 font-semibold text-[#A4145E] hover:underline"
                        >
                          Mở bảng tính <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      )}
                    </p>
                  )}
                  {exportError && (
                    <p className="text-[13px] text-red-700 flex items-start gap-1.5">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> {exportError}
                    </p>
                  )}
                </div>
              )}

              <div className="mt-4">
                {view === 'table' ? (
                  <RadarResultsTable items={items} />
                ) : (
                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                    {items.map((content) => (
                      <RadarContentCard key={content.id} content={content} />
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};
