import { homedir } from 'node:os';
import { join } from 'node:path';

export const expandHomePath = (path: string): string => {
  if (path === '~') {
    return homedir();
  }
  if (path.startsWith('~/')) {
    return join(homedir(), path.slice(2));
  }
  return path;
};
