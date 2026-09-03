import React, { useEffect, useRef, useState } from 'react';
import {
  Waves, Link as LinkIcon, Loader2, Sparkles, AlertCircle, Copy, Check, Download,
  FileSpreadsheet, Sheet, Target, Share2, FilePenLine, FileImage, UploadCloud,
  ClipboardPaste, X, Globe, Video, Music, Trash2,
} from 'lucide-react';
import {
  AnalysisMode, BrandProfile, FileData, WaterfallObjective, WATERFALL_OBJECTIVE_LABELS,
} from '../types';
import { analyzeContent, fileToGenerativePart } from '../services/geminiService';
import { loadLinkSource } from '../services/sourceLoader';
import { Button, FileDropzone } from './UiComponents';
import { SectionCard, WorkflowStepper, RunStatus } from './WorkspaceShell';
import { exportToExcelCsv, openInGoogleSheets } from '../src/utils/exportUtils';
import { recordAndBackup } from '../services/historyBackup';
import { BookingNudge } from './BookingNudge';

const STEPS: [string, string][] = [
  ['Nguồn gốc', 'Link, video, text hoặc ảnh'],
  ['Tùy chỉnh', 'Số ý tưởng, kênh & mục tiêu'],
  ['Kết quả', 'Bản đồ cơ hội nội dung'],
];

const IDEA_COUNTS = [10, 15, 20, 30];

type PastedImage = { file: File; previewUrl: string; base64: string; mimeType: string };

/**
 * Content Waterfall - the brainstorming half of the app. One source of any
 * kind (article, post, video, podcast, report, raw notes) becomes a map of
 * distinct content opportunities for the active brand. Content Creator is
 * where a chosen opportunity is then written out in full.
 */
export const ContentWaterfall: React.FC<{ brand: BrandProfile }> = ({ brand }) => {
  const [urlInput, setUrlInput] = useState('');
  const [readComments, setReadComments] = useState(true);
  const [fileData, setFileData] = useState<FileData | null>(null);
  const [sourceText, setSourceText] = useState('');
  const [images, setImages] = useState<PastedImage[]>([]);
  const [pastedCount, setPastedCount] = useState(0);

  const [ideaCount, setIdeaCount] = useState(15);
  const [objective, setObjective] = useState<WaterfallObjective>('auto');
  const [channels, setChannels] = useState('');
  const [instructions, setInstructions] = useState('');

  const [fetching, setFetching] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState('');
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [result, setResult] = useState('');
  const [copied, setCopied] = useState(false);

  const resultRef = useRef<HTMLDivElement>(null);

  const hasSource = !!fileData || !!sourceText.trim() || images.length > 0;
  const currentStep = result ? 3 : hasSource ? 2 : 1;

  const addImages = async (files: FileList | File[] | null) => {
    if (!files || !('length' in files) || !files.length) return;
    const picked = Array.from(files as ArrayLike<File>).filter((f) => f.type.startsWith('image'));
    if (!picked.length) return;

    const loaded = await Promise.all(
      picked.map(async (file) => {
        const { inlineData } = await fileToGenerativePart(file);
        return {
          file,
          previewUrl: URL.createObjectURL(file),
          base64: inlineData.data,
          mimeType: file.type || 'image/jpeg',
        };
      })
    );
    setImages((prev) => [...prev, ...loaded]);
    setError('');
  };

  // Listening on the window means a screenshot pastes wherever the caret is,
  // not only inside the drop box.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.files || []).filter((f) => f.type.startsWith('image'));
      if (!files.length) return;
      event.preventDefault();
      addImages(files);
      setPastedCount(files.length);
      window.setTimeout(() => setPastedCount(0), 2500);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  const removeImage = (index: number) => {
    setImages((prev) => {
      const target = prev[index];
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((_, i) => i !== index);
    });
  };

  const handleFileSelect = async (file: File) => {
    setError('');
    setNotice('');
    setUrlInput('');

    if (file.size > 30 * 1024 * 1024) {
      setError('File lớn hơn 30MB. Với video dài, hãy cắt lấy đoạn quan trọng (dưới 1-2 phút) hoặc dán link thay vì tải lên.');
      return;
    }

    const type = file.type.startsWith('video') ? 'video'
      : file.type.startsWith('audio') ? 'audio' : 'image';

    try {
      const { inlineData } = await fileToGenerativePart(file);
      setFileData({
        file,
        previewUrl: URL.createObjectURL(file),
        type,
        base64: inlineData.data,
        mimeType: inlineData.mimeType,
      });
    } catch {
      setError('Lỗi khi đọc file. Vui lòng thử lại.');
    }
  };

  // A link here can be either an article or a video, so the loader decides for
  // itself which one it is rather than the user picking a mode first.
  const handleUrlFetch = async () => {
    if (!urlInput.trim()) return;

    setFetching(true);
    setStartedAt(Date.now());
    setError('');
    setNotice('');
    setResult('');
    setProgress('Đang kết nối liên kết...');

    try {
      const { fileData: loaded, warning } = await loadLinkSource(urlInput.trim(), {
        mode: 'auto',
        withComments: readComments,
        onProgress: setProgress,
      });
      setFileData(loaded);
      if (warning) setNotice(warning);
    } catch (err: any) {
      setError('Lỗi tải link: ' + (err.message || 'Vui lòng kiểm tra lại đường dẫn.'));
    } finally {
      setFetching(false);
      setProgress('');
      setStartedAt(null);
    }
  };

  const handleClearSource = () => {
    setFileData(null);
    setUrlInput('');
    setNotice('');
    setError('');
  };

  const handleRun = async () => {
    if (!hasSource) {
      setError('Chưa có nguồn nào để bung ý tưởng. Hãy dán link, dán nội dung, tải video lên hoặc dán ảnh chụp.');
      return;
    }

    setRunning(true);
    setStartedAt(Date.now());
    setError('');
    setResult('');

    const attached = [
      ...images.map(({ base64, mimeType }) => ({ base64, mimeType })),
      ...(fileData?.sourceImages || []),
    ].slice(0, 10);

    try {
      const html = await analyzeContent(
        '',
        AnalysisMode.CONTENT_WATERFALL,
        fileData?.base64 || '',
        fileData?.mimeType || '',
        sourceText,
        fileData?.sourceText,
        fileData?.url,
        brand,
        instructions,
        undefined,
        fileData?.fileUri,
        fileData?.videoMeta,
        attached.length ? attached : undefined,
        { ideaCount, channels, objective }
      );
      setResult(html);
      recordAndBackup({
        brandId: brand.id,
        brandName: brand.name,
        kind: 'waterfall',
        modeLabel: 'Content Waterfall',
        html,
        sourceUrl: fileData?.url || fileData?.videoMeta?.webpageUrl || undefined,
      });
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    } catch (err: any) {
      setError(err.message || 'Đã có lỗi xảy ra khi bung ý tưởng.');
    } finally {
      setRunning(false);
      setStartedAt(null);
    }
  };

  const plainText = () => {
    const holder = document.createElement('div');
    holder.innerHTML = result;
    return holder.textContent || holder.innerText || '';
  };

  const brandSlug = (brand.name || 'brand').toLowerCase().replace(/\s+/g, '-');

  const handleCopy = () => {
    navigator.clipboard.writeText(plainText());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleExportTxt = () => {
    const blob = new Blob([plainText()], { type: 'text/plain;charset=utf-8' });
    const href = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = href;
    link.download = `content-waterfall-${brandSlug}.txt`;
    link.click();
    URL.revokeObjectURL(href);
  };

  const handleOpenSheets = async () => {
    const ok = await openInGoogleSheets(result, `Content Waterfall - ${brand.name}`);
    setNotice(ok
      ? 'Đã mở Google Sheets mới ở tab khác. Bấm ô A1 rồi Ctrl+V (Cmd+V) để dán bảng ý tưởng.'
      : 'Đã mở Google Sheets mới, nhưng trình duyệt chặn sao chép tự động. Dùng nút CSV rồi vào Sheet: Tệp ▸ Nhập ▸ Tải lên.');
    setTimeout(() => setNotice(''), 15000);
  };

  const runExpectation = fileData?.fileUri || fileData?.videoMeta
    ? 'Nguồn video có thể mất 1-3 phút. Cứ để tab này mở.'
    : 'Thường mất 30-90 giây. Cứ để tab này mở.';

  return (
    <div className="max-w-[880px] space-y-7">
      <div>
        <div className="flex items-center gap-3">
          <span className="w-11 h-11 rounded-2xl bg-[#FDF2F7] border border-pink-200 flex items-center justify-center text-[#A4145E]">
            <Waves className="w-5 h-5" />
          </span>
          <h1 className="text-[34px] leading-tight font-bold text-slate-900">Content Waterfall</h1>
        </div>
        <p className="mt-3 text-[15px] text-slate-600 leading-relaxed">
          Đây là phần brainstorm ý tưởng. Đưa vào MỘT nguồn bất kỳ — bài viết, bài đăng, tin tức,
          video, podcast, báo cáo, case study hay ghi chú thô — AI sẽ bóc tách và bung ra nhiều
          hướng nội dung khác biệt cho {brand.name}. Chọn được hướng ưng ý rồi thì sang
          Content Creator để triển khai chi tiết.
        </p>
      </div>

      <WorkflowStepper steps={STEPS} current={currentStep} running={running || fetching} />

      {/* ================= STEP 1: SOURCE ================= */}
      <SectionCard n={1} title="Nguồn gốc" hint="Link bài viết, link video, file video/audio, text hoặc ảnh chụp">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-6">
          <div className="space-y-3.5 min-w-0">
            {/* Link */}
            <div className="space-y-2">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <LinkIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#A4145E]" />
                  <input
                    type="text"
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleUrlFetch(); } }}
                    placeholder="Dán link bài viết, bài đăng, tin tức hoặc link video TikTok, YouTube, Reels..."
                    className="w-full bg-white border border-slate-200 rounded-xl py-3 pl-10 pr-3 text-sm text-slate-800 focus:outline-none focus:border-[#A4145E] transition-colors placeholder:text-slate-400"
                  />
                </div>
                <Button
                  variant="secondary"
                  className="shrink-0 text-xs px-4"
                  onClick={handleUrlFetch}
                  disabled={fetching || running || !urlInput.trim()}
                >
                  {fetching ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Lấy nội dung'}
                </Button>
              </div>
              {fetching && <RunStatus compact message={progress || 'Đang lấy nội dung...'} startedAt={startedAt} />}
              <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={readComments}
                  onChange={(e) => setReadComments(e.target.checked)}
                  className="w-3.5 h-3.5 accent-[#A4145E] cursor-pointer"
                />
                Đọc cả bình luận trong bài
                {typeof fileData?.commentCount === 'number' && fileData.commentCount > 0 && (
                  <span className="text-[#A4145E] font-medium">
                    · đã đọc {fileData.commentCount} bình luận
                  </span>
                )}
              </label>
              <p className="text-xs text-slate-500">
                Link video sẽ được tải về cho AI xem trực tiếp. Link bài viết sẽ được đọc lấy nguyên văn nội dung.
              </p>
            </div>

            {/* Upload video / audio */}
            <FileDropzone
              onFileSelect={handleFileSelect}
              currentFile={fileData?.file || null}
              label="Hoặc kéo thả file video, audio, ảnh nguồn vào đây"
            />

            {/* Paste text */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                <FilePenLine className="w-3.5 h-3.5 text-[#A4145E]" /> Nội dung nguồn (bài viết, transcript, ghi chú, báo cáo...)
              </label>
              <textarea
                className="w-full bg-white border border-slate-200 rounded-xl p-3.5 text-sm text-slate-800 focus:border-[#A4145E] outline-none h-40 resize-none custom-scrollbar placeholder:text-slate-400"
                placeholder="Dán nội dung nguồn vào đây. Có thể bỏ trống nếu đã dán link, tải file hoặc dán ảnh chụp."
                value={sourceText}
                onChange={(e) => setSourceText(e.target.value)}
              />
            </div>

            {/* Screenshots */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                <FileImage className="w-3.5 h-3.5 text-[#A4145E]" /> Ảnh chụp nguồn (chọn được nhiều ảnh)
              </label>
              <div className="relative border border-dashed border-pink-300 rounded-xl p-4 bg-pink-50/40 hover:bg-pink-50/70 transition-colors text-center">
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(e) => { addImages(e.target.files); e.target.value = ''; }}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
                <UploadCloud className="w-6 h-6 text-pink-600 mx-auto mb-1.5" />
                <p className="text-xs font-semibold text-slate-800">Kéo thả hoặc chọn ảnh chụp nguồn</p>
                <p className="text-[11px] text-slate-500 mt-0.5">AI đọc chữ trong ảnh và coi đó là một phần của nguồn</p>
              </div>

              <div
                tabIndex={0}
                className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 px-4 py-3 text-center cursor-text transition-colors outline-none focus:border-[#A4145E] focus:bg-[#FDF2F7] hover:border-slate-400"
              >
                <div className="flex items-center justify-center gap-2 text-slate-600">
                  <ClipboardPaste className="w-4 h-4 text-[#A4145E]" />
                  <span className="text-xs font-semibold">Hoặc bấm vào ô này rồi Ctrl+V để dán ảnh</span>
                </div>
                <p className="text-[11px] text-slate-400 mt-0.5">Chụp màn hình xong dán thẳng vào, không cần lưu thành file</p>
              </div>

              {pastedCount > 0 && (
                <p className="text-[11px] font-semibold text-emerald-700">Đã dán {pastedCount} ảnh từ clipboard.</p>
              )}

              {images.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {images.map((img, i) => (
                    <div key={img.previewUrl} className="relative group">
                      <img src={img.previewUrl} alt="" className="w-16 h-16 object-cover rounded-lg border border-slate-200" />
                      <button
                        onClick={() => removeImage(i)}
                        className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-white border border-slate-300 text-slate-500 hover:text-pink-600 hover:border-pink-300 flex items-center justify-center shadow-sm"
                        title="Bỏ ảnh này"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Source preview */}
          <div className="min-w-0">
            {fileData ? (
              <div className="rounded-2xl border border-slate-200 overflow-hidden bg-white">
                {fileData.type === 'video' ? (
                  fileData.previewUrl && !fileData.fileUri ? (
                    <video src={fileData.previewUrl} controls className="w-full aspect-video object-contain bg-slate-950" />
                  ) : (
                    <div className="p-4 flex flex-col items-center justify-center bg-pink-50/50 text-pink-800 gap-2 text-center">
                      {fileData.previewUrl
                        ? <img src={fileData.previewUrl} alt="" className="w-full rounded-lg" />
                        : <Video className="w-8 h-8 text-pink-500" />}
                      <p className="font-bold text-slate-900 text-[13px]">Đã lấy được video nguồn</p>
                      <p className="text-[11px] text-slate-500 line-clamp-2">
                        {fileData.videoMeta?.title || fileData.url}
                      </p>
                    </div>
                  )
                ) : fileData.type === 'audio' ? (
                  <div className="p-4 flex flex-col items-center justify-center bg-pink-50/50 text-pink-800 gap-2 text-center">
                    <Music className="w-8 h-8 text-pink-500" />
                    <p className="font-bold text-slate-900 text-[13px]">Đã nạp file âm thanh</p>
                    <p className="text-[11px] text-slate-500 truncate max-w-full">{fileData.file?.name || 'File âm thanh'}</p>
                  </div>
                ) : fileData.type === 'url' ? (
                  <div className="p-4 flex flex-col items-center justify-center bg-pink-50/50 text-pink-800 gap-2 text-center">
                    <Globe className="w-8 h-8 text-pink-500" />
                    <p className="font-bold text-slate-900 text-[13px]">
                      {fileData.sourceText ? 'Đã đọc được nội dung trang' : 'Đã kết nối link nguồn'}
                    </p>
                    <p className="text-[11px] text-slate-500 break-all">{fileData.sourceTitle || fileData.url}</p>
                    {fileData.sourceText && (
                      <p className="text-[11px] text-slate-400">{fileData.sourceText.length.toLocaleString('vi-VN')} ký tự</p>
                    )}
                  </div>
                ) : (
                  <img src={fileData.previewUrl} alt="" className="w-full aspect-video object-contain bg-slate-950" />
                )}
                <button
                  onClick={handleClearSource}
                  className="w-full px-3 py-2 text-[11px] font-semibold text-slate-500 hover:text-pink-600 border-t border-slate-100 flex items-center justify-center gap-1.5"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Bỏ nguồn này
                </button>
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 p-5 text-center h-full flex flex-col items-center justify-center min-h-[180px]">
                <div className="w-11 h-11 rounded-xl bg-white border border-slate-200 flex items-center justify-center mb-2.5">
                  <Waves className="w-5 h-5 text-slate-400" strokeWidth={1.5} />
                </div>
                <p className="text-[13px] font-semibold text-slate-600">Chưa có nguồn</p>
                <p className="text-[11px] text-slate-400 mt-1 leading-snug">Link, video, text hoặc ảnh</p>
              </div>
            )}
          </div>
        </div>

        {notice && (
          <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-900">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
            <span className="leading-relaxed">{notice}</span>
          </div>
        )}
      </SectionCard>

      {/* ================= STEP 2: TUNING ================= */}
      <SectionCard n={2} title="Tùy chỉnh" hint="Số ý tưởng, kênh & mục tiêu">
        <div className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                <Waves className="w-3.5 h-3.5 text-[#A4145E]" /> Số ý tưởng tối đa
              </label>
              <select
                value={ideaCount}
                onChange={(e) => setIdeaCount(Number(e.target.value))}
                className="w-full bg-white border border-slate-200 text-slate-800 text-sm rounded-xl p-3 focus:border-[#A4145E] outline-none"
              >
                {IDEA_COUNTS.map((n) => <option key={n} value={n}>{n} ý tưởng</option>)}
              </select>
              <p className="text-[11px] text-slate-500">
                Đây là mức trần. Nguồn chỉ đủ chất liệu cho ít ý tưởng mạnh hơn thì AI trả về ít hơn thay vì bịa cho đủ.
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                <Target className="w-3.5 h-3.5 text-[#A4145E]" /> Mục tiêu nội dung
              </label>
              <select
                value={objective}
                onChange={(e) => setObjective(e.target.value as WaterfallObjective)}
                className="w-full bg-white border border-slate-200 text-slate-800 text-sm rounded-xl p-3 focus:border-[#A4145E] outline-none"
              >
                {(Object.keys(WATERFALL_OBJECTIVE_LABELS) as WaterfallObjective[]).map((o) => (
                  <option key={o} value={o}>{WATERFALL_OBJECTIVE_LABELS[o]}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
              <Share2 className="w-3.5 h-3.5 text-[#A4145E]" /> Kênh & định dạng ưu tiên (tùy chọn)
            </label>
            <input
              type="text"
              value={channels}
              onChange={(e) => setChannels(e.target.value)}
              placeholder="VD: TikTok, Facebook, carousel Instagram, newsletter..."
              className="w-full bg-white border border-slate-200 rounded-xl p-3 text-sm text-slate-800 focus:border-[#A4145E] outline-none placeholder:text-slate-400"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
              <FilePenLine className="w-3.5 h-3.5 text-[#A4145E]" /> Yêu cầu bổ sung (tùy chọn)
            </label>
            <textarea
              className="w-full bg-white border border-slate-200 rounded-xl p-3.5 text-sm text-slate-800 focus:border-[#A4145E] outline-none h-24 resize-none custom-scrollbar placeholder:text-slate-400"
              placeholder="VD: Tránh chủ đề giảm giá, ưu tiên góc dành cho người mới, không nhắc tới đối thủ..."
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
            />
          </div>

          <Button onClick={handleRun} disabled={running || fetching} className="w-full py-3.5 text-sm font-bold shadow-md">
            {running ? (
              <><Loader2 className="w-5 h-5 animate-spin" /> <span>Đang bung ý tưởng...</span></>
            ) : (
              <><Sparkles className="w-5 h-5" /> <span>Bung thác ý tưởng nội dung</span></>
            )}
          </Button>

          {error && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-800 text-xs flex items-start gap-3">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-500" />
              <div className="leading-relaxed">{error}</div>
            </div>
          )}
        </div>
      </SectionCard>

      {/* ================= STEP 3: RESULT ================= */}
      <div ref={resultRef}>
        <SectionCard
          n={3}
          title="Kết quả"
          hint={result ? `Áp dụng quy tắc: ${brand.name}` : 'Bản đồ cơ hội nội dung'}
          action={result ? (
            <div className="flex items-center flex-wrap gap-2 justify-end">
              <button
                onClick={handleOpenSheets}
                className="text-xs flex items-center gap-1.5 text-emerald-800 hover:text-emerald-900 bg-emerald-50 hover:bg-emerald-100 px-3 py-1.5 rounded-lg border border-emerald-300 transition-colors font-semibold"
                title="Mở Google Sheets mới và dán bảng ý tưởng (Ctrl+V)"
              >
                <Sheet className="w-3.5 h-3.5 text-emerald-600" />
                <span className="hidden sm:inline">Google Sheets</span>
              </button>
              <button
                onClick={() => exportToExcelCsv(result, `content-waterfall-${brandSlug}.csv`)}
                className="text-xs flex items-center gap-1.5 text-slate-700 hover:text-slate-900 bg-white hover:bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200 transition-colors font-medium"
                title="Tải file CSV mở được bằng Excel"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-slate-500" />
                <span className="hidden sm:inline">CSV</span>
              </button>
              <button
                onClick={handleExportTxt}
                className="text-xs flex items-center gap-1.5 text-slate-700 hover:text-slate-900 bg-white hover:bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200 transition-colors font-medium"
                title="Xuất file văn bản .txt"
              >
                <Download className="w-3.5 h-3.5 text-slate-500" />
                <span className="hidden sm:inline">.txt</span>
              </button>
              <button
                onClick={handleCopy}
                className="text-xs flex items-center gap-1.5 text-white bg-[#A4145E] hover:bg-[#86104D] px-3 py-1.5 rounded-lg font-semibold transition-colors"
              >
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? 'Đã copy' : 'Copy'}
              </button>
            </div>
          ) : undefined}
        >
          {running ? (
            <RunStatus message="Đang bóc tách nguồn và bung ý tưởng..." startedAt={startedAt} expectation={runExpectation} />
          ) : result ? (
            <>
              <div className="max-h-[720px] overflow-y-auto overflow-x-auto custom-scrollbar pr-1">
                <div className="analysis-output font-sans" dangerouslySetInnerHTML={{ __html: result }} />
              </div>
              <BookingNudge />
            </>
          ) : (
            <div className="py-14 text-center">
              <div className="w-14 h-14 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-center text-slate-400 mx-auto mb-3">
                <Waves className="w-6 h-6" strokeWidth={1.5} />
              </div>
              <p className="text-sm font-semibold text-slate-600">Chưa có ý tưởng nào</p>
              <p className="text-xs text-slate-400 mt-1">Nạp nguồn ở bước 1 rồi bấm bung thác ý tưởng.</p>
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
};
