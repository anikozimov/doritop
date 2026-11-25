'use strict';

require('dotenv').config();
const path = require('path');

const isProd = process.env.NODE_ENV === 'production';
const ROOT = path.join(__dirname, '..');

function bool(v, def = false) {
  if (v === undefined || v === '') return def;
  return v === '1' || v === 'true' || v === 'yes';
}

function num(v, def) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : def;
}

const config = {
  isProd,
  ROOT,
  PORT: parseInt(process.env.PORT || '3000', 10),
  PUBLIC_DIR: path.join(ROOT, 'public'),
  DB_PATH: path.resolve(process.env.DB_PATH || path.join(ROOT, 'data', 'dori_top.db')),
  UPLOAD_DIR: path.resolve(process.env.UPLOAD_DIR || path.join(ROOT, 'data', 'uploads')),
  SITE_URL: (process.env.SITE_URL || '').replace(/\/+$/, ''),
  TZ: process.env.APP_TIMEZONE || 'Asia/Tashkent',
  TRUST_PROXY: process.env.TRUST_PROXY || '',
  CORS_ORIGIN: process.env.CORS_ORIGIN || '',
  CSP_ENABLED: process.env.CSP_ENABLED !== 'false',
  FORCE_HTTPS: bool(process.env.FORCE_HTTPS, false),
  ADMIN_PHONE: process.env.ADMIN_PHONE || '',
  ADMIN_SETUP_CODE: process.env.ADMIN_SETUP_CODE || '',
  ADMIN_2FA_REQUIRED: bool(process.env.ADMIN_2FA_REQUIRED, isProd),
  JWT_SECRET: process.env.JWT_SECRET || '',
  TOKEN_TTL: process.env.TOKEN_TTL || '14d',

  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
  TELEGRAM_BOT_USERNAME: (process.env.TELEGRAM_BOT_USERNAME || '').replace(/^@/, ''),
  TELEGRAM_POLLING: bool(process.env.TELEGRAM_POLLING, true),
  ADMIN_ALERT_CHAT_ID: process.env.ADMIN_ALERT_CHAT_ID || '',
  AUTO_REMIND: bool(process.env.AUTO_REMIND, true),
  STALE_DAYS: num(process.env.STALE_DAYS, 7),
  REMIND_EVERY_DAYS: num(process.env.REMIND_EVERY_DAYS, 3),

  BACKUP_DIR: process.env.BACKUP_DIR || '',
  BACKUP_EVERY_HOURS: Math.max(num(process.env.BACKUP_EVERY_HOURS, 24), 0.01),
  BACKUP_KEEP: parseInt(process.env.BACKUP_KEEP || '7', 10),
  LOG_FORMAT: process.env.LOG_FORMAT || (isProd ? 'json' : 'dev'),
  JOBS_ENABLED: process.env.JOBS_ENABLED !== 'false'
};

module.exports = config;
