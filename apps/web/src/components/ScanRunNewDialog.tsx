import { useEffect, useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import { api, ApiError } from '@/lib/api';
import type { CodeVersionPublic, CoverageMode, ScanRunPublic } from '@/lib/scanTypes';

interface ScanRunNewDialogProps {
  projectId: string;
  versions: CodeVersionPublic[];
  /** 父组件传入选中的 codeVersionId,默认首个 */
  defaultCodeVersionId?: string;
  onClose: () => void;
  onCreated: (run: ScanRunPublic) => void;
}

/**
 * §5.3 创建 ScanRun —— 必选 codeVersionId + skillBundleId + coverageMode
 *
 * 当前 MVP:SkillBundle 用占位字符串 'active' 传给后端;后端要求 skillBundleId,
 * 前端暂无专用列表接口,所以这里给一个手填 ID 的 fallback(可触发,后端会报 404)。
 *
 * 升级路径:Phase 2 接 GET /api/skill-bundle-versions?active=true 后换成下拉。
 */
export default function ScanRunNewDialog({
  projectId,
  versions,
  defaultCodeVersionId,
  onClose,
  onCreated,
}: ScanRunNewDialogProps): React.ReactElement {
  const [codeVersionId, setCodeVersionId] = useState<string>(
    defaultCodeVersionId ?? versions[0]?.id ?? '',
  );
  const [skillBundleId, setSkillBundleId] = useState('');
  const [coverageMode, setCoverageMode] = useState<CoverageMode>('FULL');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    // 若 props 提供新的 defaultCodeVersionId,同步(新建版本后弹起的情况)
    if (defaultCodeVersionId) setCodeVersionId(defaultCodeVersionId);
  }, [defaultCodeVersionId]);

  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (!codeVersionId) {
      setErr('请先上传一个 CodeVersion(§5.2)');
      return;
    }
    if (!skillBundleId.trim()) {
      setErr('skillBundleId 必填(暂用占位字符串 active 触发,后端 404 即报错)');
      return;
    }
    setSubmitting(true);
    setErr(null);
    try {
      const run = await api.post<ScanRunPublic>('/scan-runs', {
        projectId,
        codeVersionId,
        skillBundleId: skillBundleId.trim(),
        triggerType: 'manual',
        coverageMode,
      });
      onCreated(run);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        void onSubmit(e);
      }}
      className="mb-4 rounded-lg border bg-card p-4"
      data-testid="scan-new-form"
    >
      <h2 className="mb-3 text-lg font-semibold">New Scan</h2>

      {versions.length === 0 ? (
        <p className="mb-3 rounded border border-yellow-500 bg-yellow-50 p-3 text-xs text-yellow-900">
          该项目还没有 CodeVersion —— 请先在 Scans 标签用 Upload 上传一个 zip。
        </p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm md:col-span-2">
            <span className="text-muted-foreground">Code Version *</span>
            <select
              value={codeVersionId}
              onChange={(e) => setCodeVersionId(e.target.value)}
              className="rounded-md border border-input bg-background px-3 py-2"
              data-testid="scan-new-codeversion"
            >
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.versionLabel ?? v.id} — {v.fileCount} files / {v.locCount} LOC
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">Skill Bundle ID *</span>
            <input
              value={skillBundleId}
              onChange={(e) => setSkillBundleId(e.target.value)}
              placeholder="active (or real bundle id)"
              required
              className="rounded-md border border-input bg-background px-3 py-2 font-mono text-xs"
              data-testid="scan-new-bundle"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">Coverage Mode</span>
            <select
              value={coverageMode}
              onChange={(e) => setCoverageMode(e.target.value as CoverageMode)}
              className="rounded-md border border-input bg-background px-3 py-2"
              data-testid="scan-new-coverage"
            >
              <option value="FULL">FULL</option>
              <option value="SAMPLE">SAMPLE</option>
            </select>
          </label>
        </div>
      )}

      {err && (
        <p className="mt-3 text-sm text-destructive" role="alert" data-testid="scan-new-error">
          {err}
        </p>
      )}

      <div className="mt-3 flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={submitting || versions.length === 0}
          data-testid="scan-new-submit"
        >
          {submitting ? 'Creating...' : 'Create Scan'}
        </Button>
      </div>
    </form>
  );
}
