import { Module } from '@nestjs/common';

import { DatabaseModule } from '../db/database.module.js';

import { GitCloneService } from './git-clone.service.js';
import { GitHubService } from './github.service.js';

/**
 * §5.7 Git Clone Module —— 提供 GitCloneService + GitHubService
 *
 * - GitCloneService 调本机 `git` CLI(from-git 路径)
 * - GitHubService 调 GitHub REST tarball API(from-github 路径)
 * - 都注册在同一个 module 里,方便 CodeVersionsModule 一次性 imports
 */
@Module({
  imports: [DatabaseModule],
  providers: [GitCloneService, GitHubService],
  exports: [GitCloneService, GitHubService],
})
export class GitCloneModule {}
