import { useEffect, useState } from 'react';

import { cn } from '@/lib/utils';

export interface ReportSection {
  /** 原始标题文本 */
  title: string;
  /** 生成的 anchor id */
  anchor: string;
  /** 2 = ##, 3 = ### */
  level: 2 | 3;
}

/**
 * 把任意标题文本转换成 slug,用于 anchor id
 * - 去掉前后空白
 * - 非字母数字替换成 -
 * - 合并连续 -
 * - 去掉首尾 -
 * - 全空则回退 "section"
 */
export function slugifyHeading(text: string): string {
  const base = text
    .trim()
    .replace(/[^a-zA-Z0-9一-龥]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return base || 'section';
}

/**
 * 从 Markdown 文本中抽取 ## / ### 标题
 * 跳过被围栏代码块(```...```)包裹的行
 */
export function extractSections(md: string): ReportSection[] {
  const lines = md.split(/\r?\n/);
  const result: ReportSection[] = [];
  const seen = new Map<string, number>();
  let inFence = false;

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    // 仅匹配 ## 或 ###,匹配行首 + 后面跟空格 + 标题文字
    const m = /^(#{2,3})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    const level = (m[1]?.length ?? 2) === 3 ? 3 : 2;
    const title = m[2] ?? '';
    let anchor = slugifyHeading(title);
    const dup = seen.get(anchor) ?? 0;
    if (dup > 0) {
      anchor = `${anchor}-${dup}`;
    }
    seen.set(slugifyHeading(title), dup + 1);
    result.push({ title, anchor, level: level as 2 | 3 });
  }
  return result;
}

interface ReportSectionNavProps {
  sections: ReportSection[];
  /** 当前高亮的 anchor(id) */
  activeAnchor?: string | null;
  className?: string;
}

/**
 * 报告页左侧锚点导航
 * - 渲染章节列表(##/### 缩进区分)
 * - 点击滚动到对应 anchor
 * - 通过 IntersectionObserver 跟踪当前在视口内的章节并高亮
 */
export function ReportSectionNav({
  sections,
  activeAnchor,
  className,
}: ReportSectionNavProps): React.ReactElement | null {
  // 客户端高亮当前可见章节(SSR 友好:失败则直接退回到 props.activeAnchor)
  const [observed, setObserved] = useState<string | null>(activeAnchor ?? null);

  useEffect(() => {
    if (sections.length === 0) return;
    if (typeof IntersectionObserver === 'undefined') return;

    const visible = new Map<string, number>();
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            visible.set(e.target.id, e.intersectionRatio);
          } else {
            visible.delete(e.target.id);
          }
        }
        if (visible.size > 0) {
          // 选中当前可见的最靠上的那个章节
          const sorted = sections.map((s) => s.anchor).filter((a) => visible.has(a));
          if (sorted[0]) setObserved(sorted[0]);
        }
      },
      { rootMargin: '-20% 0px -70% 0px', threshold: [0, 1] },
    );

    for (const s of sections) {
      const el = document.getElementById(s.anchor);
      if (el) obs.observe(el);
    }
    return () => obs.disconnect();
  }, [sections]);

  // 同步外部 prop
  useEffect(() => {
    if (activeAnchor) setObserved(activeAnchor);
  }, [activeAnchor]);

  if (sections.length === 0) return null;

  function handleClick(e: React.MouseEvent<HTMLAnchorElement>, anchor: string): void {
    e.preventDefault();
    const el = document.getElementById(anchor);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      // 同步 URL hash 但不触发额外跳转
      history.replaceState(null, '', `#${anchor}`);
      setObserved(anchor);
    }
  }

  return (
    <nav
      aria-label="Report sections"
      className={cn(
        'sticky top-4 hidden max-h-[calc(100vh-2rem)] overflow-y-auto rounded-lg border bg-card p-3 text-sm lg:block',
        className,
      )}
    >
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Sections
      </p>
      <ul className="space-y-1">
        {sections.map((s) => {
          const isActive = observed === s.anchor;
          return (
            <li key={`${s.level}-${s.anchor}`} className={cn(s.level === 3 && 'pl-3')}>
              <a
                href={`#${s.anchor}`}
                onClick={(e) => {
                  handleClick(e, s.anchor);
                }}
                className={cn(
                  'block rounded px-2 py-1 leading-snug transition-colors',
                  isActive
                    ? 'bg-primary/10 font-medium text-primary'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
                data-testid={`section-nav-${s.anchor}`}
              >
                {s.title}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
