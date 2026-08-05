export const INSTALLED_TOOLS_PORT = Symbol('INSTALLED_TOOLS_PORT');

export interface InstalledToolsPort {
  collect(): Promise<string[]>;
}
