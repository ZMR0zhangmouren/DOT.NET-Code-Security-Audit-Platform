-- §11 Q13 锁定 SOCKS5;把已有的 'socks' 字符串统一改为 'socks5'
-- SQLite TEXT 列无 CHECK 约束,只需做数据 UPDATE。
UPDATE `proxy_configs` SET `protocol` = 'socks5' WHERE `protocol` = 'socks';
