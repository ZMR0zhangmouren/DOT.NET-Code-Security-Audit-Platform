import { randomBytes } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface.js';
import type { Request } from 'express';
import { diskStorage } from 'multer';

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import {
  CodeVersionsService,
  ZIP_MAX_BYTES,
  type CodeVersionPublic,
} from './code-versions.service.js'; // 运行时引用

interface UploadMetaDto {
  label?: string;
  parentVersionId?: string;
}

/**
 * §5.2 CodeVersion 上传 + 列表 + 详情
 */
@Controller()
export class CodeVersionsController {
  constructor(private readonly cv: CodeVersionsService) {}

  /** 上传 zip(单个文件,500MB 上限) */
  @Post('projects/:id/code-versions/upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: tmpdir(),
        filename: (_req, file, cb) => {
          const id = randomBytes(8).toString('hex');
          cb(null, `cvup-${id}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`);
        },
      }),
      limits: { fileSize: ZIP_MAX_BYTES, files: 1 },
    } as MulterOptions),
  )
  async upload(
    @Param('id') projectId: string,
    @Req() req: Request,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: UploadMetaDto,
  ): Promise<CodeVersionPublic> {
    if (!file) throw new BadRequestException('file is required');
    if (!body.label || !body.label.trim()) {
      safeUnlink(file.path);
      throw new BadRequestException('label is required');
    }

    const uploadedBy = (req.headers['x-user-id'] as string | undefined) ?? 'unknown';

    try {
      return await this.cv.uploadZip({
        projectId,
        uploadedBy,
        label: body.label.trim(),
        parentVersionId: body.parentVersionId,
        tmpPath: file.path,
        originalName: file.originalname,
        sizeBytes: file.size,
      });
    } catch (e) {
      safeUnlink(file.path);
      throw e;
    }
  }

  @Get('projects/:id/code-versions')
  list(@Param('id') projectId: string): CodeVersionPublic[] {
    return this.cv.listByProject(projectId);
  }

  @Get('code-versions/:id')
  get(@Param('id') id: string): CodeVersionPublic {
    return this.cv.get(id);
  }
}

function safeUnlink(p: string | undefined): void {
  if (!p) return;
  try {
    unlinkSync(p);
  } catch {
    /* ignore */
  }
  // 抑制 unused
  void join;
}
