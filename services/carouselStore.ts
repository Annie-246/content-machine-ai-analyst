import { CarouselKit } from '../types';

// Kho bộ nhận diện hình ảnh.
//
// Dùng IndexedDB chứ không localStorage như Brand DNA: một ảnh nền 1080x1080
// đã ngót 1MB, mà localStorage chỉ có tổng cộng khoảng 5MB. Vài cái nền là đầy.
// IndexedDB chứa được hàng trăm MB và lưu thẳng chuỗi dài không cần cắt nhỏ.

const DB_NAME = 'content-machine-carousel';
const DB_VERSION = 1;
const STORE = 'kits';
const ACTIVE_KEY = 'cm_carousel_active_kit';

const openDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Không mở được kho ảnh.'));
  });

const tx = async <T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const request = run(transaction.objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Thao tác với kho ảnh thất bại.'));
    transaction.oncomplete = () => db.close();
  });
};

export const listKits = async (): Promise<CarouselKit[]> => {
  const all = await tx<CarouselKit[]>('readonly', (store) => store.getAll() as IDBRequest<CarouselKit[]>);
  return (all || []).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
};

export const getKit = async (id: string): Promise<CarouselKit | undefined> =>
  tx<CarouselKit | undefined>('readonly', (store) => store.get(id) as IDBRequest<CarouselKit | undefined>);

export const saveKit = async (kit: CarouselKit): Promise<void> => {
  await tx('readwrite', (store) => store.put({ ...kit, updatedAt: Date.now() }) as IDBRequest<IDBValidKey>);
};

export const removeKit = async (id: string): Promise<void> => {
  await tx('readwrite', (store) => store.delete(id) as IDBRequest<undefined>);
};

/** Bộ đang chọn - chỉ là một id nên để localStorage cho gọn. */
export const getActiveKitId = (): string => {
  try {
    return localStorage.getItem(ACTIVE_KEY) || '';
  } catch {
    return '';
  }
};

export const setActiveKitId = (id: string): void => {
  try {
    localStorage.setItem(ACTIVE_KEY, id);
  } catch { /* trình duyệt chặn lưu - không sao, phiên này vẫn dùng được */ }
};

export const newId = (prefix: string): string =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

/** Màu mặc định lấy từ bộ quy tắc carousel đang chạy thật, không phải màu bịa. */
export const emptyKit = (name = 'Bộ nhận diện mới'): CarouselKit => ({
  id: newId('kit'),
  name,
  templates: [],
  fonts: [],
  titleFont: 'Inter',
  bodyFont: 'Mulish',
  titleGradientFrom: '#0246AD',
  titleGradientTo: '#12B49C',
  accentColor: '#0246AD',
  bodyColor: '#111111',
  footColor: '#C60001',
  ruleColor: '#08DEB7',
  frameColor: '#C9CEE6',
  extraColors: [],
  guideline: '',
  updatedAt: Date.now(),
});

/** Đọc một file thành data URI để nhúng thẳng vào HTML lúc dựng ảnh. */
export const fileToDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error(`Không đọc được file ${file.name}.`));
    reader.readAsDataURL(file);
  });
