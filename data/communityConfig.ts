// Cộng đồng, hỗ trợ và các kênh liên hệ.
//
// Mọi đường dẫn hiển thị trong app đều nằm ở đây, nên khi có link mới thì chỉ
// sửa file này - không phải đụng vào bất kỳ file giao diện nào.
//
// Chỗ nào để trống ('') thì phần đó tự ẩn khỏi giao diện, không hiện ô rỗng.

export const COMMUNITY = {
  /** Cộng đồng Skool. */
  skool: {
    name: 'XMAI - AI Heroes Club',
    url: 'https://www.skool.com/xmai-ai-heroes-club-7508/about',
    description:
      'Cộng đồng thực chiến giúp bạn dùng AI làm việc nhanh hơn: học theo lộ trình, thực hành trên việc thật của bạn, có người kèm.',
    // Ảnh nằm trong public/ nên app vẫn hiện được khi không có mạng.
    banner: '/skool-banner.jpg',
    logo: '/xmai-logo.jpg',
  },

  /** Đặt lịch tư vấn giải pháp AI riêng. */
  booking: {
    url: 'https://calendly.com/pthao24-work/t-v-n-1-1-ai-cung-nh-t-d-ng-xoa-mu-ai',
    heading: 'Cần hỗ trợ hoặc tư vấn triển khai giải pháp AI riêng?',
    description:
      'Đặt lịch để cùng xem quy trình của bạn và thiết kế hệ thống AI phù hợp với đội ngũ, thay vì dùng chung một công cụ có sẵn.',
    cta: 'Đặt lịch tư vấn 1-1',
  },

  /** Video hướng dẫn sử dụng, hiện trong mục Cộng đồng và ở chỗ báo thiếu key. */
  guide: {
    // Link YouTube, Drive hay bài viết đều được.
    url: '',
    label: 'Xem video hướng dẫn sử dụng',
  },

  /**
   * Ủng hộ tác giả bằng chuyển khoản.
   *
   * Mã QR là cách chính: nó là tài khoản định danh VietQR (QRGD...), chuyển được
   * khi quét nhưng không gõ tay vào app ngân hàng được vì có chữ. Muốn hiện thêm
   * số tài khoản cho người chuyển thủ công thì điền `accountNumber` bên dưới.
   */
  donate: {
    heading: 'Ủng hộ tác giả',
    description:
      'App miễn phí và sẽ luôn miễn phí. Nếu nó giúp được việc của bạn, một ly cà phê là đủ để mình vui cả ngày.',
    qrImage: '/donate-qr.jpg',
    bankName: 'Vietcombank',
    accountNumber: '',
    accountName: 'DO DAO NHAT DUONG',
  },

  /** Các kênh liên hệ. Để trống kênh nào thì kênh đó tự ẩn. */
  contact: {
    zalo: 'https://zalo.me/0363923882',
    zaloLabel: 'Zalo · 0363923882 (Phương Thảo)',
    facebook: 'https://www.facebook.com/nhatduong.vn',
    youtube: 'https://www.youtube.com/@Under30vn',
    email: 'podcast.u30@gmail.com',
  },
} as const;
