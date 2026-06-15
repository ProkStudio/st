const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { getSetting } = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'bambusito-dev-secret-change-me';

function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : req.cookies?.admin_token;
  if (!token) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  try {
    req.admin = verifyToken(token);
    next();
  } catch {
    return res.status(401).json({ error: 'invalid_token' });
  }
}

function login(username, password) {
  const storedUser = getSetting('admin_username', 'admin');
  const hash = getSetting('admin_password_hash');
  if (username !== storedUser || !bcrypt.compareSync(password, hash)) {
    return null;
  }
  return signToken({ role: 'admin', username });
}

function changePassword(currentPassword, newPassword) {
  const hash = getSetting('admin_password_hash');
  if (!bcrypt.compareSync(currentPassword, hash)) return false;
  const { setSetting } = require('./db');
  setSetting('admin_password_hash', bcrypt.hashSync(newPassword, 10));
  return true;
}

module.exports = { signToken, verifyToken, authMiddleware, login, changePassword, JWT_SECRET };
