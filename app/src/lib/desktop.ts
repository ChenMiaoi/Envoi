import {translate} from '@/i18n/runtime';

import type {EnvoiBridge} from '../../electron/preload/api';
export type {EnvoiBridge} from '../../electron/preload/api';

declare global {
  interface Window { envoi?: EnvoiBridge }
}

// 桌面版为唯一目标；浏览器场景下桥不存在，运行期报“服务不可用”。
export const isDesktop = typeof window !== 'undefined' && 'envoi' in window;

export function envoi(): EnvoiBridge {
  const bridge = typeof window === 'undefined' ? undefined : window.envoi;
  if (!bridge) throw new Error(translate('project.serviceUnavailable'));
  return bridge;
}

// 主进程抛出的中文错误经 IPC 后带 "Error invoking remote method 'envoi:xxx': Error: " 前缀，还原原始消息。
export function ipcError(error: unknown): Error {
  const original = error instanceof Error ? error : new Error(String(error));
  const message = original.message.replace(/^Error invoking remote method '[^']*':\s*(?:Error:\s*)?/, '');
  if (message === original.message) return original;
  return new Error(message);
}
