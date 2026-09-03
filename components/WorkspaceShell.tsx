import React, { useEffect, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';

// ---------------------------------------------------------------------------
// The three-stage bar above the workspace. Each feature supplies its own stage
// names, so the wording always matches what that feature actually asks for.

export const WorkflowStepper: React.FC<{
  steps: [string, string][];
  current: number;
  running?: boolean;
}> = ({ steps, current, running }) => (
  <div className="flex items-start overflow-x-auto custom-scrollbar pb-1">
    {steps.map(([label, hint], i) => {
      const n = i + 1;
      const done = n < current;
      const active = n === current;
      const isRunning = active && running;

      return (
        <React.Fragment key={label}>
          <div className="text-center w-28 sm:w-36 shrink-0">
            <span
              className={`mx-auto mb-2 w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold transition-colors
                ${done ? 'bg-[#A4145E] text-white'
                  : active ? 'bg-[#A4145E] text-white'
                  : 'bg-slate-100 text-slate-400 border border-slate-200'}
                ${isRunning ? 'ring-4 ring-[#fbdce7] animate-pulse' : ''}`}
            >
              {done ? <Check className="w-4 h-4" /> : isRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : n}
            </span>
            <p className={`text-sm font-medium ${active || done ? 'text-slate-900' : 'text-slate-500'}`}>{label}</p>
            <p className="text-xs text-slate-500 mt-0.5 leading-snug">{hint}</p>
          </div>
          {i < steps.length - 1 && (
            <span className={`flex-1 h-px mt-4 min-w-8 ${n < current ? 'bg-[#A4145E]' : 'bg-slate-200'}`} />
          )}
        </React.Fragment>
      );
    })}
  </div>
);

// ---------------------------------------------------------------------------
// One numbered block of the workflow. Keeping them stacked means a long result
// simply scrolls instead of fighting for height with the inputs.

export const SectionCard: React.FC<{
  n: number;
  title: string;
  hint?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  muted?: boolean;
}> = ({ n, title, hint, action, children, muted }) => (
  <section className={`rounded-2xl border ${muted ? 'border-slate-200 bg-white' : 'border-slate-200 bg-white'} overflow-hidden`}>
    <div className="px-4 sm:px-6 py-4 flex items-center justify-between gap-3 sm:gap-4 border-b border-slate-100">
      <div className="flex items-center gap-3 min-w-0">
        <span className="w-7 h-7 rounded-full bg-[#FDF2F7] text-[#A4145E] flex items-center justify-center text-sm font-bold shrink-0">
          {n}
        </span>
        <h2 className="text-[17px] font-bold text-slate-900 truncate">{title}</h2>
        {hint && <span className="text-xs text-slate-500 truncate hidden sm:block">· {hint}</span>}
      </div>
      {action}
    </div>
    <div className="p-6">{children}</div>
  </section>
);

// ---------------------------------------------------------------------------
// Live progress. Long runs used to look like the app had frozen; this names the
// stage, counts the seconds and keeps a bar moving so waiting feels accounted for.

const formatElapsed = (seconds: number): string =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

export const RunStatus: React.FC<{
  message: string;
  startedAt: number | null;
  /** Rough expectation shown under the bar, e.g. "thường mất 30-90 giây". */
  expectation?: string;
  compact?: boolean;
}> = ({ message, startedAt, expectation, compact }) => {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!startedAt) {
      setElapsed(0);
      return;
    }
    setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);

  if (compact) {
    return (
      <div className="flex items-center gap-2.5 text-xs text-[#A4145E] font-medium">
        <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
        <span className="truncate">{message}</span>
        <span className="ml-auto tabular-nums text-slate-500 shrink-0">{formatElapsed(elapsed)}</span>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-[#f0c9d8] bg-[#FDF2F7] p-5">
      <div className="flex items-start gap-3.5">
        <Loader2 className="w-5 h-5 text-[#A4145E] animate-spin shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-sm font-semibold text-slate-900">Đang chạy</p>
            <span className="text-sm tabular-nums text-[#A4145E] font-semibold">{formatElapsed(elapsed)}</span>
          </div>
          <p className="text-[13px] text-slate-700 mt-1 leading-relaxed break-words">{message}</p>

          <div className="mt-3 h-1.5 rounded-full bg-white overflow-hidden">
            <div className="h-full w-1/3 rounded-full bg-[#A4145E] cm-progress" />
          </div>

          <p className="text-[11px] text-slate-500 mt-2">
            {expectation || 'Đừng đóng tab này. Bạn sẽ thấy kết quả ngay khi xong.'}
          </p>
        </div>
      </div>
    </div>
  );
};
