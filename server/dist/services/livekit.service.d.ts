export declare const livekitService: {
    /**
     * Generate a LiveKit access token for a participant to join a room.
     * This token is what the client uses to connect to the LiveKit SFU.
     */
    generateToken(roomName: string, participantName: string, participantId: string, isTeacher?: boolean): Promise<string>;
    /**
     * Get the LiveKit WebSocket URL for the client to connect to
     */
    getServerUrl(): string;
    /**
     * Check if LiveKit is configured with valid non-placeholder credentials
     */
    isConfigured(): boolean;
};
//# sourceMappingURL=livekit.service.d.ts.map