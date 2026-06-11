# Sangeet Arghya — Production Audit Report

**Date:** 2026-06-11
**Auditor:** Senior Full-Stack Architect Agent
**Stack:** React 18 + Vite + TypeScript / Node.js + Express + TypeScript / LiveKit SFU / Turso (libSQL) / Cloudflare R2 / Capacitor 6

---

## PHASE 1 — COMPLETE APPLICATION ANALYSIS

### 1.1 — Auth System

#### FINDING: server/.env committed to git with live secrets
**Status:** CRITICAL
**Issue:** `server/.env` containing live production credentials (LiveKit API keys, S3 secret keys, Turso auth tokens, JWT secrets) is tracked in git since the first commit (`bcd8aacf`). `client/.env` with the production API URL is also tracked.
**Impact:** Anyone with repo access (including GitHub's scanning bots) has all production secrets. S3 bucket can be accessed, LiveKit rooms hijacked, database compromised.
**Fix:**
1. Immediately rotate ALL secrets (JWT_SECRET, LiveKit keys, S3 keys, Turso token)
2. `git rm --cached server/.env client/.env`
3. Use `git filter-branch` or BFG Repo Cleaner to purge from history
4. Add env vars only via Render/Vercel dashboard
**Priority:** P0 (blocking)

#### FINDING: bcrypt salt rounds too low
**Status:** Needs Improvement
**Issue:** `server/src/routes/auth.routes.ts:60` uses `bcrypt.genSalt(10)`. Production standard is >= 12.
**Impact:** Weaker password hashes, more susceptible to brute-force if DB is compromised.
**Fix:** Change to `bcrypt.genSalt(12)`.
**Priority:** P1

#### FINDING: No role enforcement middleware
**Status:** Needs Improvement
**Issue:** `auth.middleware.ts` verifies JWT and attaches `req.user.role`, but there is no `requireRole('teacher')` guard. Any student can call `/meetings/create`, `/meetings/end`, `/recordings/start`.
**Impact:** Students can create meetings, end other teachers' meetings (if they guess room code), start recordings.
**Fix:** Add role guard middleware:
```typescript
export const requireRole = (...roles: string[]) => (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!req.user || !roles.includes(req.user.role)) {
    res.status(403).json({ error: 'Insufficient permissions' });
    return;
  }
  next();
};
```
Apply to: `POST /meetings/create`, `POST /meetings/end`, `POST /meetings/schedule`, `POST /recordings/start`.
**Priority:** P0

#### FINDING: JWT refresh token has no rotation
**Status:** Needs Improvement
**Issue:** `POST /auth/refresh` issues a new access token but does not rotate the refresh token. A stolen refresh token is valid indefinitely (7 days) with no detection.
**Impact:** Token theft goes undetected; no way to invalidate a compromised refresh token.
**Fix:** Implement refresh token rotation — issue a new refresh token on each refresh call, store hash in DB, invalidate on reuse detection.
**Priority:** P1

#### FINDING: Hardcoded fallback JWT secrets
**Status:** Needs Improvement
**Issue:** `server/src/config/index.ts:15-16` falls back to `'sangeet-arghya-demo-secret'` if `JWT_SECRET` is not set. In production, this means anyone can forge tokens.
**Impact:** If env var is missing in production, all auth is compromised.
**Fix:** Throw an error in production if `JWT_SECRET` is not set, rather than using a fallback.
**Priority:** P1

#### FINDING: Rate limiting — good but could be tighter
**Status:** Good
**Issue:** `authLimiter` at 10 req/15min on login/signup is present and reasonable.
**Impact:** N/A — working as intended.
**Priority:** N/A

#### FINDING: Input validation with Zod — good
**Status:** Good
**Issue:** All auth endpoints use Zod schemas for validation.
**Impact:** N/A — working as intended.
**Priority:** N/A

#### FINDING: CORS configuration
**Status:** Good
**Issue:** CORS origins are explicitly listed (localhost variants + `CLIENT_URL`), not wildcard. `credentials: true` is set.
**Impact:** N/A — appropriate for the use case.
**Priority:** N/A

#### FINDING: Tokens exposed in response body
**Status:** Needs Improvement
**Issue:** `auth.routes.ts:77-81` returns `accessToken` and `refreshToken` in the JSON body alongside setting cookies. On web, only cookies should be used.
**Impact:** Tokens in response body may be logged by intermediaries. For native (Capacitor), this is needed, but for web it's redundant.
**Fix:** Conditionally include tokens in response body only when `isNative` is detected (or remove entirely and rely on cookies for web).
**Priority:** P2

---

### 1.2 — Dashboard

#### FINDING: Socket.io cleanup on unmount
**Status:** Good
**Issue:** `Dashboard.tsx:98-101` properly calls `socket.off()` and `disconnectSocket()` in the cleanup function.
**Impact:** N/A — no memory leaks.
**Priority:** N/A

#### FINDING: Data fetching strategy
**Status:** Good
**Issue:** Uses `Promise.all` for parallel fetching of recent + scheduled meetings. `useCallback` on `fetchMeetings`.
**Impact:** N/A — efficient.
**Priority:** N/A

#### FINDING: Background prefetch of Meeting component
**Status:** Good
**Issue:** `Dashboard.tsx:77-79` preloads the heavy Meeting component after 1.5s idle — excellent for perceived speed.
**Impact:** Reduces meeting join time significantly.
**Priority:** N/A

#### FINDING: No error boundary on dashboard data fetch failure
**Status:** Needs Improvement
**Issue:** `fetchMeetings` catches errors silently (`catch {}`). If the API is down, the user sees an empty dashboard with no error message or retry option.
**Impact:** User confusion when API is unreachable.
**Fix:** Show a toast/banner on fetch failure with a "Retry" button.
**Priority:** P1

#### FINDING: Role-conditional rendering missing
**Status:** Needs Improvement
**Issue:** Dashboard shows the same UI (Create Meeting, Schedule) for both teachers and students. Students should not see "New Meeting" or "Schedule" quick action cards.
**Impact:** Students see controls they can't use (or shouldn't use).
**Fix:** Conditionally render based on `user.role === 'teacher'`.
**Priority:** P1

#### FINDING: Duplicate LiveClock timer
**Status:** Needs Improvement
**Issue:** `Dashboard.tsx` has both a `LiveClock` component (line 11-46) with its own interval AND a separate `currentTime` state (line 67-72) with its own interval. Two intervals ticking every second for the same purpose.
**Impact:** Unnecessary re-renders.
**Fix:** Remove the duplicate `currentTime` state and use the `LiveClock` component or a single timer.
**Priority:** P2

---

### 1.3 — Create Meeting Flow

#### FINDING: Room code generation — weak entropy
**Status:** Needs Improvement
**Issue:** `meeting.routes.ts:13-20` generates 6-char codes from a 31-char alphabet. That's `31^6 = ~887M` combinations. With `Math.random()` (not cryptographically random), collision risk increases.
**Impact:** At scale, room code collisions. `Math.random()` is not secure random.
**Fix:** Use `crypto.randomInt()` for server-side code generation. Consider 7-8 chars for more headroom.
**Priority:** P1

#### FINDING: Optimistic DB insert (meeting created AFTER response)
**Status:** Needs Improvement
**Issue:** `meeting.routes.ts:78-87` sends the response BEFORE writing to DB (`setImmediate`). If the DB write fails, the room exists in LiveKit but not in the database.
**Impact:** Orphan meetings — user is in a room that doesn't exist in DB, can't be found by join, can't be ended properly.
**Fix:** Write to DB first (it's Turso/libSQL, should be fast), then respond. Or at minimum, handle the failure case with a cleanup.
**Priority:** P1

#### FINDING: No collision check on create (only on schedule)
**Status:** Needs Improvement
**Issue:** `POST /create` does `setImmediate` for DB insert with only a log warning on collision. `POST /schedule` properly retries up to 5 times.
**Impact:** Meeting could be created with a duplicate room code.
**Fix:** Apply the same retry logic from schedule to create.
**Priority:** P1

#### FINDING: No confirmation modal for "Start Meeting"
**Status:** Needs Improvement
**Issue:** The create modal has a title input and a "Start Meeting" button, but no explicit "Are you sure?" confirmation step.
**Impact:** Accidental meeting creation.
**Fix:** This is low severity since creation is non-destructive (can just end it). Mark as P2.
**Priority:** P2

---

### 1.4 — Join Meeting Flow

#### FINDING: Room code normalization
**Status:** Good
**Issue:** `Dashboard.tsx:175` uppercases and trims room code before API call. Server also uppercases on join (`meeting.routes.ts:146`).
**Impact:** N/A — working correctly.
**Priority:** N/A

#### FINDING: Clear error messages
**Status:** Good
**Issue:** Server returns distinct errors: "Meeting not found" (404) vs "This meeting has ended" (410).
**Impact:** N/A — good UX.
**Priority:** N/A

---

### 1.5 — Schedule Class Flow

#### FINDING: Timezone handling
**Status:** Needs Improvement
**Issue:** `Dashboard.tsx:204` creates ISO string from local date/time: `new Date(\`${scheduleDate}T${scheduleTime}\`).toISOString()`. This converts local time to UTC, which is correct for storage. However, the display in `formatDate` uses `toLocaleDateString` which converts back to local. This works, but there's no timezone indicator shown to the user.
**Impact:** If teacher and student are in different timezones, the scheduled time will display differently.
**Fix:** Show timezone indicator (e.g., "IST") next to the time picker and in the scheduled meetings list.
**Priority:** P1

#### FINDING: No duplicate schedule detection
**Status:** Needs Improvement
**Issue:** No check for overlapping schedules — teacher can schedule multiple classes at the same time.
**Impact:** Confusion, double-booked classes.
**Fix:** Query existing scheduled meetings and warn if time overlaps.
**Priority:** P2

---

### 1.6 — Recorded Classes

#### FINDING: Storage — Cloudflare R2 (good)
**Status:** Good
**Issue:** Recordings use Cloudflare R2 via S3-compatible API with multipart upload. This is production-appropriate.
**Impact:** N/A.
**Priority:** N/A

#### FINDING: Recordings served via public URL (no signed URLs)
**Status:** Needs Improvement
**Issue:** `recording.routes.ts:120` constructs a public download URL: `${s3PublicUrl}/${r.storage_key}`. Anyone with the URL can access the recording.
**Impact:** Unauthorized access to class recordings.
**Fix:** Use presigned GET URLs with expiry (e.g., 1 hour) instead of public URLs.
**Priority:** P1

#### FINDING: No access control on recording retrieval
**Status:** Needs Improvement
**Issue:** `GET /recordings/:meetingId` only requires auth but doesn't verify the user is the host or a participant of that meeting.
**Impact:** Any authenticated user can access any meeting's recordings by guessing the meetingId.
**Fix:** Verify `req.user.userId` is the host or a participant before returning recordings.
**Priority:** P0

#### FINDING: No streaming/range request support
**Status:** Needs Improvement
**Issue:** Recordings are served as direct R2 public URLs. No HTTP 206 range request support from your server (R2 handles it natively though).
**Impact:** Large recordings must fully download before playback in some browsers.
**Fix:** R2 supports range requests natively, so this is acceptable if the public URL is used. However, with presigned URLs, verify R2 passes through range headers.
**Priority:** P2

---

### 1.7 — Meeting Room — Deep Audit

#### FINDING: LiveKit SFU (not raw WebRTC)
**Status:** Good
**Issue:** The app uses LiveKit as the media server (SFU), not raw WebRTC peer-to-peer. This is the correct architecture for 100-participant classes. LiveKit handles STUN/TURN, ICE, SDP, simulcast, and codec negotiation.
**Impact:** N/A — this is a strong architectural choice.
**Priority:** N/A

#### FINDING: Music Mode implementation
**Status:** Needs Improvement
**Issue:** `Meeting.tsx:413-424` — Music Mode toggles `echoCancellation`, `noiseSuppression`, `autoGainControl` by stopping and restarting the microphone (`setMicrophoneEnabled(false)` then `setMicrophoneEnabled(true, {...})`). This causes an audible dropout of ~200-500ms.
**Impact:** Audio interruption when switching modes mid-class.
**Fix:** Use `track.setMediaStream()` or `track.applyConstraints()` to modify the existing track without stopping it. With LiveKit, use `localParticipant.audioTrackPublications` to get the track and call `restartTrack()` with new constraints.
**Priority:** P1

#### FINDING: Audio constraints — default voice mode is good
**Status:** Good
**Issue:** `Meeting.tsx:25` sets `echoCancellation: true, noiseSuppression: true, autoGainControl: true` as defaults. This is correct for voice mode.
**Impact:** N/A.
**Priority:** N/A

#### FINDING: Audio bitrate — 256kbps (good for music)
**Status:** Good
**Issue:** `Meeting.tsx:26` sets `audioPreset: { maxBitrate: 256_000 }`. This is high quality for Opus.
**Impact:** N/A — good audio quality.
**Priority:** N/A

#### FINDING: DTX disabled (correct for music)
**Status:** Good
**Issue:** `Meeting.tsx:26` sets `dtx: false`. This prevents Opus from silencing "background noise" (which could be music).
**Impact:** N/A — correct for music class.
**Priority:** N/A

#### FINDING: Video — simulcast enabled, 720p, 2Mbps cap
**Status:** Good
**Issue:** `Meeting.tsx:26` — `simulcast: true`, `VideoPresets.h720.resolution`, `maxBitrate: 2_000_000`. Good adaptive quality.
**Impact:** N/A.
**Priority:** N/A

#### FINDING: No independent Noise Suppression toggle
**Status:** Needs Improvement
**Issue:** The prompt requires an independent noise suppression toggle. Currently, it's bundled into Music Mode (off when music mode is on, on when off).
**Impact:** User can't independently control noise suppression vs echo cancellation.
**Fix:** Add a separate toggle button for noise suppression.
**Priority:** P2

#### FINDING: Missing confirmation modals for recording
**Status:** Needs Improvement
**Issue:** Recording starts/stops immediately on button click without a confirmation modal.
**Impact:** Accidental recording start/stop.
**Fix:** Add confirmation modals for "Start Recording" and "Stop Recording".
**Priority:** P1

#### FINDING: Confirmation modals for Leave/End — present and good
**Status:** Good
**Issue:** `Meeting.tsx:636-687` — Both leave and end have confirmation modals with Cancel/Confirm buttons, red confirm color, and descriptive text.
**Impact:** N/A — working correctly.
**Priority:** N/A

#### FINDING: Socket events — magic strings
**Status:** Needs Improvement
**Issue:** All socket event names are hardcoded strings throughout the codebase (`'join-room'`, `'meeting-ended'`, `'recording:started'`, etc.). No constants file.
**Impact:** Typos in event names cause silent failures. Hard to refactor.
**Fix:** Create `client/src/constants/events.ts` with all event names as constants.
**Priority:** P1

#### FINDING: Socket events — incomplete implementation
**Status:** Needs Improvement
**Issue:** The prompt requires: `user-joined`, `user-left`, `mic-toggled`, `camera-toggled`, `music-mode-changed`. Currently implemented: `join-room`, `leave-room`, `meeting-ended`, `recording:start/stop`, `meeting-ended-global`.
**Impact:** No live participant join/leave notifications via socket (relying on LiveKit events instead, which is acceptable). No mic/camera state sync via socket (also handled by LiveKit natively).
**Fix:** Since LiveKit handles participant presence and track state natively, the missing socket events are redundant. This is acceptable. However, `music-mode-changed` notification to other peers would be useful.
**Priority:** P2

#### FINDING: ParticipantVideoTile — React.memo (good)
**Status:** Good
**Issue:** `Meeting.tsx:709` — `ParticipantVideoTile` is wrapped in `React.memo`.
**Impact:** N/A — prevents unnecessary re-renders.
**Priority:** N/A

#### FINDING: BrandedMeetingUI — React.memo (good)
**Status:** Good
**Issue:** `Meeting.tsx:274` — `BrandedMeetingUI` is wrapped in `React.memo`.
**Impact:** N/A.
**Priority:** N/A

#### FINDING: Optimistic UI for mic/cam toggles (good)
**Status:** Good
**Issue:** `Meeting.tsx:355-367` — Optimistic state for mic/camera with auto-reconciliation. Excellent UX pattern.
**Impact:** Instant visual feedback.
**Priority:** N/A

#### FINDING: ErrorBoundary uses window.location.reload()
**Status:** Needs Improvement
**Issue:** `Meeting.tsx:88` and `ErrorBoundary.tsx:41` use `window.location.reload()` and `window.location.href`. These break Capacitor compatibility.
**Impact:** In Capacitor, `window.location.href` navigates away from the app shell.
**Fix:** Use React Router's `navigate()` instead.
**Priority:** P1

---

## PHASE 2 — PERFORMANCE & LATENCY OPTIMIZATION

### 2.1 — Bundle Size

#### FINDING: LiveKit chunk is 540KB (uncompressed)
**Status:** Needs Improvement
**Issue:** The `livekit` chunk is 540KB raw. Estimated ~160KB gzipped (LiveKit compresses well). Still the largest chunk by far.
**Impact:** Slow initial load on poor networks, but mitigated by lazy loading (Meeting is not in the initial bundle).
**Fix:** Already lazy-loaded, so this only affects the Meeting route. Acceptable. Consider tree-shaking unused LiveKit components.
**Priority:** P2

#### FINDING: Code splitting — good
**Status:** Good
**Issue:** `App.tsx:10-12` lazy-loads Dashboard, Meeting, and MeetingEnded. Vite config has manual chunks for livekit, socket, and vendor.
**Impact:** Initial bundle is only `index.js` (66.7KB) + `vendor.js` (175.2KB) = ~242KB uncompressed (~70KB gzipped). Excellent.
**Priority:** N/A

#### FINDING: console.log in production build
**Status:** Needs Improvement
**Issue:** `api.ts:37` has `console.log` for API timing. `useMeetingRecorder.ts` has multiple `console.error`/`console.warn`. These will appear in production.
**Impact:** Information leakage, minor performance cost.
**Fix:** Add `drop: ['console']` to Vite build config esbuild options:
```typescript
build: {
  minify: 'esbuild',
  // In vite.config.ts, add:
}
// And in esbuild config or via plugin, drop console in production
```
Or use `vite-plugin-remove-console`.
**Priority:** P1

#### FINDING: No service worker
**Status:** Needs Improvement
**Issue:** No service worker for offline caching of the app shell.
**Impact:** No offline support, slower repeat visits.
**Fix:** Add a basic service worker via `vite-plugin-pwa` for static asset caching.
**Priority:** P2

### 2.2 — Audio Quality for Music

#### FINDING: Opus codec preference
**Status:** Good (via LiveKit)
**Issue:** LiveKit defaults to Opus and handles codec negotiation. The `dtx: false` and `audioPreset: { maxBitrate: 256_000 }` settings are correct for music.
**Impact:** N/A — LiveKit handles this well.
**Priority:** N/A

#### FINDING: Music mode constraints application
**Status:** Needs Improvement
**Issue:** As noted in 1.7, music mode stops and restarts the mic track instead of using `applyConstraints()`. The constraints themselves are correct (all three off for music mode).
**Impact:** Audio dropout on mode switch.
**Fix:** Use LiveKit's `LocalAudioTrack.restartTrack()` with new constraints instead of disable/enable cycle.
**Priority:** P1

#### FINDING: No stereo audio
**Status:** Needs Improvement
**Issue:** Audio is mono by default. For music classes, stereo would be beneficial (e.g., for tabla left/right hand, stereo instruments).
**Impact:** Loss of spatial audio information.
**Fix:** Add `channelCount: 2` to audio constraints and `sprop-stereo=1` in Opus parameters. LiveKit supports stereo via `audioPreset: { maxBitrate: 510_000, channels: 2 }`.
**Priority:** P1

### 2.3 — React Performance

#### FINDING: useMemo/useCallback usage — good
**Status:** Good
**Issue:** `Dashboard.tsx` uses `useMemo` for `learningStats` and `activeCount`, `useCallback` for `fetchMetings`. `Meeting.tsx` uses `useCallback` for toggle handlers and `useMemo` for `displayTracks`.
**Impact:** N/A — good React performance patterns.
**Priority:** N/A

#### FINDING: WebRTC streams stored in refs (good)
**Status:** Good
**Issue:** `useMeetingRecorder.ts` stores MediaStream, MediaRecorder, and AudioContext in `useRef`, not state.
**Impact:** N/A — prevents unnecessary re-renders.
**Priority:** N/A

---

## PHASE 3 — PRODUCTION HARDENING

### 3.1 — Security

#### FINDING: Helmet.js configured
**Status:** Good
**Issue:** `index.ts:36-38` uses Helmet with `crossOriginResourcePolicy: 'cross-origin'`.
**Impact:** N/A — security headers are set.
**Priority:** N/A

#### FINDING: No Socket.io rate limiting
**Status:** Needs Improvement
**Issue:** Socket events have no rate limiting. A malicious client can spam `join-room`, `recording:start`, etc.
**Impact:** DoS via socket event flooding.
**Fix:** Add per-socket event throttling middleware.
**Priority:** P1

#### FINDING: No input sanitization for XSS
**Status:** Needs Improvement
**Issue:** Meeting titles, display names, and class titles are stored and displayed without sanitization. While React escapes JSX by default, the values are stored in DB and could be exploited if rendered via `dangerouslySetInnerHTML` or in other contexts.
**Impact:** Stored XSS if rendering context changes.
**Fix:** Add server-side sanitization using a library like `dompurify` or `xss` on all string inputs.
**Priority:** P1

#### FINDING: Recording URLs are public
**Status:** Critical (repeated from 1.6)
**Issue:** See 1.6 — recordings accessible via public R2 URLs without auth.
**Priority:** P0

### 3.2 — Error Handling & Recovery

#### FINDING: Global ErrorBoundary — present
**Status:** Good
**Issue:** `App.tsx:120` wraps the entire app in `ErrorBoundary`.
**Impact:** N/A — crash recovery exists.
**Priority:** N/A

#### FINDING: Meeting ErrorBoundary — present
**Status:** Good
**Issue:** `Meeting.tsx:225` wraps the meeting UI in `MeetingErrorBoundary`.
**Impact:** N/A.
**Priority:** N/A

#### FINDING: Socket.io reconnection handling
**Status:** Good
**Issue:** `socket.ts:19-23` configures reconnection with exponential backoff (1s-5s, 10 attempts). `Meeting.tsx:493-498` shows connection state in UI.
**Impact:** N/A — good resilience.
**Priority:** N/A

#### FINDING: No offline detection banner
**Status:** Needs Improvement
**Issue:** No `navigator.onLine` check or offline banner. If the user loses connectivity, they get generic errors.
**Impact:** Poor UX on flaky mobile networks.
**Fix:** Add a global offline banner that listens to `online`/`offline` events.
**Priority:** P1

### 3.3 — Confirmation Modals Checklist

| Action | Modal Present? | Status |
|--------|---------------|--------|
| Start Meeting | No (just the create form) | P2 |
| Join Meeting | No (just the join form) | P2 |
| Schedule Class | No (just the schedule form) | P2 |
| Cancel Schedule | No (dismisses on overlay click) | P2 |
| Leave Meeting (student) | Yes | Good |
| End Meeting (host) | Yes | Good |
| Start Recording | No | P1 |
| Stop Recording | No | P1 |
| Delete Recording | N/A (no delete UI exists) | P1 |
| Delete Meeting | Yes | Good |
| Logout | Yes | Good |

**Issue:** Modals are dismissible by clicking the overlay (`onClick={() => setShowJoinModal(false)}`). For destructive actions, this should be prevented.
**Fix:** Remove overlay click-to-dismiss for destructive action modals.
**Priority:** P1

### 3.4 — Capacitor Readiness

#### FINDING: capacitor.config.ts — present
**Status:** Good
**Issue:** Config has correct `appId`, `appName`, `webDir: 'dist'`.
**Impact:** N/A.
**Priority:** N/A

#### FINDING: window.location.href usage
**Status:** Needs Improvement
**Issue:** `api.ts:77` uses `window.location.href = '/login'` on refresh failure. `ErrorBoundary.tsx:41` uses `window.location.href = '/dashboard'`.
**Impact:** Breaks Capacitor navigation — exits the WebView.
**Fix:** Use React Router's `navigate()` or dispatch a custom event that the app router listens to.
**Priority:** P1

#### FINDING: Socket.io transports
**Status:** Good
**Issue:** `socket.ts:24` uses `transports: ['websocket', 'polling']`. This is correct — websocket first with polling fallback.
**Impact:** N/A.
**Priority:** N/A

#### FINDING: No hardcoded localhost in production
**Status:** Good
**Issue:** `client/.env` uses `https://sangeet-arghya.onrender.com/api`. `api.ts:8` uses `import.meta.env.VITE_API_URL`.
**Impact:** N/A.
**Priority:** N/A

#### FINDING: CapacitorHttp plugin enabled
**Status:** Good
**Issue:** `capacitor.config.ts:8-10` enables `CapacitorHttp` which patches `fetch`/`XMLHttpRequest` for native HTTP requests.
**Impact:** N/A — correct for Capacitor.
**Priority:** N/A

---

## PHASE 4 — CODE QUALITY & MAINTAINABILITY

### 4.1 — File & Folder Structure

**Current structure:**
```
client/src/
  /components  (ErrorBoundary only)
  /pages       (Login, Signup, Dashboard, Meeting, MeetingEnded)
  /hooks       (useMeetingRecorder)
  /context     (AuthContext)
  /services    (api, socket, livekitPrewarm)
  /types       (index)
  /styles      (CSS files)
server/src/
  /routes      (auth, meeting, recording)
  /services    (jwt, livekit, s3)
  /models      (db)
  /middleware  (auth)
  /lib         (logger)
  /config      (index)
```

**Missing:**
- `/constants` directory (for socket event names, error codes)
- `/utils` directory (for room code generation, audio constraints, SDP utils)
- Server `/controllers` (routes contain both routing logic and business logic)
- Server `/socket` directory (socket handlers are inline in `index.ts`)

**Priority:** P2

### 4.2 — Environment Configuration

#### FINDING: .env.example — present but incomplete
**Status:** Needs Improvement
**Issue:** `server/.env.example` is present with most variables. Missing: `NODE_ENV`, `TURSO_AUTH_TOKEN`.
**Fix:** Add all required variables.
**Priority:** P2

### 4.3 — API Consistency

#### FINDING: Inconsistent response format
**Status:** Needs Improvement
**Issue:** API responses are inconsistent:
- Success: `{ user: {...}, accessToken: '...' }` (auth)
- Success: `{ meeting: {...}, livekit: {...} }` (meetings)
- Success: `{ meetings: [...] }` (list)
- Error: `{ error: '...' }` (all errors)

No standardized `{ success: true/false, data: {}, message: '' }` format.
**Impact:** Frontend must handle each endpoint differently.
**Fix:** Standardize response format across all endpoints.
**Priority:** P2

#### FINDING: No error code constants
**Status:** Needs Improvement
**Issue:** Error messages are raw strings. Frontend checks `err.response?.data?.error` and displays directly. No error codes like `ROOM_NOT_FOUND`, `MEETING_ENDED`.
**Impact:** Fragile error handling on frontend.
**Fix:** Add error codes to API responses and use them in frontend conditionals.
**Priority:** P2

---

## PHASE 5 — PRE-DEPLOYMENT CHECKLIST

### Build & Bundle

| Check | Status | Notes |
|-------|--------|-------|
| Production build runs without warnings | Needs verification | Run `npm run build` in client |
| Bundle size < 500KB initial JS (gzipped) | PASS | Initial: ~70KB gzipped (index + vendor) |
| Source maps disabled in production | Needs verification | `tsconfig.json` has `sourceMap: true` for server |
| Env vars injected at build time | PASS | Vite uses `import.meta.env` (build-time) |

### Performance

| Check | Status | Notes |
|-------|--------|-------|
| Lazy loading of heavy routes | PASS | Dashboard, Meeting, MeetingEnded all lazy |
| FCP < 1.5s on 4G | Likely PASS | Small initial bundle |
| No layout shifts | Needs verification | No explicit skeleton screens |

### Security

| Check | Status | Notes |
|-------|--------|-------|
| No secrets in client bundle | PASS | Client only has API URL |
| Secrets in git history | FAIL | server/.env with all credentials committed |
| CSP header | PASS | Via Helmet |
| Dependencies audited | Needs verification | Run `npm audit` |

### Real-time

| Check | Status | Notes |
|-------|--------|-------|
| Socket cleanup on unmount | PASS | Verified in Dashboard and Meeting |
| Socket event names as constants | FAIL | All magic strings |
| Reconnection with backoff | PASS | Configured in socket.ts |

### Meeting Room

| Check | Status | Notes |
|-------|--------|-------|
| Music mode constraints | PARTIAL | Correct constraints, but stops/restarts track |
| DTX disabled | PASS | `dtx: false` in roomOptions |
| Recording saves correctly | PASS | Multipart upload to R2 |
| End meeting navigates all out | PASS | `meeting-ended` socket event + navigate |
| Confirmation modals on destructive | PARTIAL | Leave/End have modals, Recording does not |

### Capacitor Prep

| Check | Status | Notes |
|-------|--------|-------|
| capacitor.config.json present | PASS | Correct config |
| No hardcoded localhost | PASS | Uses env vars |
| React Router navigation | PARTIAL | Most navigation is Router-based, but ErrorBoundary and api.ts use window.location |
| Camera/mic permissions | PASS | Handled by LiveKit's getUserMedia |

---

## PRIORITY FIX LIST (sorted by impact)

### P0 — Blocking (must fix before any deployment)

| # | Issue | Effort | Impact |
|---|-------|--------|--------|
| 1 | **Secrets in git history** — Rotate ALL keys, purge git history | 2 hours | Complete security compromise |
| 2 | **No role enforcement** — Students can create/end meetings, start recordings | 1 hour | Authorization bypass |
| 3 | **No access control on recordings** — Any user can access any recording | 30 min | Privacy violation |
| 4 | **Public recording URLs** — Use presigned URLs with expiry | 2 hours | Unauthorized data access |

### P1 — Pre-deploy (fix before going live)

| # | Issue | Effort | Impact |
|---|-------|--------|--------|
| 5 | bcrypt salt rounds (10 -> 12) | 10 min | Weaker password hashes |
| 6 | Refresh token rotation | 2 hours | Token theft undetectable |
| 7 | Hardcoded JWT fallback secrets | 15 min | Auth bypass if env missing |
| 8 | Music mode track restart (use applyConstraints) | 2 hours | Audio dropout on switch |
| 9 | Stereo audio for music mode | 1 hour | Mono audio loses spatial info |
| 10 | Recording confirmation modals | 1 hour | Accidental recording start/stop |
| 11 | Socket.io rate limiting | 1 hour | DoS vulnerability |
| 12 | Input sanitization (XSS) | 1 hour | Stored XSS risk |
| 13 | Offline detection banner | 30 min | Poor mobile UX on flaky networks |
| 14 | Room code crypto.randomInt | 30 min | Predictable room codes |
| 15 | DB write before response on create | 1 hour | Orphan meetings |
| 16 | Remove console.log in production | 30 min | Information leakage |
| 17 | Socket event name constants | 1 hour | Maintainability |
| 18 | window.location -> React Router navigate | 1 hour | Capacitor compatibility |
| 19 | Dashboard fetch error UI | 30 min | Blank dashboard on API failure |
| 20 | Role-conditional dashboard rendering | 30 min | Students see teacher controls |
| 21 | Timezone indicator for scheduled classes | 30 min | Scheduling confusion |

### P2 — Nice to have

| # | Issue | Effort | Impact |
|---|-------|--------|--------|
| 22 | Independent noise suppression toggle | 1 hour | UX flexibility |
| 23 | Service worker for offline caching | 3 hours | Repeat visit speed |
| 24 | API response standardization | 3 hours | Code maintainability |
| 25 | Error code constants | 2 hours | Fragile error handling |
| 26 | Duplicate schedule detection | 1 hour | Double-booking |
| 27 | Folder structure improvements | 2 hours | Code organization |
| 28 | Server source maps in production | 15 min | Security (expose source) |

---

## ARCHITECTURE DIAGRAM

```
                                    +------------------+
                                    |   Capacitor App  |
                                    |  (Android/iOS)   |
                                    +--------+---------+
                                             |
                                             | (native HTTP + WebSocket)
                                             v
+------------------+              +----------+----------+
|  Browser (Web)   |------------->|   Vercel / CDN      |
|  Chrome/Firefox  |  static      |  (React SPA + SW)   |
|  Safari/Edge     |  assets      +----------+----------+
+------------------+                         |
                                             | API calls (axios)
                                             | WebSocket (socket.io)
                                             v
                                +------------+------------+
                                |   Render.com Server      |
                                |   Express + Socket.io    |
                                |   (Node.js + TypeScript) |
                                +--+--------+--------+----+
                                   |        |        |
                          +--------+  +-----+  +-----+--------+
                          |           |        |               |
                          v           v        v               v
                    +-----+----+ +----+---+ +--+-------+ +----+------+
                    | Turso DB | | LiveKit| | CloudFlare| | Socket.io |
                    | (libSQL) | | Cloud  | | R2 (S3)   | | Rooms     |
                    |          | | (SFU)  | |           | |           |
                    | - users  | |        | | - record- | | - room    |
                    | - meet-  | | - media| |   ings    | |   state   |
                    |   ings   | | - SFU  | |           | | - events  |
                    | - record-| | - TURN | |           | |           |
                    |   ings   | |        | |           | |           |
                    +----------+ +--------+ +-----------+ +-----------+
```

**Data Flow for Meeting Join:**
```
Student clicks "Join"
  -> Dashboard.tsx: api.post('/meetings/join', { roomCode })
  -> Express: meeting.routes.ts validates, queries Turso DB
  -> Express: livekitService.generateToken() (JWT for LiveKit room)
  -> Response: { meeting, livekit: { token, url } }
  -> navigate('/meeting/:roomCode', { state: { livekit, meeting } })
  -> Meeting.tsx: <LiveKitRoom> connects to LiveKit Cloud with token
  -> LiveKit SFU: WebRTC media negotiation (STUN/TURN handled by LiveKit)
  -> socket.emit('join-room', { roomCode })
  -> Peer media flows via LiveKit SFU (not P2P)
```

---

## FINAL VERDICT

**Is this app production-ready?** No.

**The single most important thing to fix before going live:**

**Rotate all secrets and purge them from git history.** The `server/.env` file with live production credentials (LiveKit API keys, S3 secret keys, Turso auth token, JWT secrets) has been committed to git since the first commit. This is a critical security breach that must be addressed immediately — before any other optimization or feature work.

**Second priority:** Add role enforcement middleware. Currently, any authenticated student can create meetings, end meetings, and start recordings — actions that should be restricted to teachers only.

**Third priority:** Fix recording access control. Any authenticated user can access any meeting's recordings, and recordings are served via public URLs without authentication.

**Overall assessment:** The application has a solid architecture (LiveKit SFU for media, Turso for DB, R2 for storage, Capacitor for mobile). The code quality is generally good with proper use of React patterns (memo, useCallback, useMemo), lazy loading, and error boundaries. The audio configuration for music (DTX off, 256kbps Opus, noise suppression toggle) shows domain awareness. The main gaps are in security (secrets exposure, missing authorization, public recordings) rather than functionality or performance.
