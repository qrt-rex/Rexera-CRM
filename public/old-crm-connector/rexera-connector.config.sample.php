<?php
/**
 * Rexera CRM 2.0 connector — settings. Copy this file to rexera-connector.config.php (same folder) and fill it in.
 * Keep it private: it holds the database passwords and the shared secret. Never commit it or send it by email.
 */
return [
  // the same long random text as LEGACY_SYNC_SECRET on the new CRM's server (Render → Environment) — 32+ characters
  'secret' => 'PASTE-THE-SAME-SECRET-AS-ON-RENDER',

  // the old CRM's main database (users, crm, leads, documents …) — on Hostinger the host is usually localhost
  'main' => ['host' => 'localhost', 'port' => 3306, 'name' => 'u000000000_crm', 'user' => 'u000000000_reader', 'pass' => 'database-password'],

  // optional: the old billing database (staff full names, invoices) — remove this line if there is none
  'billing' => ['host' => 'localhost', 'port' => 3306, 'name' => 'u000000000_bill', 'user' => 'u000000000_reader', 'pass' => 'database-password'],

  // the folder of the old CRM's uploaded files (client documents, payment screenshots, agreements)
  'uploads_dir' => __DIR__ . '/../uploads',

  // shown in the new CRM's IT dashboard
  'crm_name' => 'Rexera CRM (old)',
  'logo_url' => '',

  // optional: only these addresses may call the connector (the new CRM server's outgoing IP), e.g. ['203.0.113.10']
  'allowed_ips' => [],
];
