import { useCallback, useRef, useState, type ChangeEvent, type DragEvent } from 'react';

import { Button } from '@/components/ui/button';
import { api, ApiError } from '@/lib/api';
import type { CodeVersionPublic } from '@/lib/scanTypes';
import { cn } from '@/lib/utils';

interface UploadDropzoneProps {
  projectId: string;
  /** 上传成功后的回调 —— 父组件可用它来刷新列表或跳转 */
  onSuccess?: (cv: CodeVersionPublic) => void;
}

const ZIP_MIME = ['application/zip', 'application/x-zip-compressed', 'application/octet-stream'];
const ZIP_MAX_BYTES = 500 * 1024 * 1024; // 与后端 ZIP_MAX_BYTES 对齐(展示用,真正限制在后端)

/**
 * §5.2 CodeVersion 上传 —— 拖拽 / 点击选 zip,带 label 必填项
 *
 * 通过 api.post(FormData) 上传(api.ts 已支持 FormData 跳过 content-type)
 */
export default function UploadDropzone({
  projectId,
  onSuccess,
}: UploadDropzoneProps): React.ReactElement {
  const [file, setFile] = useState<File | null>(null);
  const [label, setLabel] = useState('');
  const [parentVersionId, setParentVersionId] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const handleFile = useCallback(
    (f: File | null | undefined) => {
      setErr(null);
      if (!f) {
        setFile(null);
        return;
      }
      const isZipByName = /\.zip$/i.test(f.name);
      const isZipByMime = ZIP_MIME.includes(f.type) || f.type === '';
      if (!isZipByName || !isZipByMime) {
        setErr(`Only .zip allowed (got: ${f.type || 'unknown'})`);
        setFile(null);
        return;
      }
      if (f.size > ZIP_MAX_BYTES) {
        setErr(`File too large (max ${ZIP_MAX_BYTES / 1024 / 1024} MB)`);
        setFile(null);
        return;
      }
      setFile(f);
      // 默认用文件名(去 .zip)作为 label
      if (!label) {
        const base = f.name.replace(/\.zip$/i, '');
        setLabel(base);
      }
    },
    [label],
  );

  function onDrop(e: DragEvent<HTMLDivElement>): void {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    handleFile(f);
  }

  function onDragOver(e: DragEvent<HTMLDivElement>): void {
    e.preventDefault();
    setDragOver(true);
  }

  function onDragLeave(): void {
    setDragOver(false);
  }

  function onPick(e: ChangeEvent<HTMLInputElement>): void {
    const f = e.target.files?.[0];
    handleFile(f);
  }

  async function onUpload(): Promise<void> {
    if (!file) {
      setErr('Pick a zip file first');
      return;
    }
    if (!label.trim()) {
      setErr('Label is required');
      return;
    }
    setUploading(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('label', label.trim());
      if (parentVersionId.trim()) fd.append('parentVersionId', parentVersionId.trim());
      const cv = await api.post<CodeVersionPublic>(
        `/projects/${projectId}/code-versions/upload`,
        fd,
      );
      // reset
      setFile(null);
      setLabel('');
      setParentVersionId('');
      if (inputRef.current) inputRef.current.value = '';
      onSuccess?.(cv);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  function formatBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(2)} MB`;
  }

  return (
    <div className="space-y-3">
      <div
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        data-testid="upload-dropzone"
        className={cn(
          'flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed bg-card p-6 text-center transition-colors',
          dragOver ? 'border-primary bg-primary/5' : 'border-input hover:border-primary/50',
          uploading && 'pointer-events-none opacity-60',
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".zip,application/zip"
          className="hidden"
          onChange={onPick}
          data-testid="upload-input"
        />
        {file ? (
          <div className="space-y-1">
            <p className="text-sm font-medium" data-testid="upload-filename">
              {file.name}
            </p>
            <p className="text-xs text-muted-foreground">{formatBytes(file.size)}</p>
            <p className="text-xs text-muted-foreground">点击或拖拽以替换</p>
          </div>
        ) : (
          <div className="space-y-1">
            <p className="text-sm font-medium">拖拽 .zip 到此处</p>
            <p className="text-xs text-muted-foreground">或点击选择文件(最大 500 MB)</p>
          </div>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Label *</span>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            required
            placeholder="v1.0.0-rc1"
            className="rounded-md border border-input bg-background px-3 py-2"
            data-testid="upload-label"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Parent Version ID (可选)</span>
          <input
            value={parentVersionId}
            onChange={(e) => setParentVersionId(e.target.value)}
            placeholder="codeVersionId (差分上传时填)"
            className="rounded-md border border-input bg-background px-3 py-2 font-mono text-xs"
            data-testid="upload-parent"
          />
        </label>
      </div>

      {err && (
        <p className="text-sm text-destructive" role="alert" data-testid="upload-error">
          {err}
        </p>
      )}

      <div className="flex justify-end">
        <Button
          onClick={() => {
            void onUpload();
          }}
          disabled={uploading || !file || !label.trim()}
          data-testid="upload-submit"
        >
          {uploading ? 'Uploading...' : 'Upload'}
        </Button>
      </div>
    </div>
  );
}
