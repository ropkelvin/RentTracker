const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./rent-tracker.db');

// Users table
db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password TEXT
)`);

// Tenants table
db.run(`CREATE TABLE IF NOT EXISTS tenants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    name TEXT,
    phone TEXT,
    FOREIGN KEY(user_id) REFERENCES users(id)
)`);

// Rent records table
db.run(`CREATE TABLE IF NOT EXISTS rent (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    tenant_id INTEGER,
    month TEXT,
    amount REAL,
    date_collected TEXT,
    notes TEXT,
    mpesa_code TEXT,
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(tenant_id) REFERENCES tenants(id)
)`);

module.exports = db;
