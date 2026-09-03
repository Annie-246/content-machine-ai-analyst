import React, { useEffect, useState } from 'react';
import { Check, Eye, EyeOff, Loader2, AlertCircle, ExternalLink, KeyRound, Trash2, Ban, Cpu, Server } from 'lucide-react';
import {
  PROVIDERS, CAPABILITIES, Capability, ProviderId, ProviderInfo, ProviderSettings,
  loadProviderSettings, saveProviderSettings, maskKey, getProvider, getServerUrl,
} from '../services/apiKeyStore';
import { postJson, getJson } from '../services/apiClient';
import { DataSourcePanel } from './DataSourcePanel';
import { GoogleDrivePanel } from './GoogleDrivePanel';

type TestState = { status: 'idle' | 'testing' | 'ok' | 'fail'; message: string };

const CapabilityButtons: React.FC<{
  provider: ProviderInfo;
  settings: ProviderSettings;
  hasKey: boolean;
  onAssign: (capability: Capability) => void;
}> = ({ provider, settings, hasKey, onAssign }) => (
  <div className="mt-4">
    <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">
      Dùng nhà cung cấp này cho
    </p>
    <div className="flex flex-wrap gap-2">
      {CAPABILITIES.map((cap) => {
        const canDo = provider.supports.includes(cap.id);
        const isAssigned = settings.assignments[cap.id] === provider.id;
        const blocked = !canDo || !hasKey;
        const reason = !canDo
          ? provider.unsupportedReason[cap.id] || 'Nhà cung cấp này không làm được việc đó'
          : !hasKey
            ? 'Cần lưu API key trước'
            : cap.desc;

        return (
          <button
            key={cap.id}
            onClick={() => !blocked && onAssign(cap.id)}
            disabled={blocked}
            title={reason}
            className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border text-sm font-medium transition-colors
              ${isAssigned && !blocked
                ? 'bg-[#A4145E] border-[#A4145E] text-white'
                : blocked
                  ? 'bg-slate-50 border-slate-200 text-slate-400 cursor-not-allowed'
                  : 'bg-white border-slate-200 text-slate-700 hover:border-[#A4145E] hover:text-[#A4145E]'}`}
          >
            {isAssigned && !blocked ? <Check className="w-3.5 h-3.5" /> : !canDo ? <Ban className="w-3.5 h-3.5" /> : null}
            {cap.label}
          </button>
        );
      })}
    </div>
  </div>
);

export const IntegrationsPanel = () => {
  const [settings, setSettings] = useState<ProviderSettings>(() => loadProviderSettings());
  const [drafts, setDrafts] = useState<Partial<Record<ProviderId, string>>>({});
  const [revealed, setRevealed] = useState<Partial<Record<ProviderId, boolean>>>({});
  const [saved, setSaved] = useState<ProviderId | null>(null);
  const [tests, setTests] = useState<Partial<Record<ProviderId, TestState>>>({});
  // When the server carries its own key, users do not need to paste one.
  const [serverHasKey, setServerHasKey] = useState(false);

  useEffect(() => {
    getJson<{ hasServerKey: boolean }>('/api/health')
      .then((info) => setServerHasKey(!!info.hasServerKey))
      .catch(() => setServerHasKey(false));
  }, []);

  const persist = (next: ProviderSettings) => {
    setSettings(next);
    saveProviderSettings(next);
  };

  const handleSaveKey = (id: ProviderId) => {
    const value = (drafts[id] ?? '').trim();
    if (!value) return;
    persist({ ...settings, keys: { ...settings.keys, [id]: value } });
    setDrafts((d) => ({ ...d, [id]: '' }));
    setSaved(id);
    setTests((t) => ({ ...t, [id]: { status: 'idle', message: '' } }));
    setTimeout(() => setSaved(null), 2500);
  };

  const handleRemoveKey = (id: ProviderId) => {
    const keys = { ...settings.keys };
    delete keys[id];

    // Anything this provider was handling goes back to Gemini.
    const assignments = { ...settings.assignments };
    (Object.keys(assignments) as Capability[]).forEach((cap) => {
      if (assignments[cap] === id) assignments[cap] = 'gemini';
    });

    persist({ ...settings, keys, assignments });
    setTests((t) => ({ ...t, [id]: { status: 'idle', message: '' } }));
  };

  const handleAssign = (capability: Capability, id: ProviderId) => {
    persist({ ...settings, assignments: { ...settings.assignments, [capability]: id } });
  };

  const handleModelChange = (id: ProviderId, model: string) => {
    persist({ ...settings, models: { ...settings.models, [id]: model } });
  };

  const handleTest = async (id: ProviderId) => {
    // Empty key is fine for Gemini when the server supplies one.
    const key = settings.keys[id] || '';
    if (!key && !(id === 'gemini' && serverHasKey)) return;
    const info = getProvider(id);
    const model = settings.models[id] || info.defaultModel;

    setTests((t) => ({ ...t, [id]: { status: 'testing', message: 'Đang gọi thử API...' } }));

    try {
      let reply = '';
      if (id === 'gemini') {
        const payload = await postJson<{ text: string }>('/api/gemini', {
          apiKey: key,
          model,
          parts: [{ text: 'Tra loi dung 1 tu: OK' }],
          systemInstruction: 'Tra loi that ngan gon.',
          temperature: 0,
        });
        reply = payload.text.trim();
      } else {
        const payload = await postJson<{ text: string }>('/api/llm', {
          provider: id,
          apiKey: key,
          model,
          system: 'Tra loi that ngan gon.',
          prompt: 'Tra loi dung 1 tu: OK',
        });
        reply = payload.text;
      }
      setTests((t) => ({
        ...t,
        [id]: { status: 'ok', message: `Hoạt động với model ${model}. Trả lời: "${reply.slice(0, 20)}"` },
      }));
    } catch (err: any) {
      let detail = err?.message || 'Không rõ nguyên nhân';
      try {
        detail = JSON.parse(detail).error.message;
      } catch { /* message was not JSON */ }
      setTests((t) => ({ ...t, [id]: { status: 'fail', message: String(detail).slice(0, 300) } }));
    }
  };

  return (
    <div className="max-w-3xl">
      <h1 className="text-[40px] leading-tight font-bold text-slate-900">Tích hợp</h1>
      <p className="mt-3 text-[15px] text-slate-600">
        Dán API key và chọn nhà cung cấp nào lo phần việc nào. Key lưu trên trình duyệt của bạn và
        có hiệu lực ngay, không cần sửa file cấu hình hay khởi động lại app.
      </p>

      {/* The server used to be configurable here, back when the interface could
          sit on Vercel while the API ran elsewhere. As a desktop app the two are
          always the same process on loopback, so the field only ever offered a
          way to break a working install. The settings underneath still exist and
          default to empty, which means "talk to ourselves". */}

      <DataSourcePanel />

      <GoogleDrivePanel />

      {/* Current routing at a glance */}
      <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50/60 p-5">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-3">
          Đang phân công
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {CAPABILITIES.map((cap) => (
            <div key={cap.id}>
              <p className="text-sm text-slate-500">{cap.label}</p>
              <p className="text-[15px] font-semibold text-slate-900 mt-0.5">
                {getProvider(settings.assignments[cap.id]).name}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-5 space-y-4">
        {PROVIDERS.map((provider) => {
          const storedKey = settings.keys[provider.id];
          const usingServerKey = provider.id === 'gemini' && serverHasKey && !storedKey;
          const draft = drafts[provider.id] ?? '';
          const test = tests[provider.id] || { status: 'idle', message: '' };
          const assignedTo = CAPABILITIES.filter((c) => settings.assignments[c.id] === provider.id);
          const isInUse = assignedTo.length > 0 && (!!storedKey || usingServerKey);

          return (
            <div
              key={provider.id}
              className={`rounded-2xl border p-6 transition-colors ${
                isInUse ? 'border-[#A4145E] bg-[#FDF2F7]/40' : 'border-slate-200 bg-white'
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <h2 className="text-lg font-bold text-slate-900">{provider.name}</h2>
                    {isInUse && (
                      <span className="text-[10px] uppercase tracking-wide font-semibold px-2 py-0.5 rounded-full bg-[#A4145E] text-white">
                        Đang dùng
                      </span>
                    )}
                    {storedKey && (
                      <span className="text-[10px] uppercase tracking-wide font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                        Đã lưu key
                      </span>
                    )}
                    {usingServerKey && (
                      <span className="text-[10px] uppercase tracking-wide font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                        Máy chủ đã có key
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-slate-600 mt-1.5 leading-relaxed">{provider.hint}</p>
                </div>

                <a
                  href={provider.docsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-[#A4145E] transition-colors"
                >
                  Lấy key <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>

              {storedKey && (
                <div className="mt-4 flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
                  <KeyRound className="w-4 h-4 text-slate-400 shrink-0" />
                  <code className="flex-1 text-sm text-slate-700 font-mono truncate">
                    {revealed[provider.id] ? storedKey : maskKey(storedKey)}
                  </code>
                  <button
                    onClick={() => setRevealed((r) => ({ ...r, [provider.id]: !r[provider.id] }))}
                    className="text-slate-400 hover:text-slate-700 transition-colors"
                    title={revealed[provider.id] ? 'Ẩn key' : 'Hiện key'}
                  >
                    {revealed[provider.id] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                  <button
                    onClick={() => handleRemoveKey(provider.id)}
                    className="text-slate-400 hover:text-pink-600 transition-colors"
                    title="Xóa key này"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              )}

              <div className="mt-3 flex gap-2.5">
                <input
                  type="password"
                  value={draft}
                  onChange={(e) => setDrafts((d) => ({ ...d, [provider.id]: e.target.value }))}
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveKey(provider.id)}
                  placeholder={storedKey ? 'Dán key mới để thay thế...' : `Dán API key (${provider.keyPrefix}...)`}
                  className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-[#A4145E] transition-colors font-mono"
                />
                <button
                  onClick={() => handleSaveKey(provider.id)}
                  disabled={!draft.trim()}
                  className="shrink-0 px-6 py-3 rounded-xl bg-[#A4145E] hover:bg-[#86104D] disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium transition-colors"
                >
                  {saved === provider.id ? <Check className="w-4 h-4" /> : 'Lưu'}
                </button>
              </div>

              {usingServerKey && (
                <p className="mt-3 text-sm text-emerald-700">
                  Máy chủ đã cấu hình sẵn API key, bạn dùng được ngay mà không cần dán key riêng.
                  Chỉ dán key bên dưới nếu muốn dùng tài khoản của chính mình.
                </p>
              )}

              <CapabilityButtons
                provider={provider}
                settings={settings}
                hasKey={!!storedKey || usingServerKey}
                onAssign={(cap) => handleAssign(cap, provider.id)}
              />

              {(storedKey || usingServerKey) && (
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-2">
                    <Cpu className="w-4 h-4 text-slate-400" />
                    <input
                      value={settings.models[provider.id] ?? provider.defaultModel}
                      onChange={(e) => handleModelChange(provider.id, e.target.value)}
                      className="w-56 rounded-lg border border-slate-200 px-3 py-2 text-sm font-mono text-slate-700 focus:outline-none focus:border-[#A4145E] transition-colors"
                      title="Tên model dùng cho nhà cung cấp này"
                    />
                  </div>

                  <button
                    onClick={() => handleTest(provider.id)}
                    disabled={test.status === 'testing'}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-200 hover:border-[#A4145E] text-sm font-medium text-slate-700 hover:text-[#A4145E] transition-colors disabled:opacity-50"
                  >
                    {test.status === 'testing' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    Kiểm tra kết nối
                  </button>

                  {test.status === 'ok' && (
                    <span className="text-sm text-emerald-700 font-medium flex items-center gap-1.5">
                      <Check className="w-4 h-4" /> {test.message}
                    </span>
                  )}
                  {test.status === 'fail' && (
                    <span className="text-sm text-red-700 flex items-start gap-1.5 max-w-lg">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> {test.message}
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-8 rounded-2xl border border-amber-200 bg-amber-50/60 p-5 flex items-start gap-3">
        <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
        <div className="text-sm text-amber-900 leading-relaxed">
          <p className="font-semibold">Key được lưu trong trình duyệt này</p>
          <p className="mt-1 text-amber-800">
            Ai dùng chung máy và mở app này đều có thể xem được key. Khi đưa app lên môi trường thật,
            nên chuyển việc gọi AI về phía máy chủ thay vì giữ key ở trình duyệt.
          </p>
        </div>
      </div>
    </div>
  );
};
