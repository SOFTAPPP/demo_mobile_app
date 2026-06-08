interface TokenPayload {
    userId: string;
    email: string;
    role: string;
}
export declare const jwtService: {
    signAccessToken(payload: TokenPayload): string;
    signRefreshToken(payload: TokenPayload): string;
    verifyAccessToken(token: string): TokenPayload;
    verifyRefreshToken(token: string): TokenPayload;
};
export {};
//# sourceMappingURL=jwt.service.d.ts.map