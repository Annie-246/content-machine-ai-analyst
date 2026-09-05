import { CarouselDeck, CarouselSlide, CarouselKit } from '../types';

// Dựng HTML cho bộ carousel.
//
// Khung CSS bê nguyên từ bộ quy tắc Tabcom đang chạy - cùng toạ độ, cùng cỡ chữ,
// cùng cách tô gradient tiêu đề - để ảnh ra khớp với những bộ đã đăng. Hai chi
// tiết trong đó trông vụn vặt nhưng bỏ đi là hỏng, nên chú thích ngay tại chỗ.
//
// Ảnh nền, logo và ảnh minh hoạ đều nhúng thẳng dạng data URI: file HTML được
// ghi vào thư mục tạm rồi mới mở, nên mọi đường dẫn tương đối đều gãy.

// Xuống dòng trong HTML sinh ra. Để riêng một hằng vì viết thẳng ký tự thoát
// vào chuỗi lồng trong template literal rất dễ hỏng khi sửa file bằng script.
const NL = String.fromCharCode(10);

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** Cho phép **in đậm** trong nội dung người dùng gõ, và chỉ thế. */
const inlineMarkup = (value: string): string =>
  escapeHtml(value).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');

const styleBlock = (kit: CarouselKit): string => {
  const fontFaces = (kit.fonts || [])
    .filter((f) => f.dataUrl)
    // font-weight:100 900 là BẮT BUỘC với variable font. Thiếu nó, trình duyệt
    // coi file chỉ có một độ đậm 400; gặp font-weight:700 nó không tìm ra nét đậm
    // thật nên tự bôi đậm giả - chữ dày thô và méo, trông như lỗi font. Câu chốt
    // đỏ và tiêu đề đều dùng 700 nên dính đầu tiên.
    .map((f) => `@font-face{font-family:'${f.family}';src:url('${f.dataUrl}');font-weight:100 900;font-style:normal;font-display:block}`)
    .join('\n');

  const titleFont = kit.titleFont || 'Inter';
  const bodyFont = kit.bodyFont || 'Mulish';

  return `
${fontFaces}
*{box-sizing:border-box}
html,body{margin:0;background:#fff}
body{display:flex;flex-direction:column;align-items:center;gap:24px}
.slide{position:relative;width:1080px;height:1080px;overflow:hidden;color:${kit.bodyColor};
 font-family:'${bodyFont}',Arial,sans-serif;background:#fff center/cover no-repeat}
/* overflow:hidden là chốt chặn cuối: nội dung có dài quá thì bị khuất chứ không
   tràn ra đè lên logo và chân trang đã in sẵn trên nền. */
.content{position:absolute;left:80px;right:80px;top:154px;bottom:150px;display:flex;flex-direction:column;overflow:hidden}
.title{flex:none;margin:0;font-family:'${titleFont}',Arial,sans-serif;font-weight:700;font-size:46px;line-height:1.05;
 letter-spacing:-.6px;text-transform:uppercase}
/* Mỗi dòng tiêu đề phải là một span riêng: tô gradient trên cả thẻ h1 thì dòng
   thứ hai mất dải màu. padding dọc là bắt buộc - thiếu nó background-clip ăn mất
   dấu của Ắ Ầ Ề Ẫ Ố Ớ, "BẮT ĐẦU" render ra "BĂT ĐÂU". */
.title span{display:block;width:fit-content;padding:.12em 0 .04em;
 background:linear-gradient(90deg,${kit.titleGradientFrom},${kit.titleGradientTo});
 -webkit-background-clip:text;background-clip:text;color:transparent}
.rule{width:96px;height:6px;flex:none;background:${kit.ruleColor};margin:18px 0 0;border-radius:4px}
.lead{flex:none;margin:26px 0 0;font-size:26px;line-height:1.42}
.lead b{font-weight:700}
.items{flex:none;margin-top:24px;display:flex;flex-direction:column;gap:16px}
.it{display:flex;gap:14px;font-size:25px;line-height:1.42}
.it i{flex:0 0 8px;height:8px;border-radius:50%;background:${kit.bodyColor};display:block;margin-top:13px}
.it b{font-weight:700}
.it .n{font-weight:700;color:${kit.accentColor}}
/* flex:none cho MỌI khối chữ. Thiếu nó, khối ảnh giãn ra chiếm hết chỗ và đẩy
   câu chốt ra khỏi khung - trên ảnh trông như ảnh đè lên chữ. */
.foot{flex:none;margin-top:22px;font-size:25px;line-height:1.4;color:${kit.footColor};font-weight:700}
/* Khối ảnh nhận phần chỗ còn thừa và TỰ CO khi chữ chiếm nhiều - trước đây nó
   giữ nguyên chiều cao tự nhiên nên một ảnh dọc là đẩy cả slide tràn ra ngoài
   rồi bị cắt ngang. Dòng min-height:0 là bắt buộc: thiếu nó, flex item không co
   xuống dưới kích thước nội dung và mọi thứ tràn y như cũ. */
/* flex:1 1 auto - vừa co được khi chữ nhiều, vừa GIÃN ra lấp chỗ trống khi chữ
   ít. Để 0 1 auto thì slide ít chữ bị hụt hẫng cả một mảng trống dưới đáy.
   TUYỆT ĐỐI KHÔNG thêm align-items:center vào đây, cũng như align-self:center
   vào .shot: bỏ stretch theo chiều dọc là ô lưới lấy chiều cao tự nhiên của ảnh,
   max-height:100% mất mốc tham chiếu, và ảnh dọc 1600px phóng to đè lên cả tiêu
   đề. Đã mắc bẫy này hai lần. */
.shots{flex:1 1 auto;min-height:0;margin-top:26px;display:grid;gap:14px}
.shots.n1{grid-template-columns:1fr}
.shots.n2{grid-template-columns:1fr 1fr}
.shots.n3{grid-template-columns:repeat(3,1fr)}
.shots.n4{grid-template-columns:1fr 1fr}
.shots.n5,.shots.n6{grid-template-columns:repeat(3,1fr)}
.shots.many{grid-template-columns:repeat(4,1fr)}
/* Vị trí chỉnh riêng cho từng ảnh: một slide có thể vừa có ảnh dạt trái, vừa có
   ảnh nằm giữa. Mặc định đã là giữa nên chỉ cần đè hai đầu. */
.shot.al-left{justify-self:start}
.shot.al-right{justify-self:end}
/* Viền nằm trên chính thẻ ảnh, KHÔNG phải trên một khung bọc ngoài.
   Cách cũ dùng khung có padding và width:fit-content, nhưng fit-content tính theo
   bề rộng gốc của ảnh chứ không theo bề rộng SAU KHI ảnh co lại vì max-height -
   nên ảnh dọc luôn để lại một mảng trắng to đùng hai bên, nhìn như cái icon dán
   giữa tờ giấy. Đặt viền lên ảnh thì nó bám sát mép, không đời nào thừa ra.
   .shot giờ chỉ còn là hộp căn giữa: không nền, không padding. */
.shot{min-height:0;display:flex;align-items:center;justify-content:center;overflow:hidden}
.shot img{max-width:100%;max-height:100%;width:auto;height:auto;object-fit:contain;display:block;
 border:2px solid ${kit.frameColor};border-radius:16px}
/* Ảnh nhỏ hơn thì bo góc nhỏ lại cho cân. */
.shots.n3 .shot img,.shots.n4 .shot img,.shots.n5 .shot img,.shots.n6 .shot img,.shots.many .shot img{border-radius:12px}
/* ----- Bố cục 'side': chữ trái, ảnh phải -----
   Cứu đúng tình huống slide nhiều chữ mà vẫn cần ảnh to: xếp dọc thì ảnh bị nén
   còn con tem, xếp ngang thì cả hai đều đủ chỗ thở. */
.content.side{flex-direction:row;gap:32px;align-items:stretch}
/* Căn giữa theo chiều dọc: chữ ít mà dồn hết lên trên thì nửa dưới trống hoác. */
.content.side .col{flex:1 1 0;min-width:0;display:flex;flex-direction:column;justify-content:center}
.content.side .col.pic{flex:0 0 44%;justify-content:center}
.content.side .shots{margin-top:0;height:100%;flex:1 1 auto}
.content.side .title{font-size:40px}
.content.side .lead{font-size:24px;margin-top:20px}
.content.side .it{font-size:22px}

/* ----- Bố cục 'hero': ảnh là nhân vật chính -----
   Chữ rút còn tiêu đề và một câu, ảnh chiếm phần lớn chiều cao. */
.content.hero .shots{flex:1 1 auto;margin-top:22px}
.content.hero .shot img{max-width:100%;max-height:100%}

.cmp{margin-top:24px;display:grid;grid-template-columns:1fr 1fr;gap:20px}
.card{border:2px solid ${kit.frameColor};border-radius:16px;background:#fff;padding:26px 28px}
.card.hi{border-color:${kit.accentColor}}
.card .lab{font-size:26px;font-weight:700;line-height:1.3}
.card .big{font-size:72px;font-weight:700;line-height:1.15;margin-top:10px}
.card.hi .big{color:${kit.accentColor}}
.card .row{margin-top:16px;padding-top:14px;border-top:2px solid #EEF1F8;font-size:25px;line-height:1.35}
.note{margin-top:14px;font-size:22px;color:${kit.bodyColor}}`.trim();
};

const titleHtml = (title: string): string => {
  const lines = title.split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return '';
  return `<h1 class="title">${lines.map((l) => `<span>${escapeHtml(l)}</span>`).join('')}</h1>`;
};

const slideHtml = (slide: CarouselSlide, background: string): string => {
  // Gom cả ảnh của bộ cũ (một ảnh) lẫn bộ mới (nhiều ảnh) về một chỗ.
  const images = [
    ...(slide.images || []).map((img) => ({ src: img.dataUrl, align: img.align })),
    ...(slide.imageDataUrl && !(slide.images || []).length
      ? [{ src: slide.imageDataUrl, align: undefined as undefined | 'left' | 'center' | 'right' }]
      : []),
  ].filter((img) => !!img.src);

  // Không khai bố cục thì suy ra: nhiều ảnh là lưới, còn lại xếp dọc.
  const layout = slide.layout || (images.length > 1 ? 'grid' : 'stack');

  const textParts: string[] = [];
  if (slide.title.trim()) {
    textParts.push(titleHtml(slide.title));
    textParts.push('<div class="rule"></div>');
  }
  if (slide.lead?.trim()) {
    textParts.push(`<p class="lead">${inlineMarkup(slide.lead.trim())}</p>`);
  }

  const bullets = (slide.bullets || []).map((b) => b.trim()).filter(Boolean);
  if (bullets.length) {
    const items = bullets
      .map((b) => `<div class="it"><i></i><span>${inlineMarkup(b)}</span></div>`)
      .join('');
    textParts.push(`<div class="items">${items}</div>`);
  }

  const footHtml = slide.foot?.trim() ? `<p class="foot">${inlineMarkup(slide.foot.trim())}</p>` : '';

  // Lớp n1..n6 quyết định lưới chia mấy cột; từ 7 ảnh trở lên dùng lưới 4 cột.
  const gridClass = images.length <= 6 ? `n${images.length}` : 'many';
  const shotsHtml = images.length
    ? `<div class="shots ${gridClass}">${images
        .map((img) => {
          const align = img.align && img.align !== 'center' ? ` al-${img.align}` : '';
          return `<div class="shot${align}"><img src="${img.src}" alt=""></div>`;
        })
        .join('')}</div>`
    : '';

  const bg = background ? `style="background-image:url('${background}')"` : '';

  // Bố cục ngang cần hai cột thật, nên phần thân dựng khác hẳn hai bố cục kia.
  if (layout === 'side' && images.length) {
    const textCol = textParts.join(NL);
    return `<section class="slide" ${bg}><div class="content side">
<div class="col">${textCol}${footHtml}</div>
<div class="col pic">${shotsHtml}</div>
</div></section>`;
  }

  const body = [...textParts, shotsHtml, footHtml].filter(Boolean).join(NL);
  return `<section class="slide" ${bg}><div class="content ${layout}">${body}</div></section>`;
};

/**
 * Bộ slide -> một trang HTML đầy đủ, sẵn sàng để chụp.
 * Nền lấy theo template đã chọn; slide nào chỉ định riêng thì dùng nền của nó.
 */
export const buildCarouselHtml = (deck: CarouselDeck, kit: CarouselKit): string => {
  const template = kit.templates.find((t) => t.id === deck.templateId) || kit.templates[0];
  const defaultBg = template?.backgroundDataUrl || '';

  const sections = deck.slides
    .map((slide) => slideHtml(slide, slide.backgroundDataUrl || defaultBg))
    .join('\n');

  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<title>${escapeHtml(deck.name || 'Carousel')}</title>
<style>
${styleBlock(kit)}
</style>
</head>
<body>
${sections}
</body>
</html>`;
};
