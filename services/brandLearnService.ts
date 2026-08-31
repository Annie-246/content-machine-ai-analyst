import { BrandProfile } from '../types';
import { getGeminiApiKey, loadProviderSettings, resolveProvider } from './apiKeyStore';
import { postJson } from './apiClient';

// The Brand DNA fields the AI is allowed to propose. Only `id` stays out - it is
// internal. The name is proposed too, but the modal puts it in an editable box
// rather than a checkbox, since the user always has the final say on it.
export const LEARNABLE_FIELDS = [
  'name',
  'industry',
  'tagline',
  'targetAudience',
  'speakerPersona',
  'addressingSpeaker',
  'addressingAudience',
  'brandVoiceTone',
  'coreUSPs',
  'callToAction',
  'forbiddenKeywords',
  'customNotes',
  'footerBlock',
  'hashtags',
] as const;

export type LearnableField = (typeof LEARNABLE_FIELDS)[number];

export const FIELD_LABELS: Record<LearnableField, string> = {
  name: 'Tên thương hiệu',
  industry: 'Ngành hàng & lĩnh vực',
  tagline: 'Slogan / khẩu hiệu',
  targetAudience: 'Khách hàng mục tiêu & insight',
  speakerPersona: 'Hình tượng người nói',
  addressingSpeaker: 'Người nói xưng là',
  addressingAudience: 'Khán giả gọi là',
  brandVoiceTone: 'Giọng văn & sắc thái',
  coreUSPs: 'Điểm cốt lõi / lợi thế (USP)',
  callToAction: 'Lời kêu gọi hành động (CTA)',
  forbiddenKeywords: 'Điều cấm kỵ & từ không dùng',
  customNotes: 'Ghi chú riêng',
  footerBlock: 'Khối footer cố định',
  hashtags: 'Bộ hashtag mặc định',
};

export type SourceStatus = 'pending' | 'reading' | 'ready' | 'error';

export interface BrandSource {
  id: string;
  kind: 'link' | 'file' | 'text';
  label: string;
  status: SourceStatus;
  error?: string;
  // Set when a source was read but the platform held part of it back.
  note?: string;
  // Textual sources arrive as text; PDFs go to the model as raw bytes.
  text?: string;
  base64?: string;
  mimeType?: string;
}

export interface FieldSuggestion {
  value: string;
  evidence: string;
}

export interface BrandDnaSuggestion {
  fields: Partial<Record<LearnableField, FieldSuggestion>>;
  summary: string;
  gaps: string[];
}

const MAX_FILE_BYTES = 12 * 1024 * 1024;
const MAX_TEXT_CHARS = 40_000;
const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|html?|xml|srt|vtt|log|rtf)$/i;

export const newSourceId = (): string =>
  `src_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(new Error('Không đọc được file.'));
    reader.readAsDataURL(file);
  });

// Turns one picked file into something the model can read, or explains why it cannot.
export const readLocalFile = async (file: File): Promise<BrandSource> => {
  const base: BrandSource = { id: newSourceId(), kind: 'file', label: file.name, status: 'reading' };

  if (file.size > MAX_FILE_BYTES) {
    return { ...base, status: 'error', error: `File nặng ${Math.round(file.size / 1024 / 1024)}MB, vượt giới hạn 12MB.` };
  }

  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  if (isPdf) {
    try {
      return { ...base, status: 'ready', base64: await fileToBase64(file), mimeType: 'application/pdf' };
    } catch (err) {
      return { ...base, status: 'error', error: (err as Error).message };
    }
  }

  if (/\.(docx?|pptx?|xlsx?|pages|key)$/i.test(file.name)) {
    return {
      ...base,
      status: 'error',
      error: 'Chưa đọc được file Office. Hãy lưu thành PDF (File ▸ Xuất ▸ PDF) rồi tải lại.',
    };
  }

  if (!TEXT_EXT.test(file.name) && !file.type.startsWith('text/')) {
    return { ...base, status: 'error', error: 'Định dạng này không đọc được. Nhận PDF hoặc file văn bản (txt, md, csv, json, html).' };
  }

  const text = (await file.text()).trim();
  if (text.length < 30) {
    return { ...base, status: 'error', error: 'File gần như không có nội dung.' };
  }
  return { ...base, status: 'ready', text: `NGUỒN: file "${file.name}"\n\n${text}`.slice(0, MAX_TEXT_CHARS) };
};

// Websites and social links are read on the server, which has no CORS limits and
// can fall back to yt-dlp for platforms that render in the browser.
export const readLink = async (url: string): Promise<BrandSource> => {
  const base: BrandSource = { id: newSourceId(), kind: 'link', label: url, status: 'reading' };
  try {
    const payload = await postJson<{ kind: string; title: string; text?: string; base64?: string; mimeType?: string; note?: string }>(
      '/api/fetch-source',
      { url },
    );
    if (payload.base64) {
      return { ...base, status: 'ready', label: payload.title || url, base64: payload.base64, mimeType: payload.mimeType || 'application/pdf' };
    }
    return { ...base, status: 'ready', label: payload.title || url, text: payload.text || '', note: payload.note };
  } catch (err) {
    return { ...base, status: 'error', error: (err as Error).message };
  }
};

export const makeTextSource = (text: string, label = 'Nội dung dán vào'): BrandSource => ({
  id: newSourceId(),
  kind: 'text',
  label,
  status: 'ready',
  text: `NGUỒN: ${label}\n\n${text.trim()}`.slice(0, MAX_TEXT_CHARS),
});

const SYSTEM_INSTRUCTION = `Bạn là chuyên gia chiến lược thương hiệu, chuyên xây dựng Brand Guidelines cho đội ngũ sản xuất nội dung tại Việt Nam.

Nhiệm vụ: đọc các tài liệu thật của thương hiệu (website, bài đăng mạng xã hội, hồ sơ năng lực, tài liệu nội bộ) rồi đề xuất nội dung cho từng trường trong Bộ Quy Tắc Thương Hiệu.

NGUYÊN TẮC BẮT BUỘC:
1. CHỈ dựa trên tài liệu được cung cấp. TUYỆT ĐỐI KHÔNG bịa thông tin, số liệu, giải thưởng hay cam kết mà tài liệu không nói tới.
2. Nếu tài liệu không đủ căn cứ cho một trường, BỎ HẲN trường đó khỏi kết quả và ghi tên trường vào mảng "gaps". Thà thiếu còn hơn đoán.
3. Trường "evidence" phải nêu rõ căn cứ, kèm trích dẫn ngắn nguyên văn từ tài liệu khi có.
4. Viết bằng tiếng Việt tự nhiên, súc tích, đúng văn phong người Việt dùng hằng ngày.
5. Với addressingSpeaker và addressingAudience: chỉ điền khi tài liệu thực sự cho thấy cách xưng hô đang dùng (ví dụ thấy "shop", "bên mình", "các nàng"...). Trả về đúng từ xưng hô, không giải thích.
6. Với forbiddenKeywords: nêu điều thương hiệu tránh, suy ra từ những gì tài liệu KHÔNG bao giờ nói hoặc nói rõ là không làm. Nếu không có căn cứ thì bỏ trường này.
7. Với hashtags: chỉ lấy hashtag thật sự xuất hiện trong tài liệu.
8. Với footerBlock: chỉ lấy khi tài liệu có khối thông tin liên hệ lặp lại ở cuối các bài đăng.
9. Nếu Brand DNA hiện tại đã có nội dung cho một trường, chỉ đề xuất thay khi tài liệu cho thấy nội dung cụ thể hơn hoặc chính xác hơn. Trường đang trống là ưu tiên số một.
10. Với name: điền tên thương hiệu / tên kênh / tên tài khoản đúng như tài liệu ghi. Chỉ lấy tên, không kèm slogan hay mô tả. Nếu tài liệu không nêu tên rõ ràng thì bỏ trường này.

Trả về DUY NHẤT một object JSON, không kèm lời dẫn, không kèm dấu markdown:
{
  "fields": {
    "<tên trường>": { "value": "<nội dung đề xuất>", "evidence": "<căn cứ ngắn gọn từ tài liệu>" }
  },
  "summary": "<2-3 câu tóm tắt bạn hiểu gì về thương hiệu này>",
  "gaps": ["<tên trường thiếu căn cứ>", "..."]
}

Tên trường hợp lệ: ${LEARNABLE_FIELDS.join(', ')}. Không tạo thêm trường nào khác.`;

const describeCurrentBrand = (brand: BrandProfile): string => {
  const rows = LEARNABLE_FIELDS.map((key) => {
    const value = (brand[key] || '').toString().trim();
    return `- ${key} (${FIELD_LABELS[key]}): ${value ? `"${value}"` : '[ĐANG TRỐNG - ưu tiên đề xuất]'}`;
  });
  return `BRAND DNA HIỆN TẠI:\n${rows.join('\n')}`;
};

// The model sometimes wraps JSON in prose or a code fence even when asked not to.
const parseSuggestion = (raw: string): BrandDnaSuggestion => {
  let text = raw.trim();
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) {
    throw new Error('AI không trả về dữ liệu đúng định dạng. Thử lại hoặc bớt bớt nguồn.');
  }

  let parsed: any;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error('AI trả về JSON hỏng. Bấm phân tích lại.');
  }

  const fields: Partial<Record<LearnableField, FieldSuggestion>> = {};
  for (const key of LEARNABLE_FIELDS) {
    const entry = parsed?.fields?.[key];
    const value = typeof entry === 'string' ? entry : entry?.value;
    if (typeof value !== 'string' || !value.trim()) continue;
    fields[key] = { value: value.trim(), evidence: String(entry?.evidence || '').trim() };
  }

  return {
    fields,
    summary: String(parsed?.summary || '').trim(),
    gaps: Array.isArray(parsed?.gaps) ? parsed.gaps.map(String) : [],
  };
};

export const learnBrandDna = async (
  sources: BrandSource[],
  brand: BrandProfile,
): Promise<BrandDnaSuggestion> => {
  const ready = sources.filter((s) => s.status === 'ready' && (s.text || s.base64));
  if (!ready.length) throw new Error('Chưa có nguồn nào đọc được.');

  const parts: any[] = [];
  const textBlocks: string[] = [];

  ready.forEach((source, i) => {
    if (source.base64) {
      parts.push({ inlineData: { data: source.base64, mimeType: source.mimeType || 'application/pdf' } });
      textBlocks.push(`### TÀI LIỆU ${i + 1}: ${source.label} (xem file đính kèm)`);
    } else {
      textBlocks.push(`### TÀI LIỆU ${i + 1}: ${source.label}\n${source.text}`);
    }
  });

  const prompt = `${describeCurrentBrand(brand)}

=======================================================
TÀI LIỆU THẬT CỦA THƯƠNG HIỆU (${ready.length} nguồn)
=======================================================
${textBlocks.join('\n\n')}
=======================================================

Hãy phân tích và trả về JSON theo đúng cấu trúc đã quy định.`;

  // A PDF has to go to Gemini - it is the only provider wired up here that reads
  // files. Text-only work follows whichever provider the user assigned.
  const hasFile = ready.some((s) => !!s.base64);
  const routed = resolveProvider('text');

  if (!hasFile && routed.id !== 'gemini') {
    const payload = await postJson<{ text: string }>('/api/llm', {
      provider: routed.id,
      apiKey: routed.apiKey,
      model: routed.model,
      system: SYSTEM_INSTRUCTION,
      prompt,
    });
    return parseSuggestion(payload.text);
  }

  const payload = await postJson<{ text: string }>('/api/gemini', {
    apiKey: getGeminiApiKey(),
    parts: [...parts, { text: prompt }],
    systemInstruction: SYSTEM_INSTRUCTION,
    temperature: 0.3,
    responseJson: true,
  });

  return parseSuggestion(payload.text);
};

// Which provider's quota this run will spend, so the user knows before pressing go.
export const describeBilling = (hasFile: boolean): string => {
  const routed = resolveProvider('text');
  // A PDF forces the Gemini route regardless of who handles plain text.
  if (!hasFile && routed.id !== 'gemini') return `${routed.name} - key của bạn`;
  const ownKey = (loadProviderSettings().keys.gemini || '').trim();
  return ownKey
    ? 'Google Gemini - key của bạn (gói miễn phí dùng được)'
    : 'Google Gemini - chưa dán key riêng, vào mục Tích hợp để thêm';
};
