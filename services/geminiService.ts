import { AnalysisMode, BrandProfile, ScriptFormula, FORMULA_LABELS, VideoMeta } from "../types";
import { getGeminiApiKey, resolveProvider } from "./apiKeyStore";
import { postJson } from "./apiClient";

// Helper to convert file/blob to base64 for inlineData
export const fileToGenerativePart = async (file: Blob): Promise<{ inlineData: { data: string; mimeType: string } }> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = reader.result as string;
      const base64Data = base64String.split(',')[1];
      resolve({
        inlineData: {
          data: base64Data,
          mimeType: file.type || 'application/octet-stream',
        },
      });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

export const formatBrandGuidelines = (brand?: BrandProfile): string => {
  if (!brand) {
    return `
    - THƯƠNG HIỆU: Đang ở chế độ Sáng Tạo Tự Do (Creator Mặc Định)
    - NGÔI XƯNG: "Mình - Các bạn" hoặc "Tôi - Quý vị" (Lịch sự, chân thành, tự nhiên)
    - PHONG CÁCH: Thu hút, tự nhiên, gần gũi, giàu giá trị thực tế cho người xem.
    `;
  }

  return `
  =======================================================
  ⭐ BỘ QUY TẮC THƯƠNG HIỆU (BRAND DNA & GUIDELINES) ⭐
  =======================================================
  - TÊN THƯƠNG HIỆU: ${brand.name || 'Thương hiệu của bạn'}
  - NGÀNH HÀNG / LĨNH VỰC: ${brand.industry || 'Chung'}
  - SLOGAN / THÔNG ĐIỆP CHÍNH: "${brand.tagline || ''}"
  - ĐỐI TƯỢNG KHÁN GIẢ MỤC TIÊU: ${brand.targetAudience || 'Khách hàng đại chúng'}
  - HÌNH TƯỢNG NGƯỜI NÓI (SPEAKER PERSONA): ${brand.speakerPersona || 'Người chia sẻ nhiệt tình, am hiểu'}
  - QUY TẮC XƯNG HÔ BẮT BUỘC (CRITICAL):
    + Người nói xưng là: "${brand.addressingSpeaker || 'Mình'}"
    + Khán giả / Khách hàng gọi là: "${brand.addressingAudience || 'Các bạn'}"
    (TUYỆT ĐỐI KHÔNG xưng hô sai lệch so với quy tắc này)
  - GIỌNG VĂN & SẮC THÁI CHỦ ĐẠO (TONE OF VOICE): ${brand.brandVoiceTone || 'Chân thành, tự nhiên, thu hút'}
  - ĐIỂM CỐT LÕI / LỢI THẾ CẠNH TRANH (USPs): ${brand.coreUSPs || 'Chất lượng và sự tận tâm'}
  - LỜI KÊU GỌI HÀNH ĐỘNG (CTA) MẪU: "${brand.callToAction || 'Theo dõi để nhận thêm nhiều giá trị nhé!'}"
  - ĐIỀU CẤM KỴ & NGUYÊN TẮC KHÔNG DÙNG: ${brand.forbiddenKeywords || 'Không dùng từ ngữ tiêu cực, không thô tục, không dìm đối thủ'}
  ${brand.customNotes ? `- GHI CHÚ ĐẶC BIỆT TỪ BRAND: ${brand.customNotes}` : ''}
  ${brand.hashtags ? `- BỘ HASHTAG MẶC ĐỊNH: ${brand.hashtags}` : ''}
  ${brand.footerBlock ? `- KHỐI FOOTER CỐ ĐỊNH (BẮT BUỘC CHÈN NGUYÊN VĂN Ở CUỐI BÀI ĐĂNG SOCIAL):
${brand.footerBlock}` : ''}
  =======================================================
  `;
};

const getFormulaInstruction = (formula?: ScriptFormula): string => {
  switch (formula) {
    case 'pas': 
      return "BẮT BUỘC DÙNG CÔNG THỨC PAS: Problem (Nêu vấn đề/Nỗi đau chạm insight) -> Agitation (Xoáy sâu nỗi đau/Hậu quả) -> Solution (Giải pháp/Sản phẩm độc quyền của Brand).";
    case 'aida': 
      return "BẮT BUỘC DÙNG CÔNG THỨC AIDA: Attention (Gây chú ý ngay 3s đầu) -> Interest (Tạo sự thích thú qua câu chuyện) -> Desire (Khơi gợi khao khát sở hữu/thay đổi) -> Action (Kêu gọi hành động đúng CTA của Brand).";
    case 'storytelling': 
      return "BẮT BUỘC DÙNG CẤU TRÚC STORYTELLING: Bối cảnh khởi đầu -> Biến cố/Trở ngại -> Khoảnh khắc nhận ra giải pháp cùng Brand -> Kết quả viên mãn & Bài học.";
    case 'educational': 
      return "BẮT BUỘC DÙNG CẤU TRÚC CHIA SẺ GIÁ TRỊ: Hook lầm tưởng/sự thật gây sốc -> Giải thích nguyên nhân (Why) -> 3 bước hành động cụ thể (How) -> Điểm chạm giải pháp Brand (What).";
    case 'before_after': 
      return "BẮT BUỘC DÙNG CẤU TRÚC BEFORE-AFTER: Tình trạng bế tắc trước đây -> Cầu nối thay đổi (Bridge - Giải pháp Brand) -> Sự tự tin/Kết quả vượt bậc hiện tại.";
    case 'hero_journey':
      return "BẮT BUỘC DÙNG HÀNH TRÌNH ĐỘT PHÁ (Hero's Journey): Xuất phát điểm bình thường -> Thử thách lớn -> Gặp người dẫn đường/Giải pháp Brand -> Chuyển mình bứt phá.";
    default: 
      return "Tự động phân tích điểm sáng của nội dung gốc và chọn cấu trúc viral tối ưu nhất, hòa quyện trọn vẹn với định vị thương hiệu.";
  }
};

const getSystemInstruction = (mode: AnalysisMode, brand?: BrandProfile): string => {
  const brandName = brand?.name || 'thương hiệu của người dùng';
  const industrySuffix = brand?.industry ? ` (ngành: ${brand.industry})` : '';
  const voice = brand?.brandVoiceTone || 'chân thành, tự nhiên, thu hút';
  const speaker = brand?.addressingSpeaker || 'Mình';
  const audience = brand?.addressingAudience || 'Bạn';
  const footerBlock = (brand?.footerBlock || '').trim();
  const footerRule = footerBlock
    ? `Luôn kết thúc bài bằng CTA phù hợp, một dải phân cách, rồi chèn NGUYÊN VĂN khối footer cố định sau:
${footerBlock}`
    : 'Luôn kết thúc bài bằng CTA phù hợp với thương hiệu (không tự bịa link, hotline hay hashtag không được cung cấp).';

  switch (mode) {
    case AnalysisMode.REMAKE_SCRIPT:
      return `Bạn là Content Creator & Giám Đốc Sáng Tạo chuyên nghiệp của thương hiệu ${brandName}${industrySuffix}.
Nhiệm vụ của bạn:
1. Bóc tách và phân tích toàn diện bài viết/video mẫu (Hook, góc tiếp cận/angle, nhịp điệu, visual, cử chỉ, tâm lý học giữ chân).
2. Học theo cấu trúc mở bài (Hook), cách dẫn dắt tình huống, cách tạo cảm xúc/tò mò của bài mẫu.
3. VIẾT LẠI (Remake) thành một kịch bản/bài viết hoàn toàn mới cho sản phẩm/dịch vụ của ${brandName}, biến đổi 100% nội dung sang thương hiệu này, tuyệt đối không sao chép nguyên văn.
4. Tuân thủ nghiêm ngặt Tone & Voice của thương hiệu: ${voice}. Quy tắc xưng hô bắt buộc: người nói xưng "${speaker}", gọi khán giả là "${audience}".
5. Tuân thủ Quy tắc an toàn sản phẩm: chỉ dùng claim/thành phần/công dụng có thật trong thông tin được cung cấp, không bịa đặt tính năng.
6. ${footerRule}`;

    case AnalysisMode.CONTENT_AUDIT:
    case AnalysisMode.CONTENT_REMAKE:
      return `Bạn là Content Creator chuyên nghiệp của thương hiệu ${brandName}${industrySuffix}.
Nhiệm vụ: Phân tích bài viết viral mẫu (được cung cấp ở input), bóc tách cấu trúc/angle/nhịp điệu của bài đó và VIẾT LẠI (Remake) thành một bài viết hoàn toàn mới cho ${brandName}.

1. NGUYÊN TẮC REMAKE:
- Học theo: Cấu trúc mở bài (Hook), cách dẫn dắt tình huống, cách tạo cảm xúc/tò mò của bài mẫu.
- Thay đổi: Biến toàn bộ nội dung, câu chuyện, ví dụ và giải pháp thành sản phẩm/dịch vụ của ${brandName}. Tuyệt đối không sao chép nguyên văn câu chữ.

2. TONE & VOICE:
- Sắc thái chủ đạo: ${voice}.
- Xưng hô: người nói xưng "${speaker}", gọi khán giả là "${audience}".
- Ngôn ngữ: Tự nhiên, đúng ngữ cảnh ngành hàng, không hù dọa, không quá học thuật, không giật gân phản cảm.

3. QUY TẮC AN TOÀN SẢN PHẨM:
- Chỉ sử dụng các claim, thành phần, công dụng có trong thông tin được cung cấp, không tự bịa đặt tính năng.

4. CẤU TRÚC CUỐI BÀI:
${footerRule}`;

    case AnalysisMode.SCRIPT_GENERATION:
      return `Bạn là Content Creator & Biên kịch Video Ngắn hàng đầu của thương hiệu ${brandName}${industrySuffix}. Biến ý tưởng thành kịch bản sản xuất hoàn chỉnh theo cấu trúc viral, đúng giọng văn thương hiệu (${voice}), đúng xưng hô "${speaker}" ➔ "${audience}" và kết bài đúng chuẩn.`;

    case AnalysisMode.DEEP_ANALYSIS:
      return `Bạn là Chuyên gia Phân tích & Bóc tách Video Viral (Short-form & Long-form Content Analyst) hàng đầu.
Nhiệm vụ của bạn là:
1. Mổ xẻ, giải mã và bóc tách toàn diện 100% video/nội dung gốc được cung cấp theo đúng các yếu tố chuyên môn (Ấn tượng tổng quan, Hình thức sản xuất, Trang phục, Khuôn mặt/Ánh mắt/Biểu cảm, Giọng nói/Nhịp điệu, Hành động/Demo, Nhân vật, Bối cảnh/Chuyển cảnh, Text on Screen/BGM/SFX, Cấu trúc nội dung Hook 3s, 10s, Thân bài, Ending/CTA).
2. Trích xuất và bóc tách chi tiết toàn bộ kịch bản (Full Script Timeline Breakdown) của video gốc (từng mốc thời gian, thao tác hình ảnh, lời thoại/âm thanh chi tiết, mục đích tâm lý).
3. KHÔNG cần gợi ý kịch bản remake hay tư vấn cho brand trong chế độ này, tập trung 100% vào việc phân tích và giải mã video gốc.`;

    case AnalysisMode.SCRIPT_EXTRACT:
      return "Bạn là trợ lý AI chuyên nghiệp về biên tập nội dung, nghe và trích xuất lại chính xác từng câu chữ, mốc thời gian của nội dung gốc.";

    case AnalysisMode.ARTICLE_ANALYSIS:
      return `Bạn là Chuyên gia Phân tích Nội dung Số & Tâm lý học Hành vi Người đọc.
Nhiệm vụ: MỔ XẺ một bài viết đang hiệu quả để giải thích CHÍNH XÁC vì sao nó hoạt động tốt, phục vụ mục đích học hỏi và nghiên cứu.

ĐÂY LÀ CÔNG CỤ PHÂN TÍCH THUẦN TÚY. Phạm vi nghiêm ngặt:
- CHỈ phân tích và giải thích. KHÔNG viết lại, KHÔNG remake, KHÔNG đề xuất phiên bản mới.
- KHÔNG chấm điểm, KHÔNG cho điểm số, KHÔNG xếp hạng bài viết.
- KHÔNG đối chiếu hay áp bất kỳ thương hiệu nào vào bài viết này. Không nhắc tên thương hiệu nào của người dùng.
- Giữ thái độ khách quan của người nghiên cứu: mô tả bài viết đang làm gì và vì sao nó có tác dụng, không khen chê.

Nguyên tắc bắt buộc:
- Luôn trích dẫn nguyên văn câu/đoạn cụ thể khi phân tích, không nói chung chung.
- Nếu có hình ảnh đính kèm, phân tích cả phần nhìn: bố cục, chữ trên ảnh, màu sắc, mức ăn khớp với nội dung chữ.
- TUYỆT ĐỐI KHÔNG bịa số liệu (lượt xem, tương tác, thứ hạng SEO) nếu dữ liệu không được cung cấp.`;

    case AnalysisMode.THUMBNAIL_AUDIT:
      return `Bạn là Giám Đốc Nghệ Thuật (Art Director) cho thương hiệu ${brandName}${industrySuffix}, chuyên tối ưu tỷ lệ nhấp (CTR) và tính thẩm mỹ của hình ảnh đại diện.`;

    default:
      return `Bạn là Content Creator & Cố vấn Nội dung chuyên nghiệp của thương hiệu ${brandName}${industrySuffix}.`;
  }
};

const getPrompt = (
  mode: AnalysisMode, 
  userPrompt?: string, 
  url?: string, 
  brand?: BrandProfile,
  additionalInstructions?: string,
  formula?: ScriptFormula
): string => {
  const brandGuidelines = formatBrandGuidelines(brand);
  const formulaInstruction = getFormulaInstruction(formula);
  const brandLabel = brand?.name || 'thương hiệu';
  const brandLabelUpper = brandLabel.toUpperCase();
  const brandSpeaker = brand?.addressingSpeaker || 'Mình';
  const brandAudience = brand?.addressingAudience || 'Bạn';
  const brandHashtags = (brand?.hashtags || '').trim();
  const brandFooter = (brand?.footerBlock || '').trim();
  
  const extraReqs = additionalInstructions 
    ? `\n\n📌 YÊU CẦU BỔ SUNG ĐẶC BIỆT TỪ NGƯỜI DÙNG: "${additionalInstructions}"` 
    : "";

  switch (mode) {
    case AnalysisMode.REMAKE_SCRIPT:
      return `
      Dưới đây là nội dung/video gốc cần phân tích bóc tách toàn diện và chuyển thể thành KỊCH BẢN REMAKE ĐỘC NHẤT cho thương hiệu.

      ${brandGuidelines}

      =======================================================
      🎯 QUY TRÌNH THỰC HIỆN 2 PHẦN BẮT BUỘC:
      =======================================================
      
      PHẦN 1: BẢNG BÓC TÁCH & PHÂN TÍCH CHUYÊN SÂU NỘI DUNG/VIDEO GỐC (Trực quan, chi tiết từng yếu tố)
      Bạn hãy phân tích sâu các hạng mục sau từ video/content mẫu:
      1. Ấn tượng tổng quan (Overall Impression): Điểm đọng lại mạnh nhất, cảm xúc chủ đạo, tại sao video lại viral/giữ chân được người xem.
      2. Hình thức video (Production & Visual Formats):
         - Thumbnail / Bìa video: Text nổi, biểu cảm, màu sắc, độ tương phản.
         - Trang phục & Tạo hình: Phong cách, tính thẩm mỹ, độ gần gũi/chuyên gia.
         - Khuôn mặt & Biểu cảm: Mức độ năng lượng, ánh mắt nhìn vào camera, ngôn ngữ cơ thể.
         - Giọng nói & Nhịp điệu (Voice & Pacing): Tone giọng, tốc độ nói, khoảng ngắt nghỉ (pauses).
         - Hành động & Tương tác: Cử chỉ tay, động tác cầm/chạm sản phẩm, biểu diễn thực tế (demo/test).
         - Nhân vật & Persona: Vai trò của người nói (người bạn, chuyên gia, nạn nhân trải nghiệm...).
         - Bối cảnh & Chuyển cảnh (Pacing & Angles): Ánh sáng, góc quay (cận/trung/toàn), nhịp cắt cảnh (mỗi 2-3s một lần cắt).
         - Text on Screen, Nhạc nền (BGM) & Sound Effects: Chữ chạy trên màn hình, font chữ, âm thanh minh họa tạo điểm nhấn.
      3. Phân tích nội dung & Cấu trúc kịch bản (Content Structure):
         - Hook 3 giây đầu tiên nói gì & làm gì: Chiêu thức giật tò mò, tạo xung đột hoặc đánh trúng nỗi sợ/khao khát.
         - 10 giây đầu tiên nói gì: Cách mở rộng vấn đề, giữ chân người xem không lướt qua.
         - Cách triển khai thân bài: Thứ tự lập luận, câu chuyện, dẫn chứng minh họa, giải pháp.
         - Câu kết & Kêu gọi hành động (Ending & CTA): Cách chốt hạ video, điều hướng tương tác (comment/share/mua).

      PHẦN 2: KỊCH BẢN REMAKE CHUẨN SIGNATURE CHO THƯƠNG HIỆU (${brand?.name || 'Brand'})
      - Kịch bản Remake PHẢI TẬN DỤNG VÀ KẾ THỪA TOÀN BỘ ĐIỂM THẮNG (Hook, Pacing, Góc quay, Cách demo) từ bảng phân tích ở Phần 1.
      - Nhưng được hòa quyện 100% các yếu tố SIGNATURE đặc trưng của Brand:
        + ÁP DỤNG CHÍNH XÁC 100% CÁCH XƯNG HÔ CỦA BRAND:
          * Người nói: "${brand?.addressingSpeaker || 'Mình'}"
          * Người nghe: "${brand?.addressingAudience || 'Các bạn'}"
        + GIỌNG VĂN (TONE OF VOICE): ${brand?.brandVoiceTone || 'Tự nhiên, chân thành, cuốn hút'}
        + ĐIỂM CỐT LÕI / USPs / CÔNG NGHỆ: ${brand?.coreUSPs || 'Chất lượng hàng đầu'}
        + TUÂN THỦ ĐIỀU CẤM KỴ: ${brand?.forbiddenKeywords || 'Không dùng từ thô tục, không dìm đối thủ'}
        + CÔNG THỨC: ${formulaInstruction}
      ${extraReqs}

      =======================================================
      📑 YÊU CẦU ĐỊNH DẠNG ĐẦU RA (MÃ HTML SẠCH - GIAO DIỆN LIGHT THEME CAO CẤP):
      =======================================================
      Hãy xuất ra mã HTML sạch (không bọc <html>/<body>), thiết kế tinh tế với Tailwind CSS dành cho Light Theme:

      <!-- KHỐI 1: TỔNG QUAN ẤN TƯỢNG -->
      <div class="mb-6 p-5 bg-white rounded-2xl border border-red-200 shadow-lg">
        <div class="flex items-center justify-between mb-3 border-b border-red-100 pb-3">
          <h3 class="text-base font-bold text-red-900 flex items-center gap-2">
            📊 PHẦN 1: BẢNG PHÂN TÍCH CHI TIẾT VIDEO/NỘI DUNG GỐC
          </h3>
          <span class="text-xs text-red-700 bg-red-50 px-3 py-1 rounded-full border border-red-200 font-medium">
            Có thể xuất trực tiếp sang Excel / Google Sheets
          </span>
        </div>
        
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs md:text-sm text-slate-700 mb-5">
          <div class="p-3.5 bg-red-50/60 rounded-xl border border-red-100">
            <span class="font-bold text-red-900 block mb-1">🌟 1. Ấn Tượng Tổng Quan:</span>
            <p class="leading-relaxed">...</p>
          </div>
          <div class="p-3.5 bg-red-50/60 rounded-xl border border-red-100">
            <span class="font-bold text-red-900 block mb-1">🎯 2. Yếu Tố Viral Cốt Lõi:</span>
            <p class="leading-relaxed">...</p>
          </div>
        </div>

        <!-- BẢNG PHÂN TÍCH HÌNH THỨC & NỘI DUNG (TABLE DÙNG ĐỂ XUẤT EXCEL / GG SHEETS) -->
        <div class="overflow-x-auto rounded-xl border border-red-200 mb-4">
          <table class="w-full text-left border-collapse text-xs md:text-sm">
            <thead>
              <tr class="bg-red-100/80 text-red-950 uppercase tracking-wider text-[11px] font-bold">
                <th class="p-3 border border-red-200 w-1/4">Hạng Mục Phân Tích</th>
                <th class="p-3 border border-red-200 w-1/2">Chi Tiết Thực Tế Trong Video Mẫu</th>
                <th class="p-3 border border-red-200 w-1/4">Chiến Thuật Giữ Chân Khán Giả</th>
              </tr>
            </thead>
            <tbody class="bg-white divide-y divide-red-100 text-slate-700">
              <tr class="hover:bg-red-50/40">
                <td class="p-3 border border-red-100 font-semibold text-red-800">Thumbnail & Bìa Video</td>
                <td class="p-3 border border-red-100">...</td>
                <td class="p-3 border border-red-100 text-slate-500">...</td>
              </tr>
              <tr class="hover:bg-red-50/40">
                <td class="p-3 border border-red-100 font-semibold text-red-800">Trang Phục & Tạo Hình Nhân Vật</td>
                <td class="p-3 border border-red-100">...</td>
                <td class="p-3 border border-red-100 text-slate-500">...</td>
              </tr>
              <tr class="hover:bg-red-50/40">
                <td class="p-3 border border-red-100 font-semibold text-red-800">Khuôn Mặt, Ánh Mắt & Biểu Cảm</td>
                <td class="p-3 border border-red-100">...</td>
                <td class="p-3 border border-red-100 text-slate-500">...</td>
              </tr>
              <tr class="hover:bg-red-50/40">
                <td class="p-3 border border-red-100 font-semibold text-red-800">Tone Giọng Nói & Tốc Độ (Pacing)</td>
                <td class="p-3 border border-red-100">...</td>
                <td class="p-3 border border-red-100 text-slate-500">...</td>
              </tr>
              <tr class="hover:bg-red-50/40">
                <td class="p-3 border border-red-100 font-semibold text-red-800">Hành Động, Cử Chỉ & Demo</td>
                <td class="p-3 border border-red-100">...</td>
                <td class="p-3 border border-red-100 text-slate-500">...</td>
              </tr>
              <tr class="hover:bg-red-50/40">
                <td class="p-3 border border-red-100 font-semibold text-red-800">Bối Cảnh, Góc Máy & Cắt Cảnh</td>
                <td class="p-3 border border-red-100">...</td>
                <td class="p-3 border border-red-100 text-slate-500">...</td>
              </tr>
              <tr class="hover:bg-red-50/40">
                <td class="p-3 border border-red-100 font-semibold text-red-800">Text On Screen, BGM & Sound Effect</td>
                <td class="p-3 border border-red-100">...</td>
                <td class="p-3 border border-red-100 text-slate-500">...</td>
              </tr>
              <tr class="bg-red-50/80 font-medium hover:bg-red-100/50">
                <td class="p-3 border border-red-200 font-bold text-red-900">⚡ Hook 3 Giây Đầu Tiên</td>
                <td class="p-3 border border-red-200 text-red-950 font-semibold">"..."</td>
                <td class="p-3 border border-red-200 text-red-800">...</td>
              </tr>
              <tr class="hover:bg-red-50/40">
                <td class="p-3 border border-red-100 font-semibold text-red-900">⏳ 10 Giây Tiếp Theo</td>
                <td class="p-3 border border-red-100">"..."</td>
                <td class="p-3 border border-red-100 text-slate-500">...</td>
              </tr>
              <tr class="hover:bg-red-50/40">
                <td class="p-3 border border-red-100 font-semibold text-purple-900">📖 Triển Khai Thân Bài & Đưa Giải Pháp</td>
                <td class="p-3 border border-red-100">...</td>
                <td class="p-3 border border-red-100 text-slate-500">...</td>
              </tr>
              <tr class="hover:bg-red-50/40">
                <td class="p-3 border border-red-100 font-semibold text-red-900">🎯 Kết Bài & Lời Kêu Gọi (Ending & CTA)</td>
                <td class="p-3 border border-red-100">"..."</td>
                <td class="p-3 border border-red-100 text-slate-500">...</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- KHỐI 2: KỊCH BẢN REMAKE HOÀN CHỈNH CHO THƯƠNG HIỆU -->
      <div class="mb-6 p-5 bg-gradient-to-br from-red-50 via-white to-red-50 rounded-2xl border border-red-300 shadow-xl">
        <div class="flex items-center justify-between mb-4 border-b border-red-200 pb-3">
          <div>
            <h3 class="text-base md:text-lg font-bold text-red-950 flex items-center gap-2">
              🎬 PHẦN 2: KỊCH BẢN REMAKE ĐỘC NHẤT CHO ${brandLabelUpper}
            </h3>
            <p class="text-xs text-red-700 mt-0.5 font-medium">
              Kế thừa 100% điểm thắng video mẫu + Lồng ghép bản sắc và sản phẩm của <strong>${brandLabel}</strong>
            </p>
          </div>
          <span class="text-xs px-3 py-1 rounded-full bg-red-100 text-red-800 border border-red-300 font-bold">
            Chuẩn Giọng ${brandSpeaker} ➔ ${brandAudience}
          </span>
        </div>

        <!-- BẢNG PHÂN CẢNH KỊCH BẢN SẢN XUẤT (PRODUCTION SCRIPT) -->
        <div class="overflow-x-auto rounded-xl border border-red-200 mb-5 shadow-sm">
          <table class="w-full text-left border-collapse text-xs md:text-sm">
            <thead>
              <tr class="bg-red-100/90 text-red-950 uppercase tracking-wider text-[11px] font-bold">
                <th class="p-3 border border-red-200 w-24">Thời Lượng</th>
                <th class="p-3 border border-red-200 w-2/5">Lời Thoại (Đúng Giọng & Ngôi Xưng Thương Hiệu)</th>
                <th class="p-3 border border-red-200 w-1/3">Mô Tả Visual / Hành Động / Góc Máy</th>
                <th class="p-3 border border-red-200">Biểu Cảm, Chữ Nổi & BGM</th>
              </tr>
            </thead>
            <tbody class="bg-white divide-y divide-red-100 text-slate-700">
              <tr class="hover:bg-red-50/40">
                <td class="p-3 border border-red-100 font-bold text-red-700">0 - 3s<br/><span class="text-[10px] font-semibold text-slate-400">HOOK VIRAL</span></td>
                <td class="p-3 border border-red-100 font-medium text-slate-900">...</td>
                <td class="p-3 border border-red-100 text-slate-600 italic">...</td>
                <td class="p-3 border border-red-100 text-xs text-red-800 font-medium">...</td>
              </tr>
              <tr class="hover:bg-red-50/40">
                <td class="p-3 border border-red-100 font-bold text-amber-700">3 - 12s<br/><span class="text-[10px] font-semibold text-slate-400">NỖI ĐAU/VẤN ĐỀ</span></td>
                <td class="p-3 border border-red-100">...</td>
                <td class="p-3 border border-red-100 text-slate-600 italic">...</td>
                <td class="p-3 border border-red-100 text-xs text-red-800 font-medium">...</td>
              </tr>
              <tr class="hover:bg-red-50/40">
                <td class="p-3 border border-red-100 font-bold text-emerald-700">12 - 40s<br/><span class="text-[10px] font-semibold text-slate-400">GIẢI PHÁP & USP</span></td>
                <td class="p-3 border border-red-100">...</td>
                <td class="p-3 border border-red-100 text-slate-600 italic">...</td>
                <td class="p-3 border border-red-100 text-xs text-red-800 font-medium">...</td>
              </tr>
              <tr class="hover:bg-red-50/40">
                <td class="p-3 border border-red-100 font-bold text-purple-700">40 - 60s<br/><span class="text-[10px] font-semibold text-slate-400">KẾT & CTA</span></td>
                <td class="p-3 border border-red-100 font-medium text-slate-900">...</td>
                <td class="p-3 border border-red-100 text-slate-600 italic">...</td>
                <td class="p-3 border border-red-100 text-xs text-red-800 font-medium">...</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- 3 OPTIONS HOOK VIRAL CHUẨN BRAND -->
        <div class="p-4 bg-white rounded-xl border border-red-200 mb-4 shadow-sm">
          <h4 class="text-xs font-bold text-red-900 uppercase tracking-wider mb-2.5">
            🔥 3 Phương Án Hook Mở Đầu (0-3s) Chuẩn Giọng Thương Hiệu:
          </h4>
          <div class="space-y-2 text-xs md:text-sm text-slate-800">
            <div class="p-2.5 bg-red-50/60 rounded-lg border border-red-100">
              <strong class="text-red-900">Option 1 (Xoáy nỗi đau/Tò mò):</strong> "..."
            </div>
            <div class="p-2.5 bg-red-50/60 rounded-lg border border-red-100">
              <strong class="text-red-900">Option 2 (Trải nghiệm thực tế / Demo bất ngờ):</strong> "..."
            </div>
            <div class="p-2.5 bg-red-50/60 rounded-lg border border-red-100">
              <strong class="text-red-900">Option 3 (Cảnh báo sai lầm thường gặp):</strong> "..."
            </div>
          </div>
        </div>

        <!-- GHI CHÚ ĐẠO DIỄN VÀ FOOTER -->
        <div class="p-4 bg-white rounded-xl border border-red-200 text-xs text-slate-700 space-y-2 shadow-sm">
          <p><strong class="text-red-900">🎵 Gợi ý Nhạc nền (BGM) & Hiệu ứng âm thanh:</strong> ...</p>
          <p><strong class="text-red-900">🎥 Lưu ý về góc máy & ánh sáng khi quay:</strong> ...</p>
          <p><strong class="text-red-900">📌 Hashtag đề xuất:</strong> ${brandHashtags || '(Tự đề xuất 5-8 hashtag bám sát thương hiệu và chủ đề, không bịa tên chiến dịch không có thật)'}</p>
        </div>
      </div>
      `;


    case AnalysisMode.CONTENT_AUDIT:
    case AnalysisMode.CONTENT_REMAKE:
      return `
      Dựa trên nguồn dữ liệu gốc (Văn bản / Link / Ảnh / Âm thanh), hãy PHÂN TÍCH và REMAKE lại thành một BÀI ĐĂNG MẠNG XÃ HỘI (Facebook/Threads/X/Instagram) mang trọn vẹn bản sắc thương hiệu ${brandLabel}.

      ${brandGuidelines}

      DỮ LIỆU ĐẦU VÀO:
      - NỘI DUNG VĂN BẢN: "${userPrompt || '(Không có)'}"
      - ĐƯỜNG DẪN LINK: "${url || '(Không có)'}"

      YÊU CẦU REMAKE THEO 4 NGUYÊN TẮC BẮT BUỘC:
      1. NGUYÊN TẮC REMAKE:
         - Học theo: Cấu trúc mở bài (Hook), cách dẫn dắt tình huống, cách tạo cảm xúc/tò mò của bài mẫu.
         - Thay đổi: Biến toàn bộ nội dung, câu chuyện, ví dụ và giải pháp thành sản phẩm/dịch vụ của ${brandLabel}. Tuyệt đối không sao chép nguyên văn câu chữ.
      2. TONE & VOICE:
         - Sắc thái: ${brand?.brandVoiceTone || 'Chân thành, tự nhiên, thu hút'}.
         - Xưng hô: người nói xưng "${brandSpeaker}", gọi khán giả là "${brandAudience}".
         - Ngôn ngữ: Tự nhiên, đúng ngữ cảnh ngành hàng, không hù dọa, không quá học thuật.
      3. QUY TẮC AN TOÀN SẢN PHẨM:
         - Chỉ sử dụng các claim, thành phần, công dụng có trong thông tin được cung cấp, không tự bịa đặt tính năng.
      4. CẤU TRÚC CUỐI BÀI BẮT BUỘC:
${brandFooter
  ? `         Luôn kết thúc bài bằng CTA phù hợp, dải phân cách và đoạn Footer nguyên văn sau:
━━━━━━━━━━━━━━
${brandFooter}`
  : `         Luôn kết thúc bài bằng CTA phù hợp với thương hiệu${brandHashtags ? ` và bộ hashtag: ${brandHashtags}` : ''}. KHÔNG tự bịa link, hotline hay hashtag không được cung cấp.`}

      ${extraReqs}

      YÊU CẦU ĐỊNH DẠNG: Trả về mã HTML sạch với khung bài đăng mô phỏng mạng xã hội hiện đại chuẩn Light Theme (div class="bg-white rounded-2xl p-6 border border-red-200 shadow-xl text-slate-800").
      `;

    case AnalysisMode.SCRIPT_GENERATION:
      return `
      Ý TƯỞNG / BẢN NHÁP GỐC CỦA NGƯỜI DÙNG: "${userPrompt}"

      ${brandGuidelines}

      NHIỆM VỤ: Hãy biến ý tưởng thô ở trên thành một KỊCH BẢN VIDEO VIRAL (TikTok/Reels/Shorts) chi tiết, chuẩn 100% định vị và giọng văn của thương hiệu.

      CÔNG THỨC KỊCH BẢN:
      ${formulaInstruction}

      QUY TẮC BẮT BUỘC:
      - Ngôi xưng: "${brand?.addressingSpeaker || 'Mình'}" xưng với "${brand?.addressingAudience || 'Các bạn'}"
      - Giọng điệu: ${brand?.brandVoiceTone || 'Tự nhiên, lôi cuốn'}
      - USPs thương hiệu: ${brand?.coreUSPs || 'Chất lượng'}
      - CTA: ${brand?.callToAction || 'Theo dõi kênh nhé'}

      ${extraReqs}

      YÊU CẦU ĐỊNH DẠNG: Trả về mã HTML chứa Bảng Kịch Bản Phân Cảnh (Table Tailwind) và 3 Options Hook mở đầu.
      `;

    case AnalysisMode.DEEP_ANALYSIS:
      return `
      Dưới đây là video/nội dung cần PHÂN TÍCH CHUYÊN SÂU & BÓC TÁCH TOÀN DIỆN VỀ HÌNH THỨC, TÂM LÝ HỌC, CHIẾN THUẬT VIRAL VÀ TOÀN BỘ KỊCH BẢN GỐC.

      ${extraReqs}

      =======================================================
      🎯 HỆ THỐNG PHÂN TÍCH & BÓC TÁCH CHI TIẾT (2 PHẦN BẮT BUỘC):
      =======================================================

      PHẦN 1: BẢNG BÓC TÁCH & PHÂN TÍCH ĐẦY ĐỦ CÁC YẾU TỐ VIDEO GỐC
      Hãy phân tích chi tiết, khách quan và sâu sắc tất cả các yếu tố sau từ video gốc:
      1. Ấn tượng tổng quan (Overall Impression):
         - Điểm đọng lại mạnh nhất trong tâm trí người xem.
         - Cảm xúc chủ đạo mà video khơi gợi (tò mò, đồng cảm, hào hứng, cảnh giác, kinh ngạc...).
         - Yếu tố cốt lõi giúp video giữ chân người xem (Retention Driver).
      2. Phân tích Hình thức Video (Production & Visual Formats):
         - Thumbnail / Bìa video: Text nổi bật, biểu cảm khuôn mặt, màu sắc, độ tương phản, mức độ thu hút nhấp chuột.
         - Trang phục & Tạo hình: Phong cách người nói, tính thẩm mỹ, mức độ gần gũi hay uy tín/chuyên gia.
         - Khuôn mặt, Ánh mắt & Biểu cảm: Mức độ năng lượng, ánh mắt nhìn thẳng camera (eye-contact), biểu cảm cơ mặt.
         - Giọng nói, Ngữ điệu & Tốc độ (Voice & Pacing): Tone giọng (nhấn nhá, khoảng ngắt nghỉ pauses, tốc độ nói wpm, độ tự nhiên).
         - Hành động, Cử chỉ & Thao tác Demo: Động tác tay (hand gestures), cách cầm/chạm/thao tác sản phẩm, biểu diễn/test thực tế.
         - Nhân vật & Persona: Vai trò người nói trong video (người trải nghiệm thật, bạn thân tâm tình, chuyên gia phân tích...).
         - Bối cảnh, Ánh sáng & Chuyển cảnh (Pacing & Angles): Ánh sáng (tự nhiên/studio), góc quay (cận/trung/toàn/POV), nhịp cắt cảnh (mỗi 2-3s).
         - Text on Screen, Nhạc nền (BGM) & Sound Effects: Chữ chạy trên màn hình (vị trí/font/màu sắc), âm thanh SFX và nhạc nền tạo nhịp điệu.
      3. Phân tích Nội dung & Cấu trúc Kịch bản (Content Architecture):
         - Hook 3 giây đầu tiên nói gì & làm gì: Chiêu thức giật tò mò, tạo xung đột, thách thức niềm tin cũ hoặc đánh trúng nỗi đau/khao khát.
         - 10 giây đầu tiên nói gì: Cách mở rộng vấn đề, giữ chân người xem không lướt qua (Retention Bridge).
         - Cách triển khai thân bài: Thứ tự lập luận, câu chuyện thực tế, dẫn chứng minh họa, giải pháp đưa ra.
         - Câu kết & Kêu gọi hành động (Ending & CTA): Cách chốt hạ video, điều hướng tương tác (comment, follow, share, save).
      4. Đúc kết Công thức & Tâm lý học Viral của Video Gốc:
         - Đòn bẩy tâm lý (Psychological Triggers) được sử dụng.
         - Đánh giá điểm mạnh vượt trội và điểm có thể cải thiện của video.

      PHẦN 2: BẢNG BÓC TÁCH CHI TIẾT TOÀN BỘ KỊCH BẢN VIDEO GỐC (FULL SCRIPT & TIMELINE BREAKDOWN)
      Bóc tách chi tiết từng phân cảnh từ giây đầu tiên đến giây cuối cùng:
      - Cột 1: Mốc thời gian (Timeline: 00:00 - 00:03, 00:03 - 00:10, 00:10 - 00:25...)
      - Cột 2: Phân cảnh thị giác & Thao tác hành động (Visual, Action, Camera Angle, Text on Screen)
      - Cột 3: Lời thoại chi tiết & Âm thanh (Audio, Dialogue, Voiceover, SFX, BGM)
      - Cột 4: Kỹ thuật giữ chân & Ý đồ tâm lý (Retention Hook & Psychology Technique)

      ⚠️ LƯU Ý QUAN TRỌNG: Trong chế độ này, KHÔNG cần đưa ra gợi ý kịch bản remake hay tư vấn cho brand. Tập trung 100% vào việc phân tích mổ xẻ và bóc tách kịch bản gốc.

      =======================================================
      📑 YÊU CẦU ĐỊNH DẠNG ĐẦU RA (MÃ HTML SẠCH - GIAO DIỆN LIGHT THEME CAO CẤP):
      =======================================================
      Hãy xuất ra mã HTML sạch (không bọc <html>/<body>), thiết kế tinh tế với Tailwind CSS dành cho Light Theme:
      
      <!-- KHỐI 1: TỔNG QUAN ẤN TƯỢNG -->
      <div class="mb-6 p-5 bg-white rounded-2xl border border-red-200 shadow-sm text-slate-800">
        <div class="flex items-center justify-between mb-4 border-b border-red-100 pb-3">
          <h3 class="text-base font-bold text-red-950 flex items-center gap-2">
            🔍 BÁO CÁO PHÂN TÍCH SÂU & GIẢI MÃ VIDEO VIRAL
          </h3>
          <span class="text-xs text-red-700 bg-red-50 px-3 py-1 rounded-full border border-red-200 font-semibold">
            Bóc tách 100% Video Gốc
          </span>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs md:text-sm text-slate-700 mb-5">
          <div class="p-3.5 bg-red-50/60 rounded-xl border border-red-100">
            <span class="font-bold text-red-900 block mb-1">🌟 1. Ấn Tượng Tổng Quan:</span>
            <p class="leading-relaxed">...</p>
          </div>
          <div class="p-3.5 bg-red-50/60 rounded-xl border border-red-100">
            <span class="font-bold text-red-900 block mb-1">🎯 2. Đòn Bẩy Giữ Chân Cốt Lõi:</span>
            <p class="leading-relaxed">...</p>
          </div>
        </div>

        <!-- BẢNG BÓC TÁCH CÁC YẾU TỐ HÌNH THỨC & NỘI DUNG -->
        <h4 class="font-bold text-sm text-slate-900 mb-2 flex items-center gap-1.5">
          📋 Phân Tích Chi Tiết 8 Yếu Tố Hình Thức & 4 Khâu Cấu Trúc
        </h4>
        <div class="overflow-x-auto rounded-xl border border-red-200 mb-6 shadow-xs">
          <table class="w-full text-left border-collapse text-xs md:text-sm">
            <thead>
              <tr class="bg-red-100/90 text-red-950 uppercase tracking-wider text-[11px] font-bold">
                <th class="p-3 border border-red-200 w-1/4">Yếu Tố Bóc Tách</th>
                <th class="p-3 border border-red-200 w-1/2">Hiện Trạng Thực Tế Trong Video</th>
                <th class="p-3 border border-red-200 w-1/4">Hiệu Ứng Tâm Lý / Giữ Chân</th>
              </tr>
            </thead>
            <tbody class="bg-white divide-y divide-red-100 text-slate-700">
              <tr class="hover:bg-red-50/40">
                <td class="p-3 border border-red-100 font-semibold text-red-800">Thumbnail & Bìa Video</td>
                <td class="p-3 border border-red-100">...</td>
                <td class="p-3 border border-red-100 text-slate-600">...</td>
              </tr>
              <tr class="hover:bg-red-50/40">
                <td class="p-3 border border-red-100 font-semibold text-red-800">Trang Phục & Tạo Hình</td>
                <td class="p-3 border border-red-100">...</td>
                <td class="p-3 border border-red-100 text-slate-600">...</td>
              </tr>
              <tr class="hover:bg-red-50/40">
                <td class="p-3 border border-red-100 font-semibold text-red-800">Khuôn Mặt & Ánh Mắt</td>
                <td class="p-3 border border-red-100">...</td>
                <td class="p-3 border border-red-100 text-slate-600">...</td>
              </tr>
              <tr class="hover:bg-red-50/40">
                <td class="p-3 border border-red-100 font-semibold text-red-800">Giọng Nói & Nhịp Điệu (Pacing)</td>
                <td class="p-3 border border-red-100">...</td>
                <td class="p-3 border border-red-100 text-slate-600">...</td>
              </tr>
              <tr class="hover:bg-red-50/40">
                <td class="p-3 border border-red-100 font-semibold text-red-800">Cử Chỉ & Thao Tác Demo</td>
                <td class="p-3 border border-red-100">...</td>
                <td class="p-3 border border-red-100 text-slate-600">...</td>
              </tr>
              <tr class="hover:bg-red-50/40">
                <td class="p-3 border border-red-100 font-semibold text-red-800">Persona & Hình Tượng</td>
                <td class="p-3 border border-red-100">...</td>
                <td class="p-3 border border-red-100 text-slate-600">...</td>
              </tr>
              <tr class="hover:bg-red-50/40">
                <td class="p-3 border border-red-100 font-semibold text-red-800">Góc Máy, Bối Cảnh & Cắt Cảnh</td>
                <td class="p-3 border border-red-100">...</td>
                <td class="p-3 border border-red-100 text-slate-600">...</td>
              </tr>
              <tr class="hover:bg-red-50/40">
                <td class="p-3 border border-red-100 font-semibold text-red-800">Text on Screen, BGM & SFX</td>
                <td class="p-3 border border-red-100">...</td>
                <td class="p-3 border border-red-100 text-slate-600">...</td>
              </tr>
              <tr class="hover:bg-red-50/40">
                <td class="p-3 border border-red-100 font-semibold text-red-800">Hook 3 Giây Đầu</td>
                <td class="p-3 border border-red-100">...</td>
                <td class="p-3 border border-red-100 text-slate-600">...</td>
              </tr>
              <tr class="hover:bg-red-50/40">
                <td class="p-3 border border-red-100 font-semibold text-red-800">10 Giây Đầu Tiên</td>
                <td class="p-3 border border-red-100">...</td>
                <td class="p-3 border border-red-100 text-slate-600">...</td>
              </tr>
              <tr class="hover:bg-red-50/40">
                <td class="p-3 border border-red-100 font-semibold text-red-800">Triển Khai Thân Bài</td>
                <td class="p-3 border border-red-100">...</td>
                <td class="p-3 border border-red-100 text-slate-600">...</td>
              </tr>
              <tr class="hover:bg-red-50/40">
                <td class="p-3 border border-red-100 font-semibold text-red-800">Đoạn Kết & CTA</td>
                <td class="p-3 border border-red-100">...</td>
                <td class="p-3 border border-red-100 text-slate-600">...</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- BẢNG BÓC TÁCH TOÀN BỘ KỊCH BẢN VIDEO GỐC -->
        <h4 class="font-bold text-sm text-slate-900 mb-2 flex items-center justify-between">
          <span>🎬 Bảng Bóc Tách Toàn Bộ Kịch Bản Gốc Từng Giây (Full Script Timeline)</span>
          <span class="text-[11px] text-red-700 font-normal">Hỗ trợ copy/xuất sang bảng tính</span>
        </h4>
        <div class="overflow-x-auto rounded-xl border border-red-200 mb-4 shadow-xs">
          <table class="w-full text-left border-collapse text-xs md:text-sm">
            <thead>
              <tr class="bg-red-100/80 text-red-950 uppercase tracking-wider text-[11px] font-bold">
                <th class="p-3 border border-red-200 w-24">Timeline</th>
                <th class="p-3 border border-red-200 w-1/3">Hình Ảnh & Thao Tác (Visual / Action)</th>
                <th class="p-3 border border-red-200 w-1/3">Lời Thoại & Âm Thanh (Audio / Dialogue)</th>
                <th class="p-3 border border-red-200">Mục Đích / Kỹ Thuật Giữ Chân</th>
              </tr>
            </thead>
            <tbody class="bg-white divide-y divide-red-100 text-slate-700">
              <tr class="hover:bg-red-50/40">
                <td class="p-3 border border-red-100 font-mono text-red-700 font-bold">00:00 - 00:03</td>
                <td class="p-3 border border-red-100">...</td>
                <td class="p-3 border border-red-100 font-medium text-slate-900">"..."</td>
                <td class="p-3 border border-red-100 text-slate-600">...</td>
              </tr>
              <!-- Tiếp tục toàn bộ các phân cảnh của video -->
            </tbody>
          </table>
        </div>

        <!-- TỔNG KẾT CÔNG THỨC VIRAL -->
        <div class="p-4 bg-gradient-to-r from-red-50 to-red-50 rounded-xl border border-red-200 text-xs md:text-sm text-slate-800 space-y-2">
          <h5 class="font-bold text-red-950">🧠 Đúc Kết Công Thức Giữ Chân & Tâm Lý Học Của Video:</h5>
          <p class="leading-relaxed">...</p>
        </div>
      </div>
      `;


    case AnalysisMode.SCRIPT_EXTRACT:
      return `
      Hãy trích xuất chính xác toàn bộ lời thoại (Transcript) và mốc thời gian của nội dung/video này.

      Yêu cầu:
      - Định dạng HTML dễ đọc, phân đoạn rõ ràng.
      - Đánh dấu các mốc thời gian quan trọng bằng <strong>.
      ${extraReqs}
      `;

    case AnalysisMode.THUMBNAIL_AUDIT:
      return `
      Đánh giá chuyên sâu hình ảnh Thumbnail/Bìa này dưới góc độ thiết kế đồ họa, tâm lý học thị giác và nhận diện thương hiệu.

      ${brandGuidelines}

      NỘI DUNG PHÂN TÍCH:
      1. Đánh giá Visual: Độ tương phản màu sắc, Typography, Chủ thể trung tâm, Điểm nhấn gây tò mò (Visual Hook).
      2. Chấm điểm tỷ lệ nhấp (CTR Score trên thang điểm 10).
      3. 3 Lời khuyên cải tiến cụ thể để phù hợp hơn với thương hiệu ${brand?.name || ''}.
      ${extraReqs}

      YÊU CẦU ĐỊNH DẠNG: Trả về mã HTML sạch với style Tailwind.
      `;

    case AnalysisMode.ARTICLE_ANALYSIS:
      return `
      Hãy MỔ XẺ bài viết dưới đây để giải thích vì sao nó hiệu quả. Nguồn dữ liệu có thể gồm: nội dung văn bản dán trực tiếp, một đường link bài viết, và/hoặc ảnh chụp bài viết.

      DỮ LIỆU ĐẦU VÀO:
      - NỘI DUNG VĂN BẢN CỦA BÀI VIẾT: "${userPrompt || '(Không dán text - hãy đọc từ link hoặc từ ảnh đính kèm)'}"
      ${url ? `- LINK BÀI VIẾT: ${url}` : ''}
      - ẢNH ĐÍNH KÈM: Nếu có ảnh trong phần đầu vào, hãy đọc toàn bộ chữ trong ảnh và phân tích cả phần trình bày thị giác.

      PHẠM VI NGHIÊM NGẶT - ĐỌC KỸ TRƯỚC KHI TRẢ LỜI:
      - Đây là bản phân tích để NGHIÊN CỨU VÀ HỌC HỎI, không phải bản đánh giá hay bản sửa bài.
      - KHÔNG chấm điểm, KHÔNG cho điểm số, KHÔNG lập bảng điểm.
      - KHÔNG viết lại bài, KHÔNG đề xuất phiên bản cải tiến, KHÔNG gợi ý câu thay thế.
      - KHÔNG nhắc tới hay áp bất kỳ thương hiệu nào của người dùng vào bài viết này.
      - Nhiệm vụ duy nhất: giải thích bài viết đang dùng những kỹ thuật gì và vì sao chúng có tác dụng.

      NỘI DUNG PHÂN TÍCH:

      1. BỐI CẢNH BÀI VIẾT
         - Bài này viết về chủ đề gì, cho ai đọc, đăng trên nền tảng nào.
         - Định dạng và độ dài. Mục tiêu bài viết đang nhắm tới.

      2. HOOK - CÂU MỞ ĐẦU
         - Trích NGUYÊN VĂN câu/đoạn mở đầu.
         - Thuộc dạng hook nào: câu hỏi, con số, nghịch lý, nỗi đau, tò mò, tuyên bố gây sốc, kể chuyện...
         - Cơ chế hoạt động: vì sao câu này giữ được người đọc lại.

      3. TÂM LÝ NGƯỜI ĐỌC (phần quan trọng nhất - phân tích thật kỹ)
         - Insight hoặc nỗi đau mà bài đang chạm vào.
         - Chuỗi cảm xúc bài dẫn dắt người đọc đi qua, theo thứ tự từng đoạn.
         - Các đòn bẩy tâm lý đang dùng: FOMO, bằng chứng xã hội, khan hiếm, thẩm quyền chuyên gia, tương hỗ, đồng cảm, tò mò, sợ mất mát... Chỉ rõ đòn bẩy nào nằm ở câu nào.
         - Cơ chế giữ chân: những câu/đoạn nào tạo lý do đọc tiếp và bằng cách nào.
         - Cách bài xây dựng niềm tin: dẫn chứng, trải nghiệm cá nhân, số liệu, uy tín người viết.

      4. CẤU TRÚC & MẠCH ĐỌC
         - Bố cục thực tế của bài và công thức đang dùng (PAS, AIDA, storytelling, listicle...).
         - Nhịp điệu: độ dài câu và đoạn, chỗ dồn dập, chỗ chậm lại, và tác dụng của từng nhịp.
         - Cách bài chuyển ý giữa các phần.

      5. GIỌNG VĂN & NGÔN NGỮ
         - Giọng văn của chính bài viết này, xưng hô người viết đang dùng.
         - Lớp từ vựng đặc trưng, cách dùng từ tạo cảm giác gần gũi hoặc chuyên môn.
         - Những câu chữ có sức nặng nhất và lý do.

      6. HÌNH THỨC TRÌNH BÀY
         - Cách xuống dòng, ngắt đoạn, dùng emoji, gạch đầu dòng, in đậm.
         - Trải nghiệm đọc trên điện thoại.
         - Cách trình bày hỗ trợ nội dung như thế nào.

      7. PHÂN TÍCH HÌNH ẢNH ĐÍNH KÈM (chỉ làm nếu có ảnh)
         - Nội dung và bố cục từng ảnh.
         - Chữ trên ảnh: cách trình bày, vai trò với nội dung chữ.
         - Mức ăn khớp giữa ảnh và bài viết, ảnh tự kể được gì khi người đọc chỉ lướt qua.

      8. CTA & ĐƯỜNG DẪN HÀNH ĐỘNG
         - Trích nguyên văn CTA hiện có, hoặc ghi rõ là bài không có CTA.
         - Vị trí đặt CTA và cách bài dẫn người đọc tới đó.

      9. TỪ KHÓA & KHẢ NĂNG LAN TỎA
         - Từ khóa, hashtag đang dùng và vai trò của chúng.
         - Yếu tố khiến người đọc muốn chia sẻ hoặc lưu lại. Nếu không có thì ghi rõ là không có.

      10. BẢNG BÓC TÁCH THEO TỪNG ĐOẠN
         Lập bảng HTML gồm các cột: Đoạn trích nguyên văn | Vai trò trong bài | Kỹ thuật đang dùng | Tác động lên người đọc.
         Đi hết bài từ đầu đến cuối, không bỏ sót đoạn nào quan trọng.

      11. NHỮNG KỸ THUẬT ĐÁNG HỌC
         Rút ra danh sách các kỹ thuật viết cụ thể mà bài này đang dùng hiệu quả, diễn đạt thành nguyên tắc có thể áp dụng lại cho bài khác. Mỗi kỹ thuật kèm dẫn chứng nguyên văn từ bài.

      ${extraReqs}

      QUY TẮC BẮT BUỘC:
      - Mọi nhận định PHẢI kèm dẫn chứng trích nguyên văn từ bài viết. Không nói chung chung.
      - TUYỆT ĐỐI KHÔNG bịa số liệu lượt xem, tương tác, thứ hạng SEO nếu không được cung cấp.
      - Nếu không đọc được nội dung bài viết từ bất kỳ nguồn nào, PHẢI nói rõ là không truy cập được và dừng lại, không được tự nghĩ ra nội dung bài.
      - Không chấm điểm. Không viết lại. Không nhắc thương hiệu của người dùng.

      YÊU CẦU ĐỊNH DẠNG: Trả về mã HTML sạch với style Tailwind, dùng thẻ heading rõ ràng cho từng mục, bảng có viền, và làm nổi bật các đoạn trích dẫn nguyên văn bằng nền màu nhạt.
      `;

    default:
      return `Phân tích nội dung này theo quy tắc thương hiệu: ${brandGuidelines}`;
  }
};

const cleanResponse = (text: string): string => {
  let cleaned = text.trim();
  if (cleaned.startsWith("```html")) {
    cleaned = cleaned.substring(7);
  } else if (cleaned.startsWith("```")) {
    cleaned = cleaned.substring(3);
  }
  
  if (cleaned.endsWith("```")) {
    cleaned = cleaned.substring(0, cleaned.length - 3);
  }
  return cleaned.trim();
};

const formatCount = (n: number | null): string => {
  if (n === null || n === undefined) return 'không có dữ liệu';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + ' triệu';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
};

// Real numbers scraped from the post, so the model never has to guess engagement.
export const formatVideoMeta = (meta: VideoMeta): string => {
  const duration = meta.durationSec !== null
    ? `${Math.floor(meta.durationSec / 60)} phút ${meta.durationSec % 60} giây`
    : 'không rõ';

  return `
  =======================================================
  📊 DỮ LIỆU THẬT CỦA VIDEO GỐC (trích xuất trực tiếp từ ${meta.platform})
  =======================================================
  - NGƯỜI ĐĂNG: ${meta.uploader || 'không rõ'}
  - THỜI LƯỢNG: ${duration}
  - CAPTION / TIÊU ĐỀ GỐC: "${meta.title || '(trống)'}"
  ${meta.description && meta.description !== meta.title ? `- MÔ TẢ: "${meta.description}"` : ''}
  ${meta.hashtags.length ? `- HASHTAG: ${meta.hashtags.join(' ')}` : ''}
  ${meta.soundtrack ? `- NHẠC NỀN: ${meta.soundtrack}` : ''}
  - LƯỢT XEM: ${formatCount(meta.viewCount)}
  - LƯỢT THÍCH: ${formatCount(meta.likeCount)}
  - BÌNH LUẬN: ${formatCount(meta.commentCount)}
  - CHIA SẺ: ${formatCount(meta.shareCount)}
  - NGÀY ĐĂNG: ${meta.uploadDate || 'không rõ'}
  =======================================================
  LƯU Ý: Đây là số liệu thật. Hãy dùng chúng khi đánh giá hiệu quả nội dung,
  và TUYỆT ĐỐI KHÔNG bịa thêm số liệu nào khác ngoài danh sách trên.
  =======================================================
  `;
};

export const analyzeContent = async (
  _apiKey: string,
  mode: AnalysisMode,
  base64Data: string, 
  mimeType: string,   
  userPrompt?: string,
  contextData?: string,
  url?: string, 
  brand?: BrandProfile,
  additionalInstructions?: string,
  formula?: ScriptFormula,
  fileUri?: string,
  videoMeta?: VideoMeta,
  extraImages?: { base64: string; mimeType: string }[]
): Promise<string> => {



  let parts: any[] = [];
  
  if (mode === AnalysisMode.CONTENT_REMAKE && contextData) {
     parts.push({ text: `NỘI DUNG GỐC ĐÃ TRÍCH XUẤT:\n${contextData}` });
  } 
  
  // A real video pulled from a social link: Gemini watches the actual file.
  if (fileUri) {
    parts.push({
      fileData: {
        fileUri: fileUri,
        mimeType: mimeType || 'video/mp4'
      }
    });
  } else if (base64Data && mimeType) {
    parts.push({
      inlineData: {
        data: base64Data,
        mimeType: mimeType
      }
    });
  }

  // Screenshots of an article: every image goes in so the model can read them all.
  if (extraImages?.length) {
    for (const img of extraImages) {
      parts.push({ inlineData: { data: img.base64, mimeType: img.mimeType } });
    }
  }

  const systemInstruction = getSystemInstruction(mode, brand);
  let promptText = getPrompt(mode, userPrompt, url, brand, additionalInstructions, formula);

  if (videoMeta) {
    promptText += `\n\n${formatVideoMeta(videoMeta)}`;
  }

  // Only ask the model to hunt the web when we could NOT hand it the video itself.
  const needsWebLookup = !fileUri && !!url;

  if (needsWebLookup) {
    promptText += `\n\nCHÚ Ý: Không tải được file gốc từ liên kết này. Hãy đọc thông tin công khai về liên kết: ${url}
QUAN TRỌNG: Nếu không tìm được dữ liệu thật về nội dung video, PHẢI nói rõ là không truy cập được và KHÔNG được bịa ra nội dung, lời thoại hay số liệu.`;
  }

  // Text-only work can run on whichever provider the user assigned; anything
  // carrying video or images has to stay on Gemini, the only one that reads them.
  const hasMedia = !!fileUri || !!base64Data || !!extraImages?.length;
  const routed = resolveProvider(hasMedia ? 'video' : 'text');

  if (!hasMedia && routed.id !== 'gemini') {
    const payload = await postJson<{ text: string }>('/api/llm', {
      provider: routed.id,
      apiKey: routed.apiKey,
      model: routed.model,
      system: systemInstruction,
      prompt: promptText,
    });
    return cleanResponse(payload.text);
  }

  const payload = await postJson<{ text: string }>('/api/gemini', {
    apiKey: getGeminiApiKey(),
    parts: [...parts, { text: promptText }],
    systemInstruction,
    temperature: 0.7,
    useSearch: mode === AnalysisMode.CONTENT_AUDIT || needsWebLookup,
  });

  return cleanResponse(payload.text);
};

export const generateRemakeThumbnail = async (
  _apiKey: string,
  competitorThumbBase64: string,
  userAssetBase64: string,
  userAssetMimeType: string,
  titleText: string,
  aspectRatio: string = "16:9",
  brand?: BrandProfile
): Promise<string> => {

  const brandContext = brand ? `Brand: ${brand.name}. Industry: ${brand.industry}. Style tone: ${brand.brandVoiceTone}.` : '';

  const parts = [
    {
      inlineData: {
        data: competitorThumbBase64,
        mimeType: 'image/jpeg' 
      }
    },
    {
      inlineData: {
        data: userAssetBase64,
        mimeType: userAssetMimeType
      }
    },
    {
      text: `
      Create a high-CTR YouTube/TikTok cover thumbnail.
      ${brandContext}
      
      Image 1: Reference viral composition, high-contrast lighting, and layout angle.
      Image 2: Subject/Model/Product to feature as the main hero.
      
      TASK:
      - Seamlessly feature the subject from Image 2 into a brand-new vibrant, click-worthy scene inspired by the high-CTR style of Image 1.
      - Bold, legible 3D title text overlay: "${titleText}".
      - Sharp details, high saturation, professional studio lighting, 4K quality.
      - Aspect Ratio: ${aspectRatio}.
      `
    }
  ];

  const payload = await postJson<{ image: string }>('/api/gemini', {
    apiKey: getGeminiApiKey(),
    kind: 'image',
    parts,
    aspectRatio,
  });

  return payload.image;
};
