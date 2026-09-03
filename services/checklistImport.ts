import { BrandSource } from './brandLearnService';
import { getGeminiApiKey, resolveProvider } from './apiKeyStore';
import { postJson } from './apiClient';

// Nạp bộ tiêu chí từ tài liệu có sẵn.
//
// Phần lớn người dùng đã có bộ tiêu chí nằm trong một file Word đã xuất PDF, một
// bản checklist nội bộ hay một tài liệu đào tạo. Bắt họ gõ lại vào ô textarea là
// việc thừa, nên ở đây đọc thẳng tài liệu rồi rút phần tiêu chí ra.

const SYSTEM_INSTRUCTION = `Bạn là trợ lý biên tập, chuyên rút bộ tiêu chí chấm điểm nội dung từ tài liệu có sẵn.

Nguyên tắc:
- Chỉ lấy những gì tài liệu thật sự nói. Không tự thêm tiêu chí mà tài liệu không có.
- Giữ nguyên thang điểm, trọng số, mức đạt/không đạt nếu tài liệu có ghi. Không quy đổi sang thang khác.
- Nếu tài liệu không có điểm số, viết thành danh sách gạch đầu dòng, mỗi dòng một tiêu chí kiểm được.
- Gộp các ý trùng nhau, bỏ phần dẫn nhập và lời quảng cáo.
- Giữ nguyên ngôn ngữ của tài liệu.
- Trả về văn bản thuần, không dùng markdown, không thêm lời giải thích trước hay sau danh sách.`;

/** Nối nguyên văn phần text của các tài liệu đọc được, dùng khi người dùng muốn tự biên tập. */
export const joinSourceText = (sources: BrandSource[]): string =>
  sources
    .filter((s) => s.status === 'ready' && s.text)
    .map((s) => `# ${s.label}\n${(s.text || '').trim()}`)
    .join('\n\n');

/** Số tài liệu chỉ đọc được bằng model (PDF gửi dạng bytes). */
export const countFileOnlySources = (sources: BrandSource[]): number =>
  sources.filter((s) => s.status === 'ready' && !s.text && s.base64).length;

/**
 * Nhờ model rút tài liệu thành bộ tiêu chí chấm điểm.
 * PDF bắt buộc đi đường Gemini vì đó là nhà cung cấp duy nhất đọc được file ở đây,
 * còn tài liệu chỉ có chữ thì theo provider người dùng đã chọn.
 */
export const extractCriteriaFromSources = async (sources: BrandSource[]): Promise<string> => {
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

Rút phần tiêu chí chấm điểm trong các tài liệu trên thành một bộ tiêu chí dùng được ngay.`;

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
    return (payload.text || '').trim();
  }

  const payload = await postJson<{ text: string }>('/api/gemini', {
    apiKey: getGeminiApiKey(),
    parts: [...parts, { text: prompt }],
    systemInstruction: SYSTEM_INSTRUCTION,
    temperature: 0.2,
  });

  return (payload.text || '').trim();
};
