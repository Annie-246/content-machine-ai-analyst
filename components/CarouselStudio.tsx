import React, { useEffect, useRef, useState } from 'react';
import {
  Images, Plus, Trash2, Loader2, Download, AlertCircle, Check,
  ChevronUp, ChevronDown, Wand2, Palette, LayoutTemplate, FileUp, FileText, Sparkles,
  FileArchive, ExternalLink, RefreshCw,
} from 'lucide-react';
import { CarouselDeck, CarouselKit, CarouselRhythm, CarouselSlide, CarouselLayout } from '../types';
import {
  listKits, saveKit, removeKit, emptyKit, newId, fileToDataUrl,
  getActiveKitId, setActiveKitId,
} from '../services/carouselStore';
import { buildCarouselHtml } from '../services/carouselHtml';
import { planLayouts, splitIntoSlides, refineDeck, reviseSlide, isRhythmOff } from '../services/carouselLayout';
import { BrandSource, readLocalFile, newSourceId } from '../services/brandLearnService';
import {
  extractGuidelineFromSources, joinGuidelineText, countFileOnlyGuidelines,
} from '../services/carouselGuidelineImport';
import { postJson } from '../services/apiClient';
// @ts-ignore - module .mjs viết tay, không có khai báo kiểu
import { zipFiles } from '../services/zip.mjs';

/**
 * Carousel Studio - dựng bộ ảnh 1080x1080 từ nội dung đã viết.
 *
 * Tách làm hai phần vì chúng đổi theo hai nhịp khác nhau: bộ nhận diện (nền,
 * font, màu) khai một lần rồi thôi, còn nội dung slide thì mỗi bài một khác.
 *
 * Ảnh được dựng bằng Chrome trên chính máy này, không gọi API tạo ảnh nào, nên
 * không tốn tiền và không phụ thuộc nhà cung cấp nào.
 */

// Cùng danh sách với phần nạp bộ tiêu chí: PDF đọc bằng model, còn lại là file chữ.
const GUIDELINE_ACCEPT = '.pdf,.txt,.md,.markdown,.csv,.tsv,.json,.html,.htm,.xml,.rtf,.log';

const emptySlide = (): CarouselSlide => ({
  id: newId('slide'),
  title: '',
  lead: '',
  bullets: [''],
  foot: '',
});

/**
 * Cú pháp dán nhanh, cố ý giữ tối giản để gõ tay được:
 *   `#` mỗi dòng tiêu đề · `>` câu dẫn · `-` gạch đầu dòng · `!` câu chốt
 *   `---` ngăn giữa hai slide
 */
const parseOutline = (text: string): CarouselSlide[] =>
  text
    .split(/^\s*---\s*$/m)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const slide = emptySlide();
      const titles: string[] = [];
      const bullets: string[] = [];

      for (const raw of block.split('\n')) {
        const line = raw.trim();
        if (!line) continue;
        if (line.startsWith('#')) titles.push(line.replace(/^#+\s*/, ''));
        else if (line.startsWith('>')) slide.lead = line.replace(/^>\s*/, '');
        else if (line.startsWith('-')) bullets.push(line.replace(/^-\s*/, ''));
        else if (line.startsWith('!')) slide.foot = line.replace(/^!\s*/, '');
        else if (!slide.lead) slide.lead = line;
        else bullets.push(line);
      }

      slide.title = titles.join('\n');
      slide.bullets = bullets.length ? bullets : [''];
      return slide;
    });

const LAYOUT_LABELS: Record<CarouselLayout, string> = {
  stack: 'chữ trên · ảnh dưới',
  side: 'chữ trái · ảnh phải',
  hero: 'ảnh lớn',
  grid: 'lưới ảnh',
};

/**
 * Ô chọn bố cục cho một slide. Trước đây bố cục chỉ hiện dưới dạng nhãn do AI
 * gán, người dùng không có chỗ nào để đổi - nên một slide bị AI xếp "chữ trái ·
 * ảnh phải" (cỡ chữ nhỏ hơn) thì đành chịu. Chọn "tự động" là quay về cách suy
 * ra từ số ảnh như cũ.
 */
const LayoutSelect: React.FC<{
  value?: CarouselLayout;
  onChange: (layout: CarouselLayout | undefined) => void;
  className?: string;
}> = ({ value, onChange, className = '' }) => (
  <select
    value={value || ''}
    onChange={(e) => onChange((e.target.value || undefined) as CarouselLayout | undefined)}
    title="Bố cục slide"
    className={`bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-700 focus:border-[#A4145E] outline-none transition-colors ${className}`}
  >
    <option value="">bố cục: tự động</option>
    {(Object.keys(LAYOUT_LABELS) as CarouselLayout[]).map((key) => (
      <option key={key} value={key}>{LAYOUT_LABELS[key]}</option>
    ))}
  </select>
);

/** Ảnh của một slide, gộp cả bộ cũ chỉ có một ảnh. */
type SlideImage = { dataUrl: string; name: string; align?: 'left' | 'center' | 'right' };

const slideImages = (slide: CarouselSlide): SlideImage[] => {
  if (slide.images?.length) return slide.images as SlideImage[];
  if (slide.imageDataUrl) return [{ dataUrl: slide.imageDataUrl, name: slide.imageName || 'ảnh' }];
  return [];
};

/** Nói trước cho người dùng biết lưới sẽ chia thế nào, khỏi phải dựng rồi mới thấy. */
const imageLayoutHint = (count: number): string => {
  if (count === 1) return 'một khung lớn';
  if (count === 2) return 'hai cột';
  if (count === 3) return 'ba cột';
  if (count === 4) return 'lưới 2×2';
  if (count <= 6) return 'lưới 3 cột';
  return 'lưới 4 cột';
};

const Field: React.FC<{ label: string; hint?: string; children: React.ReactNode }> = ({ label, hint, children }) => (
  <div className="space-y-1.5">
    <label className="text-xs font-semibold text-slate-700">{label}</label>
    {!!hint && <p className="text-xs text-slate-500">{hint}</p>}
    {children}
  </div>
);

const inputClass =
  'w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-800 focus:border-[#A4145E] outline-none transition-colors';

const ColorInput: React.FC<{ label: string; value: string; onChange: (v: string) => void }> = ({ label, value, onChange }) => (
  <div className="flex items-center gap-2.5">
    <input
      type="color"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-9 h-9 rounded-lg border border-slate-200 cursor-pointer shrink-0 bg-white"
    />
    <div className="min-w-0">
      <p className="text-xs font-semibold text-slate-700 truncate">{label}</p>
      <p className="text-[11px] text-slate-400 font-mono">{value}</p>
    </div>
  </div>
);

export const CarouselStudio: React.FC = () => {
  const [kits, setKits] = useState<CarouselKit[]>([]);
  const [kit, setKit] = useState<CarouselKit | null>(null);
  const [tab, setTab] = useState<'content' | 'kit'>('content');

  const [deck, setDeck] = useState<CarouselDeck>({ name: '', templateId: '', slides: [emptySlide()] });
  const [outline, setOutline] = useState('');

  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [slides, setSlides] = useState<string[]>([]);
  const [rhythm, setRhythm] = useState<CarouselRhythm[]>([]);
  // id của slide đứng sau từng ảnh đã dựng, để "dựng lại" tìm đúng slide kể cả
  // khi người dùng đã thêm, xoá hay đổi thứ tự slide trong phần soạn.
  const [renderedIds, setRenderedIds] = useState<string[]>([]);
  const [rerenderIndex, setRerenderIndex] = useState<number | null>(null);
  const [rerenderStep, setRerenderStep] = useState('');
  // Góp ý đang gõ và câu AI trả lời "đã sửa gì", theo id slide.
  const [feedbacks, setFeedbacks] = useState<Record<string, string>>({});
  const [slideNotes, setSlideNotes] = useState<Record<string, string>>({});

  const bgInputRef = useRef<HTMLInputElement>(null);
  const fontInputRef = useRef<HTMLInputElement>(null);
  const guideInputRef = useRef<HTMLInputElement>(null);

  // Tài liệu guideline đang nạp dở, chỉ sống trong phiên soạn - đọc xong rồi
  // thì thứ được giữ lại là quy tắc và màu, không phải file gốc.
  const [guideSources, setGuideSources] = useState<BrandSource[]>([]);
  const [extracting, setExtracting] = useState(false);
  const [guideError, setGuideError] = useState('');
  const [guideNote, setGuideNote] = useState('');

  const [splitting, setSplitting] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [zipping, setZipping] = useState(false);
  const [renderStep, setRenderStep] = useState('');
  const [aiNote, setAiNote] = useState('');

  useEffect(() => {
    listKits().then((all) => {
      setKits(all);
      const active = all.find((k) => k.id === getActiveKitId()) || all[0] || null;
      setKit(active);
      if (active?.templates[0]) setDeck((d) => ({ ...d, templateId: active.templates[0].id }));
    });
  }, []);

  const persist = async (next: CarouselKit) => {
    setKit(next);
    await saveKit(next);
    setKits(await listKits());
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2000);
  };

  const handleNewKit = async () => {
    const fresh = emptyKit();
    await persist(fresh);
    setActiveKitId(fresh.id);
    setTab('kit');
  };

  const handleAddBackgrounds = async (files: FileList) => {
    if (!kit) return;
    setError('');
    const added = [];
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image')) continue;
      added.push({
        id: newId('tpl'),
        name: file.name.replace(/\.[^.]+$/, ''),
        backgroundDataUrl: await fileToDataUrl(file),
      });
    }
    if (!added.length) return;
    const next = { ...kit, templates: [...kit.templates, ...added] };
    await persist(next);
    if (!deck.templateId) setDeck((d) => ({ ...d, templateId: added[0].id }));
  };

  const handleAddFonts = async (files: FileList) => {
    if (!kit) return;
    const added = [];
    for (const file of Array.from(files)) {
      // Tên họ chữ lấy từ tên file: Inter-Variable.ttf -> Inter
      const family = file.name.replace(/\.[^.]+$/, '').split(/[-_]/)[0];
      added.push({ family, dataUrl: await fileToDataUrl(file) });
    }
    if (added.length) await persist({ ...kit, fonts: [...kit.fonts, ...added] });
  };

  const upsertGuideSource = (source: BrandSource) =>
    setGuideSources((prev) => {
      const i = prev.findIndex((x) => x.id === source.id);
      if (i === -1) return [...prev, source];
      const next = [...prev];
      next[i] = source;
      return next;
    });

  const handleAddGuidelines = async (files: FileList) => {
    setGuideError('');
    setGuideNote('');
    for (const file of Array.from(files)) {
      const pending: BrandSource = { id: newSourceId(), kind: 'file', label: file.name, status: 'reading' };
      upsertGuideSource(pending);
      const done = await readLocalFile(file);
      upsertGuideSource({ ...done, id: pending.id });
    }
  };

  /** Chèn nguyên văn, dùng khi người dùng muốn tự biên tập thay vì nhờ model. */
  const handleInsertRawGuideline = () => {
    if (!kit) return;
    const text = joinGuidelineText(guideSources);
    if (!text) {
      setGuideError('Chưa có tài liệu chữ nào đọc được. File PDF cần dùng nút nhờ AI đọc.');
      return;
    }
    const current = kit.guideline.trim();
    persist({ ...kit, guideline: current ? `${current}

${text}` : text });
    setGuideNote('Đã chèn nguyên văn tài liệu vào ô quy tắc.');
  };

  const handleExtractGuideline = async () => {
    if (!kit) return;
    setGuideError('');
    setGuideNote('');
    setExtracting(true);
    try {
      const found = await extractGuidelineFromSources(guideSources);
      const current = kit.guideline.trim();

      // Màu nào tài liệu không nói tới thì giữ nguyên màu đang có, không ghi đè
      // bằng giá trị rỗng.
      const next: CarouselKit = {
        ...kit,
        guideline: found.guideline
          ? (current ? `${current}

${found.guideline}` : found.guideline)
          : kit.guideline,
        titleGradientFrom: found.titleGradientFrom || kit.titleGradientFrom,
        titleGradientTo: found.titleGradientTo || kit.titleGradientTo,
        accentColor: found.accentColor || kit.accentColor,
        bodyColor: found.bodyColor || kit.bodyColor,
        footColor: found.footColor || kit.footColor,
        ruleColor: found.ruleColor || kit.ruleColor,
        titleFont: found.titleFont || kit.titleFont,
        bodyFont: found.bodyFont || kit.bodyFont,
      };

      const filled = [
        found.titleGradientFrom || found.titleGradientTo ? 'gradient tiêu đề' : '',
        found.accentColor ? 'màu nhấn' : '',
        found.bodyColor ? 'màu chữ' : '',
        found.footColor ? 'màu câu chốt' : '',
        found.ruleColor ? 'màu gạch' : '',
        found.titleFont || found.bodyFont ? 'font' : '',
      ].filter(Boolean);

      await persist(next);
      setGuideNote(
        filled.length
          ? `Đã điền sẵn: ${filled.join(', ')}. Soát lại bên dưới rồi sửa nếu lệch.`
          : 'Đã rút quy tắc. Tài liệu không ghi mã màu nào nên phần màu giữ nguyên.',
      );
    } catch (err) {
      setGuideError((err as Error).message || 'Không đọc được tài liệu.');
    } finally {
      setExtracting(false);
    }
  };

  const handleAiSplit = async () => {
    if (!outline.trim()) return;
    setSplitting(true);
    setError('');
    setAiNote('');
    try {
      const rows = await splitIntoSlides(outline, kit || emptyKit());
      setDeck((d) => ({
        ...d,
        slides: rows.map((row) => ({
          ...emptySlide(),
          title: row.title,
          lead: row.lead,
          bullets: row.bullets.length ? row.bullets : [''],
          foot: row.foot,
        })),
      }));
      setAiNote(`AI đã tách thành ${rows.length} slide. Soát lại rồi thêm ảnh cho từng slide.`);
    } catch (err) {
      setError((err as Error).message || 'Không tách được slide.');
    } finally {
      setSplitting(false);
    }
  };

  const handleAiLayout = async () => {
    if (!kit) {
      setError('Chưa có bộ nhận diện nào.');
      return;
    }
    setPlanning(true);
    setError('');
    setAiNote('');
    try {
      const plans = await planLayouts(deck, kit);
      if (!plans.length) {
        setError('AI không đề xuất được bố cục nào.');
        return;
      }
      setDeck((d) => ({
        ...d,
        slides: d.slides.map((slide, i) => {
          const plan = plans.find((x) => x.index === i);
          if (!plan) return slide;
          return { ...slide, layout: plan.layout, layoutNote: plan.reason };
        }),
      }));
      const warnings = plans.filter((p) => p.warning);
      setAiNote(
        warnings.length
          ? `Đã dàn trang ${plans.length} slide. ${warnings.length} slide bị quá tải: `
            + warnings.map((w) => `slide ${w.index + 1} - ${w.warning}`).join('; ')
          : `Đã dàn trang ${plans.length} slide theo nội dung và ảnh của từng slide.`,
      );
    } catch (err) {
      setError((err as Error).message || 'Không dàn trang được.');
    } finally {
      setPlanning(false);
    }
  };

  const updateSlide = (id: string, patch: Partial<CarouselSlide>) =>
    setDeck((d) => ({ ...d, slides: d.slides.map((s) => (s.id === id ? { ...s, ...patch } : s)) }));

  const moveSlide = (index: number, delta: number) =>
    setDeck((d) => {
      const next = [...d.slides];
      const target = index + delta;
      if (target < 0 || target >= next.length) return d;
      [next[index], next[target]] = [next[target], next[index]];
      return { ...d, slides: next };
    });

  const handleRender = async () => {
    if (!kit) {
      setError('Chưa có bộ nhận diện nào. Sang tab Bộ nhận diện để tạo trước.');
      return;
    }
    if (!kit.templates.length) {
      setError('Bộ nhận diện chưa có nền nào. Tải ảnh nền 1080x1080 lên trước.');
      return;
    }
    const usable = deck.slides.filter((s) => s.title.trim() || s.lead?.trim() || s.bullets.some((b) => b.trim()));
    if (!usable.length) {
      setError('Chưa có slide nào có nội dung.');
      return;
    }

    setRendering(true);
    setError('');
    setSlides([]);
    setRhythm([]);
    setAiNote('');
    setSlideNotes({});

    // Dựng, đo, sửa, dựng lại - đúng cách làm tay: một bộ chỉ được giao khi mọi
    // slide đã vào nhịp. Không có vòng này thì slide tràn hay trống chân vẫn ra
    // và người dùng phải là người phát hiện.
    const MAX_ROUNDS = 3;
    let working = { ...deck, slides: usable };
    const changes: string[] = [];

    try {
      for (let round = 1; round <= MAX_ROUNDS; round++) {
        setRenderStep(round === 1 ? 'Đang dựng ảnh...' : `Đang dựng lại (vòng ${round})...`);

        const html = buildCarouselHtml(working, kit);
        const payload = await postJson<{ slides: string[]; rhythm: CarouselRhythm[] }>(
          '/api/carousel/render', { html },
        );
        const nextRhythm = payload.rhythm || [];
        setSlides(payload.slides || []);
        setRhythm(nextRhythm);
        setRenderedIds(working.slides.map((s) => s.id));
        setDeck(working);

        const off = nextRhythm.filter((r) => isRhythmOff(r.freeBottom)).length;
        if (!off || round === MAX_ROUNDS) {
          setAiNote(
            off
              ? `Còn ${off} slide chưa vào nhịp sau ${round} vòng sửa. Chỉnh tay phần còn lại nhé.`
              : changes.length
                ? `Mọi slide đã vào nhịp sau ${round} vòng. AI đã sửa: ${changes.join('; ')}.`
                : 'Mọi slide vào nhịp ngay từ lần dựng đầu.',
          );
          break;
        }

        setRenderStep(`${off} slide chưa vào nhịp, AI đang sửa...`);
        const fixes = await refineDeck(working, kit, nextRhythm);
        if (!fixes.length) {
          setAiNote(`Còn ${off} slide chưa vào nhịp mà AI không sửa được. Chỉnh tay nhé.`);
          break;
        }

        working = {
          ...working,
          slides: working.slides.map((slide, i) => {
            const fix = fixes.find((f) => f.index === i);
            if (!fix) return slide;
            changes.push(`slide ${i + 1} (${fix.change || 'đã chỉnh'})`);
            return {
              ...slide,
              layout: fix.layout || slide.layout,
              title: fix.title || slide.title,
              lead: fix.lead,
              bullets: fix.bullets.length ? fix.bullets : [''],
              foot: fix.foot,
            };
          }),
        };
      }
    } catch (err: any) {
      setError(err?.message || 'Không dựng được ảnh.');
    } finally {
      setRendering(false);
      setRenderStep('');
    }
  };

  /**
   * Dựng lại đúng một slide, không đụng các slide còn lại.
   *
   * Có góp ý: AI xem chính ảnh vừa dựng cùng số đo, sửa bố cục / cỡ ảnh / chữ
   * của slide theo góp ý, ghi bản sửa vào phần soạn rồi dựng lại. Không góp ý:
   * dựng đúng nội dung đang có trong phần soạn, không qua AI - dùng sau khi tự
   * đổi bố cục hay sửa chữ. Cả hai đường đều chỉ mất vài giây thay vì cả bộ.
   */
  const handleRerenderSlide = async (index: number) => {
    if (!kit || rendering || rerenderIndex != null) return;
    const found = deck.slides.find((s) => s.id === renderedIds[index]);
    if (!found) {
      setError(`Slide ${index + 1} không còn trong phần soạn nên không dựng lại được.`);
      return;
    }
    if (!(found.title.trim() || found.lead?.trim() || found.bullets.some((b) => b.trim()))) {
      setError(`Slide ${index + 1} chưa có nội dung để dựng.`);
      return;
    }
    const feedback = (feedbacks[found.id] || '').trim();

    setRerenderIndex(index);
    setError('');
    try {
      let working: CarouselSlide = found;
      let change = '';
      if (feedback) {
        setRerenderStep('AI đang xem ảnh và sửa theo góp ý...');
        const fix = await reviseSlide(found, kit, rhythm[index]?.freeBottom ?? null, feedback, slides[index]);
        working = { ...found, ...fix.patch };
        change = fix.change;
        updateSlide(found.id, fix.patch);
        setSlideNotes((all) => ({ ...all, [found.id]: change }));
        setFeedbacks((all) => ({ ...all, [found.id]: '' }));
      }

      setRerenderStep('Đang dựng lại...');
      const html = buildCarouselHtml({ ...deck, slides: [working] }, kit);
      const payload = await postJson<{ slides: string[]; rhythm: CarouselRhythm[] }>(
        '/api/carousel/render', { html },
      );
      const image = payload.slides?.[0];
      if (!image) throw new Error('Không nhận được ảnh dựng lại.');
      const measure = payload.rhythm?.[0] || { freeBottom: null };

      setSlides((all) => { const next = [...all]; next[index] = image; return next; });
      setRhythm((all) => { const next = [...all]; next[index] = measure; return next; });
      setAiNote(
        feedback
          ? `Slide ${index + 1}: AI đã sửa theo góp ý (${change}) và dựng lại. Chưa ưng thì góp ý tiếp.`
          : `Đã dựng lại slide ${index + 1} theo đúng nội dung đang soạn, không qua AI sửa.`,
      );
    } catch (err: any) {
      setError(err?.message || `Không dựng lại được slide ${index + 1}.`);
    } finally {
      setRerenderIndex(null);
      setRerenderStep('');
    }
  };

  /**
   * Gói cả bộ thành một file .zip để mang sang chỗ khác chỉnh.
   *
   * Canva không có đường nào cho web ngoài đẩy thẳng ảnh vào tài khoản người
   * dùng nếu chưa qua Connect API - thứ phải đăng ký ứng dụng và chờ duyệt. Nên
   * ở đây làm phần chắc chắn chạy: đóng gói sẵn, mở Canva, người dùng thả vào.
   */
  const handleDownloadZip = async () => {
    if (!slides.length) return;
    setZipping(true);
    setError('');
    try {
      const slug = (deck.name || 'carousel')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/đ/g, 'd')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'carousel';

      const files = slides.map((dataUrl, i) => {
        const base64 = dataUrl.split(',')[1] || '';
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let b = 0; b < binary.length; b += 1) bytes[b] = binary.charCodeAt(b);
        return { name: `${slug}-slide-${String(i + 1).padStart(2, '0')}.png`, data: bytes };
      });

      const blob = await zipFiles(files);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${slug}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      setError((err as Error).message || 'Không đóng gói được file zip.');
    } finally {
      setZipping(false);
    }
  };

  const download = (dataUrl: string, index: number) => {
    const link = document.createElement('a');
    link.href = dataUrl;
    const slug = (deck.name || 'carousel').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    link.download = `${slug || 'carousel'}-slide-${index + 1}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="max-w-5xl pb-10">
      <h1 className="text-[26px] sm:text-[40px] leading-tight font-bold text-slate-900">Carousel Studio</h1>
      <p className="mt-3 text-[15px] text-slate-600">
        Dựng bộ ảnh 1080×1080 từ nội dung đã viết. Ảnh được tạo bằng trình duyệt ngay trên máy này,
        không gọi API tạo ảnh nên không tốn phí.
      </p>

      {/* Chọn bộ nhận diện */}
      <div className="mt-6 flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[240px]">
          <Field label="Bộ nhận diện đang dùng">
            <select
              value={kit?.id || ''}
              onChange={(e) => {
                const found = kits.find((k) => k.id === e.target.value) || null;
                setKit(found);
                setActiveKitId(e.target.value);
                setDeck((d) => ({ ...d, templateId: found?.templates[0]?.id || '' }));
              }}
              className={inputClass}
            >
              {!kits.length && <option value="">(chưa có bộ nào)</option>}
              {kits.map((k) => (
                <option key={k.id} value={k.id}>{k.name}</option>
              ))}
            </select>
          </Field>
        </div>
        <button
          onClick={handleNewKit}
          className="px-5 py-3 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:border-[#A4145E] hover:text-[#A4145E] transition-colors"
        >
          <Plus className="w-4 h-4 inline -mt-0.5 mr-1" /> Bộ mới
        </button>
        {saved && (
          <span className="text-sm text-emerald-700 font-medium flex items-center gap-1.5 pb-3">
            <Check className="w-4 h-4" /> Đã lưu
          </span>
        )}
      </div>

      {/* Tab */}
      <div className="mt-6 flex gap-2 border-b border-slate-200">
        {([['content', 'Nội dung slide', LayoutTemplate], ['kit', 'Bộ nhận diện', Palette]] as const).map(
          ([id, label, Icon]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`inline-flex items-center gap-2 px-5 py-3 text-sm font-semibold border-b-2 -mb-px transition-colors
                ${tab === id ? 'border-[#A4145E] text-[#A4145E]' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
            >
              <Icon className="w-4 h-4" /> {label}
            </button>
          ),
        )}
      </div>

      {tab === 'kit' && kit && (
        <div className="mt-6 space-y-6">
          <Field label="Tên bộ nhận diện">
            <input
              value={kit.name}
              onChange={(e) => setKit({ ...kit, name: e.target.value })}
              onBlur={() => persist(kit)}
              className={inputClass}
            />
          </Field>

          {/* Nền */}
          <div className="rounded-2xl border border-slate-200 p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-bold text-slate-900">Nền carousel</p>
                <p className="mt-1 text-xs text-slate-500">
                  Ảnh 1080×1080 đã in sẵn logo và chân trang. Mỗi nền là một lựa chọn khi làm ảnh.
                </p>
              </div>
              <button
                onClick={() => bgInputRef.current?.click()}
                className="shrink-0 px-4 py-2.5 rounded-xl bg-[#A4145E] hover:bg-[#86104D] text-white text-[13px] font-semibold transition-colors"
              >
                Tải nền lên
              </button>
              <input
                ref={bgInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => e.target.files && handleAddBackgrounds(e.target.files)}
              />
            </div>

            {kit.templates.length ? (
              <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
                {kit.templates.map((t) => (
                  <div key={t.id} className="rounded-xl border border-slate-200 overflow-hidden">
                    <img src={t.backgroundDataUrl} alt={t.name} className="w-full aspect-square object-cover" />
                    <div className="p-2 flex items-center gap-1.5">
                      <input
                        value={t.name}
                        onChange={(e) =>
                          setKit({
                            ...kit,
                            templates: kit.templates.map((x) => (x.id === t.id ? { ...x, name: e.target.value } : x)),
                          })
                        }
                        onBlur={() => persist(kit)}
                        className="flex-1 min-w-0 text-xs px-2 py-1 rounded border border-slate-200 outline-none focus:border-[#A4145E]"
                      />
                      <button
                        onClick={() => persist({ ...kit, templates: kit.templates.filter((x) => x.id !== t.id) })}
                        className="p-1 text-slate-400 hover:text-red-600 transition-colors"
                        title="Xoá nền"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-4 text-sm text-slate-500">Chưa có nền nào.</p>
            )}
          </div>

          {/* Font */}
          <div className="rounded-2xl border border-slate-200 p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-bold text-slate-900">Font chữ</p>
                <p className="mt-1 text-xs text-slate-500">
                  Tải file .ttf/.woff2. Không có font riêng thì ảnh vẫn dựng được nhưng dùng font hệ thống,
                  chữ sẽ khác thiết kế gốc.
                </p>
              </div>
              <button
                onClick={() => fontInputRef.current?.click()}
                className="shrink-0 px-4 py-2.5 rounded-xl border border-slate-200 text-[13px] font-semibold text-slate-700 hover:border-[#A4145E] hover:text-[#A4145E] transition-colors"
              >
                Tải font
              </button>
              <input
                ref={fontInputRef}
                type="file"
                accept=".ttf,.otf,.woff,.woff2"
                multiple
                className="hidden"
                onChange={(e) => e.target.files && handleAddFonts(e.target.files)}
              />
            </div>

            {!!kit.fonts.length && (
              <div className="mt-3 flex flex-wrap gap-2">
                {kit.fonts.map((f, i) => (
                  <span key={i} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-100 text-xs font-medium text-slate-700">
                    {f.family}
                    <button
                      onClick={() => persist({ ...kit, fonts: kit.fonts.filter((_, x) => x !== i) })}
                      className="text-slate-400 hover:text-red-600"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            {/* Tên font phải khớp CHÍNH XÁC tên họ chữ suy ra từ file đã tải.
                Lệch một chữ là trình duyệt lặng lẽ rơi về font hệ thống, và ảnh
                ra khác thiết kế mà không có lỗi nào báo. */}
            {(() => {
              const loaded = kit.fonts.map((f) => f.family);
              const missing = [kit.titleFont, kit.bodyFont]
                .filter((name) => name && !loaded.includes(name));
              if (!missing.length) return null;
              return (
                <p className="mt-4 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>
                    Chưa có file font cho <b>{missing.join(', ')}</b>
                    {loaded.length ? <> — bộ này mới có {loaded.join(', ')}</> : ' — bộ này chưa có font nào'}.
                    Ảnh vẫn dựng được nhưng dùng font hệ thống, chữ sẽ khác thiết kế gốc.
                  </span>
                </p>
              );
            })()}

            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Font tiêu đề" hint={kit.fonts.length ? `Đã nạp: ${kit.fonts.map((f) => f.family).join(', ')}` : undefined}>
                <input
                  value={kit.titleFont}
                  onChange={(e) => setKit({ ...kit, titleFont: e.target.value })}
                  onBlur={() => persist(kit)}
                  list="cm-carousel-fonts"
                  className={inputClass}
                />
              </Field>
              <Field label="Font nội dung">
                <input
                  value={kit.bodyFont}
                  onChange={(e) => setKit({ ...kit, bodyFont: e.target.value })}
                  onBlur={() => persist(kit)}
                  list="cm-carousel-fonts"
                  className={inputClass}
                />
              </Field>
              <datalist id="cm-carousel-fonts">
                {kit.fonts.map((f, i) => <option key={i} value={f.family} />)}
              </datalist>
            </div>
          </div>

          {/* Màu */}
          <div className="rounded-2xl border border-slate-200 p-5">
            <p className="text-sm font-bold text-slate-900 mb-4">Màu sắc</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <ColorInput label="Gradient tiêu đề - đầu" value={kit.titleGradientFrom} onChange={(v) => persist({ ...kit, titleGradientFrom: v })} />
              <ColorInput label="Gradient tiêu đề - cuối" value={kit.titleGradientTo} onChange={(v) => persist({ ...kit, titleGradientTo: v })} />
              <ColorInput label="Màu nhấn (số)" value={kit.accentColor} onChange={(v) => persist({ ...kit, accentColor: v })} />
              <ColorInput label="Chữ nội dung" value={kit.bodyColor} onChange={(v) => persist({ ...kit, bodyColor: v })} />
              <ColorInput label="Câu chốt" value={kit.footColor} onChange={(v) => persist({ ...kit, footColor: v })} />
              <ColorInput label="Gạch dưới tiêu đề" value={kit.ruleColor} onChange={(v) => persist({ ...kit, ruleColor: v })} />
              <ColorInput label="Viền khung ảnh" value={kit.frameColor} onChange={(v) => persist({ ...kit, frameColor: v })} />
            </div>

            {/* Màu phụ do người dùng thêm. Sáu vai trò trên là cố định vì khung
                slide dùng đúng chừng đó; màu thương hiệu còn lại cất ở đây để
                lúc cần dán mã hex thì có chỗ tra, khỏi mở file guideline. */}
            <div className="mt-6 pt-5 border-t border-slate-200">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-bold text-slate-900">Màu phụ của thương hiệu</p>
                  <p className="mt-1 text-xs text-slate-500">
                    Những màu không nằm trong sáu vai trò trên. Lưu ở đây để tra nhanh khi cần.
                  </p>
                </div>
                <button
                  onClick={() =>
                    persist({
                      ...kit,
                      extraColors: [
                        ...(kit.extraColors || []),
                        { id: newId('col'), name: 'Màu mới', value: '#888888' },
                      ],
                    })
                  }
                  className="shrink-0 inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-slate-200 text-[13px] font-semibold text-slate-700 hover:border-[#A4145E] hover:text-[#A4145E] transition-colors"
                >
                  <Plus className="w-4 h-4" /> Thêm màu
                </button>
              </div>

              {!!(kit.extraColors || []).length && (
                <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {(kit.extraColors || []).map((color) => (
                    <div key={color.id} className="flex items-center gap-2.5 rounded-xl border border-slate-200 p-2.5">
                      <input
                        type="color"
                        value={color.value}
                        onChange={(e) =>
                          persist({
                            ...kit,
                            extraColors: (kit.extraColors || []).map((c) =>
                              c.id === color.id ? { ...c, value: e.target.value } : c),
                          })
                        }
                        className="w-9 h-9 rounded-lg border border-slate-200 cursor-pointer shrink-0 bg-white"
                      />
                      <div className="flex-1 min-w-0">
                        <input
                          value={color.name}
                          onChange={(e) =>
                            setKit({
                              ...kit,
                              extraColors: (kit.extraColors || []).map((c) =>
                                c.id === color.id ? { ...c, name: e.target.value } : c),
                            })
                          }
                          onBlur={() => persist(kit)}
                          className="w-full text-xs font-semibold text-slate-700 px-2 py-1 rounded border border-transparent hover:border-slate-200 focus:border-[#A4145E] outline-none"
                        />
                        <p className="px-2 text-[11px] text-slate-400 font-mono">{color.value}</p>
                      </div>
                      <button
                        onClick={() =>
                          persist({
                            ...kit,
                            extraColors: (kit.extraColors || []).filter((c) => c.id !== color.id),
                          })
                        }
                        className="shrink-0 p-2 text-slate-400 hover:text-red-600 transition-colors"
                        title={`Xoá ${color.name}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Quy tắc thiết kế */}
          <div className="rounded-2xl border border-slate-200 p-5 space-y-4">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="min-w-[220px] flex-1">
                <p className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <FileUp className="w-4 h-4 text-[#A4145E]" /> Quy tắc thiết kế
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Đã có file brand guideline rồi thì tải lên đây, khỏi gõ lại. Nhận PDF và file văn bản
                  (txt, md, csv, json, html). File Word cần lưu thành PDF trước.
                </p>
              </div>
              <button
                onClick={() => guideInputRef.current?.click()}
                className="shrink-0 px-4 py-2.5 rounded-xl bg-[#A4145E] hover:bg-[#86104D] text-white text-[13px] font-semibold transition-colors"
              >
                Tải tài liệu
              </button>
              <input
                ref={guideInputRef}
                type="file"
                accept={GUIDELINE_ACCEPT}
                multiple
                className="hidden"
                onChange={(e) => e.target.files && handleAddGuidelines(e.target.files)}
              />
            </div>

            {!!guideSources.length && (
              <div className="space-y-2">
                {guideSources.map((source) => (
                  <div key={source.id} className="flex items-center gap-2.5 text-sm">
                    <FileText className="w-4 h-4 text-slate-400 shrink-0" />
                    <span className="flex-1 min-w-0 truncate text-slate-700">{source.label}</span>
                    <span className="shrink-0 text-xs">
                      {source.status === 'reading' && <span className="text-slate-500">đang đọc...</span>}
                      {source.status === 'ready' && (
                        <span className="text-emerald-700 font-medium">
                          {source.text ? 'đọc được chữ' : 'gửi cho AI đọc'}
                        </span>
                      )}
                      {source.status === 'error' && (
                        <span className="text-red-700">{source.error || 'không đọc được'}</span>
                      )}
                    </span>
                    <button
                      onClick={() => setGuideSources((prev) => prev.filter((x) => x.id !== source.id))}
                      className="shrink-0 p-1 text-slate-400 hover:text-red-600 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}

                <div className="flex flex-wrap gap-2.5 pt-1">
                  <button
                    onClick={handleExtractGuideline}
                    disabled={extracting}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-700 disabled:bg-slate-300 text-white text-[13px] font-semibold transition-colors"
                  >
                    {extracting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                    {extracting ? 'Đang đọc tài liệu...' : 'Nhờ AI rút quy tắc & màu'}
                  </button>
                  <button
                    onClick={handleInsertRawGuideline}
                    className="px-5 py-2.5 rounded-xl border border-slate-200 text-[13px] font-semibold text-slate-700 hover:border-[#A4145E] hover:text-[#A4145E] transition-colors"
                  >
                    Chèn nguyên văn
                  </button>
                </div>

                {countFileOnlyGuidelines(guideSources) > 0 && (
                  <p className="text-xs text-slate-500">
                    {countFileOnlyGuidelines(guideSources)} file PDF chỉ đọc được bằng AI, nút “Chèn nguyên văn”
                    sẽ bỏ qua chúng.
                  </p>
                )}
              </div>
            )}

            {!!guideError && (
              <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> {guideError}
              </p>
            )}
            {!!guideNote && (
              <p className="text-sm text-emerald-700 flex items-start gap-2">
                <Check className="w-4 h-4 shrink-0 mt-0.5" /> {guideNote}
              </p>
            )}

            <Field label="Nội dung quy tắc" hint="Rút từ tài liệu xong vẫn sửa tay được ở đây.">
              <textarea
                value={kit.guideline}
                onChange={(e) => setKit({ ...kit, guideline: e.target.value })}
                onBlur={() => persist(kit)}
                rows={8}
                placeholder="Tải tài liệu lên rồi bấm “Nhờ AI rút quy tắc & màu”, hoặc gõ thẳng vào đây."
                className={inputClass + ' font-mono text-[13px] leading-relaxed'}
              />
            </Field>
          </div>

          <button
            onClick={() => { removeKit(kit.id).then(() => listKits().then((all) => { setKits(all); setKit(all[0] || null); })); }}
            className="text-sm text-slate-500 hover:text-red-600 transition-colors"
          >
            Xoá bộ nhận diện này
          </button>
        </div>
      )}

      {tab === 'kit' && !kit && (
        <p className="mt-6 text-sm text-slate-500">Chưa có bộ nhận diện nào. Bấm “Bộ mới” ở trên để tạo.</p>
      )}

      {tab === 'content' && (
        <div className="mt-6 space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Tên bộ ảnh">
              <input
                value={deck.name}
                onChange={(e) => setDeck({ ...deck, name: e.target.value })}
                placeholder="VD: BV12 - Bắt đầu bán hàng trên sàn"
                className={inputClass}
              />
            </Field>
            <Field label="Nền dùng cho bộ này">
              <select
                value={deck.templateId}
                onChange={(e) => setDeck({ ...deck, templateId: e.target.value })}
                className={inputClass}
              >
                {!kit?.templates.length && <option value="">(bộ nhận diện chưa có nền)</option>}
                {kit?.templates.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </Field>
          </div>

          {/* Dán nhanh */}
          <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-5">
            <p className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Wand2 className="w-4 h-4 text-[#A4145E]" /> Từ bài viết thành slide
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Dán nguyên bài viết vào đây rồi để AI tự chia. Nó đọc theo ý chứ không cắt theo độ dài,
              và slide nào không hợp gạch đầu dòng thì viết thành đoạn văn.
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Muốn tự chia tay thì dùng cú pháp: <code>#</code> dòng tiêu đề · <code>&gt;</code> câu dẫn ·{' '}
              <code>-</code> gạch đầu dòng · <code>!</code> câu chốt · <code>---</code> ngăn hai slide.
            </p>
            <textarea
              value={outline}
              onChange={(e) => setOutline(e.target.value)}
              rows={6}
              placeholder={'# BẮT ĐẦU BÁN HÀNG\n# TRÊN SÀN TỪ ĐÂU\n> Ba việc phải làm xong trước khi bật quảng cáo.\n- **Tối ưu sản phẩm:** ảnh bìa rõ USP.\n- **Giá cạnh tranh:** so với ba shop cùng ngành.\n! Set mãi không cắn tiền thì xem lại sản phẩm.\n---\n# SLIDE TIẾP THEO'}
              className={inputClass + ' mt-3 font-mono text-[13px] leading-relaxed'}
            />
            <div className="mt-3 flex flex-wrap gap-2.5">
              <button
                onClick={handleAiSplit}
                disabled={!outline.trim() || splitting}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#A4145E] hover:bg-[#86104D] disabled:bg-slate-200 disabled:text-slate-400 text-white text-[13px] font-semibold transition-colors"
              >
                {splitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                {splitting ? 'AI đang đọc bài...' : 'Nhờ AI tách slide'}
              </button>
              <button
                onClick={() => {
                  const parsed = parseOutline(outline);
                  if (parsed.length) setDeck((d) => ({ ...d, slides: parsed }));
                }}
                disabled={!outline.trim()}
                className="px-5 py-2.5 rounded-xl border border-slate-200 text-[13px] font-semibold text-slate-700 hover:border-[#A4145E] hover:text-[#A4145E] disabled:opacity-40 transition-colors"
              >
                Tách theo cú pháp
              </button>
            </div>
          </div>

          {/* Từng slide */}
          {deck.slides.map((slide, index) => (
            <div key={slide.id} className="rounded-2xl border border-slate-200 p-5 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-slate-900 flex flex-wrap items-center gap-2">
                    <span>Slide {index + 1}</span>
                    <LayoutSelect
                      value={slide.layout}
                      onChange={(layout) => updateSlide(slide.id, { layout, layoutNote: undefined })}
                    />
                  </p>
                  {!!slide.layoutNote && (
                    <p className="mt-0.5 text-xs text-slate-500">{slide.layoutNote}</p>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => moveSlide(index, -1)} disabled={index === 0} className="p-2 rounded-lg text-slate-400 hover:text-slate-800 disabled:opacity-30">
                    <ChevronUp className="w-4 h-4" />
                  </button>
                  <button onClick={() => moveSlide(index, 1)} disabled={index === deck.slides.length - 1} className="p-2 rounded-lg text-slate-400 hover:text-slate-800 disabled:opacity-30">
                    <ChevronDown className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setDeck((d) => ({ ...d, slides: d.slides.filter((s) => s.id !== slide.id) }))}
                    disabled={deck.slides.length === 1}
                    className="p-2 rounded-lg text-slate-400 hover:text-red-600 disabled:opacity-30"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <Field label="Tiêu đề" hint="Mỗi dòng một câu, xuống dòng để tách. Sẽ tự viết hoa.">
                <textarea
                  value={slide.title}
                  onChange={(e) => updateSlide(slide.id, { title: e.target.value })}
                  rows={2}
                  className={inputClass}
                />
              </Field>

              <Field label="Câu dẫn">
                <input value={slide.lead || ''} onChange={(e) => updateSlide(slide.id, { lead: e.target.value })} className={inputClass} />
              </Field>

              <Field label="Gạch đầu dòng" hint="Dùng **hai dấu sao** để in đậm.">
                <div className="space-y-2">
                  {slide.bullets.map((bullet, bi) => (
                    <div key={bi} className="flex gap-2">
                      <input
                        value={bullet}
                        onChange={(e) => {
                          const next = [...slide.bullets];
                          next[bi] = e.target.value;
                          updateSlide(slide.id, { bullets: next });
                        }}
                        className={inputClass}
                      />
                      <button
                        onClick={() => updateSlide(slide.id, { bullets: slide.bullets.filter((_, x) => x !== bi) })}
                        className="shrink-0 px-3 rounded-xl text-slate-400 hover:text-red-600"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={() => updateSlide(slide.id, { bullets: [...slide.bullets, ''] })}
                    className="text-sm font-semibold text-[#A4145E] hover:underline"
                  >
                    + Thêm dòng
                  </button>
                </div>
              </Field>

              <Field label="Câu chốt">
                <input value={slide.foot || ''} onChange={(e) => updateSlide(slide.id, { foot: e.target.value })} className={inputClass} />
              </Field>

              <Field
                label="Ảnh minh hoạ"
                hint="Chọn được nhiều ảnh một lúc. Khung tự chia chỗ và thu ảnh cho vừa, không cắt xén."
              >
                <div className="space-y-3">
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={async (e) => {
                      const files: File[] = Array.from(e.target.files || []);
                      if (!files.length) return;
                      const added: SlideImage[] = [];
                      for (const file of files) {
                        added.push({ dataUrl: await fileToDataUrl(file), name: file.name });
                      }
                      updateSlide(slide.id, { images: [...slideImages(slide), ...added] });
                      e.target.value = '';
                    }}
                    className="text-sm text-slate-600 file:mr-3 file:px-4 file:py-2 file:rounded-lg file:border-0 file:bg-slate-900 file:text-white file:text-xs file:font-semibold"
                  />

                  {!!slideImages(slide).length && (
                    <>
                      <div className="grid grid-cols-3 sm:grid-cols-5 gap-2.5">
                        {slideImages(slide).map((img, ii) => (
                          <div key={ii} className="relative group">
                            <img
                              src={img.dataUrl}
                              alt={img.name}
                              className="w-full aspect-square object-contain rounded-lg border border-slate-200 bg-white"
                            />
                            <button
                              onClick={() =>
                                updateSlide(slide.id, {
                                  images: slideImages(slide).filter((_, x) => x !== ii),
                                  imageDataUrl: undefined,
                                  imageName: undefined,
                                })
                              }
                              className="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full bg-white border border-slate-200 shadow-sm flex items-center justify-center text-slate-400 hover:text-red-600 hover:border-red-200 transition-colors"
                              title={`Bỏ ${img.name}`}
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>

                            {/* Vị trí riêng cho từng ảnh: trong một slide có ảnh
                                muốn dạt trái, ảnh khác lại muốn nằm giữa. */}
                            <div className="mt-1.5 flex gap-1">
                              {([['left', 'Trái'], ['center', 'Giữa'], ['right', 'Phải']] as const).map(
                                ([value, label]) => {
                                  const current = img.align || 'center';
                                  return (
                                    <button
                                      key={value}
                                      onClick={() =>
                                        updateSlide(slide.id, {
                                          images: slideImages(slide).map((x, k) =>
                                            k === ii ? { ...x, align: value } : x),
                                          imageDataUrl: undefined,
                                          imageName: undefined,
                                        })
                                      }
                                      className={`flex-1 py-1 rounded text-[10px] font-semibold border transition-colors
                                        ${current === value
                                          ? 'bg-[#A4145E] border-[#A4145E] text-white'
                                          : 'bg-white border-slate-200 text-slate-500 hover:border-[#A4145E] hover:text-[#A4145E]'}`}
                                    >
                                      {label}
                                    </button>
                                  );
                                },
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                      <p className="text-xs text-slate-500">
                        {slideImages(slide).length} ảnh — xếp {imageLayoutHint(slideImages(slide).length)}.
                      </p>
                    </>
                  )}
                </div>
              </Field>
            </div>
          ))}

          <button
            onClick={() => setDeck((d) => ({ ...d, slides: [...d.slides, emptySlide()] }))}
            className="w-full py-4 rounded-2xl border-2 border-dashed border-slate-300 text-slate-600 hover:border-[#A4145E] hover:text-[#A4145E] font-semibold transition-colors"
          >
            <Plus className="w-5 h-5 inline -mt-0.5 mr-1" /> Thêm slide
          </button>

          {!!error && (
            <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> {error}
            </p>
          )}

          {!!aiNote && (
            <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 flex items-start gap-2">
              <Check className="w-4 h-4 shrink-0 mt-0.5" /> {aiNote}
            </p>
          )}

          <button
            onClick={handleAiLayout}
            disabled={planning}
            className="w-full inline-flex items-center justify-center gap-2.5 px-8 py-3.5 rounded-2xl border-2 border-[#A4145E] text-[#A4145E] hover:bg-[#FDF2F7] disabled:opacity-40 font-bold transition-colors"
          >
            {planning ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5" />}
            {planning ? 'AI đang xem nội dung và ảnh...' : 'Nhờ AI dàn trang từng slide'}
          </button>

          <button
            onClick={handleRender}
            disabled={rendering}
            className="w-full inline-flex items-center justify-center gap-2.5 px-8 py-4 rounded-2xl bg-[#A4145E] hover:bg-[#86104D] disabled:bg-slate-300 text-white font-bold transition-colors"
          >
            {rendering ? <Loader2 className="w-5 h-5 animate-spin" /> : <Images className="w-5 h-5" />}
            {rendering ? (renderStep || 'Đang dựng ảnh...') : 'Dựng ảnh carousel'}
          </button>

          {!!slides.length && (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-4">
                <p className="text-lg font-bold text-slate-900">{slides.length} ảnh đã dựng</p>
                <div className="flex flex-wrap gap-2.5">
                  <button
                    onClick={() => slides.forEach((s, i) => window.setTimeout(() => download(s, i), i * 250))}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-700 text-white text-sm font-semibold transition-colors"
                  >
                    <Download className="w-4 h-4" /> Tải từng ảnh
                  </button>
                  <button
                    onClick={handleDownloadZip}
                    disabled={zipping}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#A4145E] hover:bg-[#86104D] disabled:bg-slate-300 text-white text-sm font-semibold transition-colors"
                  >
                    {zipping ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileArchive className="w-4 h-4" />}
                    {zipping ? 'Đang gói...' : 'Tải .zip để mang sang Canva'}
                  </button>
                  <button
                    onClick={() => window.open('https://www.canva.com/design/play?type=TACQ-nBxfxk', '_blank', 'noopener,noreferrer')}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:border-[#A4145E] hover:text-[#A4145E] transition-colors"
                  >
                    <ExternalLink className="w-4 h-4" /> Mở Canva
                  </button>
                </div>
              </div>

              <p className="text-xs text-slate-500">
                Canva không cho phép đẩy thẳng ảnh từ ứng dụng khác vào tài khoản của bạn, nên cách
                nhanh nhất là tải .zip rồi giải nén và kéo cả loạt vào Canva.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {slides.map((src, i) => {
                  const free = rhythm[i]?.freeBottom;
                  // Đích của bộ quy tắc là 0..60: dư nhiều nghĩa là slide trống
                  // chân, âm nghĩa là nội dung tràn ra ngoài khung.
                  const tone =
                    free == null ? 'text-slate-400'
                      : free < 0 ? 'text-red-700 font-semibold'
                        : free <= 60 ? 'text-emerald-700 font-semibold'
                          : 'text-amber-700';
                  // Slide đang đứng sau ảnh này trong phần soạn; mất là do đã bị xoá.
                  const live = deck.slides.find((s) => s.id === renderedIds[i]);
                  const busy = rendering || rerenderIndex != null;
                  return (
                    <div key={i} className="rounded-2xl border border-slate-200 overflow-hidden">
                      <div className="relative">
                        <img src={src} alt={`Slide ${i + 1}`} className="w-full aspect-square object-cover bg-slate-50" />
                        {rerenderIndex === i && (
                          <div className="absolute inset-0 bg-white/75 flex flex-col items-center justify-center gap-2">
                            <Loader2 className="w-8 h-8 animate-spin text-[#A4145E]" />
                            {!!rerenderStep && <p className="text-xs font-semibold text-[#A4145E]">{rerenderStep}</p>}
                          </div>
                        )}
                      </div>
                      <div className="p-3 space-y-2.5">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-slate-900">Slide {i + 1}</p>
                            <p className={`text-xs ${tone}`}>
                              {free == null ? 'không đo được'
                                : free < 0 ? `tràn ${Math.abs(free)}px — cắt bớt chữ`
                                  : free <= 60 ? `nhịp đẹp (dư ${free}px)`
                                    : `trống chân ${free}px — thêm nội dung hoặc phóng ảnh`}
                            </p>
                          </div>
                          <button
                            onClick={() => download(src, i)}
                            title="Tải ảnh này"
                            className="shrink-0 p-2.5 rounded-lg border border-slate-200 text-slate-600 hover:border-[#A4145E] hover:text-[#A4145E] transition-colors"
                          >
                            <Download className="w-4 h-4" />
                          </button>
                        </div>
                        {live ? (
                          <div className="space-y-2">
                            {!!slideNotes[live.id] && (
                              <p className="text-xs text-[#A4145E]">AI đã sửa: {slideNotes[live.id]}</p>
                            )}
                            <LayoutSelect
                              value={live.layout}
                              onChange={(layout) => updateSlide(live.id, { layout, layoutNote: undefined })}
                              className="w-full"
                            />
                            <div className="flex items-center gap-2">
                              <input
                                value={feedbacks[live.id] || ''}
                                onChange={(e) => setFeedbacks((all) => ({ ...all, [live.id]: e.target.value }))}
                                onKeyDown={(e) => { if (e.key === 'Enter' && !busy) handleRerenderSlide(i); }}
                                placeholder="Góp ý cho AI: vd. tiêu đề nhỏ quá, ảnh lấn chữ, trống dưới..."
                                className="flex-1 min-w-0 bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-800 focus:border-[#A4145E] outline-none transition-colors"
                              />
                              <button
                                onClick={() => handleRerenderSlide(i)}
                                disabled={busy}
                                title={feedbacks[live.id]?.trim()
                                  ? 'AI xem ảnh này, sửa theo góp ý rồi dựng lại'
                                  : 'Dựng lại riêng ảnh này theo nội dung đang soạn, không qua AI'}
                                className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#A4145E] text-xs font-semibold text-[#A4145E] hover:bg-[#FDF2F7] disabled:opacity-40 transition-colors"
                              >
                                {rerenderIndex === i
                                  ? <Loader2 className="w-4 h-4 animate-spin" />
                                  : feedbacks[live.id]?.trim() ? <Sparkles className="w-4 h-4" /> : <RefreshCw className="w-4 h-4" />}
                                {feedbacks[live.id]?.trim() ? 'AI sửa & dựng lại' : 'Dựng lại'}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <p className="text-xs text-slate-400">Slide này đã bị xoá khỏi phần soạn.</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
