# 5 Cards

Realtime multiplayer card game using Firebase Realtime Database.

## Firebase details extracted from your message

- `apiKey`: `AIzaSyCmRSLgpM93wi-kp-NZnaryDzmWjfU3XeE`
- `authDomain`: `cards-f6618.firebaseapp.com`
- `databaseURL`: `https://cards-f6618-default-rtdb.asia-southeast1.firebasedatabase.app`
- `projectId`: `cards-f6618`
- `storageBucket`: `cards-f6618.firebasestorage.app`
- `messagingSenderId`: `105494867189`
- `appId`: `1:105494867189:web:8ea23072f75446e45529bc`
- `measurementId`: `G-F0LFL93Z4X`

These are now filled in `firebase-config.js`.

## What changed


## Gameplay limits updated

- Human players: up to 20
- Bot players: up to 20
- Total players in a match: up to 20
- Deck copies auto-scale based on player count so dealing/draw pile has enough cards for larger lobbies.

- Firebase modular initialization now exists in `firebase-init.js`.
- `app.js` continues using a familiar Realtime DB API (`ref().set/get/update/on/off/child`) through a compatibility wrapper.
- Firebase Hosting config added:
  - `.firebaserc` (default project: `cards-f6618`)
  - `firebase.json`
- `package.json` updated with scripts and firebase dependency.

## Step-by-step to publish to GitHub

Run these in your local machine terminal from this project folder:

```bash
git checkout work
git pull --rebase origin work

git add .
git commit -m "Configure Firebase modular setup and hosting deployment" || true

git push -u origin work
```

If you want these changes on `main` immediately:

```bash
git checkout main
git merge work
git push origin main
```

## Step-by-step to deploy to Firebase Hosting

1. Install dependencies:

```bash
npm install
```

2. Install Firebase CLI globally (if not already):

```bash
npm install -g firebase-tools
```

3. Login to Firebase:

```bash
firebase login
```

4. Confirm project setup (already preconfigured by `.firebaserc`):

```bash
firebase use cards-f6618
```

5. Deploy:

```bash
firebase deploy
```

6. Firebase CLI output will print your live Hosting URL. Share that URL with your friends.

## Realtime Database rules (dev only)

Use permissive rules only for testing:

```json
{
  "rules": {
    "rooms": {
      ".read": true,
      ".write": true
    }
  }
}
```

For production, add Firebase Auth and room-scoped security rules.


## Realtime sync fix

- Game state sync now only publishes gameplay fields (not per-client online identity), which prevents one player from overwriting another player's local identity/session while joining/starting online rooms.
