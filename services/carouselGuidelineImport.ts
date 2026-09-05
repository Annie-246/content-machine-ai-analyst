import { BrandSource } from './brandLearnService';
import { getGeminiApiKey, resolveProvider } from './apiKeyStore';
import { postJson } from './apiClient';

// Nạp quy tắc thiết kế từ tài liệu có sẵn.
//
// Khác với bên chấm điểm ở một điểm quan trọng: file brand guideline nào cũng có
// bảng màu, mà bắt người dùng soi từng mã hex rồi gõ lại vào sáu ô chọn màu là
// việc buồn ngủ nhất trong cả quy trình. Nên ở đây rút luôn cả màu, trả về dạng
// có cấu trúc để điền thẳng vào bộ nhận diện.

const SYSTEM_INSTRUCTION = `Bạn là trợ lý thiết kế, chuyên đọc tài liệu brand guideline và rút ra hai thứ: bộ quy tắc thiết kế, và bảng màu.

Nguyên tắc:
- Chỉ lấy những gì tài liệu thật sự nói. KHÔNG tự nghĩ ra quy tắc hay mã màu mà tài liệu không có.
- Mã màu phải là mã hex đúng như tài liệu ghi. Nếu tài liệu ghi màu bằng RGB hay CMYK thì quy đổi sang hex.
- Nếu tài liệu không nói tới một vai trò màu nào đó, để trống trường đó, KHÔNG đoán bừa.
- Phần quy tắc: viết thành gạch đầu dòng ngắn gọn, mỗi dòng một quy tắc kiểm được. Gộp ý trùng, bỏ lời dẫn nhập.
- Giữ nguyên ngôn ngữ của tài liệu.

Trả về DUY NHẤT một object JSON, không kèm giải thích, không bọc trong markdown:
{
  "guideline": "chuỗi quy tắc, mỗi dòng một ý",
  "titleGradientFrom": "#RRGGBB hoặc chuỗi rỗng",
  "titleGradientTo": "#RRGGBB hoặc chuỗi rỗng",
  "accentColor": "#RRGGBB hoặc chuỗi rỗng",
  "bodyColor": "#RRGGBB hoặc chuỗi rỗng",
  "footColor": "#RRGGBB hoặc chuỗi rỗng",
  "ruleColor": "#RRGGBB hoặc chuỗi rỗng",
  "titleFont": "tên font tiêu đề hoặc chuỗi rỗng",
  "bodyFont": "tên font nội dung hoặc chuỗi rỗng"
}

Ý nghĩa từng vai trò màu - ĐỌC KỸ, hai vai trò accentColor và footColor rất dễ bị đổi chỗ cho nhau:
- titleGradientFrom / titleGradientTo: hai đầu dải chuyển sắc của tiêu đề lớn. Tài liệu chỉ có một màu tiêu đề thì điền cùng một mã vào cả hai.
- accentColor: màu của SỐ THỨ TỰ và SỐ LIỆU trong phần thân (kiểu "01.", "02.", con số nổi bật). Thường cùng tông với tiêu đề. ĐÂY KHÔNG PHẢI màu cảnh báo.
- bodyColor: màu chữ nội dung thường.
- footColor: màu của CÂU CHỐT ở cuối slide, cũng là màu tài liệu dành cho cảnh báo, lỗi, kết luận. Thường là màu đỏ hoặc màu nóng. Tài liệu nào nói "màu X dùng cho cảnh báo / câu kết luận" thì X thuộc về đây, KHÔNG phải accentColor.
- ruleColor: màu gạch trang trí dưới tiêu đề.`;

export interface GuidelineExtract {
  guideline: string;
  titleGradientFrom?: string;
  titleGradientTo?: string;
  accentColor?: string;
  bodyColor?: string;
  footColor?: string;
  ruleColor?: string;
  titleFont?: string;
  bodyFont?: string;
}

/** Nối nguyên văn phần chữ của tài liệu, dùng khi người dùng muốn tự biên tập. */
export const joinGuidelineText = (sources: BrandSource[]): string =>
  sources
    .filter((s) => s.status === 'ready' && s.text)
    .map((s) => `# ${s.label}\n${(s.text || '').trim()}`)
    .join('\n\n');

/** Số tài liệu chỉ đọc được bằng model - PDF gửi sang dạng bytes. */
export const countFileOnlyGuidelines = (sources: BrandSource[]): number =>
  sources.filter((s) => s.status === 'ready' && !s.text && s.base64).length;

const HEX = /^#[0-9a-fA-F]{6}$/;

// Tài liệu hay ghi font kèm độ đậm - "Inter Bold 700", "Mulish Regular 400".
// Dùng nguyên chuỗi đó làm font-family thì không khớp @font-face nào và chữ rơi
// về Arial, nên cắt lấy đúng tên họ chữ.
const FONT_NOISE = /(thin|extra ?light|ultra ?light|light|regular|book|normal|medium|semi ?bold|demi ?bold|bold|extra ?bold|ultra ?bold|black|heavy|italic|oblique|variable|vf)/gi;

const cleanFontFamily = (value: unknown): string | undefined => {
  const text = String(value || '')
    // Có tài liệu ghi thẳng tên file thay vì tên họ chữ.
    .replace(/\.(ttf|otf|woff2?|eot)/gi, ' ')
    .replace(FONT_NOISE, ' ')
    .replace(/[0-9]+/g, ' ')
    .replace(/[,/|].*$/, '')
    .replace(/\s+/g, ' ')
    // "Inter-Variable" sau khi bỏ chữ Variable còn lại dấu nối lửng.
    .replace(/^[-_\s]+|[-_\s]+$/g, '')
    .trim();
  return text || undefined;
};

/** Bỏ mọi mã màu không hợp lệ, để một câu trả lời hỏng không làm loạn bộ nhận diện. */
const cleanHex = (value: unknown): string | undefined => {
  const text = String(value || '').trim();
  return HEX.test(text) ? text.toUpperCase() : undefined;
};

/**
 * Nhờ model đọc tài liệu rồi rút ra quy tắc thiết kế kèm bảng màu.
 * PDF bắt buộc đi đường Gemini vì đó là nhà cung cấp duy nhất ở đây đọc được file.
 */
export const extractGuidelineFromSources = async (sources: BrandSource[]): Promise<GuidelineExtract> => {
  const ready = sources.filter((s) => s.status === 'ready' && (s.text || s.base64));
  if (!ready.length) throw new Error('Chưa có tài liệu nào đọc được.');

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

  const prompt = `=======================================================
TÀI LIỆU NGƯỜI DÙNG CUNG CẤP (${ready.length} nguồn)
=======================================================
${textBlocks.join('\n\n')}
=======================================================

Rút quy tắc thiết kế và bảng màu trong các tài liệu trên. Trả về đúng một object JSON theo cấu trúc đã mô tả.`;

  const hasFile = ready.some((s) => !!s.base64);
  const routed = resolveProvider('text');

  let raw = '';
  if (!hasFile && routed.id !== 'gemini') {
    const payload = await postJson<{ text: string }>('/api/llm', {
      provider: routed.id,
      apiKey: routed.apiKey,
      model: routed.model,
      system: SYSTEM_INSTRUCTION,
      prompt,
    });
    raw = payload.text || '';
  } else {
    const payload = await postJson<{ text: string }>('/api/gemini', {
      apiKey: getGeminiApiKey(),
      parts: [...parts, { text: prompt }],
      systemInstruction: SYSTEM_INSTRUCTION,
      temperature: 0.2,
      responseJson: true,
    });
    raw = payload.text || '';
  }

  // Model thỉnh thoảng vẫn bọc JSON trong ```json dù đã dặn, nên gỡ trước khi parse.
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();

  let parsed: any;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Không parse được thì vẫn còn dùng được phần chữ: đưa nguyên văn vào ô quy
    // tắc còn hơn bắt người dùng làm lại từ đầu.
    if (!cleaned) throw new Error('Model không trả về nội dung nào.');
    return { guideline: cleaned };
  }

  return {
    guideline: String(parsed.guideline || '').trim(),
    titleGradientFrom: cleanHex(parsed.titleGradientFrom),
    titleGradientTo: cleanHex(parsed.titleGradientTo),
    accentColor: cleanHex(parsed.accentColor),
    bodyColor: cleanHex(parsed.bodyColor),
    footColor: cleanHex(parsed.footColor),
    ruleColor: cleanHex(parsed.ruleColor),
    titleFont: cleanFontFamily(parsed.titleFont),
    bodyFont: cleanFontFamily(parsed.bodyFont),
  };
};
