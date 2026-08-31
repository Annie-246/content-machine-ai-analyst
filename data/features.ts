import React from 'react';
import {
  FileVideo, BarChart3, FileSearch, Clapperboard, Image as ImageIcon, Newspaper, Gauge,
} from 'lucide-react';
import { AnalysisMode } from '../types';

export type FeatureTab = 'video' | 'article';

export interface Feature {
  mode: AnalysisMode;
  tab: FeatureTab;
  title: string;
  desc: string;
  icon: React.ElementType;
  featured?: boolean;
  // The three workflow stages, shown both on the launcher card and as the
  // stepper above the workspace. Every feature names its own stages so the
  // wording matches what it actually asks for.
  steps: [string, string][];
  soon?: boolean;
}

export const VIDEO_FEATURES: Feature[] = [
  {
    mode: AnalysisMode.REMAKE_SCRIPT,
    tab: 'video',
    title: 'Remake kịch bản video',
    desc: 'Biến video gốc thành kịch bản mới theo đúng Brand DNA và giọng văn của bạn.',
    icon: FileVideo,
    featured: true,
    steps: [
      ['Nguồn video', 'Dán link hoặc tải lên'],
      ['Tùy chỉnh', 'Công thức & giọng văn'],
      ['Kết quả', 'Kịch bản mới sẵn sàng'],
    ],
  },
  {
    mode: AnalysisMode.DEEP_ANALYSIS,
    tab: 'video',
    title: 'Phân tích sâu video',
    desc: 'Phân tích chi tiết: kịch bản, hình ảnh, âm thanh, hook, CTA và hiệu suất.',
    icon: BarChart3,
    steps: [
      ['Nguồn video', 'Dán link hoặc tải lên'],
      ['Tùy chỉnh', 'Trọng tâm cần mổ xẻ'],
      ['Kết quả', 'Báo cáo phân tích'],
    ],
  },
  {
    mode: AnalysisMode.SCRIPT_EXTRACT,
    tab: 'video',
    title: 'Trích script video',
    desc: 'Trích xuất kịch bản (script) từ video nhanh chóng và chính xác.',
    icon: FileSearch,
    steps: [
      ['Nguồn video', 'Dán link hoặc tải lên'],
      ['Tùy chỉnh', 'Yêu cầu bổ sung'],
      ['Kết quả', 'Script kèm mốc thời gian'],
    ],
  },
  {
    mode: AnalysisMode.SCRIPT_GENERATION,
    tab: 'video',
    title: 'Tạo kịch bản từ ý tưởng',
    desc: 'Từ ý tưởng nháp thô thành kịch bản viral chuẩn thương hiệu.',
    icon: Clapperboard,
    steps: [
      ['Ý tưởng', 'Ý tưởng thô hoặc link'],
      ['Tùy chỉnh', 'Công thức & giọng văn'],
      ['Kết quả', 'Kịch bản hoàn chỉnh'],
    ],
  },
  {
    mode: AnalysisMode.VIDEO_SCORING,
    tab: 'video',
    title: 'Chấm điểm nội dung',
    desc: 'Chấm điểm video theo bộ tiêu chí của thương hiệu.',
    icon: Gauge,
    soon: true,
    steps: [
      ['Nguồn video', 'Dán link hoặc tải lên'],
      ['Tùy chỉnh', 'Bộ tiêu chí chấm'],
      ['Kết quả', 'Bảng điểm chi tiết'],
    ],
  },
];

export const ARTICLE_FEATURES: Feature[] = [
  {
    mode: AnalysisMode.CONTENT_AUDIT,
    tab: 'article',
    title: 'Remake bài viết',
    desc: 'Chuyển đổi một bài viết hiện có thành phiên bản mới, phù hợp với Brand DNA và giọng văn của bạn.',
    icon: Newspaper,
    featured: true,
    steps: [
      ['Nguồn bài viết', 'Link, text hoặc ảnh chụp'],
      ['Tùy chỉnh', 'Nội dung & giọng văn'],
      ['Kết quả', 'Bài viết mới sẵn sàng'],
    ],
  },
  {
    mode: AnalysisMode.ARTICLE_ANALYSIS,
    tab: 'article',
    title: 'Phân tích sâu bài viết',
    desc: 'Mổ xẻ bài viết hay để học: hook, tâm lý người đọc, cấu trúc, hình thức và CTA.',
    icon: BarChart3,
    steps: [
      ['Nguồn bài viết', 'Link, text hoặc ảnh chụp'],
      ['Tùy chỉnh', 'Trọng tâm cần mổ xẻ'],
      ['Kết quả', 'Báo cáo phân tích'],
    ],
  },
  {
    mode: AnalysisMode.THUMBNAIL_AUDIT,
    tab: 'article',
    title: 'Tạo hình ảnh',
    desc: 'Tạo hình ảnh minh họa, đồ họa hỗ trợ cho bài viết và nội dung mạng xã hội.',
    icon: ImageIcon,
    soon: true,
    steps: [
      ['Nguồn ảnh', 'Ảnh sản phẩm hoặc mẫu'],
      ['Tùy chỉnh', 'Tiêu đề & tỉ lệ khung'],
      ['Kết quả', 'Hình ảnh chuẩn brand'],
    ],
  },
  {
    mode: AnalysisMode.ARTICLE_SCORING,
    tab: 'article',
    title: 'Chấm điểm nội dung',
    desc: 'Chấm điểm bài viết theo bộ tiêu chí của thương hiệu.',
    icon: Gauge,
    soon: true,
    steps: [
      ['Nguồn bài viết', 'Link, text hoặc ảnh chụp'],
      ['Tùy chỉnh', 'Bộ tiêu chí chấm'],
      ['Kết quả', 'Bảng điểm chi tiết'],
    ],
  },
];

export const ALL_FEATURES: Feature[] = [...VIDEO_FEATURES, ...ARTICLE_FEATURES];

export const getFeature = (mode: AnalysisMode): Feature =>
  ALL_FEATURES.find((f) => f.mode === mode) || VIDEO_FEATURES[0];
