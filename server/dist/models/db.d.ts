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
export interface Recording {
    id: string;
    meeting_id: string;
    user_id: string;
    egress_id: string;
    status: 'recording' | 'completed' | 'failed';
    file_url: string | null;
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
    create: (id: string, meeting_id: string, user_id: string, egress_id: string, status: string, file_url: string | null) => Promise<void>;
    updateStatus: (status: string, egress_id: string) => Promise<void>;
    getByMeetingId: (meeting_id: string) => Promise<Recording[]>;
    getAllForUser: (user_id: string) => Promise<Recording[]>;
    deleteById: (id: string) => Promise<void>;
    findById: (id: string) => Promise<Recording | undefined>;
};
export default db;
//# sourceMappingURL=db.d.ts.map