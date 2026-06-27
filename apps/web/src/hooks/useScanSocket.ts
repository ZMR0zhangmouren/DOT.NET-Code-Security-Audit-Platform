import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';

export type ScanLogLevel = 'info' | 'warn' | 'error' | 'debug';
export interface ScanLogEvent {
  scanRunId: string;
  level: ScanLogLevel;
  message: string;
  ts: number;
}

export interface ScanProgressEvent {
  scanRunId: string;
  percent: number;
  currentStage: string;
}

export type ScanSocketStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';

/**
 * §5.3 实时日志 Hook —— 连接 /scans 命名空间,订阅指定 scanRunId 的日志流
 *
 * dev 期:直接连 http://127.0.0.1:3000(后端 socket.io 端口)
 * 生产期:走 vite proxy 转发(已在 vite.config.ts 配 /socket.io)
 */
export function useScanSocket(scanRunId: string | null): {
  status: ScanSocketStatus;
  logs: ScanLogEvent[];
  lastProgress: ScanProgressEvent | null;
  poke: () => void;
} {
  const [status, setStatus] = useState<ScanSocketStatus>('idle');
  const [logs, setLogs] = useState<ScanLogEvent[]>([]);
  const [lastProgress, setLastProgress] = useState<ScanProgressEvent | null>(null);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!scanRunId) return;

    const url = `${window.location.protocol}//${window.location.hostname}:3000/scans`;
    setStatus('connecting');

    const sock = io(url, {
      transports: ['websocket', 'polling'],
      autoConnect: true,
      withCredentials: false,
    });
    socketRef.current = sock;

    sock.on('connect', () => {
      setStatus('connected');
      sock.emit('subscribe:scan', { scanRunId });
    });
    sock.on('disconnect', () => setStatus('disconnected'));
    sock.on('connect_error', () => setStatus('error'));

    sock.on('scan:log', (event: ScanLogEvent) => {
      setLogs((prev) => [...prev.slice(-99), event]);
    });
    sock.on('scan:progress', (event: ScanProgressEvent) => {
      setLastProgress(event);
    });

    return () => {
      sock.disconnect();
      socketRef.current = null;
    };
  }, [scanRunId]);

  return {
    status,
    logs,
    lastProgress,
    poke: () => socketRef.current?.emit('demo:poke', { scanRunId }),
  };
}
