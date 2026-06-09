import type { Database as DBType, Statement } from 'better-sqlite3';
declare const db: DBType;
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
export declare const userQueries: Record<string, Statement>;
export declare const meetingQueries: Record<string, Statement>;
export default db;
//# sourceMappingURL=db.d.ts.map