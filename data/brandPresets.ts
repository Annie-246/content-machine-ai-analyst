import { BrandProfile } from '../types';

// Ứng dụng khởi động ở trạng thái rỗng: người dùng tự tạo Brand DNA qua wizard onboarding,
// nhập từ file JSON, hoặc chọn một mẫu trung tính bên dưới rồi sửa lại.
export const DEFAULT_BRAND_PRESETS: BrandProfile[] = [];

export const BRAND_FIELD_KEYS: (keyof BrandProfile)[] = [
  'id', 'name', 'industry', 'tagline', 'targetAudience', 'speakerPersona',
  'addressingSpeaker', 'addressingAudience', 'brandVoiceTone', 'coreUSPs',
  'callToAction', 'forbiddenKeywords', 'customNotes', 'footerBlock', 'hashtags',
];

export const createBrandId = (): string => {
  try {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return `brand_${crypto.randomUUID()}`;
  } catch {
    // Trình duyệt cũ không có crypto.randomUUID.
  }
  return `brand_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
};

export const createBlankBrand = (name = ''): BrandProfile => ({
  id: createBrandId(),
  name,
  industry: '',
  tagline: '',
  targetAudience: '',
  speakerPersona: '',
  addressingSpeaker: 'Mình',
  addressingAudience: 'Bạn',
  brandVoiceTone: '',
  coreUSPs: '',
  callToAction: '',
  forbiddenKeywords: '',
  customNotes: '',
  footerBlock: '',
  hashtags: '',
});

// Ép dữ liệu lạ (import từ file JSON) về đúng hình dạng BrandProfile.
export const normalizeBrand = (raw: unknown, fallbackName = 'Thương hiệu nhập khẩu'): BrandProfile | null => {
  if (!raw || typeof raw !== 'object') return null;
  const src = raw as Record<string, unknown>;
  const str = (key: string): string => (typeof src[key] === 'string' ? (src[key] as string) : '');
  const name = str('name').trim();
  if (!name) return null;

  const base = createBlankBrand(name);
  return {
    ...base,
    id: str('id').trim() || base.id,
    name: name || fallbackName,
    industry: str('industry'),
    tagline: str('tagline'),
    targetAudience: str('targetAudience'),
    speakerPersona: str('speakerPersona'),
    addressingSpeaker: str('addressingSpeaker') || base.addressingSpeaker,
    addressingAudience: str('addressingAudience') || base.addressingAudience,
    brandVoiceTone: str('brandVoiceTone'),
    coreUSPs: str('coreUSPs'),
    callToAction: str('callToAction'),
    forbiddenKeywords: str('forbiddenKeywords'),
    customNotes: str('customNotes'),
    footerBlock: str('footerBlock'),
    hashtags: str('hashtags'),
  };
};

// Mẫu trung tính - dùng làm điểm khởi đầu, người dùng sửa lại theo thương hiệu thật.
export const SAMPLE_BRAND_PRESETS: BrandProfile[] = [
  {
    id: 'sample_beauty',
    name: 'Mẫu — Mỹ phẩm & Chăm sóc da',
    industry: 'Mỹ phẩm, chăm sóc da',
    tagline: 'Chăm da đúng cách, tự tin mỗi ngày',
    targetAudience: 'Nữ 18-35 tuổi quan tâm chăm sóc da, ưu tiên thành phần lành tính và hiệu quả rõ ràng.',
    speakerPersona: 'Người bạn am hiểu về da, chia sẻ kiến thức dễ hiểu, không phán xét.',
    addressingSpeaker: 'Mình',
    addressingAudience: 'Bạn',
    brandVoiceTone: 'Gần gũi, tích cực, minh bạch về thành phần, không hù dọa, không hứa hẹn quá đà.',
    coreUSPs: '• Thành phần minh bạch, có kiểm nghiệm\n• Phù hợp da nhạy cảm\n• Hướng dẫn routine cụ thể theo từng loại da',
    callToAction: 'Nhắn tin để được tư vấn routine phù hợp với làn da của bạn nhé!',
    forbiddenKeywords: 'Trắng cấp tốc sau 1 đêm, trị dứt điểm, kem trộn, dìm hàng đối thủ, tạo áp lực ngoại hình.',
    customNotes: '',
    footerBlock: '',
    hashtags: '',
  },
  {
    id: 'sample_fnb',
    name: 'Mẫu — F&B / Đồ uống',
    industry: 'Ẩm thực & đồ uống',
    tagline: 'Ngon thật, nguyên liệu thật',
    targetAudience: 'Dân văn phòng và người trẻ 20-35 tuổi ở thành phố, thích trải nghiệm món mới, quan tâm nguyên liệu sạch.',
    speakerPersona: 'Người sành ăn thân thiện, kể chuyện món ăn bằng trải nghiệm thật.',
    addressingSpeaker: 'Tụi mình',
    addressingAudience: 'Bạn',
    brandVoiceTone: 'Vui vẻ, đời thường, gợi cảm giác thèm, tập trung vào hương vị và trải nghiệm tại chỗ.',
    coreUSPs: '• Nguyên liệu chọn lọc theo mùa\n• Công thức pha chế riêng\n• Không gian phù hợp làm việc và gặp gỡ',
    callToAction: 'Ghé thử và cho tụi mình biết cảm nhận của bạn nhé!',
    forbiddenKeywords: 'Rẻ nhất thị trường, so sánh trực tiếp với đối thủ, claim về sức khỏe không có căn cứ.',
    customNotes: '',
    footerBlock: '',
    hashtags: '',
  },
  {
    id: 'sample_creator',
    name: 'Mẫu — Kênh Creator cá nhân',
    industry: 'Sáng tạo nội dung / Giáo dục',
    tagline: 'Kiến thức thực chiến, nói thẳng nói thật',
    targetAudience: 'Người đi làm 22-40 tuổi muốn học kỹ năng mới nhanh và áp dụng được ngay.',
    speakerPersona: 'Người đi trước chia sẻ kinh nghiệm thật, có ví dụ cụ thể, không lý thuyết suông.',
    addressingSpeaker: 'Mình',
    addressingAudience: 'Các bạn',
    brandVoiceTone: 'Thẳng thắn, súc tích, giàu ví dụ thực tế, không giật gân câu view.',
    coreUSPs: '• Nội dung đúc kết từ trải nghiệm thật\n• Luôn có bước hành động cụ thể\n• Không bán khóa học ảo',
    callToAction: 'Theo dõi để không bỏ lỡ các chia sẻ tiếp theo nhé!',
    forbiddenKeywords: 'Cam kết thu nhập, làm giàu nhanh, tiêu đề giật gân sai sự thật.',
    customNotes: '',
    footerBlock: '',
    hashtags: '',
  },
];

export const STORAGE_KEY_BRAND_PROFILES = 'cm_brand_profiles_v1';
export const STORAGE_KEY_ACTIVE_BRAND = 'cm_active_brand_id_v1';
