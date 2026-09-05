# Content Machine

Công cụ phân tích và remake nội dung cho thương hiệu: tải video từ mạng xã hội, cho AI xem trực tiếp,
bóc tách kịch bản, phân tích bài viết và tạo nội dung mới theo Brand DNA.

App **không gắn với thương hiệu nào**. Lần đầu mở, bạn tạo Brand DNA của riêng mình; mọi prompt gửi cho AI
đều sinh ra từ hồ sơ đó. Có thể tạo nhiều thương hiệu và chuyển qua lại trong cùng một bản cài đặt.

## Tải app Windows

Bản đóng gói sẵn nằm ở trang [Releases](https://github.com/Annie-246/content-machine-ai-analyst/releases/latest),
không cần cài Node.js:

- `Content Machine Setup <phiên bản>.exe`: bản cài đặt, có shortcut.
- `Content Machine <phiên bản>.exe`: bản chạy ngay, không cần cài.

Máy vẫn cần `yt-dlp` để tải video (xem bảng bên dưới) và Chrome hoặc Edge để Carousel Studio dựng ảnh.

## Yêu cầu hệ thống

| Thành phần | Bắt buộc | Dùng để làm gì |
|---|---|---|
| Node.js 20 trở lên | Có | Chạy app và máy chủ |
| Python 3 + `yt-dlp` | Có | Tải video từ TikTok, YouTube, Facebook... |
| `curl_cffi` | Rất nên có | Vượt lớp chống bot của TikTok. Thiếu nó thì phần lớn link TikTok sẽ bị chặn |
| `ffmpeg` | Nên có | Ghép hình và tiếng khi nền tảng trả về hai luồng riêng |

Cài công cụ tải video:

```bash
pip install -U "yt-dlp[default,curl-cffi]"
```

TikTok đổi cơ chế chặn thường xuyên, nên chạy lại lệnh trên khi thấy link hay lỗi.

## Chạy ở máy local

```bash
npm install
npm run dev
```

Mở http://localhost:3100

## Build và chạy bản production

```bash
npm install
npm run build     # tạo thư mục dist/
npm start         # chạy máy chủ phục vụ dist/ và các API
```

`npm start` chạy [server/production.mjs](server/production.mjs) — nó vừa phục vụ giao diện đã build,
vừa xử lý `/api/*`. Không dùng `vite preview` để deploy: lệnh đó chỉ phục vụ file tĩnh, mọi tính năng
gọi AI và tải video sẽ hỏng.

## Biến môi trường

Đặt trong `.env.local` khi chạy local, hoặc trong cấu hình môi trường khi deploy.

| Biến | Bắt buộc | Ý nghĩa |
|---|---|---|
| `GEMINI_API_KEY` | Không | Key dùng chung cho cả hệ thống. Có key này thì người dùng không cần tự nhập. Bỏ trống thì mỗi người tự dán key ở mục **Tích hợp** |
| `PORT` | Không | Cổng máy chủ, mặc định `3100` |
| `HOST` | Không | Địa chỉ lắng nghe, mặc định `0.0.0.0` |
| `YTDLP_PATH` | Không | Đường dẫn tới yt-dlp nếu không nằm trong PATH |
| `YTDLP_IMPERSONATE` | Không | Trình duyệt giả lập, mặc định `chrome` |
| `YTDLP_COOKIES_FROM_BROWSER` | Không | Mượn cookie trình duyệt cho video riêng tư, ví dụ `chrome` |
| `YTDLP_COOKIES_FILE` | Không | Dùng file `cookies.txt` thay cho mượn cookie trình duyệt |

Lấy key Gemini tại https://aistudio.google.com/apikey

## Brand DNA (nhiều thương hiệu)

Lần đầu mở app sẽ hiện màn hình khởi tạo với 3 lựa chọn:

| Lựa chọn | Dùng khi |
|---|---|
| Tạo mới từ đầu | Nhập tên thương hiệu rồi điền form Brand DNA |
| Nhập file JSON | Đã có Brand DNA export từ máy khác |
| Dùng preset mẫu | Muốn bắt đầu nhanh từ mẫu trung tính rồi sửa lại |

Sau đó:

- Thêm thương hiệu mới: menu chọn brand ở thanh trên, hoặc nút **Thêm brand** ở banner.
- Chuyển thương hiệu: chọn trong menu ở thanh trên.
- Chia sẻ Brand DNA: mở **Quản lý Brand** ➔ **Xuất JSON** / **Nhập JSON**.

Hai trường tùy chọn đáng chú ý trong form:

- **Khối Footer Cố Định**: nếu điền, AI sẽ chèn nguyên văn khối này ở cuối mọi bài đăng social.
- **Bộ Hashtag Mặc Định**: nếu để trống, AI tự đề xuất hashtag theo chủ đề.

Dữ liệu Brand DNA lưu trong `localStorage` của trình duyệt, không gửi đi đâu ngoài prompt cho AI.

## Về API key

Bản build **không nhúng key vào mã nguồn phía trình duyệt**. Mọi lời gọi AI đều đi qua máy chủ:

- Có `GEMINI_API_KEY` trên máy chủ: người dùng mở app là dùng được ngay.
- Không có: người dùng vào mục **Tích hợp**, dán key của họ. Key lưu trong trình duyệt của từng người.

Key người dùng tự nhập được ưu tiên hơn key máy chủ.

## Chọn nhà cung cấp AI

Mục **Tích hợp** cho phép gán từng nhóm việc cho từng nhà cung cấp:

| Nhóm việc | Nhà cung cấp dùng được |
|---|---|
| Phân tích video | Chỉ Google Gemini — các bên khác không nhận video làm đầu vào |
| Nội dung văn bản | Gemini, OpenAI, Anthropic Claude, DeepSeek |
| Tạo hình ảnh | Chỉ Google Gemini |

Yêu cầu nào có video hoặc ảnh sẽ tự động chạy bằng Gemini, bất kể phân công.

## Deploy

App cần chạy được tiến trình Node **và** gọi được yt-dlp, nên phải deploy lên nơi có toàn quyền hệ thống:
VPS, Railway, Render, Fly.io, hoặc container.

Không dùng được: Vercel, Netlify, Cloudflare Workers, GitHub Pages — các nền tảng này không chạy được
yt-dlp và ffmpeg.

### Docker

```bash
docker build -t content-machine .
docker run -p 3100:3100 -e GEMINI_API_KEY=your_key content-machine
```

### VPS

```bash
git clone <repo> && cd <repo>
npm install
npm run build
pip install -U "yt-dlp[default,curl-cffi]"
GEMINI_API_KEY=your_key PORT=3100 npm start
```

Nên chạy qua `pm2` hoặc systemd để tự khởi động lại, và đặt nginx phía trước để có HTTPS.

## Giới hạn đã biết

- Video dài quá 15 phút hoặc nặng quá 150MB sẽ bị từ chối.
- TikTok thỉnh thoảng chặn ngẫu nhiên; máy chủ tự thử lại 7 lần trước khi báo lỗi.
- Video Facebook và Instagram riêng tư cần cookie, xem biến `YTDLP_COOKIES_*`.
- Video đã tải được lưu trên Gemini 48 giờ; máy chủ nhớ trong 40 giờ để khỏi tải lại.
