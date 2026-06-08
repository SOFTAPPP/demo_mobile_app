export interface User {
  id: string;
  name: string;
  email: string;
  role: 'teacher' | 'student';
  avatar_color: string;
  created_at?: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AuthResponse {
  user: User;
  accessToken: string;
  refreshToken: string;
}

export interface Meeting {
  id: string;
  room_code: string;
  title: string;
  host_id: string;
  max_participants: number;
  is_active: boolean | number;
  created_at: string;
  ended_at: string | null;
}

export interface LiveKitInfo {
  token: string;
  url: string;
  configured: boolean;
}

export interface MeetingResponse {
  meeting: Meeting;
  livekit: LiveKitInfo;
}
