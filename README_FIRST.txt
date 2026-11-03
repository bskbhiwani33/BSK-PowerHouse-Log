BSK - Power House Feeder Log (starter)

Included:
- User ID + 4-digit PIN login screen
- Staff daily report form
- Fields: date, feeder, breaker status, event type, fault details, duration, restoration time, remarks
- Load and Generation fields are intentionally omitted

IMPORTANT:
This is a starter project, not a complete production deployment yet.
Do not deploy it for real staff use until the backend secret, user provisioning,
Firestore rules, and admin dashboard are configured and tested.

Next setup steps:
1. Upload this project folder (or ZIP) to Netlify.
2. Add the Firebase Admin service account JSON as a Netlify environment variable
   named FIREBASE_SERVICE_ACCOUNT. Never put that private JSON in this folder,
   HTML, JavaScript, chat, or GitHub.
3. Create users in Firestore using a secure one-time admin provisioning process.
   User documents are in collection "users"; document ID must be the Firebase UID.
   Required fields:
     userId: unique string
     role: "admin" or "staff"
     active: true
     pinSalt: random salt string
     pinHash: hex output of scryptSync(pin, salt, 64)
     houseId: required for staff
     houseName: optional display name
4. Update Firestore rules to authorize custom-token claims (role and houseId).
   The earlier rules that look up users documents are not the final rules for
   this custom-token login implementation.
5. Test with dummy accounts before using operational data.

Firebase web config is public client configuration; the Firebase Admin service
account is a private credential and must remain secret.
