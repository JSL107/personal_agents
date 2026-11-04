export interface AutoRemindAtInput {
  dueDate: Date | null;
  dueTime: string | null;
  now: Date;
}

export const computeAutoRemindAt = ({
  dueDate,
  dueTime,
  now,
}: AutoRemindAtInput): Date | null => {
  if (!dueDate || !dueTime || !/^([01]\d|2[0-3]):[0-5]\d$/.test(dueTime)) {
    return null;
  }
  const [hour, minute] = dueTime.split(':').map(Number);
  const result = new Date(
    dueDate.getTime() + (hour * 60 + minute - 600) * 60_000,
  );
  return result.getTime() > now.getTime() ? result : null;
};
