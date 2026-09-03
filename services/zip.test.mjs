// Kiểm chứng file .zip do zip.mjs tạo ra bằng chính công cụ giải nén của Windows.
//
// Asserting on the bytes we just wrote would only prove the code agrees with
// itself. What matters is whether a real extractor opens the archive, so the
// test writes a genuine .zip to disk and makes PowerShell's Expand-Archive pull
// it apart - the same path a user takes when they double-click the download.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { zipFiles, crc32 } from './zip.mjs';

const execFileAsync = promisify(execFile);
const encoder = new TextEncoder();

const expandArchive = async (zipPath, destination) => {
  await execFileAsync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command',
    `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${destination}' -Force`,
  ]);
};

test('crc32 khớp giá trị chuẩn của chuỗi "123456789"', () => {
  // The canonical CRC-32 check value, published with the algorithm.
  assert.equal(crc32(encoder.encode('123456789')), 0xcbf43926);
});

test('zip mở được bằng Expand-Archive, giữ nguyên nội dung và tên tiếng Việt', async (t) => {
  const workDir = await mkdtemp(path.join(tmpdir(), 'cm-zip-'));
  t.after(() => rm(workDir, { recursive: true, force: true }));

  // Long, repetitive text so DEFLATE actually engages; short text would fall
  // back to stored and leave the compressed path untested.
  const longHtml = `<h1>Kịch bản</h1>${'<p>Nội dung mẫu để nén, lặp lại nhiều lần.</p>'.repeat(200)}`;
  const csv = 'STT,Tiêu đề\r\n1,"Bài viết ""đặc biệt"", có dấu phẩy"\r\n';
  const binary = new Uint8Array(Array.from({ length: 512 }, (_, i) => i % 256));

  const files = [
    { name: 'muc-luc.csv', data: encoder.encode(csv) },
    { name: 'noi-dung/001-kich-ban-video.html', data: encoder.encode(longHtml) },
    { name: 'hinh-anh/thumbnail.bin', data: binary },
  ];

  const blob = await zipFiles(files);
  const zipPath = path.join(workDir, 'lich-su.zip');
  await writeFile(zipPath, Buffer.from(await blob.arrayBuffer()));

  const outDir = path.join(workDir, 'giai-nen');
  await expandArchive(zipPath, outDir);

  assert.deepEqual((await readdir(outDir)).sort(), ['hinh-anh', 'muc-luc.csv', 'noi-dung']);

  assert.equal(await readFile(path.join(outDir, 'muc-luc.csv'), 'utf8'), csv);
  assert.equal(await readFile(path.join(outDir, 'noi-dung', '001-kich-ban-video.html'), 'utf8'), longHtml);
  assert.deepEqual(
    new Uint8Array(await readFile(path.join(outDir, 'hinh-anh', 'thumbnail.bin'))),
    binary
  );

  // The archive must actually be smaller than its contents, otherwise the
  // deflate path silently regressed to storing everything.
  const rawSize = files.reduce((sum, file) => sum + file.data.length, 0);
  assert.ok(blob.size < rawSize, `zip ${blob.size} bytes không nhỏ hơn dữ liệu gốc ${rawSize} bytes`);
});

test('zip rỗng vẫn là archive hợp lệ', async (t) => {
  const workDir = await mkdtemp(path.join(tmpdir(), 'cm-zip-empty-'));
  t.after(() => rm(workDir, { recursive: true, force: true }));

  const blob = await zipFiles([]);
  const zipPath = path.join(workDir, 'rong.zip');
  await writeFile(zipPath, Buffer.from(await blob.arrayBuffer()));

  const outDir = path.join(workDir, 'giai-nen');
  await expandArchive(zipPath, outDir);
  assert.deepEqual(await readdir(outDir), []);
});
