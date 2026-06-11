import { Client } from '@libsql/client';
declare const db: Client;
export declare const initializeDatabase: () => Promise<void>;
export interface User {
    id: string;
    name: string;
    email: string;
    password_hash: string;
    role: string;
    avatar_color: string;
    created_at: string;
}
export interface Meeting {
    id: string;
    room_code: string;
    title: string;
    host_id: string;
    max_participants: number;
    is_active: number;
    created_at: string;
    ended_at: string | null;
    scheduled_for: string | null;
}
export interface MeetingParticipant {
    meeting_id: string;
    user_id: string;
    joined_at: string;
}
export interface Recording {
    id: string;
    meeting_id: string;
    user_id: string;
    egress_id: string;
    status: 'recording' | 'processing' | 'saved' | 'failed';
    storage_provider: string;
    storage_key: string;
    upload_id?: string;
    parts_json: string;
    file_size: number;
    duration: number;
    mime_type?: string;
    started_at: string;
    ended_at?: string;
    created_at: string;
}
export declare const userQueries: {
    create: (id: string, name: string, email: string, password_hash: string, role: string, avatar_color: string) => Promise<void>;
    findByEmail: (email: string) => Promise<User | undefined>;
    findById: (id: string) => Promise<User | undefined>;
    getAll: () => Promise<User[]>;
};
export declare const meetingQueries: {
    create: (id: string, room_code: string, title: string, host_id: string, max_participants: number) => Promise<void>;
    schedule: (id: string, room_code: string, title: string, host_id: string, max_participants: number, scheduled_for: string) => Promise<void>;
    findByCode: (room_code: string) => Promise<Meeting | undefined>;
    findById: (id: string) => Promise<Meeting | undefined>;
    getActiveByHost: (host_id: string) => Promise<Meeting[]>;
    getRecent: (host_id: string, user_id: string) => Promise<Meeting[]>;
    getScheduled: (host_id: string) => Promise<Meeting[]>;
    endMeeting: (room_code: string) => Promise<void>;
    getActive: () => Promise<Meeting[]>;
    deleteMeeting: (id: string, host_id: string) => Promise<void>;
};
export declare const recordingQueries: {
    createRecording(recording: Omit<Recording, "created_at" | "started_at" | "file_size" | "duration" | "parts_json" | "status">): Promise<void>;
    getRecordingById(id: string): Promise<Recording | null>;
    getRecordingsByMeetingId(meetingId: string): Promise<Recording[]>;
    updateRecordingParts(id: string, partsJson: string): Promise<void>;
    finalizeRecording(id: string, status: Recording["status"], duration: number, fileSize: number): Promise<void>;
    getOngoingRecordingsForMeeting(meetingId: string): Promise<Recording[]>;
    getRecordingsByUserId(userId: string): Promise<(Recording & {
        meeting_title: string;
        meeting_room_code: string;
    })[]>;
    deleteRecording(id: string, userId: string): Promise<boolean>;
};
export default db;
//# sourceMappingURL=db.d.ts.map