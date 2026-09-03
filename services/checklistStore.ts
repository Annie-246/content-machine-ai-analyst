import { ScoringChecklist } from '../types';

// Bộ tiêu chí chấm điểm do người dùng tự nạp.
//
// Lưu trên máy như Brand DNA, vì đây cũng là tri thức riêng của từng người: bộ
// tiêu chí chấm bài bán hàng khác hẳn bộ chấm bài chia sẻ kiến thức, và không ai
// muốn tiêu chí nội bộ của mình nằm trên máy chủ người khác.

const STORAGE_KEY = 'cm_scoring_checklists';

const read = (): ScoringChecklist[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const write = (list: ScoringChecklist[]): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch (e) {
    console.error('Không lưu được bộ tiêu chí chấm điểm', e);
  }
};

export const loadChecklists = (): ScoringChecklist[] =>
  read().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

/** Chỉ những bộ dùng được cho loại nội dung đang chấm. */
export const listChecklistsFor = (kind: 'article' | 'video'): ScoringChecklist[] =>
  loadChecklists().filter((c) => c.kind === kind || c.kind === 'both');

export const getChecklist = (id: string): ScoringChecklist | undefined =>
  read().find((c) => c.id === id);

export const saveChecklist = (checklist: ScoringChecklist): void => {
  const list = read();
  const at = list.findIndex((c) => c.id === checklist.id);
  const next = { ...checklist, updatedAt: Date.now() };
  if (at >= 0) list[at] = next;
  else list.unshift(next);
  write(list);
};

export const removeChecklist = (id: string): void => {
  write(read().filter((c) => c.id !== id));
};

export const newChecklistId = (): string =>
  `cl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
