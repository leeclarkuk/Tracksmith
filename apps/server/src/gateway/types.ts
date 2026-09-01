export type GatewayReadStatus = 'ok' | 'unreachable' | 'not_found' | 'error';

export interface GatewayReadResult<T> {
  status: GatewayReadStatus;
  data?: T;
  message?: string;
}
