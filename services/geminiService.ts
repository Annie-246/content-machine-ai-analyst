import { AnalysisMode, BrandProfile, ScriptFormula, FORMULA_LABELS, VideoMeta, WaterfallOptions, WATERFALL_OBJECTIVE_LABELS } from "../types";
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
Nhiệm vụ: nhận một nội dung có sẵn (bài viết, video, audio, ảnh - dán trực tiếp hoặc lấy từ link) và VIẾT LẠI nó thành một bài đăng mang giọng văn của ${brandName}, giữ đúng nội dung gốc.

1. NGUỒN LÀ SỰ THẬT DUY NHẤT:
- Phải đọc / xem / nghe hết nguồn trước khi viết. Nguồn là video thì nội dung nằm trong lời nói và hình ảnh của video, không phải trong caption.
- Bài viết lại phải kể đúng những gì nguồn nói: cùng chủ đề, cùng dữ kiện, cùng câu chuyện, cùng kết luận. KHÔNG thêm chi tiết, số liệu, ví dụ hay câu chuyện mà nguồn không có. KHÔNG đổi câu chuyện của nguồn thành câu chuyện của ${brandName}.
- Không xem được nguồn thì nói thẳng, không tự nghĩ ra nội dung.

2. HỌC TỪ NGUỒN, KHÔNG CHÉP NGUỒN:
- Giữ lại cái làm nguồn hiệu quả: cách mở bài, cách dẫn dắt, nhịp điệu, cách tạo cảm xúc.
- Diễn đạt lại hoàn toàn bằng chữ của mình, không dùng lại nguyên văn câu chữ của nguồn.

3. TONE & VOICE:
- Sắc thái chủ đạo: ${voice}.
- Xưng hô: người nói xưng "${speaker}", gọi khán giả là "${audience}".
- Ngôn ngữ: Tự nhiên, đúng ngữ cảnh ngành hàng, không hù dọa, không quá học thuật, không giật gân phản cảm.

4. QUY TẮC AN TOÀN SẢN PHẨM:
- Sản phẩm / dịch vụ của ${brandName} chỉ xuất hiện ở phần kết hoặc CTA, và chỉ với claim, thành phần, công dụng có trong thông tin được cung cấp. Không tự bịa đặt tính năng.

5. CẤU TRÚC CUỐI BÀI:
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
      return `Bạn là trợ lý AI chuyên nghiệp về biên tập nội dung kiêm biên dịch viên. Bạn nghe và trích xuất lại chính xác từng câu chữ, mốc thời gian của nội dung gốc, đồng thời dịch sang tiếng Việt khi nội dung gốc không phải tiếng Việt.
Nguyên tắc bắt buộc:
- Phần script gốc giữ NGUYÊN VĂN đúng ngôn ngữ của video: không dịch, không tóm tắt, không sửa văn phong, không bỏ câu đệm.
- Phần bản dịch là bản dịch tiếng Việt sát nghĩa nhưng tự nhiên như người Việt nói, giữ đúng giọng điệu và sắc thái của người nói, không dịch máy từng từ.
- Nếu nội dung gốc đã là tiếng Việt thì KHÔNG tạo phần dịch.
- Tuyệt đối không bịa lời thoại. Đoạn nào nghe không rõ thì ghi [không nghe rõ] ở đúng vị trí đó.`;

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

    case AnalysisMode.ARTICLE_WRITING:
      return `Bạn là Cây bút Nội dung Viral kiêm Chuyên gia Tâm lý Người đọc, viết cho thương hiệu ${brandName}${industrySuffix}.
Nhiệm vụ: viết ra một bài đăng hoàn chỉnh, đăng được ngay. Đầu vào là một trong hai:
- Một ý tưởng còn thô sơ của người dùng: bạn mở nó ra thành bài đủ sâu.
- Một NGUỒN có sẵn (video, bài viết, ảnh lấy từ link hoặc file): bạn phải hiểu kỹ nguồn trước, rồi viết bài BÁM ĐÚNG nội dung nguồn bằng lời của thương hiệu. Có nguồn thì nguồn là sự thật duy nhất - không thêm dữ kiện nguồn không nói, không chép nguyên văn nguồn.

BỘ TIÊU CHÍ NGẦM - đây chính là những gì làm nên một bài viết hiệu quả, rút ra từ việc mổ xẻ các bài đang chạy tốt. Bạn PHẢI viết sao cho bài đạt được từng điểm dưới đây, nhưng TUYỆT ĐỐI KHÔNG liệt kê hay giảng giải chúng trong bài:
1. HOOK: câu đầu tiên phải chặn được ngón tay đang lướt. Nó phải chạm vào một nỗi đau, một nghịch lý, một con số bất ngờ hoặc một điều người đọc tưởng mình đã biết mà hoá ra không phải.
2. TÂM LÝ: xác định rõ insight thật sự của người đọc, rồi dẫn họ đi qua một chuỗi cảm xúc có chủ đích. Dùng đòn bẩy tâm lý (FOMO, bằng chứng xã hội, khan hiếm, thẩm quyền, đồng cảm, sợ mất mát) đúng chỗ, không rải đều.
3. GIỮ CHÂN: cứ vài đoạn phải có một lý do để đọc tiếp - một câu hỏi mở, một tiết lộ chưa trọn, một con số chưa giải thích.
4. CẤU TRÚC: theo đúng công thức người dùng chọn, mạch đọc liền lạc, chuyển ý mượt.
5. NHỊP ĐIỆU: câu dài xen câu ngắn. Chỗ cao trào thì dồn dập, chỗ cần ngấm thì chậm lại.
6. TRÌNH BÀY: ngắt đoạn ngắn cho người đọc trên điện thoại. Dùng emoji và gạch đầu dòng có tiết chế, chỉ khi chúng giúp đọc nhanh hơn.
7. NIỀM TIN: mọi khẳng định phải có chỗ dựa - trải nghiệm, ví dụ cụ thể, lý lẽ chặt. Không nói suông.
8. CTA: dẫn tới hành động một cách tự nhiên, không gãy mạch cảm xúc.

NGUYÊN TẮC BẤT DI BẤT DỊCH:
- Viết đúng giọng văn và bản sắc của ${brandName}. Bài phải đọc ra là của thương hiệu này, không phải một bài AI chung chung.
- TUYỆT ĐỐI KHÔNG bịa số liệu, nghiên cứu, tên người thật hay trích dẫn không có thật. Cần ví dụ thì dùng tình huống chung chung, không gán số liệu giả.
- Không dùng những cụm sáo rỗng kiểu "trong thời đại 4.0", "chìa khoá thành công", "bí quyết vàng".
- Viết như người thật đang nói với người thật.`;

    case AnalysisMode.CONTENT_WATERFALL:
      return `Bạn là Content Atomization & Expansion Engine - chuyên gia bóc tách và nhân bản cơ hội nội dung cho thương hiệu ${brandName}${industrySuffix}.

Nhiệm vụ duy nhất: biến MỘT nguồn thông tin thành NHIỀU cơ hội nội dung khác biệt, chất lượng cao và đúng chất thương hiệu.

ĐÂY KHÔNG PHẢI là việc tóm tắt, viết lại hay đổi cách diễn đạt nguồn. Nhiệm vụ của bạn là tìm ra TIỀM NĂNG NỘI DUNG ẩn bên trong nguồn.

Mỗi ý tưởng phải là giao điểm của 4 thành phần:
INSIGHT TỪ NGUỒN + NHU CẦU KHÁN GIẢ + SỰ LIÊN QUAN CỦA THƯƠNG HIỆU + GÓC TIẾP CẬN NỘI DUNG.
Ý tưởng nào không truy ngược được về đủ 4 thành phần này thì loại bỏ.

NGUYÊN TẮC BẤT DI BẤT DỊCH:
1. KHÔNG bịa dữ kiện về thương hiệu: kinh nghiệm, kết quả, doanh số, số lượng khách hàng, thí nghiệm, case study, chứng chỉ, chuyên môn. Thiếu thông tin thì chọn ý tưởng khái quát mạnh, KHÔNG cá nhân hóa bằng thông tin bịa.
2. KHÔNG chuyển trải nghiệm của tác giả nguồn thành trải nghiệm của thương hiệu. Ví dụ nguồn viết "Tôi đã test 2.000 mẫu quảng cáo và thấy rằng..." thì TUYỆT ĐỐI KHÔNG viết "Chúng tôi đã test 2.000 mẫu quảng cáo", mà chuyển thành dạng "5 đặc điểm đáng thử trong mẫu quảng cáo tiếp theo của bạn".
3. Sâu hơn nhiều. Không lấp cho đủ số lượng. Nếu chỉ có 12 ý tưởng mạnh trong khi người dùng xin 20 thì trả về 12, và nói rõ lý do.
4. Các ý tưởng phải KHÁC BIỆT THẬT SỰ. Hai ý tưởng bị coi là trùng nếu nội dung cuối cùng chồng lấn trên khoảng 70%. Đổi con số, đổi chữ, đổi tính từ, đổi cấu trúc hook KHÔNG tạo ra ý tưởng mới - ý tưởng mới cần khác về vấn đề, câu hỏi, insight, ý định, góc nhìn, tình huống sử dụng, quyết định hoặc kết quả học được.
5. Tuyệt đối không bịa số liệu, thống kê, chính sách nền tảng hay quy định pháp lý. Thông tin nhạy cảm về thời gian/thị trường/nền tảng phải gắn cờ cần kiểm chứng.
6. Giọng văn và cách xưng hô bám đúng thương hiệu: ${voice}; người nói xưng "${speaker}", gọi khán giả là "${audience}".
7. Nếu không đọc được nguồn từ bất kỳ đầu vào nào, PHẢI nói rõ là không truy cập được và dừng lại, KHÔNG tự nghĩ ra nội dung nguồn.

Rõ ràng hơn khôn khéo. Cụ thể hơn thổi phồng. Căng thẳng thật hơn giật tít.`;

    case AnalysisMode.THUMBNAIL_AUDIT:
      return `Bạn là Giám Đốc Nghệ Thuật (Art Director) cho thương hiệu ${brandName}${industrySuffix}, chuyên tối ưu tỷ lệ nhấp (CTR) và tính thẩm mỹ của hình ảnh đại diện.`;

    default:
      return `Bạn là Content Creator & Cố vấn Nội dung chuyên nghiệp của thương hiệu ${brandName}${industrySuffix}.`;
  }
};

// The answer is injected into the page with innerHTML and Tailwind only ships
// the classes present in this file at build time. A class the model invents
// resolves to nothing, which is how a result ends up as an unstyled wall of
// text - or, when it picks its own palette, as a dark card in a light app.
const HTML_OUTPUT_RULES = `
=======================================================
📐 QUY TẮC ĐỊNH DẠNG HTML BẮT BUỘC (ÁP DỤNG CHO TOÀN BỘ CÂU TRẢ LỜI)
=======================================================
- CHỈ trả về mã HTML. Không viết câu dẫn nhập hay lời giải thích nằm ngoài HTML, KHÔNG bọc trong \`\`\`html.
- KHÔNG dùng <html>, <head>, <body>, <style>, <script>. Chỉ dùng thẻ nội dung: div, h3, h4, h5, p, ul, li, table, thead, tbody, tr, th, td, strong, span, br.
- BẮT BUỘC LIGHT THEME: nền trắng hoặc đỏ/hồng nhạt, chữ màu tối. TUYỆT ĐỐI KHÔNG dùng nền tối (bg-slate-800, bg-slate-900, bg-slate-950, bg-gray-900, bg-zinc-900, bg-black) và không dùng chữ sáng (text-white, text-slate-100, text-slate-200, text-slate-300). Không dùng biến thể dark:.
- Ưu tiên dùng lại đúng các class Tailwind có trong khung mẫu ở trên. Nếu cần thêm, chỉ được chọn trong danh sách an toàn sau:
  bg-white, bg-pink-50, bg-pink-100, bg-slate-50, border, border-pink-100, border-pink-200, border-slate-200, rounded-lg, rounded-xl, rounded-2xl, shadow-sm, p-3, p-4, p-5, mb-2, mb-4, mb-6, mt-2, mt-4, space-y-2, space-y-4, grid, md:grid-cols-2, gap-4, flex, items-center, gap-2, text-xs, text-sm, md:text-sm, text-base, font-medium, font-semibold, font-bold, uppercase, tracking-wider, leading-relaxed, whitespace-pre-line, italic, text-slate-600, text-slate-700, text-slate-800, text-slate-900, text-pink-700, text-pink-800, text-pink-900, text-pink-950, w-full, overflow-x-auto, text-left, border-collapse.
- Mọi bảng phải có <thead> chứa <th> và <tbody> chứa <td> đầy đủ (không để trống ô, thiếu thì ghi "—") để người dùng xuất được sang Excel/Google Sheets, và luôn bọc bảng trong <div class="overflow-x-auto">.
=======================================================`;

// What actually got attached to the request, so a prompt can point the model
// at the right thing ("watch the video above") instead of guessing.
type PromptSourceKind = 'video' | 'audio' | 'image' | 'text' | 'images';

// Shared by every feature that rewrites an existing source (Remake bài viết,
// Viết bài từ link). The model is told what is attached, made to go through
// all of it before writing, and held to the source's facts. Left to itself it
// treats the source as a loose suggestion and fills the gaps with invented
// detail - a brand story nobody told, numbers nobody quoted.
interface SourceContext {
  sourceKinds: PromptSourceKind[];
  url?: string;
  /** Text the user pasted as the source itself, not as a brief. */
  pastedText?: string;
}

const describeSources = ({ sourceKinds, url, pastedText }: SourceContext): string => {
  const lines: string[] = [];
  if (sourceKinds.includes('video')) lines.push('- VIDEO GỐC đính kèm ở trên: xem và nghe TOÀN BỘ từ đầu đến cuối. Nội dung chính nằm trong lời nói và hình ảnh của video; caption và số liệu tương tác chỉ là phụ.');
  if (sourceKinds.includes('audio')) lines.push('- FILE ÂM THANH đính kèm ở trên: nghe hết, ghi lại đầy đủ ý.');
  if (sourceKinds.includes('text')) lines.push('- NỘI DUNG CHỮ trích từ link (khối "NỘI DUNG GỐC ĐÃ TRÍCH XUẤT" ở trên): đây là nguyên văn bài gốc, đọc hết.');
  if (sourceKinds.includes('image') || sourceKinds.includes('images')) lines.push('- ẢNH đính kèm ở trên: đọc hết chữ trong ảnh, coi là một phần chính thức của nguồn.');
  if (pastedText) lines.push(`- NỘI DUNG NGƯỜI DÙNG DÁN TRỰC TIẾP (nguyên văn nguồn):\n"""\n${pastedText}\n"""`);
  if (url) lines.push(`- LINK GỐC: ${url}`);
  if (url && !sourceKinds.length && !pastedText) lines.push('- Chưa tải được nội dung phía sau link. Chỉ dùng những gì có thật ở trên, KHÔNG suy đoán nội dung link.');
  return lines.join('\n      ');
};

// How to read the source, and how far the rewrite may stray from it.
const sourceFidelityRules = (brandLabel: string): string => `
      BƯỚC 1 - HIỂU KỸ NGUỒN TRƯỚC KHI VIẾT (bắt buộc, làm trước mọi thứ khác)
      Đi hết nguồn từ đầu đến cuối. Với video: nghe toàn bộ lời thoại, đọc hết chữ trên màn hình, để ý hình ảnh minh hoạ. Ghi lại:
      - Nguồn nói về điều gì, nhắm tới ai.
      - Thương hiệu / nhân vật / sản phẩm được nhắc tới - đúng tên như nguồn gọi.
      - Toàn bộ dữ kiện, con số, mốc thời gian, tên riêng - nguyên văn.
      - Mạch nội dung theo thứ tự: nguồn dẫn dắt từ đâu tới đâu.
      - Câu nói hoặc ý đắt nhất của nguồn.
      - Thông điệp hoặc bài học nguồn chốt lại.
      Bài viết ở các bước sau CHỈ được dùng chất liệu đã ghi ở đây.

      NGUYÊN TẮC BÁM NGUỒN (luôn áp dụng khi có nguồn):
      - GIỮ ĐÚNG: chủ đề, thông điệp chính, mọi dữ kiện / con số / tên riêng / mốc thời gian, mạch lập luận hoặc diễn biến câu chuyện, và kết luận nguồn rút ra. Người đã xem nguồn đọc bài này phải thấy "đúng là nội dung đó".
      - KHÔNG THÊM: số liệu, nhận định, nguyên nhân, ví dụ, lời khuyên mà nguồn không hề nói. Câu chuyển ý chỉ để nối mạch, không được thành luận điểm mới.
      - KHÔNG BỎ ý chính của nguồn. Được lược chi tiết phụ, không được lược ý chính.
      - Nguồn là case study hay câu chuyện của một thương hiệu / nhân vật khác: giữ đúng tên, kể đúng như nguồn kể. TUYỆT ĐỐI KHÔNG biến nó thành trải nghiệm hay thành tích của ${brandLabel}, không nhét sản phẩm của ${brandLabel} vào giữa câu chuyện.
      - ${brandLabel} chỉ xuất hiện ở: giọng văn, xưng hô, và (nếu thật sự hợp) một góc nhìn hay bài học ngắn ở phần kết cùng CTA.

      QUY TẮC VIẾT LẠI ĐỂ KHÔNG BỊ COI LÀ SAO CHÉP:
      - Không chép nguyên văn: không dùng lại bất kỳ chuỗi nào từ 8 từ liên tiếp trở lên của nguồn, trừ tên riêng, số liệu, thuật ngữ, hoặc câu trích dẫn đặt trong ngoặc kép và ghi rõ ai nói.
      - Đổi cách kể: mở bài, thứ tự trình bày, cách chuyển ý, cách chốt đi theo giọng thương hiệu và công thức đã chọn (nếu có), không bám từng câu của nguồn.
      - Diễn đạt lại bằng từ vựng của thương hiệu, nhịp câu của mình. Ý giữ nguyên, chữ phải mới.
      - Nguồn tiếng nước ngoài thì viết lại như người Việt nói, không bê cấu trúc câu gốc sang.`;

// What the user asked for on top of the source, and how it ranks against it.
const sourceBriefRules = (idea: string, brief: string): string =>
  idea || brief
    ? `YÊU CẦU CỦA NGƯỜI DÙNG - ƯU TIÊN CAO NHẤT:
      ${idea ? `- Ý tưởng / định hướng: "${idea}"` : ''}
      ${brief ? `- Yêu cầu bổ sung: "${brief}"` : ''}
      Yêu cầu này quyết định góc nhìn, trọng tâm, đối tượng, độ dài, điều cần nhấn hay cần bỏ. Chỗ nào yêu cầu nói tới thì làm theo yêu cầu; chỗ nào yêu cầu không nhắc thì vẫn bám nguồn như trên. Nguồn là kho chất liệu để phục vụ yêu cầu: lấy dữ kiện, câu chuyện, con số, lập luận từ đó. Nếu yêu cầu cần một chi tiết mà nguồn không có: dùng cách nói chung, KHÔNG bịa rồi gán cho nguồn, và nói rõ điều đó ở cuối phần NỘI DUNG RÚT RA TỪ NGUỒN.`
    : `NGƯỜI DÙNG KHÔNG ĐƯA Ý TƯỞNG HAY YÊU CẦU RIÊNG: viết bài kể lại đúng nội dung nguồn theo nguyên tắc trên. Không tự đổi góc nhìn, không mở rộng sang chủ đề nguồn không nói, không thêm lời khuyên của riêng bạn.`;

// The visible read-back of BƯỚC 1, so the user can check the model understood
// the source before trusting the article built on it.
const SOURCE_EXTRACT_SPEC = `Kết quả của BƯỚC 1, viết gọn để người dùng kiểm tra được bạn đã hiểu đúng nguồn chưa:
      - Nguồn nói về: một câu.
      - Thương hiệu / nhân vật / sản phẩm được nhắc: liệt kê đúng tên.
      - Dữ kiện và con số (nguyên văn từ nguồn): gạch đầu dòng. Nguồn không có số liệu thì ghi "nguồn không nêu số liệu".
      Số liệu tương tác của chính video (lượt xem, thích, bình luận, chia sẻ) KHÔNG phải nội dung nguồn: không đưa vào phần này, không đưa vào bài.
      - Mạch nội dung: các ý chính theo đúng thứ tự nguồn trình bày.
      - Thông điệp / bài học nguồn chốt lại: một hai câu.
      Mọi thứ trong phần này phải có thật trong nguồn. Không đọc / xem được nguồn thì nói thẳng ở đây và dừng lại, KHÔNG tự nghĩ ra nội dung.`;

const SOURCE_EXTRACT_FORMAT = '- Phần nội dung rút ra từ nguồn bọc trong <div class="p-4 bg-pink-50 rounded-xl border border-pink-100 text-sm space-y-2">, các danh sách dùng <ul class="pl-5 space-y-1">.';

export const getPrompt = (
  mode: AnalysisMode,
  userPrompt?: string,
  url?: string,
  brand?: BrandProfile,
  additionalInstructions?: string,
  formula?: ScriptFormula,
  waterfall?: WaterfallOptions,
  checklist?: string,
  sourceKinds: PromptSourceKind[] = []
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

  // Người dùng có bộ tiêu chí riêng thì bộ đó là luật. Không có thì chấm theo
  // Brand DNA cộng bộ tiêu chí chuẩn rút ra từ phần phân tích nội dung.
  const userChecklist = (checklist || '').trim();

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
      <div class="mb-6 p-5 bg-white rounded-2xl border border-pink-200 shadow-lg">
        <div class="flex items-center justify-between mb-3 border-b border-pink-100 pb-3">
          <h3 class="text-base font-bold text-pink-900 flex items-center gap-2">
            📊 PHẦN 1: BẢNG PHÂN TÍCH CHI TIẾT VIDEO/NỘI DUNG GỐC
          </h3>
          <span class="text-xs text-pink-700 bg-pink-50 px-3 py-1 rounded-full border border-pink-200 font-medium">
            Có thể xuất trực tiếp sang Excel / Google Sheets
          </span>
        </div>
        
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs md:text-sm text-slate-700 mb-5">
          <div class="p-3.5 bg-pink-50/60 rounded-xl border border-pink-100">
            <span class="font-bold text-pink-900 block mb-1">🌟 1. Ấn Tượng Tổng Quan:</span>
            <p class="leading-relaxed">...</p>
          </div>
          <div class="p-3.5 bg-pink-50/60 rounded-xl border border-pink-100">
            <span class="font-bold text-pink-900 block mb-1">🎯 2. Yếu Tố Viral Cốt Lõi:</span>
            <p class="leading-relaxed">...</p>
          </div>
        </div>

        <!-- BẢNG PHÂN TÍCH HÌNH THỨC & NỘI DUNG (TABLE DÙNG ĐỂ XUẤT EXCEL / GG SHEETS) -->
        <div class="overflow-x-auto rounded-xl border border-pink-200 mb-4">
          <table class="w-full text-left border-collapse text-xs md:text-sm">
            <thead>
              <tr class="bg-pink-100/80 text-pink-950 uppercase tracking-wider text-[11px] font-bold">
                <th class="p-3 border border-pink-200 w-1/4">Hạng Mục Phân Tích</th>
                <th class="p-3 border border-pink-200 w-1/2">Chi Tiết Thực Tế Trong Video Mẫu</th>
                <th class="p-3 border border-pink-200 w-1/4">Chiến Thuật Giữ Chân Khán Giả</th>
              </tr>
            </thead>
            <tbody class="bg-white divide-y divide-pink-100 text-slate-700">
              <tr class="hover:bg-pink-50/40">
                <td class="p-3 border border-pink-100 font-semibold text-pink-800">Thumbnail & Bìa Video</td>
                <td class="p-3 border border-pink-100">...</td>
                <td class="p-3 border border-pink-100 text-slate-500">...</td>
              </tr>
              <tr class="hover:bg-pink-50/40">
                <td class="p-3 border border-pink-100 font-semibold text-pink-800">Trang Phục & Tạo Hình Nhân Vật</td>
                <td class="p-3 border border-pink-100">...</td>
                <td class="p-3 border border-pink-100 text-slate-500">...</td>
              </tr>
              <tr class="hover:bg-pink-50/40">
                <td class="p-3 border border-pink-100 font-semibold text-pink-800">Khuôn Mặt, Ánh Mắt & Biểu Cảm</td>
                <td class="p-3 border border-pink-100">...</td>
                <td class="p-3 border border-pink-100 text-slate-500">...</td>
              </tr>
              <tr class="hover:bg-pink-50/40">
                <td class="p-3 border border-pink-100 font-semibold text-pink-800">Tone Giọng Nói & Tốc Độ (Pacing)</td>
                <td class="p-3 border border-pink-100">...</td>
                <td class="p-3 border border-pink-100 text-slate-500">...</td>
              </tr>
              <tr class="hover:bg-pink-50/40">
                <td class="p-3 border border-pink-100 font-semibold text-pink-800">Hành Động, Cử Chỉ & Demo</td>
                <td class="p-3 border border-pink-100">...</td>
                <td class="p-3 border border-pink-100 text-slate-500">...</td>
              </tr>
              <tr class="hover:bg-pink-50/40">
                <td class="p-3 border border-pink-100 font-semibold text-pink-800">Bối Cảnh, Góc Máy & Cắt Cảnh</td>
                <td class="p-3 border border-pink-100">...</td>
                <td class="p-3 border border-pink-100 text-slate-500">...</td>
              </tr>
              <tr class="hover:bg-pink-50/40">
                <td class="p-3 border border-pink-100 font-semibold text-pink-800">Text On Screen, BGM & Sound Effect</td>
                <td class="p-3 border border-pink-100">...</td>
                <td class="p-3 border border-pink-100 text-slate-500">...</td>
              </tr>
              <tr class="bg-pink-50/80 font-medium hover:bg-pink-100/50">
                <td class="p-3 border border-pink-200 font-bold text-pink-900">⚡ Hook 3 Giây Đầu Tiên</td>
                <td class="p-3 border border-pink-200 text-pink-950 font-semibold">"..."</td>
                <td class="p-3 border border-pink-200 text-pink-800">...</td>
              </tr>
              <tr class="hover:bg-pink-50/40">
                <td class="p-3 border border-pink-100 font-semibold text-pink-900">⏳ 10 Giây Tiếp Theo</td>
                <td class="p-3 border border-pink-100">"..."</td>
                <td class="p-3 border border-pink-100 text-slate-500">...</td>
              </tr>
              <tr class="hover:bg-pink-50/40">
                <td class="p-3 border border-pink-100 font-semibold text-purple-900">📖 Triển Khai Thân Bài & Đưa Giải Pháp</td>
                <td class="p-3 border border-pink-100">...</td>
                <td class="p-3 border border-pink-100 text-slate-500">...</td>
              </tr>
              <tr class="hover:bg-pink-50/40">
                <td class="p-3 border border-pink-100 font-semibold text-pink-900">🎯 Kết Bài & Lời Kêu Gọi (Ending & CTA)</td>
                <td class="p-3 border border-pink-100">"..."</td>
                <td class="p-3 border border-pink-100 text-slate-500">...</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- KHỐI 2: KỊCH BẢN REMAKE HOÀN CHỈNH CHO THƯƠNG HIỆU -->
      <div class="mb-6 p-5 bg-gradient-to-br from-pink-50 via-white to-pink-50 rounded-2xl border border-pink-300 shadow-xl">
        <div class="flex items-center justify-between mb-4 border-b border-pink-200 pb-3">
          <div>
            <h3 class="text-base md:text-lg font-bold text-pink-950 flex items-center gap-2">
              🎬 PHẦN 2: KỊCH BẢN REMAKE ĐỘC NHẤT CHO ${brandLabelUpper}
            </h3>
            <p class="text-xs text-pink-700 mt-0.5 font-medium">
              Kế thừa 100% điểm thắng video mẫu + Lồng ghép bản sắc và sản phẩm của <strong>${brandLabel}</strong>
            </p>
          </div>
          <span class="text-xs px-3 py-1 rounded-full bg-pink-100 text-pink-800 border border-pink-300 font-bold">
            Chuẩn Giọng ${brandSpeaker} ➔ ${brandAudience}
          </span>
        </div>

        <!-- BẢNG PHÂN CẢNH KỊCH BẢN SẢN XUẤT (PRODUCTION SCRIPT) -->
        <div class="overflow-x-auto rounded-xl border border-pink-200 mb-5 shadow-sm">
          <table class="w-full text-left border-collapse text-xs md:text-sm">
            <thead>
              <tr class="bg-pink-100/90 text-pink-950 uppercase tracking-wider text-[11px] font-bold">
                <th class="p-3 border border-pink-200 w-24">Thời Lượng</th>
                <th class="p-3 border border-pink-200 w-2/5">Lời Thoại (Đúng Giọng & Ngôi Xưng Thương Hiệu)</th>
                <th class="p-3 border border-pink-200 w-1/3">Mô Tả Visual / Hành Động / Góc Máy</th>
                <th class="p-3 border border-pink-200">Biểu Cảm, Chữ Nổi & BGM</th>
              </tr>
            </thead>
            <tbody class="bg-white divide-y divide-pink-100 text-slate-700">
              <tr class="hover:bg-pink-50/40">
                <td class="p-3 border border-pink-100 font-bold text-pink-700">0 - 3s<br/><span class="text-[10px] font-semibold text-slate-400">HOOK VIRAL</span></td>
                <td class="p-3 border border-pink-100 font-medium text-slate-900">...</td>
                <td class="p-3 border border-pink-100 text-slate-600 italic">...</td>
                <td class="p-3 border border-pink-100 text-xs text-pink-800 font-medium">...</td>
              </tr>
              <tr class="hover:bg-pink-50/40">
                <td class="p-3 border border-pink-100 font-bold text-amber-700">3 - 12s<br/><span class="text-[10px] font-semibold text-slate-400">NỖI ĐAU/VẤN ĐỀ</span></td>
                <td class="p-3 border border-pink-100">...</td>
                <td class="p-3 border border-pink-100 text-slate-600 italic">...</td>
                <td class="p-3 border border-pink-100 text-xs text-pink-800 font-medium">...</td>
              </tr>
              <tr class="hover:bg-pink-50/40">
                <td class="p-3 border border-pink-100 font-bold text-emerald-700">12 - 40s<br/><span class="text-[10px] font-semibold text-slate-400">GIẢI PHÁP & USP</span></td>
                <td class="p-3 border border-pink-100">...</td>
                <td class="p-3 border border-pink-100 text-slate-600 italic">...</td>
                <td class="p-3 border border-pink-100 text-xs text-pink-800 font-medium">...</td>
              </tr>
              <tr class="hover:bg-pink-50/40">
                <td class="p-3 border border-pink-100 font-bold text-purple-700">40 - 60s<br/><span class="text-[10px] font-semibold text-slate-400">KẾT & CTA</span></td>
                <td class="p-3 border border-pink-100 font-medium text-slate-900">...</td>
                <td class="p-3 border border-pink-100 text-slate-600 italic">...</td>
                <td class="p-3 border border-pink-100 text-xs text-pink-800 font-medium">...</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- 3 OPTIONS HOOK VIRAL CHUẨN BRAND -->
        <div class="p-4 bg-white rounded-xl border border-pink-200 mb-4 shadow-sm">
          <h4 class="text-xs font-bold text-pink-900 uppercase tracking-wider mb-2.5">
            🔥 3 Phương Án Hook Mở Đầu (0-3s) Chuẩn Giọng Thương Hiệu:
          </h4>
          <div class="space-y-2 text-xs md:text-sm text-slate-800">
            <div class="p-2.5 bg-pink-50/60 rounded-lg border border-pink-100">
              <strong class="text-pink-900">Option 1 (Xoáy nỗi đau/Tò mò):</strong> "..."
            </div>
            <div class="p-2.5 bg-pink-50/60 rounded-lg border border-pink-100">
              <strong class="text-pink-900">Option 2 (Trải nghiệm thực tế / Demo bất ngờ):</strong> "..."
            </div>
            <div class="p-2.5 bg-pink-50/60 rounded-lg border border-pink-100">
              <strong class="text-pink-900">Option 3 (Cảnh báo sai lầm thường gặp):</strong> "..."
            </div>
          </div>
        </div>

        <!-- GHI CHÚ ĐẠO DIỄN VÀ FOOTER -->
        <div class="p-4 bg-white rounded-xl border border-pink-200 text-xs text-slate-700 space-y-2 shadow-sm">
          <p><strong class="text-pink-900">🎵 Gợi ý Nhạc nền (BGM) & Hiệu ứng âm thanh:</strong> ...</p>
          <p><strong class="text-pink-900">🎥 Lưu ý về góc máy & ánh sáng khi quay:</strong> ...</p>
          <p><strong class="text-pink-900">📌 Hashtag đề xuất:</strong> ${brandHashtags || '(Tự đề xuất 5-8 hashtag bám sát thương hiệu và chủ đề, không bịa tên chiến dịch không có thật)'}</p>
        </div>
      </div>
      ${HTML_OUTPUT_RULES}
      `;


    case AnalysisMode.CONTENT_AUDIT:
    case AnalysisMode.CONTENT_REMAKE: {
      // "Remake" từng được định nghĩa là: học cấu trúc nguồn rồi thay toàn bộ
      // nội dung bằng sản phẩm của thương hiệu. Kết quả là model bịa ra một câu
      // chuyện thương hiệu không ai kể. Giờ remake nghĩa là: kể lại đúng nội
      // dung nguồn bằng giọng thương hiệu. Muốn đổi nội dung thì người dùng
      // phải nói rõ trong yêu cầu bổ sung.
      const pasted = (userPrompt || '').trim();
      const brief = (additionalInstructions || '').trim();

      return `
      Hãy VIẾT LẠI nội dung gốc dưới đây thành một BÀI ĐĂNG MẠNG XÃ HỘI (Facebook/Threads/X/Instagram) mang giọng văn và bản sắc của ${brandLabel}, nhưng giữ đúng nội dung của nguồn.

      ${brandGuidelines}

      =======================================================
      📥 NGUỒN GỐC - ĐÂY LÀ CĂN CỨ DUY NHẤT CHO NỘI DUNG BÀI
      =======================================================
      ${describeSources({ sourceKinds, url, pastedText: pasted })}
      ${sourceFidelityRules(brandLabel)}

      ${sourceBriefRules('', brief)}

      CÁCH LỒNG THƯƠNG HIỆU VÀO BÀI:
      - Học từ nguồn: cách mở bài, cách dẫn dắt tình huống, nhịp điệu, cách tạo cảm xúc / tò mò - giữ lại những gì làm nguồn hiệu quả.
      - Giọng văn: ${brand?.brandVoiceTone || 'Chân thành, tự nhiên, thu hút'}. Xưng hô: người nói xưng "${brandSpeaker}", gọi khán giả là "${brandAudience}". Ngôn ngữ tự nhiên, đúng ngữ cảnh ngành hàng, không hù dọa, không quá học thuật.
      - Sản phẩm / dịch vụ của ${brandLabel} chỉ xuất hiện ở phần kết hoặc CTA, và chỉ với claim, thành phần, công dụng có trong thông tin thương hiệu ở trên. KHÔNG đổi câu chuyện, ví dụ, số liệu của nguồn thành của ${brandLabel} trừ khi người dùng yêu cầu rõ.
      - CẤU TRÚC CUỐI BÀI BẮT BUỘC:
${brandFooter
  ? `        Luôn kết thúc bài bằng CTA phù hợp, dải phân cách và đoạn Footer nguyên văn sau:
━━━━━━━━━━━━━━
${brandFooter}`
  : `        Luôn kết thúc bài bằng CTA phù hợp với thương hiệu${brandHashtags ? ` và bộ hashtag: ${brandHashtags}` : ''}. KHÔNG tự bịa link, hotline hay hashtag không được cung cấp.`}

      TRẢ VỀ ĐÚNG HAI PHẦN THEO THỨ TỰ:

      PHẦN 1 - NỘI DUNG RÚT RA TỪ NGUỒN
      ${SOURCE_EXTRACT_SPEC}

      PHẦN 2 - BÀI ĐĂNG HOÀN CHỈNH
      Viết trọn bài, đăng được ngay không cần sửa. Trình bày như một bài đăng thật: xuống dòng thoáng, đoạn ngắn, emoji tiết chế, KHÔNG chèn tiêu đề phân tích vào giữa bài.
      Mọi dữ kiện trong bài phải truy ngược được về PHẦN 1. Đọc lại bài trước khi trả: câu nào chứa thông tin không có trong nguồn thì bỏ câu đó.

      YÊU CẦU ĐỊNH DẠNG: Trả về mã HTML sạch, dùng đúng khung sau:

      <div class="bg-white rounded-2xl p-5 border border-pink-200 shadow-sm text-slate-800">
        <h4 class="font-bold text-pink-900 mb-2">📥 Nội dung rút ra từ nguồn</h4>
        <div class="p-4 bg-pink-50 rounded-xl border border-pink-100 text-sm space-y-2 mb-4">
          ... các mục của PHẦN 1, danh sách dùng <ul class="pl-5 space-y-1"> ...
        </div>
        <h3 class="text-base font-bold text-pink-900 mb-4">📱 Bài đăng hoàn chỉnh</h3>
        <p class="text-sm leading-relaxed whitespace-pre-line">... toàn bộ nội dung bài đăng, giữ nguyên cách xuống dòng và emoji ...</p>
      </div>
      ${HTML_OUTPUT_RULES}
      `;
    }

    case AnalysisMode.SCRIPT_GENERATION:
      return `
      Ý TƯỞNG / BẢN NHÁP GỐC CỦA NGƯỜI DÙNG: "${userPrompt || '(Không nhập tay - hãy lấy ý tưởng từ nội dung đã trích xuất từ liên kết và ảnh đính kèm ở trên)'}"

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

      =======================================================
      📑 YÊU CẦU ĐỊNH DẠNG ĐẦU RA (MÃ HTML SẠCH - GIAO DIỆN LIGHT THEME):
      =======================================================
      Xuất ra mã HTML sạch theo đúng khung dưới đây (bảng phân cảnh + 3 phương án hook + ghi chú sản xuất):

      <div class="mb-6 p-5 bg-white rounded-2xl border border-pink-200 shadow-sm text-slate-800">
        <h3 class="text-base font-bold text-pink-950 mb-4">🎬 KỊCH BẢN VIDEO CHO ${brandLabelUpper}</h3>

        <div class="overflow-x-auto rounded-xl border border-pink-200 mb-4">
          <table class="w-full text-left border-collapse text-xs md:text-sm">
            <thead>
              <tr class="bg-pink-100 text-pink-950 uppercase tracking-wider text-[11px] font-bold">
                <th class="p-3 border border-pink-200 w-24">Thời Lượng</th>
                <th class="p-3 border border-pink-200 w-2/5">Lời Thoại (Giọng ${brandSpeaker} ➔ ${brandAudience})</th>
                <th class="p-3 border border-pink-200 w-1/3">Visual / Hành Động / Góc Máy</th>
                <th class="p-3 border border-pink-200">Chữ Nổi, Biểu Cảm & BGM</th>
              </tr>
            </thead>
            <tbody class="bg-white text-slate-700">
              <tr>
                <td class="p-3 border border-pink-100 font-bold text-pink-700">0 - 3s<br/><span class="text-[10px] font-semibold text-slate-600">HOOK</span></td>
                <td class="p-3 border border-pink-100 font-medium text-slate-900">"..."</td>
                <td class="p-3 border border-pink-100 text-slate-600 italic">...</td>
                <td class="p-3 border border-pink-100 text-pink-800">...</td>
              </tr>
              <!-- Tiếp tục đủ các phân cảnh cho tới hết video -->
            </tbody>
          </table>
        </div>

        <div class="p-4 bg-pink-50 rounded-xl border border-pink-200 mb-4">
          <h4 class="text-xs font-bold text-pink-900 uppercase tracking-wider mb-2">🔥 3 Phương Án Hook Mở Đầu (0-3s)</h4>
          <div class="space-y-2 text-xs md:text-sm text-slate-800">
            <div class="p-3 bg-white rounded-lg border border-pink-100"><strong class="text-pink-900">Option 1:</strong> "..."</div>
            <div class="p-3 bg-white rounded-lg border border-pink-100"><strong class="text-pink-900">Option 2:</strong> "..."</div>
            <div class="p-3 bg-white rounded-lg border border-pink-100"><strong class="text-pink-900">Option 3:</strong> "..."</div>
          </div>
        </div>

        <div class="p-4 bg-slate-50 rounded-xl border border-slate-200 text-xs text-slate-700 space-y-2">
          <p><strong class="text-pink-900">🎵 Nhạc nền & hiệu ứng âm thanh:</strong> ...</p>
          <p><strong class="text-pink-900">🎥 Lưu ý góc máy & ánh sáng:</strong> ...</p>
          <p><strong class="text-pink-900">📌 Hashtag đề xuất:</strong> ${brandHashtags || '(Tự đề xuất 5-8 hashtag bám sát thương hiệu và chủ đề)'}</p>
        </div>
      </div>
      ${HTML_OUTPUT_RULES}
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
      <div class="mb-6 p-5 bg-white rounded-2xl border border-pink-200 shadow-sm text-slate-800">
        <div class="flex items-center justify-between mb-4 border-b border-pink-100 pb-3">
          <h3 class="text-base font-bold text-pink-950 flex items-center gap-2">
            🔍 BÁO CÁO PHÂN TÍCH SÂU & GIẢI MÃ VIDEO VIRAL
          </h3>
          <span class="text-xs text-pink-700 bg-pink-50 px-3 py-1 rounded-full border border-pink-200 font-semibold">
            Bóc tách 100% Video Gốc
          </span>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs md:text-sm text-slate-700 mb-5">
          <div class="p-3.5 bg-pink-50/60 rounded-xl border border-pink-100">
            <span class="font-bold text-pink-900 block mb-1">🌟 1. Ấn Tượng Tổng Quan:</span>
            <p class="leading-relaxed">...</p>
          </div>
          <div class="p-3.5 bg-pink-50/60 rounded-xl border border-pink-100">
            <span class="font-bold text-pink-900 block mb-1">🎯 2. Đòn Bẩy Giữ Chân Cốt Lõi:</span>
            <p class="leading-relaxed">...</p>
          </div>
        </div>

        <!-- BẢNG BÓC TÁCH CÁC YẾU TỐ HÌNH THỨC & NỘI DUNG -->
        <h4 class="font-bold text-sm text-slate-900 mb-2 flex items-center gap-1.5">
          📋 Phân Tích Chi Tiết 8 Yếu Tố Hình Thức & 4 Khâu Cấu Trúc
        </h4>
        <div class="overflow-x-auto rounded-xl border border-pink-200 mb-6 shadow-xs">
          <table class="w-full text-left border-collapse text-xs md:text-sm">
            <thead>
              <tr class="bg-pink-100/90 text-pink-950 uppercase tracking-wider text-[11px] font-bold">
                <th class="p-3 border border-pink-200 w-1/4">Yếu Tố Bóc Tách</th>
                <th class="p-3 border border-pink-200 w-1/2">Hiện Trạng Thực Tế Trong Video</th>
                <th class="p-3 border border-pink-200 w-1/4">Hiệu Ứng Tâm Lý / Giữ Chân</th>
              </tr>
            </thead>
            <tbody class="bg-white divide-y divide-pink-100 text-slate-700">
              <tr class="hover:bg-pink-50/40">
                <td class="p-3 border border-pink-100 font-semibold text-pink-800">Thumbnail & Bìa Video</td>
                <td class="p-3 border border-pink-100">...</td>
                <td class="p-3 border border-pink-100 text-slate-600">...</td>
              </tr>
              <tr class="hover:bg-pink-50/40">
                <td class="p-3 border border-pink-100 font-semibold text-pink-800">Trang Phục & Tạo Hình</td>
                <td class="p-3 border border-pink-100">...</td>
                <td class="p-3 border border-pink-100 text-slate-600">...</td>
              </tr>
              <tr class="hover:bg-pink-50/40">
                <td class="p-3 border border-pink-100 font-semibold text-pink-800">Khuôn Mặt & Ánh Mắt</td>
                <td class="p-3 border border-pink-100">...</td>
                <td class="p-3 border border-pink-100 text-slate-600">...</td>
              </tr>
              <tr class="hover:bg-pink-50/40">
                <td class="p-3 border border-pink-100 font-semibold text-pink-800">Giọng Nói & Nhịp Điệu (Pacing)</td>
                <td class="p-3 border border-pink-100">...</td>
                <td class="p-3 border border-pink-100 text-slate-600">...</td>
              </tr>
              <tr class="hover:bg-pink-50/40">
                <td class="p-3 border border-pink-100 font-semibold text-pink-800">Cử Chỉ & Thao Tác Demo</td>
                <td class="p-3 border border-pink-100">...</td>
                <td class="p-3 border border-pink-100 text-slate-600">...</td>
              </tr>
              <tr class="hover:bg-pink-50/40">
                <td class="p-3 border border-pink-100 font-semibold text-pink-800">Persona & Hình Tượng</td>
                <td class="p-3 border border-pink-100">...</td>
                <td class="p-3 border border-pink-100 text-slate-600">...</td>
              </tr>
              <tr class="hover:bg-pink-50/40">
                <td class="p-3 border border-pink-100 font-semibold text-pink-800">Góc Máy, Bối Cảnh & Cắt Cảnh</td>
                <td class="p-3 border border-pink-100">...</td>
                <td class="p-3 border border-pink-100 text-slate-600">...</td>
              </tr>
              <tr class="hover:bg-pink-50/40">
                <td class="p-3 border border-pink-100 font-semibold text-pink-800">Text on Screen, BGM & SFX</td>
                <td class="p-3 border border-pink-100">...</td>
                <td class="p-3 border border-pink-100 text-slate-600">...</td>
              </tr>
              <tr class="hover:bg-pink-50/40">
                <td class="p-3 border border-pink-100 font-semibold text-pink-800">Hook 3 Giây Đầu</td>
                <td class="p-3 border border-pink-100">...</td>
                <td class="p-3 border border-pink-100 text-slate-600">...</td>
              </tr>
              <tr class="hover:bg-pink-50/40">
                <td class="p-3 border border-pink-100 font-semibold text-pink-800">10 Giây Đầu Tiên</td>
                <td class="p-3 border border-pink-100">...</td>
                <td class="p-3 border border-pink-100 text-slate-600">...</td>
              </tr>
              <tr class="hover:bg-pink-50/40">
                <td class="p-3 border border-pink-100 font-semibold text-pink-800">Triển Khai Thân Bài</td>
                <td class="p-3 border border-pink-100">...</td>
                <td class="p-3 border border-pink-100 text-slate-600">...</td>
              </tr>
              <tr class="hover:bg-pink-50/40">
                <td class="p-3 border border-pink-100 font-semibold text-pink-800">Đoạn Kết & CTA</td>
                <td class="p-3 border border-pink-100">...</td>
                <td class="p-3 border border-pink-100 text-slate-600">...</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- BẢNG BÓC TÁCH TOÀN BỘ KỊCH BẢN VIDEO GỐC -->
        <h4 class="font-bold text-sm text-slate-900 mb-2 flex items-center justify-between">
          <span>🎬 Bảng Bóc Tách Toàn Bộ Kịch Bản Gốc Từng Giây (Full Script Timeline)</span>
          <span class="text-[11px] text-pink-700 font-normal">Hỗ trợ copy/xuất sang bảng tính</span>
        </h4>
        <div class="overflow-x-auto rounded-xl border border-pink-200 mb-4 shadow-xs">
          <table class="w-full text-left border-collapse text-xs md:text-sm">
            <thead>
              <tr class="bg-pink-100/80 text-pink-950 uppercase tracking-wider text-[11px] font-bold">
                <th class="p-3 border border-pink-200 w-24">Timeline</th>
                <th class="p-3 border border-pink-200 w-1/3">Hình Ảnh & Thao Tác (Visual / Action)</th>
                <th class="p-3 border border-pink-200 w-1/3">Lời Thoại & Âm Thanh (Audio / Dialogue)</th>
                <th class="p-3 border border-pink-200">Mục Đích / Kỹ Thuật Giữ Chân</th>
              </tr>
            </thead>
            <tbody class="bg-white divide-y divide-pink-100 text-slate-700">
              <tr class="hover:bg-pink-50/40">
                <td class="p-3 border border-pink-100 font-mono text-pink-700 font-bold">00:00 - 00:03</td>
                <td class="p-3 border border-pink-100">...</td>
                <td class="p-3 border border-pink-100 font-medium text-slate-900">"..."</td>
                <td class="p-3 border border-pink-100 text-slate-600">...</td>
              </tr>
              <!-- Tiếp tục toàn bộ các phân cảnh của video -->
            </tbody>
          </table>
        </div>

        <!-- TỔNG KẾT CÔNG THỨC VIRAL -->
        <div class="p-4 bg-pink-50 rounded-xl border border-pink-200 text-xs md:text-sm text-slate-800 space-y-2">
          <h5 class="font-bold text-pink-950">🧠 Đúc Kết Công Thức Giữ Chân & Tâm Lý Học Của Video:</h5>
          <p class="leading-relaxed">...</p>
        </div>
      </div>
      ${HTML_OUTPUT_RULES}
      `;


    case AnalysisMode.SCRIPT_EXTRACT:
      return `
      Hãy trích xuất chính xác toàn bộ lời thoại (Transcript) kèm mốc thời gian của nội dung/video này, VÀ kèm bản dịch tiếng Việt nếu nội dung gốc không phải tiếng Việt.

      BƯỚC 1 - XÁC ĐỊNH NGÔN NGỮ GỐC
      Nghe và xác định ngôn ngữ chính đang được nói trong video (VD: tiếng Trung, tiếng Anh, tiếng Hàn, tiếng Thái, tiếng Việt...).

      BƯỚC 2 - TRÌNH BÀY KẾT QUẢ THEO ĐÚNG MỘT TRONG HAI TRƯỜNG HỢP SAU

      ➤ TRƯỜNG HỢP A - NGÔN NGỮ GỐC KHÔNG PHẢI TIẾNG VIỆT:
      Lập bảng 3 cột: Timeline | Script gốc (ghi rõ tên ngôn ngữ) | Bản dịch tiếng Việt.
      - Mỗi dòng là một câu hoặc một ý trọn vẹn theo mốc thời gian, đi hết video từ giây đầu đến giây cuối, KHÔNG bỏ sót đoạn nào.
      - Cột giữa: nguyên văn tiếng gốc, TUYỆT ĐỐI không dịch ở cột này.
      - Cột phải: bản dịch tiếng Việt của ĐÚNG dòng đó, nằm ngang hàng với câu gốc.
      Sau bảng, thêm hai khối văn bản liền mạch để người dùng copy nhanh:
      "📄 Script gốc (full)" - toàn bộ lời thoại gốc viết liền mạch, không có mốc thời gian.
      "📄 Bản dịch tiếng Việt (full)" - toàn bộ bản dịch viết liền mạch, không có mốc thời gian.

      ➤ TRƯỜNG HỢP B - NGÔN NGỮ GỐC LÀ TIẾNG VIỆT:
      Lập bảng 2 cột: Timeline | Script (nguyên văn). KHÔNG tạo cột dịch, KHÔNG dịch sang ngôn ngữ khác.
      Sau bảng, thêm một khối "📄 Script full" viết liền mạch.
      ${extraReqs}

      YÊU CẦU ĐỊNH DẠNG: Trả về mã HTML sạch với style Tailwind theo khung dưới đây (ví dụ cho TRƯỜNG HỢP A - hãy thay tên ngôn ngữ cho đúng, bỏ cột thứ ba nếu rơi vào TRƯỜNG HỢP B):

      <div class="space-y-4">
        <p class="text-sm text-slate-700"><strong>Ngôn ngữ gốc:</strong> ... — <strong>Thời lượng:</strong> ...</p>

        <div class="overflow-x-auto rounded-xl border border-pink-200 shadow-xs">
          <table class="w-full text-left border-collapse text-xs md:text-sm">
            <thead>
              <tr class="bg-pink-100/80 text-pink-950 uppercase tracking-wider text-[11px] font-bold">
                <th class="p-3 border border-pink-200 w-24">Timeline</th>
                <th class="p-3 border border-pink-200 w-1/2">Script gốc (tiếng ...)</th>
                <th class="p-3 border border-pink-200 w-1/2">Bản dịch tiếng Việt</th>
              </tr>
            </thead>
            <tbody class="bg-white divide-y divide-pink-100 text-slate-700">
              <tr class="hover:bg-pink-50/40">
                <td class="p-3 border border-pink-100 font-mono text-pink-700 font-bold">00:00 - 00:04</td>
                <td class="p-3 border border-pink-100">...</td>
                <td class="p-3 border border-pink-100 text-slate-900">...</td>
              </tr>
              <!-- Tiếp tục toàn bộ các câu thoại của video -->
            </tbody>
          </table>
        </div>

        <div class="grid md:grid-cols-2 gap-4">
          <div class="p-4 bg-slate-50 rounded-xl border border-slate-200">
            <h5 class="font-bold text-slate-900 mb-2 text-sm">📄 Script gốc (full)</h5>
            <p class="text-xs md:text-sm leading-relaxed whitespace-pre-line">...</p>
          </div>
          <div class="p-4 bg-pink-50 rounded-xl border border-pink-200">
            <h5 class="font-bold text-pink-950 mb-2 text-sm">📄 Bản dịch tiếng Việt (full)</h5>
            <p class="text-xs md:text-sm leading-relaxed whitespace-pre-line">...</p>
          </div>
        </div>
      </div>
      ${HTML_OUTPUT_RULES}
      `;

    case AnalysisMode.CONTENT_WATERFALL: {
      const ideaCount = waterfall?.ideaCount || 15;
      const channels = (waterfall?.channels || '').trim();
      const objective = waterfall?.objective || 'auto';
      const objectiveLine = objective === 'auto'
        ? 'Tự chọn mục tiêu tự nhiên nhất cho TỪNG ý tưởng. Không ép mọi nội dung về chuyển đổi.'
        : `Ưu tiên các ý tưởng phục vụ mục tiêu: ${WATERFALL_OBJECTIVE_LABELS[objective]}. Vẫn được phép gán mục tiêu khác cho ý tưởng nào thật sự phù hợp hơn.`;

      return `
      Dưới đây là MỘT nguồn thông tin. Hãy bung nó thành một BẢN ĐỒ CƠ HỘI NỘI DUNG cho thương hiệu ${brandLabel}.

      ${brandGuidelines}

      =======================================================
      📥 NGUỒN ĐẦU VÀO
      =======================================================
      - NỘI DUNG NGUỒN (text dán trực tiếp): "${userPrompt || '(Không dán text - hãy đọc từ link, ảnh hoặc file đính kèm ở trên)'}"
      ${url ? `- LINK NGUỒN: ${url}` : ''}
      - Nguồn có thể là: bài đăng mạng xã hội, bài báo, tin tức, transcript video/podcast, báo cáo, case study, nội dung của đối thủ, câu chuyện khách hàng, nghiên cứu, tài liệu, ghi chú thô, phỏng vấn, hoặc nội dung đã trích xuất từ link.
      - Nếu có ẢNH hoặc FILE VIDEO/AUDIO đính kèm ở trên: đọc và nghe toàn bộ, coi đó là một phần chính thức của nguồn.

      =======================================================
      ⚙️ THAM SỐ CHẠY
      =======================================================
      - SỐ Ý TƯỞNG YÊU CẦU: ${ideaCount} (đây là mức TRẦN, không phải chỉ tiêu. Chỉ có bao nhiêu ý tưởng mạnh thì trả bấy nhiêu.)
      - KÊNH & ĐỊNH DẠNG ƯU TIÊN: ${channels || '(Không chỉ định - tự chọn kênh và format phù hợp nhất với từng ý tưởng)'}
      - MỤC TIÊU NỘI DUNG: ${objectiveLine}
      ${extraReqs}

      =======================================================
      🧠 QUY TRÌNH TƯ DUY BẮT BUỘC (làm thầm, KHÔNG in ra các bước trung gian)
      =======================================================

      BƯỚC 1 - BÓC TÁCH CONTENT ATOM
      Tách nguồn thành các đơn vị ý nghĩa nhỏ nhất: dữ kiện, số liệu, quan sát, quan điểm, lập luận, insight, bài học, trải nghiệm, sai lầm, thất bại, thành công, nguyên nhân, hệ quả, quy luật, mâu thuẫn, đánh đổi, rủi ro, cơ hội, câu hỏi, phương pháp, quy trình, khung tư duy, nguyên tắc, lầm tưởng, cảnh báo, quyết định, so sánh, trước/sau, hành vi khách hàng, hành vi ngành, thay đổi thị trường, cơ chế nền tảng, hệ quả kinh doanh/vận hành, insight tâm lý, ý đáng trích dẫn, ý phản trực giác, câu hỏi còn bỏ ngỏ.
      LƯU Ý: Một đoạn văn có thể chứa nhiều atom. Nhiều đoạn văn có thể chỉ chứa một atom. KHÔNG mặc định mỗi gạch đầu dòng là một atom.

      BƯỚC 2 - TÌM CƠ HỘI NGẦM
      Không dừng ở những gì nguồn viết ra. Tự hỏi: Điều này hàm ý gì? Nguyên nhân là gì? Hệ quả là gì? Ai hiểu sai sẽ mắc lỗi nào? Insight này ảnh hưởng tới quyết định nào? Nên làm khác đi thế nào? Ai sẽ phản đối và vì sao? Giả định nào đang bị thách thức? Đánh đổi nằm ở đâu? Trước đó xảy ra gì, sau đó xảy ra gì? Cần đo lường gì? Cần ưu tiên gì? Rủi ro ngầm là gì? Cơ hội ngầm là gì? Người mới sẽ hiểu nhầm chỗ nào? Người có kinh nghiệm sẽ để ý điều gì? Câu hỏi tiếp theo là gì? Có thể dựng thành khung tư duy/checklist/bảng so sánh/hướng dẫn ra quyết định nào? Nó phản ánh xu hướng lớn nào?
      Ý tưởng suy ra phải còn liên kết logic rõ ràng với nguồn, không được bay quá xa khiến nguồn trở nên vô nghĩa.

      BƯỚC 3 - MỞ RỘNG, KHÔNG CHIA CƠ HỌC
      TUYỆT ĐỐI KHÔNG mặc định "1 mục trong nguồn = 1 ý tưởng". Một insight có thể sinh ra 0, 1 hoặc nhiều ý tưởng khác nhau; nhiều insight có thể gộp lại thành một nội dung mạnh hơn.

      BƯỚC 4 - THỬ NHIỀU GÓC TIẾP CẬN
      Với mỗi atom tiềm năng, thử các nhóm góc sau (chỉ dùng góc nào thực sự làm ý tưởng tốt hơn, KHÔNG ép mọi atom qua mọi góc):
      A. Giáo dục: cơ chế hoạt động, vì sao xảy ra, hướng dẫn cho người mới, insight nâng cao, giải thích đơn giản, khung tư duy, nguyên tắc, định nghĩa.
      B. Giải quyết vấn đề: how-to, từng bước, checklist, xử lý sự cố, chẩn đoán, tối ưu, khắc phục, phòng ngừa, "phải làm gì khi...".
      C. Ra quyết định: A hay B, khi nào chọn X, khi nào KHÔNG chọn X, cây quyết định, thứ tự ưu tiên, đánh đổi, chi phí và lợi ích, phân bổ nguồn lực.
      D. Sai lầm & rủi ro: lỗi phổ biến, cảnh báo, kiểu thất bại, chi phí ẩn, dấu hiệu đỏ, điều mọi người hiểu sai, điều không nên làm.
      E. Góc nhìn: lầm tưởng và sự thật, quan điểm ngược dòng, ý kiến không được lòng số đông, insight phản trực giác, tái định khung, thách thức giả định.
      F. Bằng chứng & trải nghiệm: case study, mổ xẻ, bài học rút ra, trước/sau, thử nghiệm, cái gì hiệu quả, cái gì thất bại, phân tích quy luật.
      G. Giá trị thực dụng: template, cheat sheet, checklist, công thức, kho tư liệu, quy trình làm việc, playbook.
      H. Theo nhóm khán giả: người mới, người có kinh nghiệm, đội nhỏ, đội lớn, người ra quyết định, người trực tiếp làm, khách hàng, người đang ở một giai đoạn cụ thể.
      I. Hành vi & tâm lý: vì sao người ta hành xử như vậy, tâm lý khách hàng, động lực, sự kháng cự, ma sát khi quyết định, niềm tin, nhận thức, thói quen.
      J. Tác động kinh doanh: doanh thu, chi phí, biên lợi nhuận, hiệu suất, năng suất, rủi ro, giữ chân, chuyển đổi, tăng trưởng, vận hành, lợi thế cạnh tranh.
      K. Thời điểm: trước khi bạn..., sau khi bạn..., khi nào nên..., bao lâu một lần..., quá sớm hay quá muộn, dấu hiệu đã đến lúc...
      L. Thảo luận: tranh luận, câu hỏi, poll, quan điểm nóng, đồng ý/không đồng ý, bạn sẽ chọn gì.

      BƯỚC 5 - BIẾN THÀNH NỘI DUNG MANG BẢN SẮC THƯƠNG HIỆU
      Với mỗi ý tưởng, tự trả lời: "Vì sao CHÍNH THƯƠNG HIỆU NÀY nên đăng nội dung này?". Câu trả lời phải đến từ chuyên môn, khách hàng, ngành hàng, sản phẩm, phương pháp, định vị, triết lý hoặc khán giả của thương hiệu.
      Ý tưởng cuối cùng phải giống nội dung mà thương hiệu này tự nhiên sẽ đăng, KHÔNG được giống "bài của người khác gắn thêm tên thương hiệu vào".

      BƯỚC 6 - LOẠI TRÙNG LẶP NGỮ NGHĨA
      Trước khi chốt, rà lại và bỏ các ý tưởng chồng lấn trên 70%. Đổi con số, đổi chữ, đổi tính từ hay đổi cấu trúc hook KHÔNG tạo ra ý tưởng mới.

      BƯỚC 7 - HOOK
      Mỗi ý tưởng có ĐÚNG MỘT hook/tiêu đề chính. Hook mạnh thường chứa ít nhất một trong: vấn đề rõ ràng, lợi ích cụ thể, hệ quả quan trọng, khoảng trống tò mò hữu ích, tương phản bất ngờ, sự liên quan rõ với khán giả, câu hỏi mạnh, lời hứa hành động được, rủi ro, căng thẳng khi ra quyết định, chi tiết cụ thể, insight phản trực giác.
      Tham khảo các cấu trúc: Nỗi đau ("Vì sao [vấn đề] cứ lặp lại dù bạn đã [giải pháp tưởng đúng]?"), Cảnh báo ("Đừng [hành động] trước khi [điều kiện]"), Lầm tưởng và sự thật, Ngược dòng ("Nhiều [thứ tốt] không phải lúc nào cũng tốt hơn"), Câu hỏi ("Nên chọn [A] hay [B]?"), Quyết định ("Khi nào nên [hành động] - và khi nào nên tránh?"), Chẩn đoán ("Nếu đang gặp [triệu chứng], hãy kiểm tra những thứ này trước"), Con số + giá trị cụ thể, Người mới bắt đầu, Ưu tiên ("Nếu chỉ sửa được một thứ, hãy sửa cái này trước"), Chi phí ẩn, Kiểu thất bại ("Bạn đã làm đúng [best practice]. Vì sao vẫn không hiệu quả?"), Trước khi..., So sánh, Kết quả ("Làm sao đạt [kết quả] mà không phải [đánh đổi]"), Tái định khung ("Đừng nghĩ [chủ đề] là X. Hãy nghĩ nó là Y"), Quy luật ("Vì sao những [thứ] hiệu quả nhất thường có chung điểm này"), Tín hiệu ("3 dấu hiệu bạn đã sẵn sàng [bước tiếp theo]"), Đánh đổi, Nhận diện khán giả ("Nếu bạn là [nhóm cụ thể], điều này quan trọng hơn [thứ thường được ưu tiên]").
      CẤM các kiểu giật tít rỗng: "sự thật gây sốc", "bí mật không ai nói", "thay đổi cuộc đời bạn", "hack đỉnh cao", "game changer", "bạn sẽ không tin nổi", "bí quyết số 1", "gây bão cộng đồng mạng"... trừ khi đó thật sự là chất giọng của thương hiệu này. KHÔNG dùng con số chỉ để tiêu đề trông dễ nhấp hơn. KHÔNG tạo kịch tính giả.

      BƯỚC 8 - CHỌN FORMAT THEO LOGIC
      KHÔNG gán format ngẫu nhiên. Chọn theo cách ý tưởng được truyền đạt tốt nhất: video ngắn, video talking-head, video demo, video hướng dẫn, video kể chuyện, phỏng vấn, carousel, post một ảnh, post chữ, thread, bài dài, newsletter, infographic, checklist, case study, bài so sánh, FAQ, poll, post tranh luận, meme, đồ họa dữ liệu, template, cẩm nang.
      CAROUSEL khi cần nhiều ý nối tiếp, có khung tư duy, checklist, các bước hoặc so sánh trực quan. VIDEO NGẮN khi hook mạnh, insight giải thích nhanh được, hoặc demo/cảm xúc/cá tính làm nội dung tốt hơn. POST CHỮ khi giá trị nằm ở lập luận và góc nhìn. CASE STUDY khi có bằng chứng đáng tin để mổ xẻ. INFOGRAPHIC khi quan hệ/con số/quy trình/so sánh dễ hiểu hơn bằng hình. POLL hoặc TRANH LUẬN khi tồn tại nhiều quan điểm hợp lý.

      BƯỚC 9 - GÁN MỤC TIÊU
      Chọn mục tiêu tự nhiên nhất cho từng ý tưởng: Reach, Engagement, Bình luận, Chia sẻ, Lưu, Giáo dục, Niềm tin, Uy tín chuyên môn, Cân nhắc, Nhận biết sản phẩm, Thu lead, Chuyển đổi, Giữ chân, Cộng đồng.

      BƯỚC 10 - KIỂM TRA TÍNH XÁC THỰC & ĐỘ TƯƠI
      Gắn cờ VERIFY = "Có" cho mọi nhận định có thể: phụ thuộc thời điểm, phụ thuộc nền tảng, phụ thuộc thị trường, phụ thuộc quốc gia/vùng, phụ thuộc chính sách, nhạy cảm pháp lý, nhạy cảm tài chính, nhạy cảm y tế, không chắc chắn về mặt thống kê, hoặc chỉ dựa vào trải nghiệm cá nhân của tác giả nguồn (quy định nền tảng, thuật toán, giá, phí, quy định pháp luật, số liệu thị trường, thông số sản phẩm, tính năng có sẵn, benchmark ngành, chính sách nhà nước, điều kiện tham gia chương trình).
      KHÔNG được âm thầm biến thông tin có thể đã lỗi thời thành chân lý vượt thời gian.

      BƯỚC 11 - BỘ LỌC CHẤT LƯỢNG
      Trước khi đưa ra, chấm mỗi ý tưởng trên 8 tiêu chí: (1) khán giả mục tiêu có thật sự quan tâm không, (2) có truy ngược rõ ràng về nguồn không, (3) thương hiệu này đăng có hợp lý không, (4) có thật sự khác các ý tưởng còn lại không, (5) khán giả thu được gì hữu ích, (6) có đủ chất liệu cho một nội dung thật không, (7) có nâng đỡ được một hook hấp dẫn mà trung thực không, (8) có phục vụ một mục tiêu chiến lược có ý nghĩa không. Loại thẳng ý tưởng yếu.

      =======================================================
      📏 KHOẢNG CÁCH NỘI DUNG (bắt buộc pha trộn cả 3 mức)
      =======================================================
      - TRỰC TIẾP: ý tưởng có sẵn rõ ràng trong nguồn, được đóng khung lại cho khán giả của thương hiệu.
      - MỞ RỘNG: ý tưởng suy ra từ nguyên nhân, hệ quả, quyết định, quy trình, sai lầm, cách áp dụng, so sánh, hàm ý.
      - LÂN CẬN CHIẾN LƯỢC: ý tưởng không nói thẳng trong nguồn nhưng được nguồn chống lưng mạnh và rất liên quan tới thương hiệu/khán giả.
      Tránh những ý tưởng xa tới mức mối liên hệ trở thành suy đoán.

      =======================================================
      📑 ĐỊNH DẠNG ĐẦU RA (MÃ HTML SẠCH - LIGHT THEME)
      =======================================================
      Xuất theo đúng khung dưới đây, đủ 5 mục (mục 5 chỉ xuất khi thật sự có rủi ro cần nêu):

      <div class="p-5 bg-white rounded-2xl border border-pink-200 shadow-sm text-slate-800 space-y-6">

        <div>
          <h4 class="font-bold text-pink-900 mb-2">1. 🧬 CONTENT DNA CỦA NGUỒN</h4>
          <div class="p-4 bg-pink-50 rounded-xl border border-pink-100 space-y-2 text-sm">
            <p><strong class="text-pink-900">Chủ đề cốt lõi:</strong> ... nguồn này về bản chất nói về điều gì ...</p>
            <p><strong class="text-pink-900">Các Content Atom giá trị nhất:</strong></p>
            <ul class="pl-5 space-y-1 text-slate-700"><li>...</li></ul>
          </div>
        </div>

        <div>
          <h4 class="font-bold text-pink-900 mb-2">2. 🌊 CONTENT WATERFALL</h4>
          <div class="overflow-x-auto rounded-xl border border-pink-200">
            <table class="w-full text-left border-collapse text-xs">
              <thead>
                <tr class="bg-pink-100 text-pink-950 uppercase tracking-wider font-bold">
                  <th class="p-3 border border-pink-200">ID</th>
                  <th class="p-3 border border-pink-200">Hook / Tiêu đề</th>
                  <th class="p-3 border border-pink-200">Ý tưởng nội dung</th>
                  <th class="p-3 border border-pink-200">Góc tiếp cận</th>
                  <th class="p-3 border border-pink-200">Câu hỏi của khán giả</th>
                  <th class="p-3 border border-pink-200">Định hướng triển khai</th>
                  <th class="p-3 border border-pink-200">Format</th>
                  <th class="p-3 border border-pink-200">Mục tiêu</th>
                  <th class="p-3 border border-pink-200">Bám nguồn ở đâu</th>
                  <th class="p-3 border border-pink-200">Khoảng cách</th>
                  <th class="p-3 border border-pink-200">Vì sao hợp brand</th>
                  <th class="p-3 border border-pink-200">Verify</th>
                </tr>
              </thead>
              <tbody class="bg-white text-slate-700">
                <tr>
                  <td class="p-3 border border-pink-100 font-bold text-pink-700">1</td>
                  <td class="p-3 border border-pink-100 font-semibold text-slate-900">"..."</td>
                  <td class="p-3 border border-pink-100">... mô tả ngắn gọn concept nội dung ...</td>
                  <td class="p-3 border border-pink-100">...</td>
                  <td class="p-3 border border-pink-100">... câu hỏi/vấn đề/nhu cầu cụ thể mà nội dung này trả lời ...</td>
                  <td class="p-3 border border-pink-100">• ý 1<br/>• ý 2<br/>• ý 3</td>
                  <td class="p-3 border border-pink-100">...</td>
                  <td class="p-3 border border-pink-100">...</td>
                  <td class="p-3 border border-pink-100">... insight nào trong nguồn sinh ra ý tưởng này ...</td>
                  <td class="p-3 border border-pink-100">Trực tiếp / Mở rộng / Lân cận chiến lược</td>
                  <td class="p-3 border border-pink-100">... một câu ...</td>
                  <td class="p-3 border border-pink-100">Không</td>
                </tr>
                <!-- Lặp lại đủ số ý tưởng mạnh tìm được, tối đa ${ideaCount}. Ô VERIFY ghi "Có: ..." kèm thứ cần kiểm chứng, hoặc "Không". Không để trống ô nào, thiếu thì ghi "—". -->
              </tbody>
            </table>
          </div>
          <p class="text-xs text-slate-600 mt-2">Nếu số ý tưởng trả về ít hơn ${ideaCount}, thêm một dòng ghi rõ vì sao nguồn chỉ đủ chất liệu cho bấy nhiêu ý tưởng mạnh.</p>
        </div>

        <div>
          <h4 class="font-bold text-pink-900 mb-2">3. ⭐ CƠ HỘI NÊN LÀM TRƯỚC</h4>
          <div class="space-y-2 text-sm">
            <div class="p-3 bg-pink-50 rounded-lg border border-pink-100"><strong class="text-pink-900">#ID - Hook:</strong> ... <br/><strong class="text-pink-900">Vì sao chọn ý tưởng này:</strong> ... (dựa trên mức độ liên quan với khán giả, sức mạnh của hook, độ hợp brand, giá trị chiến lược và tính khác biệt) ...</div>
          </div>
        </div>

        <div>
          <h4 class="font-bold text-pink-900 mb-2">4. 🗂️ CỤM NỘI DUNG (CONTENT CLUSTERS)</h4>
          <p class="text-xs text-slate-600 mb-2">Chỉ gom cụm khi các cụm phản ánh chủ đề chiến lược có thật, không gom cho cân đối hình thức.</p>
          <div class="grid md:grid-cols-2 gap-4 text-sm">
            <div class="p-4 bg-slate-50 rounded-xl border border-slate-200">
              <strong class="text-pink-900">Tên cụm</strong>
              <p class="text-xs text-slate-600 mt-1">Gồm các ID: ... — Vai trò chiến lược của cụm này: ...</p>
            </div>
          </div>
        </div>

        <div>
          <h4 class="font-bold text-pink-900 mb-2">5. ⚠️ RỦI RO TỪ NGUỒN</h4>
          <ul class="pl-5 space-y-1 text-sm text-slate-700">
            <li><strong>Cần kiểm chứng trước khi đăng:</strong> ...</li>
            <li><strong>Trải nghiệm của tác giả nguồn - KHÔNG được gán cho thương hiệu:</strong> ...</li>
            <li><strong>Thông tin có thể đã lỗi thời:</strong> ...</li>
            <li><strong>Nhận định thiếu căn cứ / giả định yếu của nguồn:</strong> ...</li>
          </ul>
        </div>

      </div>
      ${HTML_OUTPUT_RULES}
      `;
    }

    case AnalysisMode.THUMBNAIL_AUDIT:
      return `
      Đánh giá chuyên sâu hình ảnh Thumbnail/Bìa này dưới góc độ thiết kế đồ họa, tâm lý học thị giác và nhận diện thương hiệu.

      ${brandGuidelines}

      NỘI DUNG PHÂN TÍCH:
      1. Đánh giá Visual: Độ tương phản màu sắc, Typography, Chủ thể trung tâm, Điểm nhấn gây tò mò (Visual Hook).
      2. Chấm điểm tỷ lệ nhấp (CTR Score trên thang điểm 10).
      3. 3 Lời khuyên cải tiến cụ thể để phù hợp hơn với thương hiệu ${brand?.name || ''}.
      ${extraReqs}

      YÊU CẦU ĐỊNH DẠNG: Trả về mã HTML sạch, bọc toàn bộ trong <div class="p-5 bg-white rounded-2xl border border-pink-200 shadow-sm text-slate-800">, tiêu đề từng mục dùng <h4 class="font-bold text-pink-900">.
      ${HTML_OUTPUT_RULES}
      `;

    case AnalysisMode.ARTICLE_SCORING:
    case AnalysisMode.VIDEO_SCORING: {
      const isVideo = mode === AnalysisMode.VIDEO_SCORING;
      const what = isVideo ? 'video' : 'bài viết';

      // Hai cách chấm, khác nhau ở chỗ lấy thước đo từ đâu.
      const rubric = userChecklist
        ? `
      BỘ TIÊU CHÍ CỦA NGƯỜI DÙNG - ĐÂY LÀ LUẬT, CHẤM ĐÚNG THEO ĐÂY:
      """
      ${userChecklist}
      """

      CÁCH DÙNG BỘ TIÊU CHÍ NÀY:
      - Chấm đúng từng tiêu chí người dùng viết ra, theo đúng thang điểm và cách tính họ đặt.
      - Nếu họ ghi trọng số hay điểm tối đa cho từng mục, tôn trọng tuyệt đối con số đó.
      - Nếu họ viết dạng đạt/không đạt thì chấm đạt/không đạt, KHÔNG tự đổi sang thang 10.
      - Nếu họ có mục trừ điểm, áp dụng đúng.
      - KHÔNG tự thêm tiêu chí ngoài danh sách. Muốn góp ý thêm thì để xuống mục nhận xét cuối.`
        : `
      NGƯỜI DÙNG CHƯA NẠP BỘ TIÊU CHÍ RIÊNG. Chấm theo hai nguồn sau, ghi rõ ở đầu báo cáo là đang chấm theo bộ tiêu chí chuẩn:

      A. MỨC ĐỘ KHỚP THƯƠNG HIỆU - đối chiếu trực tiếp với Brand DNA ở trên (40 điểm)
         - Giọng văn và xưng hô có đúng như thương hiệu quy định không.
         - Có phạm từ khoá cấm không. Có nói đúng USP không.
         - Đúng đối tượng người đọc mà thương hiệu nhắm tới không.

      B. CHẤT LƯỢNG NỘI DUNG - theo đúng bộ tiêu chí dùng khi mổ xẻ một ${what} hiệu quả (60 điểm)
         - Hook: câu/cảnh mở đầu có chặn được người lướt không, thuộc dạng hook nào (15 điểm).
         - Tâm lý người đọc: có chạm đúng insight, có dùng đòn bẩy tâm lý đúng chỗ không (15 điểm).
         - Cấu trúc và mạch: bố cục theo công thức nào, chuyển ý có mượt, có chỗ nào tụt nhịp (10 điểm).
         - Niềm tin: khẳng định có chỗ dựa hay chỉ nói suông (10 điểm).
         - Trình bày: nhịp câu, ngắt đoạn, đọc trên điện thoại có dễ không (5 điểm).
         - CTA: có rõ ràng, đặt đúng chỗ, có gãy mạch cảm xúc không (5 điểm).`;

      return `
      Hãy CHẤM ĐIỂM ${what} dưới đây.

      DỮ LIỆU ĐẦU VÀO:
      - NỘI DUNG: "${userPrompt || '(Không dán text - hãy đọc từ link, file hoặc ảnh đính kèm)'}"
      ${url ? `- LINK: ${url}` : ''}
      - ẢNH / FILE ĐÍNH KÈM: nếu có, đọc hết chữ trong ảnh và tính cả phần trình bày thị giác vào điểm.
      ${rubric}

      ${extraReqs}

      TRẢ VỀ THEO ĐÚNG THỨ TỰ SAU:

      1. TỔNG ĐIỂM VÀ KẾT LUẬN NHANH
         Nêu tổng điểm thật to và rõ, kèm một câu kết luận ${what} này đang ở mức nào và vấn đề lớn nhất là gì.

      2. BẢNG CHẤM CHI TIẾT
         Lập bảng HTML gồm các cột: Tiêu chí | Điểm đạt / Điểm tối đa | Căn cứ chấm (trích nguyên văn) | Nhận xét.
         Mỗi dòng PHẢI có dẫn chứng trích nguyên văn từ nội dung. Không có dẫn chứng thì ghi rõ "không tìm thấy trong bài" và cho điểm tương ứng.

      3. ĐIỂM MẠNH GIỮ LẠI
         Những chỗ đang làm tốt, trích nguyên văn, và nói rõ vì sao nên giữ.

      4. GỢI Ý CHỈNH SỬA CỤ THỂ
         Đây là phần quan trọng nhất. Với mỗi tiêu chí bị mất điểm:
         - Trích nguyên văn đoạn đang có vấn đề.
         - Viết lại đoạn đó thành bản tốt hơn, viết thẳng ra câu chữ cụ thể chứ không khuyên chung chung.
         - Nói rõ sửa như vậy thì lấy lại được bao nhiêu điểm.
         Sắp xếp theo thứ tự ưu tiên: sửa cái nào trước thì lợi nhất.

      QUY TẮC BẮT BUỘC:
      - Mọi điểm số PHẢI có căn cứ trích dẫn từ chính nội dung. Không chấm cảm tính.
      - TUYỆT ĐỐI KHÔNG bịa số liệu tương tác nếu không được cung cấp.
      - Nếu không đọc được nội dung từ bất kỳ nguồn nào, nói rõ là không truy cập được và dừng lại, KHÔNG tự nghĩ ra nội dung để chấm.
      - Chấm thẳng thắn. Một bài dở mà được chấm cao thì bản chấm đó vô dụng.

      YÊU CẦU ĐỊNH DẠNG: Trả về mã HTML sạch, bọc toàn bộ trong <div class="p-5 bg-white rounded-2xl border border-pink-200 shadow-sm text-slate-800">.
      - Tổng điểm bọc trong <div class="p-4 bg-pink-50 rounded-xl border border-pink-200 mb-4"> với con số điểm để <span class="text-base font-bold text-pink-900">.
      - Mỗi mục mở đầu bằng <h4 class="font-bold text-pink-900">.
      - Bảng bọc trong <div class="overflow-x-auto">.
      - Mỗi gợi ý sửa bọc trong <div class="p-3 bg-slate-50 rounded-lg border border-slate-200 mb-2">, phần viết lại để <span class="whitespace-pre-line">.
      ${HTML_OUTPUT_RULES}
      `;
    }

    case AnalysisMode.ARTICLE_WRITING: {
      // Ba tình huống, ba cách viết khác hẳn nhau:
      //  - chỉ có ý tưởng: mở ý tưởng ra thành bài, được tự thêm lập luận.
      //  - có nguồn, không yêu cầu: kể lại đúng nguồn bằng lời thương hiệu.
      //  - có nguồn và có yêu cầu: yêu cầu dẫn đường, nguồn là chất liệu.
      // Gộp chung một prompt "tham khảo link" như trước thì model coi nguồn là
      // gợi ý và tự bịa phần còn lại.
      const idea = (userPrompt || '').trim();
      const brief = (additionalInstructions || '').trim();
      const hasSource = sourceKinds.length > 0 || !!url;
      const hasBrief = !!idea || !!brief;

      let n = 0;
      const part = (title: string) => `PHẦN ${++n} - ${title}`;

      const ideaOnlyBlock = `
      Ý TƯỞNG CỦA NGƯỜI DÙNG: "${idea}"
      ${brief ? `YÊU CẦU BỔ SUNG: "${brief}"` : ''}

      QUAN TRỌNG: ý tưởng người dùng đưa thường chỉ là vài dòng. Việc của bạn là mở nó ra thành một bài đủ sâu, chứ không phải diễn đạt lại cho dài. Tự bổ sung góc nhìn, ví dụ, lập luận mà một người trong nghề sẽ nghĩ tới - miễn là không bịa số liệu.`;

      const sourceBlock = `
      =======================================================
      📥 NGUỒN GỐC - ĐÂY LÀ CĂN CỨ DUY NHẤT CHO NỘI DUNG BÀI
      =======================================================
      ${describeSources({ sourceKinds, url })}
      ${sourceFidelityRules(brandLabel)}

      ${sourceBriefRules(idea, brief)}`;

      const formulaNote = hasSource
        ? ' Công thức chỉ quyết định cách sắp xếp và dẫn dắt. Nó KHÔNG cho phép thêm dữ kiện ngoài nguồn hay ép nhét sản phẩm thương hiệu vào chỗ nguồn không nói tới.'
        : '';

      return `
      Hãy viết một BÀI ĐĂNG HOÀN CHỈNH cho thương hiệu ${brandLabel}.
      ${hasSource ? sourceBlock : ideaOnlyBlock}

      CÔNG THỨC TRIỂN KHAI: ${formulaInstruction}${formulaNote}

      TRẢ VỀ ĐÚNG ${hasSource ? 'BỐN' : 'BA'} PHẦN THEO THỨ TỰ:
      ${hasSource ? `
      ${part('NỘI DUNG RÚT RA TỪ NGUỒN')}
      ${SOURCE_EXTRACT_SPEC}
      ` : ''}
      ${part('NĂM HOOK ĐỂ CHỌN')}
      Viết 5 hook khác nhau cho cùng bài này, mỗi hook một DẠNG khác nhau để người dùng có cái mà cân:
      - Một hook chạm nỗi đau trực diện
      - Một hook mở bằng con số hoặc dữ kiện cụ thể
      - Một hook nghịch lý, đi ngược điều số đông đang tin
      - Một hook kể chuyện, mở bằng một khoảnh khắc
      - Một hook đặt câu hỏi khiến người đọc phải tự soi lại mình
      Với mỗi hook, thêm một dòng ngắn gọn nói rõ nó đánh vào tâm lý gì. Đánh dấu rõ hook nào bạn cho là mạnh nhất và vì sao.
      ${hasSource ? 'Mỗi hook phải bám vào một chi tiết có thật trong nguồn. Hook con số chỉ được dùng số liệu nguồn có; nguồn không có số thì thay bằng một dạng hook khác và ghi rõ lý do.' : ''}

      ${part('BÀI VIẾT HOÀN CHỈNH')}
      Dùng hook mạnh nhất vừa chọn để mở bài, rồi viết trọn bài, đăng được ngay không cần sửa. Đúng giọng ${brandLabel}. Kết bằng CTA tự nhiên.
      Trình bày như một bài đăng thật: xuống dòng thoáng, đoạn ngắn, emoji tiết chế. KHÔNG chèn tiêu đề phân tích kiểu "Thân bài", "Kết luận" vào giữa bài.
      ${hasSource ? 'Mọi dữ kiện trong bài phải truy ngược được về phần NỘI DUNG RÚT RA TỪ NGUỒN. Đọc lại bài trước khi trả: câu nào chứa thông tin không có trong nguồn thì bỏ câu đó.' : ''}

      ${part('GHI CHÚ CHO NGƯỜI VIẾT')}
      Ngắn gọn thôi, để người dùng hiểu bài vừa viết đang chạy theo logic nào:
      - Công thức đã dùng và mạch cảm xúc dẫn dắt người đọc.
      - Các đòn bẩy tâm lý đã cài, nằm ở đoạn nào.
      ${hasSource ? '- Đối chiếu nguồn: ý chính nào của nguồn đã vào bài; ý nào (nếu có) đã lược bỏ và vì sao.' : ''}
      ${hasSource && hasBrief ? '- Chi tiết nào yêu cầu cần mà nguồn không có (nếu có).' : ''}
      - Vài hashtag phù hợp.
      - Một ghi chú về ảnh minh hoạ nên đi kèm.

      YÊU CẦU ĐỊNH DẠNG: Trả về mã HTML sạch, bọc toàn bộ trong <div class="p-5 bg-white rounded-2xl border border-pink-200 shadow-sm text-slate-800">.
      - Mỗi phần mở đầu bằng <h4 class="font-bold text-pink-900">.
      ${hasSource ? SOURCE_EXTRACT_FORMAT : ''}
      - Mỗi hook bọc trong <div class="p-3 bg-pink-50 rounded-lg border border-pink-100 mb-2">, chữ hook in đậm, dòng giải thích tâm lý để <span class="text-sm text-slate-500">.
      - Phần bài viết hoàn chỉnh bọc trong <div class="p-4 bg-slate-50 rounded-xl border border-slate-200 whitespace-pre-line leading-relaxed"> để người dùng bôi đen copy được nguyên khối.
      ${HTML_OUTPUT_RULES}
      `;
    }

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

      YÊU CẦU ĐỊNH DẠNG: Trả về mã HTML sạch, bọc toàn bộ trong <div class="p-5 bg-white rounded-2xl border border-pink-200 shadow-sm text-slate-800">, mỗi mục mở đầu bằng <h4 class="font-bold text-pink-900">, bảng bọc trong <div class="overflow-x-auto">, và làm nổi bật đoạn trích nguyên văn bằng <div class="p-3 bg-pink-50 rounded-lg border border-pink-100 italic">.
      ${HTML_OUTPUT_RULES}
      `;

    default:
      return `Phân tích nội dung này theo quy tắc thương hiệu: ${brandGuidelines}
      ${HTML_OUTPUT_RULES}`;
  }
};

// Every mode answers with HTML that goes straight into the page. The model
// still likes to wrap it: a lead-in sentence, a code fence, sometimes a whole
// <html> document. Anything left over shows up verbatim in the result pane.
const cleanResponse = (text: string): string => {
  let cleaned = text.trim();

  // Prefer what is inside a code fence, even when a sentence precedes it.
  const fenced = cleaned.match(/```(?:html)?\s*([\s\S]*?)```/i);
  if (fenced) {
    cleaned = fenced[1].trim();
  } else {
    // An opening fence with no closing one.
    cleaned = cleaned.replace(/^```(?:html)?\s*/i, '').replace(/```\s*$/, '').trim();
  }

  // A full document: keep the body only.
  const body = cleaned.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (body) cleaned = body[1].trim();

  cleaned = cleaned
    .replace(/<!DOCTYPE[^>]*>/gi, '')
    .replace(/<\/?(?:html|head|body)[^>]*>/gi, '')
    // A <style> block injected this way leaks into the whole app, and the model
    // writes them for a dark card we do not want anyway.
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .trim();

  return cleaned;
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
  extraImages?: { base64: string; mimeType: string }[],
  waterfall?: WaterfallOptions,
  checklist?: string
): Promise<string> => {



  let parts: any[] = [];
  
  if (contextData) {
     parts.push({ text: `NỘI DUNG GỐC ĐÃ TRÍCH XUẤT TỪ LIÊN KẾT (dữ liệu thật, hãy dùng làm căn cứ chính):\n${contextData}` });
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

  const sourceKinds: PromptSourceKind[] = [];
  if (fileUri || (base64Data && mimeType.startsWith('video'))) sourceKinds.push('video');
  else if (base64Data && mimeType.startsWith('audio')) sourceKinds.push('audio');
  else if (base64Data && mimeType.startsWith('image')) sourceKinds.push('image');
  if (contextData) sourceKinds.push('text');
  if (extraImages?.length) sourceKinds.push('images');

  const systemInstruction = getSystemInstruction(mode, brand);
  let promptText = getPrompt(mode, userPrompt, url, brand, additionalInstructions, formula, waterfall, checklist, sourceKinds);

  if (videoMeta) {
    promptText += `\n\n${formatVideoMeta(videoMeta)}`;
  }

  // Without this the model treats attached pictures as decoration and answers
  // from the text alone, which loses posts whose message lives on the image.
  if (extraImages?.length) {
    promptText += `\n\nCÓ ${extraImages.length} ẢNH ĐÍNH KÈM Ở TRÊN (ảnh chụp bài viết và/hoặc ảnh trong bài đăng gốc).
BẮT BUỘC: Đọc kỹ TOÀN BỘ chữ trong từng ảnh và coi đó là một phần chính thức của nội dung gốc, ngang hàng với phần văn bản.
Nhiều người sáng tạo đặt thông tin quan trọng nhất lên ảnh chứ không viết trong caption, nên bỏ qua ảnh là bỏ sót nội dung.`;
  }

  // A video feature falls back to the post's caption, stats, comments and cover
  // image when the file itself cannot be downloaded - Douyin, or any link behind
  // a login. Left unsaid, the model cheerfully invents a shot-by-shot timeline
  // for a video it never saw.
  const VIDEO_MODES = [
    AnalysisMode.REMAKE_SCRIPT,
    AnalysisMode.DEEP_ANALYSIS,
    AnalysisMode.SCRIPT_EXTRACT,
    AnalysisMode.VIDEO_SCORING,
  ];

  // Những tính năng nhận cả bài viết lẫn video. Với chúng, thiếu file KHÔNG có
  // nghĩa là hỏng - nguồn có thể vốn dĩ là một bài viết. Chỉ khi link trỏ tới
  // một video mà file không về được thì mới phải cảnh báo, nếu không model sẽ
  // dựng ra nội dung cho một video nó chưa từng xem.
  const MIXED_SOURCE_MODES = [
    AnalysisMode.CONTENT_AUDIT,
    AnalysisMode.ARTICLE_WRITING,
    AnalysisMode.ARTICLE_SCORING,
    AnalysisMode.CONTENT_WATERFALL,
  ];
  const VIDEO_LINK_RE = /(youtube\.com|youtu\.be|tiktok\.com|douyin\.com|iesdouyin\.com|fb\.watch|\/reel|\/video|\/watch)/i;

  const videoSourceMissing =
    VIDEO_MODES.includes(mode) ||
    (MIXED_SOURCE_MODES.includes(mode) && VIDEO_LINK_RE.test(url || ''));

  if (videoSourceMissing && !fileUri && !base64Data) {
    promptText += `

=======================================================
⚠️ KHÔNG TẢI ĐƯỢC FILE VIDEO GỐC
=======================================================
Bạn KHÔNG hề xem được video. Tất cả những gì bạn có là: caption, số liệu tương tác, bình luận của người xem và ảnh bìa ở trên.

BẮT BUỘC:
- Mở đầu câu trả lời bằng một dòng nói rõ: chỉ dựa trên caption, ảnh bìa và bình luận, KHÔNG dựa trên nội dung video.
- TUYỆT ĐỐI KHÔNG bịa mốc thời gian, lời thoại, cảnh quay, góc máy hay diễn biến hình ảnh trong video.
- BỎ HẲN mọi bảng bóc tách kịch bản theo timeline. Thà thiếu còn hơn bịa.
- Nếu nhiệm vụ là VIẾT LẠI hay TẠO NỘI DUNG MỚI: chỉ được triển khai từ thông tin có thật trong caption và bình luận. KHÔNG được tự nghĩ ra chi tiết, câu chuyện, số liệu hay luận điểm mà nguồn không hề nói tới.
- Nếu dữ liệu thật quá ít để làm ra một bài tử tế, hãy nói thẳng là nguồn không đủ và đề nghị người dùng tải file lên hoặc dán nội dung, thay vì viết bừa cho đủ chữ.
- Chỉ nêu những gì suy ra được từ dữ liệu thật đang có.
=======================================================`;
  }

  // Only ask the model to hunt the web when we could hand it neither the video
  // nor the text of the page behind the link.
  const needsWebLookup = !fileUri && !!url && !contextData;

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
    // Search only when the model was handed nothing. With a video or the page
    // text attached it just tempts the model to blend in unrelated material.
    useSearch: needsWebLookup,
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
