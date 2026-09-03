import { FileData, VideoMeta } from '../types';
import { postJson } from './apiClient';
import { getGeminiApiKey } from './apiKeyStore';
import { fileToGenerativePart } from './geminiService';

// Links the server can download with yt-dlp. A browser can never fetch these
// itself - CORS blocks it - so they go straight to the server-side downloader.
export const SOCIAL_LINK_RE = /(youtube\.com|youtu\.be|tiktok\.com|douyin\.com|iesdouyin\.com|facebook\.com|fb\.watch|instagram\.com|x\.com|twitter\.com|threads\.net)/i;

// A plain web address is almost always an article. Only chase the bytes when
// the link actually names a media file.
const MEDIA_EXT_RE = /\.(mp4|mov|webm|mkv|m4v|mp3|wav|ogg|m4a|jpg|jpeg|png|webp)(\?|#|$)/i;

/**
 * How hard to try for a media file behind the link.
 * - `text`  : never download media, read the page.
 * - `video` : the caller wants a file; fall back to page text only when there
 *             is no video to be had.
 * - `auto`  : the link may be either. Social links are tried as video first,
 *             everything else is read as text unless it names a media file.
 */
export type LinkSourceMode = 'text' | 'video' | 'auto';

export interface LinkSourceResult {
  fileData: FileData;
  /** The run still works, just with less material than hoped. */
  warning?: string;
}

const bareLink = (url: string): FileData => ({
  file: null, previewUrl: '', type: 'url', base64: '', mimeType: '', url,
});

/**
 * Reads the real words behind a link - a Facebook post, a thread, an article -
 * so the model works from the actual wording instead of being told to look the
 * link up on the web. Returns null when the page yields nothing usable.
 */
export const fetchLinkAsText = async (
  url: string,
  withComments = false,
): Promise<FileData | null> => {
  try {
    const payload = await postJson<{
      kind: string; title: string; text?: string; base64?: string; mimeType?: string;
      images?: { base64: string; mimeType: string }[];
      commentCount?: number;
    }>('/api/fetch-source', { url, withComments });

    if (payload.base64) {
      return {
        file: null, previewUrl: '', type: 'url',
        base64: payload.base64, mimeType: payload.mimeType || 'application/pdf',
        url, sourceTitle: payload.title,
      };
    }
    if (payload.text && payload.text.trim().length > 40) {
      return {
        file: null, previewUrl: '', type: 'url', base64: '', mimeType: '',
        url, sourceText: payload.text, sourceTitle: payload.title,
        sourceImages: payload.images,
        commentCount: payload.commentCount,
      };
    }
    return null;
  } catch {
    return null;
  }
};

const downloadDirect = async (url: string, notify: (m: string) => void): Promise<LinkSourceResult> => {
  let blob: Blob;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error('Direct fetch failed');
    blob = await response.blob();
  } catch {
    try {
      const proxyResponse = await fetch(`https://corsproxy.io/?${encodeURIComponent(url)}`);
      if (!proxyResponse.ok) throw new Error('Proxy fetch failed');
      blob = await proxyResponse.blob();
    } catch {
      return { fileData: bareLink(url), warning: 'Chuyển sang chế độ đọc Link Web.' };
    }
  }

  notify('Đang đọc file tải về...');

  let mimeType = blob.type;
  if (!mimeType || mimeType === 'application/octet-stream') {
    const ext = url.split('.').pop()?.toLowerCase();
    if (['jpg', 'jpeg'].includes(ext || '')) mimeType = 'image/jpeg';
    else if (['png'].includes(ext || '')) mimeType = 'image/png';
    else if (['mov'].includes(ext || '')) mimeType = 'video/quicktime';
    else if (['mp3', 'wav', 'ogg'].includes(ext || '')) mimeType = 'audio/mpeg';
    else mimeType = 'video/mp4';
    blob = blob.slice(0, blob.size, mimeType);
  }

  const type = mimeType.startsWith('image') ? 'image'
    : mimeType.startsWith('audio') ? 'audio' : 'video';

  const { inlineData } = await fileToGenerativePart(blob);
  return {
    fileData: {
      file: null,
      previewUrl: URL.createObjectURL(blob),
      type,
      base64: inlineData.data,
      mimeType,
    },
  };
};

/**
 * Turns a pasted link into something the model can actually read. Throws only
 * when nothing at all could be recovered; a partial result comes back with a
 * warning instead, so the user can still run on the bare address.
 */
export const loadLinkSource = async (
  url: string,
  opts: { mode: LinkSourceMode; withComments?: boolean; onProgress?: (message: string) => void }
): Promise<LinkSourceResult> => {
  const notify = (message: string) => opts.onProgress?.(message);
  const withComments = opts.withComments === true;

  const readAsText = async (): Promise<LinkSourceResult> => {
    notify(withComments ? 'Đang đọc bài đăng và bình luận...' : 'Đang đọc nội dung trang...');
    const fileData = await fetchLinkAsText(url, withComments);
    if (fileData) return { fileData };
    return {
      fileData: bareLink(url),
      warning: 'Chưa đọc được nội dung trang này, AI sẽ chỉ dựa vào đường dẫn. Hãy dán thẳng nội dung vào ô văn bản để chính xác hơn.',
    };
  };

  if (opts.mode === 'text') return readAsText();

  if (SOCIAL_LINK_RE.test(url)) {
    notify('Đang tải video từ mạng xã hội và đẩy lên Gemini...');
    try {
      const payload = await postJson<{ meta: VideoMeta; mimeType: string; fileUri: string }>(
        '/api/fetch-video',
        { url, apiKey: getGeminiApiKey() }
      );
      const meta = payload.meta;
      return {
        fileData: {
          file: null,
          previewUrl: meta.thumbnail || '',
          type: 'video',
          base64: '',
          mimeType: payload.mimeType,
          url,
          fileUri: payload.fileUri,
          videoMeta: meta,
        },
      };
    } catch (apiError: any) {
      // Most social links are not videos at all - a text post, a photo album,
      // a profile. Read them as text rather than giving up.
      notify('Không có video trong link này, đang đọc nội dung bài đăng...');
      const fileData = await fetchLinkAsText(url, withComments);
      if (fileData) return { fileData };
      throw new Error(apiError?.message || 'Không tải được nội dung từ link này.');
    }
  }

  if (opts.mode === 'auto' && !MEDIA_EXT_RE.test(url)) return readAsText();

  return downloadDirect(url, notify);
};
