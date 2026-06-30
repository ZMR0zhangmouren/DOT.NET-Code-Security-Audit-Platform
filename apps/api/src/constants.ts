/**
 * 跨模块共享的运行时常量。
 *
 * 注意:仅放真正被多个模块引用的常量,避免把所有 magic number 都塞进来。
 */

/** LOC(行数)统计时纳入计数的文件扩展名集合(含前导点,小写)。 */
export const LOC_EXTENSIONS = new Set([
  // .NET
  '.cs',
  '.cshtml',
  '.csproj',
  '.sln',
  '.vb',
  '.aspx',
  '.ascx',
  // JS/TS 生态
  '.js',
  '.ts',
  '.jsx',
  '.tsx',
  '.mjs',
  '.cjs',
  // 常见后端语言
  '.py',
  '.pyx',
  '.rb',
  '.go',
  '.rs',
  '.java',
  '.kt',
  '.swift',
  // Shell
  '.sh',
  '.bash',
  '.zsh',
  '.ps1',
  // 文档 / 配置 / 数据
  '.md',
  '.txt',
  '.json',
  '.json5',
  '.jsonc',
  '.yml',
  '.yaml',
  '.toml',
  // Web 前端
  '.html',
  '.htm',
  '.xml',
  '.svg',
  '.css',
  '.scss',
  '.less',
  // SQL / 框架模板
  '.sql',
  '.vue',
  '.svelte',
  // dotfile 配置
  '.env',
  '.gitignore',
  '.dockerignore',
  '.editorconfig',
  '.prettierrc',
  '.eslintrc',
]);
