export declare const livekitService: {
    generateToken(roomName: string, participantName: string, participantId: string, isTeacher?: boolean): Promise<string>;
    getServerUrl(): string;
    isConfigured(): boolean;
    endRoom(roomName: string): Promise<void>;
    startRecording(roomName: string, publicUrl: string): Promise<{
        egressId: string;
        fileUrl: string;
    }>;
    stopRecording(egressId: string): Promise<void>;
    getEgressStatus(egressId: string): Promise<string>;
};
//# sourceMappingURL=livekit.service.d.ts.map