<?php
/* Defaults — real credentials live in config.local.php on the server only.
   config.local.php is NOT in Git, so deployments never overwrite it.
   It is loaded first, so it can set DB_PASS and override any default below
   (e.g. a different DB_NAME / DB_USER on another Hostinger website). */
$local = __DIR__ . '/config.local.php';
if (file_exists($local)) {
    require $local;
}
defined('DB_HOST') || define('DB_HOST', 'localhost');
defined('DB_NAME') || define('DB_NAME', 'u943205660_kalisi');
defined('DB_USER') || define('DB_USER', 'u943205660_kalisi');
defined('DB_PASS') || define('DB_PASS', '');   // no local config yet → connection fails safely
