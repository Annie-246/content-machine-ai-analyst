import React, { useState } from 'react';
import { Check, Eye, EyeOff, ExternalLink, Database, Trash2, SlidersHorizontal } from 'lucide-react';
import {
  DATA_PROVIDERS, DataProviderId, RADAR_PLATFORMS, RadarSourceChoice,
  getDataKey, setDataKey, getPlatformKeyOverride, setPlatformKeyOverride,
  getPlatformSource, setPlatformSource, maskKey,
} from '../services/apiKeyStore';

// Where Content Radar gets its data. Separate from the LLM providers above
// because it answers a different question: not "which model writes this" but
// "which account pays for the crawl".
//
// A platform can be served by more than one source. One shared key per source
// covers every platform; the per-platform override exists for the person who
// wants a platform billed to a different account.

const inputClass =
  'w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 ' +
  'placeholder:text-slate-400 focus:outline-none focus:border-[#A4145E] transition-colors font-mono';

export const DataSourcePanel: React.FC = () => {
  const [keys, setKeys] = useState<Record<string, string>>(() =>
    Object.fromEntries(DATA_PROVIDERS.map((p) => [p.id, getDataKey(p.id)]))
  );
  const [overrides, setOverrides] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const platform of RADAR_PLATFORMS) {
      for (const source of platform.sources) {
        out[`${platform.id}:${source}`] = getPlatformKeyOverride(platform.id, source);
      }
    }
    return out;
  });
  const [sources, setSources] = useState<Record<string, RadarSourceChoice>>(() =>
    Object.fromEntries(RADAR_PLATFORMS.map((p) => [p.id, getPlatformSource(p.id)]))
  );

  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [savedId, setSavedId] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(() =>
    RADAR_PLATFORMS.some((p) => getPlatformSource(p.id) !== 'auto' ||
      p.sources.some((s) => getPlatformKeyOverride(p.id, s)))
  );

  const flashSaved = (id: string) => {
    setSavedId(id);
    setTimeout(() => setSavedId((current) => (current === id ? null : current)), 2000);
  };

  const saveShared = (id: DataProviderId) => {
    const value = (drafts[id] ?? '').trim();
    if (!value) return;
    setDataKey(id, value);
    setKeys((k) => ({ ...k, [id]: value }));
    setDrafts((d) => ({ ...d, [id]: '' }));
    flashSaved(id);
  };

  const clearShared = (id: DataProviderId) => {
    setDataKey(id, '');
    setKeys((k) => ({ ...k, [id]: '' }));
  };

  const saveOverride = (platform: string, source: DataProviderId) => {
    const field = `${platform}:${source}`;
    const value = (drafts[field] ?? '').trim();
    setPlatformKeyOverride(platform, source, value);
    setOverrides((o) => ({ ...o, [field]: value }));
    setDrafts((d) => ({ ...d, [field]: '' }));
    flashSaved(field);
  };

  const clearOverride = (platform: string, source: DataProviderId) => {
    const field = `${platform}:${source}`;
    setPlatformKeyOverride(platform, source, '');
    setOverrides((o) => ({ ...o, [field]: '' }));
  };

  const chooseSource = (platform: string, choice: RadarSourceChoice) => {
    setPlatformSource(platform, choice);
    setSources((s) => ({ ...s, [platform]: choice }));
  };

  const anyKey = DATA_PROVIDERS.some((p) => keys[p.id]);

  return (
    <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
      <div className="flex items-center gap-2.5 mb-1.5">
        <Database className="w-5 h-5 text-[#A4145E]" />
        <h2 className="text-lg font-bold text-slate-900">Nguồn dữ liệu</h2>
      </div>
      <p className="text-sm text-slate-600 leading-relaxed">
        Content Radar lấy dữ liệu mạng xã hội qua các nguồn này. Key được tính phí theo mỗi lần quét,
        nên đây là tài khoản của bạn. Chỉ cần một nguồn là dùng được; có cả hai thì Radar tự chọn
        nguồn rẻ hơn.
      </p>

      {!anyKey && (
        <p className="mt-3 text-[13px] text-amber-700">
          Chưa có key nào — Content Radar sẽ báo lỗi khi bạn bấm quét.
        </p>
      )}

      <div className="mt-5 space-y-6">
        {DATA_PROVIDERS.map((provider) => {
          const stored = keys[provider.id] || '';
          const draft = drafts[provider.id] ?? '';
          const isRevealed = !!revealed[provider.id];

          return (
            <div key={provider.id}>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <p className="text-[15px] font-bold text-slate-900">{provider.name}</p>
                  <p className="text-[13px] text-slate-600 mt-0.5">{provider.hint}</p>
                </div>
                <a
                  href={provider.docsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#A4145E] hover:underline shrink-0"
                >
                  Lấy API key <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>

              {stored ? (
                <div className="mt-3 flex items-center gap-2.5 flex-wrap">
                  <code className="flex-1 min-w-[220px] rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 font-mono truncate">
                    {isRevealed ? stored : maskKey(stored)}
                  </code>
                  <button
                    onClick={() => setRevealed((r) => ({ ...r, [provider.id]: !isRevealed }))}
                    className="shrink-0 p-3 rounded-xl border border-slate-200 text-slate-500 hover:text-slate-900 transition-colors"
                    title={isRevealed ? 'Ẩn key' : 'Hiện key'}
                  >
                    {isRevealed ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                  <button
                    onClick={() => clearShared(provider.id)}
                    className="shrink-0 p-3 rounded-xl border border-slate-200 text-slate-500 hover:text-pink-600 hover:border-pink-200 transition-colors"
                    title="Xoá key"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <div className="mt-3 flex gap-2.5 flex-wrap">
                  <input
                    type="password"
                    value={draft}
                    onChange={(e) => setDrafts((d) => ({ ...d, [provider.id]: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === 'Enter') saveShared(provider.id); }}
                    placeholder={provider.keyPrefix ? `${provider.keyPrefix}...` : `API key ${provider.name}`}
                    className={inputClass + ' flex-1 min-w-[220px]'}
                  />
                  <button
                    onClick={() => saveShared(provider.id)}
                    disabled={!draft.trim()}
                    className="shrink-0 px-6 py-3 rounded-xl bg-[#A4145E] hover:bg-[#86104D] disabled:bg-slate-200 disabled:text-slate-400 text-white font-medium transition-colors"
                  >
                    Lưu
                  </button>
                </div>
              )}

              {savedId === provider.id && (
                <p className="mt-2.5 text-sm text-emerald-700 font-medium flex items-center gap-1.5">
                  <Check className="w-4 h-4" /> Đã lưu. Content Radar dùng được ngay.
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* Source choice and per-platform keys - hidden until asked for. */}
      <div className="mt-6 pt-5 border-t border-slate-100">
        <button
          onClick={() => setShowAdvanced((v) => !v)}
          className="inline-flex items-center gap-2 text-[13px] font-medium text-slate-600 hover:text-[#A4145E] transition-colors"
        >
          <SlidersHorizontal className="w-4 h-4" />
          Tuỳ chỉnh theo từng nền tảng
          <span className="text-slate-400">{showAdvanced ? '−' : '+'}</span>
        </button>

        {showAdvanced && (
          <div className="mt-4 space-y-6">
            {RADAR_PLATFORMS.map((platform) => (
              <div key={platform.id}>
                <p className="text-[14px] font-bold text-slate-900">{platform.label}</p>

                <div className="mt-2.5">
                  <span className="block text-[13px] font-semibold text-slate-700 mb-1.5">Dùng nguồn</span>
                  <div className="flex flex-wrap gap-2">
                    {(['auto', ...platform.sources] as RadarSourceChoice[]).map((choice) => {
                      const active = (sources[platform.id] || 'auto') === choice;
                      const label = choice === 'auto'
                        ? 'Tự chọn'
                        : DATA_PROVIDERS.find((p) => p.id === choice)?.name || choice;
                      return (
                        <button
                          key={choice}
                          onClick={() => chooseSource(platform.id, choice)}
                          className={`px-4 py-2 rounded-xl border text-[13px] font-semibold transition-colors
                            ${active
                              ? 'border-[#A4145E] bg-[#FDF2F7] text-[#A4145E]'
                              : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'}`}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-2 text-[12px] text-slate-500">
                    {sources[platform.id] === 'auto' || !sources[platform.id]
                      ? 'Tự chọn: dùng nguồn đầu tiên có key, theo thứ tự rẻ trước.'
                      : 'Đã ghim một nguồn. Nếu nguồn đó chưa có key, Radar sẽ báo lỗi thay vì tự đổi.'}
                  </p>
                </div>

                <div className="mt-4 space-y-3">
                  <p className="text-[13px] text-slate-600">
                    Key riêng cho nền tảng này. Bỏ trống để dùng key chung ở trên.
                  </p>

                  {platform.sources.map((source) => {
                    const field = `${platform.id}:${source}`;
                    const stored = overrides[field] || '';
                    const draft = drafts[field] ?? '';
                    const name = DATA_PROVIDERS.find((p) => p.id === source)?.name || source;

                    return (
                      <div key={field}>
                        <p className="text-[12px] font-semibold text-slate-600 mb-1.5">
                          {name}
                          <span className="ml-1.5 font-normal text-slate-400">
                            {stored ? 'đang dùng key riêng' : 'đang dùng key chung'}
                          </span>
                        </p>

                        {stored ? (
                          <div className="flex items-center gap-2.5 flex-wrap">
                            <code className="flex-1 min-w-[200px] rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-[13px] text-slate-700 font-mono truncate">
                              {maskKey(stored)}
                            </code>
                            <button
                              onClick={() => clearOverride(platform.id, source)}
                              className="shrink-0 px-4 py-2.5 rounded-xl border border-slate-200 text-[13px] text-slate-600 hover:text-pink-600 hover:border-pink-200 transition-colors"
                            >
                              Dùng lại key chung
                            </button>
                          </div>
                        ) : (
                          <div className="flex gap-2.5 flex-wrap">
                            <input
                              type="password"
                              value={draft}
                              onChange={(e) => setDrafts((d) => ({ ...d, [field]: e.target.value }))}
                              onKeyDown={(e) => { if (e.key === 'Enter') saveOverride(platform.id, source); }}
                              placeholder={`Key ${name} riêng cho ${platform.label} (không bắt buộc)`}
                              className={inputClass + ' flex-1 min-w-[200px] py-2.5 text-[13px]'}
                            />
                            <button
                              onClick={() => saveOverride(platform.id, source)}
                              disabled={!draft.trim()}
                              className="shrink-0 px-5 py-2.5 rounded-xl border border-slate-200 text-[13px] font-medium text-slate-700 hover:border-[#A4145E] hover:text-[#A4145E] disabled:opacity-40 disabled:hover:border-slate-200 disabled:hover:text-slate-700 transition-colors"
                            >
                              Lưu
                            </button>
                          </div>
                        )}

                        {savedId === field && (
                          <p className="mt-2 text-[13px] text-emerald-700 font-medium flex items-center gap-1.5">
                            <Check className="w-3.5 h-3.5" /> Đã lưu.
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
