import { Controller, Get, Param, Res } from '@nestjs/common';
import type { Response } from 'express';

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { ReportService } from './report.service.js'; // runtime ref (NestJS DI)

/**
 * §5.4 报告导出端点
 *
 *  - GET /api/scan-runs/:id/report         → text/markdown
 *  - GET /api/scan-runs/:id/report.json    → application/json
 *  - GET /api/scan-runs/:id/report-archive → application/zip(md + json + 原始 log)
 */
@Controller('scan-runs')
export class ReportController {
  constructor(private readonly reports: ReportService) {}

  @Get(':id/report')
  report(@Param('id') id: string, @Res({ passthrough: false }) res: Response): void {
    const md = this.reports.toMarkdown(id);
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${id}-report.md"`);
    res.send(md);
  }

  @Get(':id/report.json')
  reportJson(@Param('id') id: string, @Res({ passthrough: false }) res: Response): void {
    const json = JSON.stringify(this.reports.toJson(id), null, 2);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${id}-report.json"`);
    res.send(json);
  }

  @Get(':id/report-archive')
  reportArchive(@Param('id') id: string, @Res({ passthrough: false }) res: Response): void {
    const { zipPath, bytes } = this.reports.buildArchive(id);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Length', String(bytes));
    res.setHeader('Content-Disposition', `attachment; filename="${id}-archive.zip"`);
    res.sendFile(zipPath, (err) => {
      if (err && !res.headersSent) {
        res.status(500).json({ error: 'failed to send archive' });
      }
    });
  }
}
