import React, { useState } from 'react';
import { Check, ExternalLink, HardDrive, Loader2, Trash2, ShieldCheck, AlertCircle } from 'lucide-react';
import {
  getGoogleClientId, setGoogleClientId, getGoogleConnection, clearGoogleConnection,
  connectGoogle, isConnected, isAutoBackupEnabled, setAutoBackupEnabled, ensureUserEmail,
} from '../services/googleDrive';

// Connecting Google is its own section rather than another "API key" card,
// because it is a different kind of thing: the user grants access to their own
// account instead of pasting a credential we then spend.

const inputClass =
  'w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 ' +
  'placeholder:text-slate-400 focus:outline-none focus:border-[#A4145E] transition-colors font-mono';

export const GoogleDrivePanel: React.FC = () => {
  const [clientId, setClientIdState] = useState(() => getGoogleClientId());
  const [draft, setDraft] = useState('');
  const [connected, setConnected] = useState(() => isConnected());
  const [connectedAt, setConnectedAt] = useState(() => getGoogleConnection().connectedAt);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [autoBackup, setAutoBackup] = useState(() => isAutoBackupEnabled());
  const [email, setEmail] = useState(() => getGoogleConnection().email || '');

  const saveClientId = () => {
    const value = draft.trim();
    if (!value) return;
    setGoogleClientId(value);
    setClientIdState(value);
    setDraft('');
    setError('');
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const removeClientId = () => {
    setGoogleClientId('');
    clearGoogleConnection();
    setClientIdState('');
    setConnected(false);
    setConnectedAt(undefined);
  };

  const handleConnect = async () => {
    setBusy(true);
    setError('');
    try {
      await connectGoogle(true);
      setConnected(true);
      setConnectedAt(getGoogleConnection().connectedAt);
      // Knowing the account is what keeps two people on one browser from seeing
      // each other's history; a failure here is not worth blocking the connect.
      setEmail(await ensureUserEmail());
    } catch (err: any) {
      setError(err?.message || 'Không kết nối được Google Drive.');
      setConnected(false);
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnect = () => {
    clearGoogleConnection();
    setConnected(false);
    setConnectedAt(undefined);
  };

  return (
    <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
      <div className="flex items-center gap-2.5 mb-1.5">
        <HardDrive className="w-5 h-5 text-[#A4145E]" />
        <h2 className="text-lg font-bold text-slate-900">Google Drive</h2>
      </div>
      <p className="text-sm text-slate-600 leading-relaxed">
        Kết nối để xuất kết quả Content Radar ra Google Sheets, và để sao lưu lịch sử nội dung
        vào Drive của chính bạn trước khi bản lưu trên máy hết hạn.
      </p>

      <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 flex items-start gap-3">
        <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
        <div className="text-[13px] text-slate-700 leading-relaxed">
          <p className="font-semibold text-slate-900">App chỉ thấy được file do chính nó tạo ra</p>
          <p className="mt-1">
            Quyền yêu cầu là <code className="font-mono text-[12px]">drive.file</code> — phạm vi hẹp nhất mà Google có.
            App <strong>không đọc, không liệt kê, không đụng</strong> tới bất kỳ tài liệu nào khác trong Drive của bạn.
            Token chỉ nằm trong bộ nhớ của tab, không ghi vào máy, và mất khi bạn đóng tab.
          </p>
        </div>
      </div>

      {/* Step 1 - the Client ID */}
      <div className="mt-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-[13px] font-semibold text-slate-700">
            1. Google OAuth Client ID
            <span className="ml-1.5 font-normal text-slate-400">loại "Web application"</span>
          </p>
          <a
            href="https://console.cloud.google.com/apis/credentials"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#A4145E] hover:underline"
          >
            Tạo Client ID <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>

        {clientId ? (
          <div className="mt-2.5 flex items-center gap-2.5 flex-wrap">
            <code className="flex-1 min-w-[220px] rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-[13px] text-slate-700 font-mono truncate">
              {clientId}
            </code>
            <button
              onClick={removeClientId}
              className="shrink-0 p-3 rounded-xl border border-slate-200 text-slate-500 hover:text-pink-600 hover:border-pink-200 transition-colors"
              title="Xoá Client ID"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="mt-2.5 flex gap-2.5 flex-wrap">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') saveClientId(); }}
              placeholder="....apps.googleusercontent.com"
              className={inputClass + ' flex-1 min-w-[220px]'}
            />
            <button
              onClick={saveClientId}
              disabled={!draft.trim()}
              className="shrink-0 px-6 py-3 rounded-xl bg-[#A4145E] hover:bg-[#86104D] disabled:bg-slate-200 disabled:text-slate-400 text-white font-medium transition-colors"
            >
              Lưu
            </button>
          </div>
        )}

        {saved && (
          <p className="mt-2.5 text-sm text-emerald-700 font-medium flex items-center gap-1.5">
            <Check className="w-4 h-4" /> Đã lưu. Giờ bấm Kết nối bên dưới.
          </p>
        )}

        <p className="mt-2.5 text-[12px] text-slate-500 leading-relaxed">
          Trong Google Cloud Console, thêm <code className="font-mono">{typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3100'}</code>{' '}
          vào mục <strong>Authorized JavaScript origins</strong>, và bật <strong>Google Sheets API</strong> cùng{' '}
          <strong>Google Drive API</strong> cho project.
        </p>
      </div>

      {/* Step 2 - the grant */}
      <div className="mt-5 pt-5 border-t border-slate-100">
        <p className="text-[13px] font-semibold text-slate-700">2. Uỷ quyền tài khoản Google</p>

        <div className="mt-2.5 flex items-center gap-3 flex-wrap">
          {connected ? (
            <>
              <span className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-emerald-200 bg-emerald-50 text-[14px] font-semibold text-emerald-700">
                <Check className="w-4 h-4" /> Đã kết nối
              </span>
              <button
                onClick={handleDisconnect}
                className="px-4 py-2.5 rounded-xl border border-slate-200 text-[13px] font-medium text-slate-600 hover:text-pink-600 hover:border-pink-200 transition-colors"
              >
                Ngắt kết nối
              </button>
            </>
          ) : (
            <button
              onClick={handleConnect}
              disabled={busy || !clientId}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-[#A4145E] hover:bg-[#86104D] disabled:bg-slate-200 disabled:text-slate-400 text-white font-semibold transition-colors"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <HardDrive className="w-4 h-4" />}
              {busy ? 'Đang mở Google…' : 'Kết nối Google Drive'}
            </button>
          )}
        </div>

        {!clientId && (
          <p className="mt-2.5 text-[13px] text-amber-700">Dán Client ID ở bước 1 trước đã.</p>
        )}

        {connected && connectedAt && (
          <p className="mt-2.5 text-[12px] text-slate-500">
            Phiên kết nối hết hạn sau khoảng một giờ hoặc khi bạn đóng tab. Lúc đó app sẽ tự xin lại quyền.
          </p>
        )}

        {error && (
          <p className="mt-2.5 text-sm text-red-700 flex items-start gap-1.5">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> {error}
          </p>
        )}

        {email && (
          <p className="mt-2.5 text-[12px] text-slate-500">
            Tài khoản: <strong className="text-slate-700">{email}</strong>. Lịch sử nội dung trên máy này
            được gắn với tài khoản đó, nên người dùng Google khác mở app trên cùng trình duyệt sẽ không thấy.
          </p>
        )}
      </div>

      {/* Step 3 - what happens automatically */}
      <div className="mt-5 pt-5 border-t border-slate-100">
        <p className="text-[13px] font-semibold text-slate-700">3. Tự động sao lưu lịch sử</p>

        <label className="mt-2.5 flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={autoBackup}
            onChange={(e) => { setAutoBackup(e.target.checked); setAutoBackupEnabled(e.target.checked); }}
            className="mt-0.5 w-4 h-4 accent-[#A4145E] cursor-pointer"
          />
          <span className="text-[13px] text-slate-700 leading-relaxed">
            Mỗi nội dung tạo xong tự đẩy lên Drive dưới dạng Google Docs, chạy ngầm và không làm chậm gì.
            <span className="block text-slate-500 mt-0.5">
              Nên bật: nội dung trên máy tự xoá sau 7 ngày, còn bản trên Drive thì giữ mãi.
              Tắt đi thì bạn phải tự bấm "Đẩy hết qua Google Drive" ở mục Lịch sử nội dung.
            </span>
          </span>
        </label>
      </div>
    </div>
  );
};
