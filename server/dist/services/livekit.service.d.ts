export declare const livekitService: {
    generateToken(roomName: string, participantName: string, participantId: string, isTeacher?: boolean): Promise<string>;
    getServerUrl(): string;
    isConfigured(): boolean;
    endRoom(roomName: string): Promise<void>;
};
//# sourceMappingURL=livekit.service.d.ts.map