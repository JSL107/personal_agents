export const AUTOPILOT_CRON_QUEUE = 'autopilot-cron';

export interface AutopilotJobData {
  ownerSlackUserId: string;
  target: string;
}
