<?php
/* Copy this file to config.local.php on the SERVER (File Manager) and fill in.
   Never commit config.local.php to Git. */
define('DB_PASS', 'your_database_password_here');
/* Only if this site uses a different database than the defaults: */
// define('DB_NAME', 'u943205660_xxxxx');
// define('DB_USER', 'u943205660_xxxxx');

/* Admin panel credentials (optional overrides).
   Default user is 'someswara', default password 'BharatApp@Admin2026' — CHANGE the password.
   Generate a hash: echo hash('sha256','YourNewPassword'); */
// define('ADMIN_USER', 'someswara');
// define('ADMIN_PASS_HASH', 'paste_sha256_hash_here');

/* Push notifications (FCM HTTP v1):
   Place your Firebase service-account JSON at api/fcm-key.json (NOT in git).
   Download it from Firebase Console → Project Settings → Service accounts → Generate new private key.
   Without this file, the app still works; only push-when-closed is disabled. */

/* Sign-up email verification (Gmail + 6-digit code).
   Codes are sent with PHP mail() from MAIL_FROM — on Hostinger create that
   mailbox (hPanel → Emails) so Gmail accepts the messages.
   REQUIRE_EMAIL false lets apps without the email step keep registering
   while you roll out the update. */
// define('MAIL_FROM', 'no-reply@bharatapp.chat');
// define('REQUIRE_EMAIL', true);

/* Forwarded-message fingerprints are deleted after this many days. */
// define('FWD_RETENTION_DAYS', 180);
