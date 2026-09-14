# SPONGEBOB SAND WAR (SAND-GAME) DEVELOPMENT RULES

## 1. PLATFORM & ARCHITECTURE CONSTRAINTS
- Platform Target: Chrome Desktop with Webcam pointing down at desk surface.
- AR Tracking: MindAR Image/Card Target Tracking ONLY.
- DO NOT add WebXR, immersive-ar, markerless tracking, surface hit-test, or reticle. WebXR was intentionally excluded from this release.
- Secure Context Required: Webcam access operates strictly under localhost or HTTPS.

## 2. DOMAIN RULES & GAMEPLAY INVARIANTS
- Card Setup: 6 physical cards on desk (3 Left = Blue Team, 3 Right = Red Team).
- Team Composition: Exactly 1 base (Benteng/Bunker), 1 artileri (Robot/Tank), 1 prajurit (Kesatria Kuda/Gargoyle) per team.
- Spectator Paradigm: Players only watch the battle. No manual unit control, attacking, summoning, or manual interaction during combat.
- Coordinate Space: Units spawn on card positions but move on a SINGLE SHARED ARENA PLANE. Never parent moving units to MindAR card anchors.

## 3. MOTION & STATE MACHINE CONVENTIONS
- Flow Phases: camera -> scan -> battle -> result (governed strictly by AppState and Wizard).
- Movement: Use walkTo with speed * dt (monotonic progress, no instant teleportation mid-walk).
- Air Units (Gargoyle): Preserve hover Y animation independently of ground X/Z translation.
- Facing: Units must face direction of travel aligned with team battle conventions.

## 4. DEPENDENCIES & TESTING WORKFLOW
- Install Command: Use 'bun install --ignore-scripts' or 'npm install --ignore-scripts' to bypass native node-canvas compile failure on Windows Node 24.
- Verification: Always run the test suite before finalizing any task or bug fix:
  node --test tests/*.test.js tests/**/*.test.js
  All 288 tests must pass with 0 failures.
- Localization: UI text in formal Indonesian (Baku), codebase internals (classes, variables, functions, tests, comments) in English.
