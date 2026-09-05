import { CarouselDeck, CarouselKit, CarouselLayout, CarouselSlide } from '../types';
import { getGeminiApiKey } from './apiKeyStore';
import { postJson } from './apiClient';

// Xuống dòng, để riêng vì chuỗi thoát lồng trong template literal rất dễ
// hỏng mỗi khi file được sửa bằng script.
const NL = String.fromCharCode(10);

// Nhờ AI dàn trang cho từng slide.
//
// Trước đây bố cục là cố định: chữ trên, ảnh dưới, ảnh co lại cho vừa chỗ thừa.
// Cách đó máy móc - một slide năm dòng bullet kèm ảnh sản phẩm sẽ ép ảnh xuống
// còn con tem, nhìn vừa chật vừa vô duyên.
//
// Quyết định bố cục cần nhìn được ảnh: ảnh dọc, ảnh ngang, ảnh chụp màn hình đầy
// chữ hay ảnh sản phẩm nền trắng - mỗi loại hợp một cách xếp khác nhau. Nên ảnh
// được gửi kèm cho model xem, không chỉ mô tả bằng lời.

const SYSTEM_INSTRUCTION = `Bạn là giám đốc mỹ thuật, chuyên dàn trang carousel vuông 1080x1080 cho mạng xã hội.

Khung nội dung mỗi slide rộng 920px, cao 776px. Trong đó phải chứa: tiêu đề, gạch trang trí, câu dẫn, các gạch đầu dòng, ảnh minh hoạ và câu chốt. Chỗ rất chật, nên bố cục sai là hoặc chữ tràn, hoặc ảnh bị nén còn con tem.

Bốn bố cục có thể chọn:
- "stack": chữ trên, ảnh dưới. Chỉ hợp khi chữ NGẮN (tổng dưới 4 dòng bullet) và ảnh NGANG. Ảnh sẽ chỉ được phần chiều cao còn thừa.
- "side": chữ cột trái, ảnh cột phải chiếm 38% bề ngang và cao hết khung. Đây là lựa chọn CỨU NGUY cho slide nhiều chữ mà vẫn cần ảnh to, và cho MỌI ảnh dọc.
- "hero": ảnh chiếm phần lớn chiều cao, chữ chỉ còn tiêu đề và một câu dẫn. Chọn khi ảnh chính là thông điệp, hoặc ảnh có chữ cần đọc được.
- "grid": nhiều ảnh xếp lưới. Chọn khi slide có từ 2 ảnh trở lên.

MỤC TIÊU: slide phải ĐẦY ĐẶN. Một slide chữ ít mà ảnh bé tí, chừa cả mảng trống dưới đáy, là slide hỏng - hỏng ngang với slide bị tràn. Luôn chọn bố cục cho ảnh được TO nhất có thể mà chữ vẫn đủ chỗ.

Cách quyết định, xét theo thứ tự:
1. Không có ảnh: "stack".
2. Từ 2 ảnh trở lên: "grid".
3. Chữ ÍT (từ 3 gạch đầu dòng trở xuống, hoặc chỉ có câu dẫn): chọn "hero". Ảnh được cả bề ngang 920px nên to gấp đôi so với nhét vào một cột hẹp. ĐỪNG chọn "side" ở đây - cột ảnh chỉ rộng 44% nên ảnh sẽ bé và slide trống huếch.
4. Chữ NHIỀU (từ 4 gạch đầu dòng trở lên, hoặc có dòng dài quá 90 ký tự): chọn "side". Xếp dọc thì ảnh bị nén còn con tem.
5. Chữ vừa phải nhưng ảnh DỌC rõ rệt (cao hơn rộng nhiều): chọn "side" - ảnh dọc nằm trong cột đứng mới hợp.
6. Còn lại: "stack".

Nhìn kỹ tấm ảnh trước khi chọn. Ảnh chụp màn hình có chữ nhỏ thì chữ trong ảnh phải đọc được sau khi thu nhỏ - ưu tiên "hero" để ảnh được to nhất.

Ngoài bố cục, nếu một slide quá tải (chữ nhiều tới mức bố cục nào cũng chật), hãy nói rõ trong trường "warning" là nên cắt bớt ý nào hoặc tách làm hai slide. Đừng tự ý sửa nội dung.

Trả về DUY NHẤT một object JSON, không kèm giải thích, không bọc trong markdown:
{
  "slides": [
    { "index": 0, "layout": "side", "reason": "5 bullet dài kèm ảnh dọc, xếp dọc sẽ nén ảnh", "warning": "" }
  ]
}

"index" đếm từ 0, đúng thứ tự slide được đưa vào. "reason" viết ngắn gọn một câu tiếng Việt. "warning" để chuỗi rỗng khi slide không có vấn đề gì.`;

export interface LayoutPlan {
  index: number;
  layout: CarouselLayout;
  reason: string;
  warning: string;
}

const VALID: CarouselLayout[] = ['stack', 'side', 'hero', 'grid'];

/** Ảnh gửi cho model xem. Nhiều ảnh quá thì tốn token mà không thêm thông tin. */
const MAX_IMAGES_PER_SLIDE = 2;

const dataUrlToPart = (dataUrl: string) => {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  return { inlineData: { mimeType: match[1], data: match[2] } };
};

/**
 * Đọc nội dung và ảnh của cả bộ, trả về bố cục đề xuất cho từng slide.
 * Bắt buộc đi đường Gemini vì cần model nhìn được ảnh.
 */
export const planLayouts = async (deck: CarouselDeck, kit: CarouselKit): Promise<LayoutPlan[]> => {
  const parts: any[] = [];
  const blocks: string[] = [];

  deck.slides.forEach((slide, i) => {
    const images = [
      ...(slide.images || []).map((img) => img.dataUrl),
      ...(slide.imageDataUrl && !(slide.images || []).length ? [slide.imageDataUrl] : []),
    ].filter(Boolean);

    const bullets = (slide.bullets || []).map((b) => b.trim()).filter(Boolean);
    const longest = bullets.reduce((max, b) => Math.max(max, b.length), 0);

    blocks.push(
      [
        `### SLIDE ${i} (index ${i})`,
        `Tiêu đề: ${slide.title.replace(/\n/g, ' / ') || '(không có)'}`,
        `Câu dẫn: ${slide.lead || '(không có)'}`,
        `Số gạch đầu dòng: ${bullets.length}, dòng dài nhất ${longest} ký tự`,
        bullets.length ? `Nội dung: ${bullets.join(' | ')}` : '',
        `Câu chốt: ${slide.foot || '(không có)'}`,
        `Số ảnh: ${images.length}${images.length ? ' (xem ảnh đính kèm ngay dưới đây)' : ''}`,
      ].filter(Boolean).join('\n'),
    );

    images.slice(0, MAX_IMAGES_PER_SLIDE).forEach((dataUrl) => {
      const part = dataUrlToPart(dataUrl);
      if (part) parts.push(part);
    });
  });

  const guideline = (kit.guideline || '').trim();
  const prompt = `=======================================================
BỘ CAROUSEL CẦN DÀN TRANG (${deck.slides.length} slide)
=======================================================
${blocks.join('\n\n')}
=======================================================
${guideline ? `\nQUY TẮC THIẾT KẾ CỦA THƯƠNG HIỆU:\n${guideline}\n` : ''}
Chọn bố cục cho từng slide theo đúng cấu trúc JSON đã mô tả. Phải có đủ ${deck.slides.length} phần tử, index từ 0 đến ${deck.slides.length - 1}.`;

  const payload = await postJson<{ text: string }>('/api/gemini', {
    apiKey: getGeminiApiKey(),
    parts: [...parts, { text: prompt }],
    systemInstruction: SYSTEM_INSTRUCTION,
    temperature: 0.2,
    responseJson: true,
  });

  const cleaned = (payload.text || '').trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();

  let parsed: any;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error('AI trả về dữ liệu không đọc được. Thử lại sau ít phút.');
  }

  const rows: any[] = Array.isArray(parsed?.slides) ? parsed.slides : [];
  if (!rows.length) throw new Error('AI không đề xuất được bố cục nào.');

  // Chỉ nhận bố cục hợp lệ và index có thật; một câu trả lời hỏng không được
  // phép làm xáo trộn bộ slide người dùng đang soạn.
  return rows
    .map((row) => ({
      index: Number(row?.index),
      layout: String(row?.layout || '') as CarouselLayout,
      reason: String(row?.reason || '').trim(),
      warning: String(row?.warning || '').trim(),
    }))
    .filter((row) =>
      Number.isInteger(row.index) &&
      row.index >= 0 &&
      row.index < deck.slides.length &&
      VALID.includes(row.layout));
};

// ---------------------------------------------------------------------------
// AI tự tách bài viết thành slide.
//
// Cách cũ bắt người dùng gõ theo cú pháp cứng: `#` tiêu đề, `-` gạch đầu dòng,
// `!` câu chốt. Nhưng đâu phải bài nào cũng có gạch đầu dòng - một bài kể chuyện
// nhét vào khuôn đó thì ra một chuỗi bullet cụt lủn. Nên việc chia slide giao
// cho model, và mỗi trường được phép để trống khi bài không có thứ đó.

const SPLIT_INSTRUCTION = `Bạn là biên tập viên carousel, chuyên cắt một bài viết dài thành bộ slide vuông 1080x1080 để đăng mạng xã hội.

Khung nội dung mỗi slide rộng 920px, cao 776px - rất chật. Một slide chứa được KHOẢNG:
- Tiêu đề 2 dòng, mỗi dòng tối đa 26 ký tự viết hoa
- Một câu dẫn dưới 90 ký tự
- Tối đa 4 gạch đầu dòng, mỗi dòng dưới 90 ký tự
- Một câu chốt dưới 80 ký tự
Vượt quá là chữ tràn ra ngoài khung và bị cắt mất.

CÁCH CHIA:
- Chia theo Ý, không chia theo độ dài. Mỗi slide nói trọn một ý, đọc riêng vẫn hiểu.
- Slide đầu phải hút được người lướt: nêu thẳng vấn đề hoặc lợi ích, không mở bài vòng vo.
- Ý nào dài quá thì tách làm hai slide, đừng nhồi.
- Số slide tuỳ nội dung, thường 4 đến 10. Đừng cố cho đủ số.

QUAN TRỌNG - ĐỪNG MÁY MÓC:
- KHÔNG phải slide nào cũng cần gạch đầu dòng. Bài kể chuyện, bài quan điểm thì để mảng "bullets" rỗng và viết vào "lead" thành đoạn văn liền mạch.
- KHÔNG phải slide nào cũng cần câu chốt. Chỉ đặt khi thật sự có câu đáng chốt.
- Câu dẫn và gạch đầu dòng không được lặp ý nhau.
- Tiêu đề viết như người ta thật sự nói, không phải nhãn dán kiểu "Phần 1", "Nội dung chính".

GIỮ NGUYÊN sự thật trong bài: số liệu, tên riêng, thuật ngữ. Được rút gọn câu chữ, KHÔNG được thêm thông tin bài không có.

Trả về DUY NHẤT một object JSON, không kèm giải thích, không bọc markdown:
{
  "slides": [
    {
      "title": "DÒNG MỘT\nDÒNG HAI",
      "lead": "câu dẫn hoặc đoạn văn, để chuỗi rỗng nếu không cần",
      "bullets": ["gạch đầu dòng", "..."],
      "foot": "câu chốt, để chuỗi rỗng nếu không cần"
    }
  ]
}

Trong "title" dùng \n để xuống dòng. Dùng **hai dấu sao** để in đậm cụm quan trọng trong lead và bullets.`;

export interface SplitSlide {
  title: string;
  lead: string;
  bullets: string[];
  foot: string;
}

/** Cắt một bài viết thành bộ slide. Trả về mảng rỗng nếu model không chia được. */
export const splitIntoSlides = async (article: string, kit: CarouselKit): Promise<SplitSlide[]> => {
  const text = article.trim();
  if (!text) throw new Error('Chưa có nội dung nào để tách.');

  const guideline = (kit.guideline || '').trim();
  const prompt = `=======================================================
BÀI VIẾT CẦN CẮT THÀNH CAROUSEL
=======================================================
${text}
=======================================================
${guideline ? `
QUY TẮC THIẾT KẾ CỦA THƯƠNG HIỆU (bám theo khi đặt tiêu đề và chọn giọng):
${guideline}
` : ''}
Cắt bài trên thành bộ slide theo đúng cấu trúc JSON đã mô tả.`;

  const payload = await postJson<{ text: string }>('/api/gemini', {
    apiKey: getGeminiApiKey(),
    parts: [{ text: prompt }],
    systemInstruction: SPLIT_INSTRUCTION,
    temperature: 0.4,
    responseJson: true,
  });

  const cleaned = (payload.text || '').trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();

  let parsed: any;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error('AI trả về dữ liệu không đọc được. Thử lại sau ít phút.');
  }

  const rows: any[] = Array.isArray(parsed?.slides) ? parsed.slides : [];
  if (!rows.length) throw new Error('AI không tách được slide nào từ nội dung này.');

  return rows.map((row) => ({
    title: String(row?.title || '').trim(),
    lead: String(row?.lead || '').trim(),
    bullets: (Array.isArray(row?.bullets) ? row.bullets : [])
      .map((b: unknown) => String(b || '').trim())
      .filter(Boolean),
    foot: String(row?.foot || '').trim(),
  })).filter((row) => row.title || row.lead || row.bullets.length);
};

// ---------------------------------------------------------------------------
// Vòng tự sửa sau khi dựng.
//
// Đây là mắt xích app còn thiếu so với cách làm tay: dựng xong thì ĐO, slide nào
// lệch thì sửa rồi dựng lại. Không có bước này, một slide tràn hay trống chân
// vẫn được giao và người dùng phải là người phát hiện.
//
// Model được đưa số đo thật của từng slide chứ không phải mô tả chung chung, nên
// nó biết chính xác phải cắt bao nhiêu chữ hay đổi bố cục nào.

const REFINE_INSTRUCTION = `Bạn là giám đốc mỹ thuật, đang sửa một bộ carousel vừa dựng xong nhưng chưa đạt.

Khung nội dung mỗi slide rộng 920px, cao 776px. Sau khi dựng, mỗi slide được đo "freeBottom" - khoảng trống còn lại dưới đáy khung:
- freeBottom ÂM: nội dung TRÀN ra ngoài khung và bị cắt. Phải rút bớt chữ hoặc đổi sang bố cục thoáng hơn.
- freeBottom 0 đến 60: ĐẠT. Đừng đụng vào slide này.
- freeBottom LỚN HƠN 60: slide TRỐNG CHÂN, nhìn hụt hẫng. Phải thêm chữ hoặc đổi bố cục để ảnh được to hơn.

Bốn bố cục:
- "stack": chữ trên, ảnh dưới. Ảnh chỉ được phần chiều cao còn thừa.
- "side": chữ cột trái, ảnh cột phải rộng 44% và cao hết khung. Cứu slide nhiều chữ.
- "hero": ảnh chiếm phần lớn chiều cao, chữ chỉ còn tiêu đề và một câu. Ảnh TO NHẤT ở bố cục này.
- "grid": nhiều ảnh xếp lưới.

CÁCH CHỮA, theo thứ tự ưu tiên:
1. Đổi bố cục trước. Tràn thì "stack" -> "side". Trống chân mà có ảnh thì "side" -> "hero", hoặc "stack" -> "hero".
2. Vẫn chưa đủ thì mới sửa chữ. Tràn thì rút ngắn câu, gộp hai gạch đầu dòng thành một, bỏ gạch đầu dòng kém quan trọng nhất. Trống chân thì viết dài thêm cho ý đã có, hoặc thêm một gạch đầu dòng từ chính thông tin đang có.

TUYỆT ĐỐI:
- KHÔNG thêm thông tin mới, số liệu mới, ý mới mà nội dung gốc không có. Trống chân thì diễn đạt kỹ hơn ý đã có, không bịa thêm ý.
- KHÔNG đổi số lượng slide.
- KHÔNG đụng vào slide đã đạt.
- Giữ nguyên giọng văn và các cụm in đậm **như thế này**.

Trả về DUY NHẤT một object JSON, không kèm giải thích, không bọc markdown:
{
  "slides": [
    {
      "index": 1,
      "layout": "side",
      "title": "DÒNG MỘT\nDÒNG HAI",
      "lead": "...",
      "bullets": ["..."],
      "foot": "...",
      "change": "rút 2 bullet dài và đổi sang side"
    }
  ]
}

CHỈ đưa vào mảng những slide cần sửa. Slide đạt rồi thì bỏ qua hẳn, đừng liệt kê.`;

export interface RefinedSlide {
  index: number;
  layout?: CarouselLayout;
  title: string;
  lead: string;
  bullets: string[];
  foot: string;
  change: string;
}

/** Ngưỡng của bộ quy tắc: dưới 0 là tràn, trên 60 là trống chân. */
export const isRhythmOff = (freeBottom: number | null): boolean =>
  typeof freeBottom === 'number' && (freeBottom < 0 || freeBottom > 60);

/**
 * Đưa số đo thật cho model và nhận về bản sửa cho những slide chưa đạt.
 * Trả mảng rỗng khi model không sửa gì.
 */
export const refineDeck = async (
  deck: CarouselDeck,
  kit: CarouselKit,
  rhythm: { freeBottom: number | null }[],
): Promise<RefinedSlide[]> => {
  const problems = deck.slides
    .map((slide, i) => ({ slide, i, free: rhythm[i]?.freeBottom ?? null }))
    .filter((row) => isRhythmOff(row.free));

  if (!problems.length) return [];

  const blocks = problems.map(({ slide, i, free }) => {
    const images = [
      ...(slide.images || []).map((img) => img.dataUrl),
      ...(slide.imageDataUrl && !(slide.images || []).length ? [slide.imageDataUrl] : []),
    ].filter(Boolean);
    const bullets = (slide.bullets || []).map((b) => b.trim()).filter(Boolean);

    return [
      `### SLIDE index ${i}`,
      `Đo được: freeBottom = ${free}px  (${(free as number) < 0 ? 'TRÀN, phải rút bớt' : 'TRỐNG CHÂN, phải lấp thêm'})`,
      `Bố cục đang dùng: ${slide.layout || 'stack'}`,
      `Số ảnh: ${images.length}`,
      `Tiêu đề: ${slide.title.split(NL).join(' / ') || '(không có)'}`,
      `Câu dẫn: ${slide.lead || '(không có)'}`,
      bullets.length
        ? 'Gạch đầu dòng:' + NL + bullets.map((b, k) => `  ${k + 1}. ${b}`).join(NL)
        : 'Gạch đầu dòng: (không có)',
      `Câu chốt: ${slide.foot || '(không có)'}`,
    ].join(NL);
  });

  const guideline = (kit.guideline || '').trim();
  const bar = '=======================================================';
  const prompt = [
    bar,
    `${problems.length} SLIDE CHƯA ĐẠT NHỊP, CẦN SỬA`,
    bar,
    blocks.join(NL + NL),
    bar,
    guideline ? `QUY TẮC THIẾT KẾ CỦA THƯƠNG HIỆU:${NL}${guideline}` : '',
    'Sửa những slide trên cho freeBottom về khoảng 0..60. Trả về JSON theo đúng cấu trúc đã mô tả.',
  ].filter(Boolean).join(NL);

  const payload = await postJson<{ text: string }>('/api/gemini', {
    apiKey: getGeminiApiKey(),
    parts: [{ text: prompt }],
    systemInstruction: REFINE_INSTRUCTION,
    temperature: 0.3,
    responseJson: true,
  });

  const cleaned = (payload.text || '').trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();

  let parsed: any;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return [];
  }

  const rows: any[] = Array.isArray(parsed?.slides) ? parsed.slides : [];

  return rows
    .map((row) => ({
      index: Number(row?.index),
      layout: VALID.includes(String(row?.layout) as CarouselLayout)
        ? (String(row.layout) as CarouselLayout)
        : undefined,
      title: String(row?.title || '').trim(),
      lead: String(row?.lead || '').trim(),
      bullets: (Array.isArray(row?.bullets) ? row.bullets : [])
        .map((b: unknown) => String(b || '').trim())
        .filter(Boolean),
      foot: String(row?.foot || '').trim(),
      change: String(row?.change || '').trim(),
    }))
    // Chỉ nhận slide có thật và thực sự nằm trong nhóm đang lệch, để một câu trả
    // lời lạc không ghi đè lên slide người dùng đã ưng.
    .filter((row) =>
      Number.isInteger(row.index) &&
      problems.some((p) => p.i === row.index) &&
      (row.title || row.lead || row.bullets.length));
};

// ---------------------------------------------------------------------------
// Sửa MỘT slide theo góp ý của người dùng.
//
// Vòng tự sửa ở trên chỉ nhìn số đo, nên nó không biết người dùng khó chịu ở
// đâu: một slide "vào nhịp" theo số vẫn có thể bị chê chữ nhỏ, ảnh lấn, bố cục
// lệch so với các slide còn lại. Ở đây model được xem CHÍNH ẢNH vừa dựng cùng
// lời góp ý, và được chỉnh mọi nút mà app có: bố cục, vị trí từng ảnh, chữ.
// Người dùng góp ý xong bấm dựng lại, thấy kết quả, góp ý tiếp - đúng cách làm
// việc với một designer.

const REVISE_INSTRUCTION = `Bạn là giám đốc mỹ thuật, đang sửa MỘT slide carousel vuông 1080x1080 theo góp ý của người dùng. Bạn được xem chính ảnh vừa dựng của slide đó.

Khung nội dung rộng 920px, cao 776px (lề trái phải 80px, trên 154px, dưới 150px - logo và chân trang đã in sẵn trên nền, không đụng được).

Những gì bạn được chỉnh:
1. "layout" - một trong bốn bố cục:
   - "stack": chữ trên, ảnh dưới, chữ chạy hết bề ngang 920px. Tiêu đề 46px, câu dẫn 26px, gạch đầu dòng 25px. Ảnh chỉ được phần chiều cao còn thừa.
   - "side": chữ cột trái (rộng khoảng 480px), ảnh cột phải (44%) cao hết khung. CHỮ NHỎ HƠN các bố cục khác: tiêu đề 40px, câu dẫn 24px, gạch đầu dòng 22px; tiêu đề dài sẽ gãy thành 3 dòng. Người dùng than "chữ nhỏ", "tiêu đề bé", "không giống các slide khác" thì gần như chắc chắn phải rời bố cục này.
   - "hero": như stack nhưng ảnh chiếm phần lớn chiều cao; hợp khi chữ ít (chỉ tiêu đề và một câu dẫn).
   - "grid": nhiều ảnh xếp lưới, chữ ở trên. Chỉ dùng khi có từ 2 ảnh.
2. "imageAligns": vị trí từng ảnh theo đúng thứ tự - mỗi phần tử là "left", "center" hoặc "right". Chỉ có tác dụng khi ảnh hẹp hơn ô của nó (ảnh dọc nằm trong ô rộng). Ảnh KHÔNG thể to hơn chiều cao còn thừa; muốn ảnh to hơn thì phải bớt chữ hoặc chọn "hero".
3. Chữ: "title" (các dòng cách nhau bằng ký tự xuống dòng, tối đa 2 dòng, mỗi dòng dưới 30 ký tự để không gãy), "lead", "bullets", "foot".

Số đo "freeBottom" là khoảng trống còn lại dưới đáy khung sau khi dựng: âm là TRÀN (bị cắt), 0 đến 60 là đạt, trên 60 là TRỐNG CHÂN.

NGUYÊN TẮC:
- Góp ý của người dùng là ưu tiên số một. Nhìn ảnh, hiểu họ đang khó chịu ở điểm nào, rồi chọn cách chỉnh trúng điểm đó. Nếu góp ý so sánh với "các slide khác", hãy hiểu là họ muốn slide này giống phong cách chung: chữ to chạy hết bề ngang (stack/grid), không phải hai cột.
- Sau khi làm theo góp ý, slide vẫn phải vào nhịp: không tràn, không trống chân. Chữ nhiều mà đổi sang stack thì rút gọn gạch đầu dòng cho vừa.
- Đổi bố cục và vị trí ảnh trước, sửa chữ sau. Sửa chữ thì chỉ rút gọn, gộp, hoặc diễn đạt kỹ hơn ý đã có. TUYỆT ĐỐI KHÔNG bịa thông tin mới. Giữ các cụm in đậm **như thế này**.
- Không xoá ảnh, không đổi số lượng ảnh.

Trả về DUY NHẤT một object JSON, không kèm giải thích, không bọc markdown:
{
  "layout": "stack",
  "imageAligns": ["center"],
  "title": "DÒNG MỘT\\nDÒNG HAI",
  "lead": "...",
  "bullets": ["..."],
  "foot": "...",
  "change": "một câu tiếng Việt nói rõ đã sửa gì và vì sao"
}
Trường nào giữ nguyên thì ghi lại đúng giá trị hiện tại.`;

type ImageAlign = 'left' | 'center' | 'right';
const ALIGNS: ImageAlign[] = ['left', 'center', 'right'];

export interface SlideRevision {
  /** Những trường cần ghi đè lên slide; đưa thẳng vào updateSlide. */
  patch: Partial<CarouselSlide>;
  /** Model đã sửa gì - hiện cho người dùng. */
  change: string;
}

/**
 * Gửi slide, số đo, ảnh vừa dựng và góp ý cho model; nhận về bản sửa.
 * Ném lỗi khi model không trả được JSON dùng được, để người dùng biết mà góp ý
 * lại thay vì thấy ảnh im lìm không đổi.
 */
export const reviseSlide = async (
  slide: CarouselSlide,
  kit: CarouselKit,
  freeBottom: number | null,
  feedback: string,
  renderedDataUrl: string,
): Promise<SlideRevision> => {
  // Gom ảnh bộ cũ (một ảnh) và bộ mới về một mảng, như slideHtml làm.
  const images = (slide.images || []).length
    ? (slide.images || [])
    : slide.imageDataUrl
      ? [{ dataUrl: slide.imageDataUrl, name: slide.imageName || 'anh', align: undefined as ImageAlign | undefined }]
      : [];
  const bullets = (slide.bullets || []).map((b) => b.trim()).filter(Boolean);
  const measure = freeBottom == null
    ? 'không đo được'
    : `${freeBottom}px (${freeBottom < 0 ? 'TRÀN' : freeBottom > 60 ? 'TRỐNG CHÂN' : 'đạt về nhịp'})`;

  const bar = '=======================================================';
  const prompt = [
    bar,
    'SLIDE CẦN SỬA (ảnh đính kèm là bản vừa dựng)',
    bar,
    `Bố cục đang dùng: ${slide.layout || '(tự động)'}`,
    `Số ảnh: ${images.length}${images.length ? ' · vị trí: ' + images.map((img) => img.align || 'center').join(', ') : ''}`,
    `Đo được: freeBottom = ${measure}`,
    `Tiêu đề: ${slide.title.split(NL).join(' / ') || '(không có)'}`,
    `Câu dẫn: ${slide.lead || '(không có)'}`,
    bullets.length
      ? 'Gạch đầu dòng:' + NL + bullets.map((b, k) => `  ${k + 1}. ${b}`).join(NL)
      : 'Gạch đầu dòng: (không có)',
    `Câu chốt: ${slide.foot || '(không có)'}`,
    bar,
    'GÓP Ý CỦA NGƯỜI DÙNG:',
    feedback.trim(),
    bar,
    (kit.guideline || '').trim() ? `QUY TẮC THIẾT KẾ CỦA THƯƠNG HIỆU:${NL}${kit.guideline.trim()}` : '',
    'Sửa slide theo góp ý trên. Trả về JSON theo đúng cấu trúc đã mô tả.',
  ].filter(Boolean).join(NL);

  const shot = dataUrlToPart(renderedDataUrl);
  const payload = await postJson<{ text: string }>('/api/gemini', {
    apiKey: getGeminiApiKey(),
    parts: [...(shot ? [shot] : []), { text: prompt }],
    systemInstruction: REVISE_INSTRUCTION,
    temperature: 0.3,
    responseJson: true,
  });

  const cleaned = (payload.text || '').trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();

  let row: any;
  try {
    row = JSON.parse(cleaned);
  } catch {
    throw new Error('AI trả về dữ liệu không đọc được. Góp ý lại ngắn gọn hơn rồi thử lần nữa.');
  }
  if (!row || typeof row !== 'object') throw new Error('AI không đưa ra được cách sửa nào.');

  const title = String(row.title || '').trim();
  const lead = String(row.lead || '').trim();
  const foot = String(row.foot || '').trim();
  const nextBullets = (Array.isArray(row.bullets) ? row.bullets : [])
    .map((b: unknown) => String(b || '').trim())
    .filter(Boolean);
  // Model bỏ trống cả phần chữ nghĩa là nó chỉ đổi bố cục; đừng để slide mất chữ.
  const keepText = !title && !lead && !nextBullets.length;

  const layout = VALID.includes(String(row.layout) as CarouselLayout)
    ? (String(row.layout) as CarouselLayout)
    : slide.layout;

  // Chỉ đụng vào mảng ảnh khi model thực sự trả vị trí, để một câu trả lời
  // thiếu trường không xoá mất chỉnh tay của người dùng.
  const aligns: unknown[] = Array.isArray(row.imageAligns) ? row.imageAligns : [];
  const imagePatch: Partial<CarouselSlide> = aligns.length && images.length
    ? {
        images: images.map((img, k) => ({
          ...img,
          align: ALIGNS.includes(aligns[k] as ImageAlign) ? (aligns[k] as ImageAlign) : img.align,
        })),
        imageDataUrl: undefined,
        imageName: undefined,
      }
    : {};

  const change = String(row.change || '').trim() || 'đã chỉnh theo góp ý';

  return {
    change,
    patch: {
      layout,
      layoutNote: change,
      ...imagePatch,
      ...(keepText ? {} : {
        title: title || slide.title,
        lead,
        bullets: nextBullets.length ? nextBullets : slide.bullets,
        foot,
      }),
    },
  };
};
