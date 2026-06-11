export const SOCKET_EVENTS = {
  JOIN_ROOM: 'join-room',
  LEAVE_ROOM: 'leave-room',
  MEETING_ENDED: 'meeting-ended',
  MEETING_ENDED_GLOBAL: 'meeting-ended-global',
  RECORDING_START: 'recording:start',
  RECORDING_STOP: 'recording:stop',
  RECORDING_STARTED: 'recording:started',
  RECORDING_STOPPED: 'recording:stopped',
} as const;

export const ERROR_CODES = {
  ROOM_NOT_FOUND: 'ROOM_NOT_FOUND',
  MEETING_ENDED: 'MEETING_ENDED',
  NOT_HOST: 'NOT_HOST',
  INVALID_TOKEN: 'INVALID_TOKEN',
  UNAUTHORIZED: 'UNAUTHORIZED',
  RECORDING_IN_PROGRESS: 'RECORDING_IN_PROGRESS',
} as const;
