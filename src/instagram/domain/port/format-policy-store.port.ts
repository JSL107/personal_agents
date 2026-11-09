import { FormatPolicy } from '../format-policy';

export const FORMAT_POLICY_STORE_PORT = Symbol('FORMAT_POLICY_STORE_PORT');
export type FormatPolicyRead =
  | { kind: 'no_directory' }
  | { kind: 'missing' }
  | { kind: 'broken'; reason: string }
  | { kind: 'ok'; policy: FormatPolicy };
export interface FormatPolicyStorePort {
  read(): Promise<FormatPolicyRead>;
  write(parameters: {
    policy: FormatPolicy;
    previous: FormatPolicy | null;
  }): Promise<void>;
}
