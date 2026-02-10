# --- !Ups

-- Create users table
CREATE TABLE users (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(255) NOT NULL UNIQUE,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT TRUE,
    INDEX idx_username (username),
    INDEX idx_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Insert demo user
-- Password is: password (BCrypt hashed)
INSERT INTO users (username, email, password_hash, full_name) VALUES
('admin', 'admin@company.com', '$2a$10$xQkYtP6w3qKV8mX.0nxnueSYZH8YXrZ5YgG9n7lQR7e6K/VqTJ2gO', 'Admin User'),
('john.doe', 'john.doe@company.com', '$2a$10$xQkYtP6w3qKV8mX.0nxnueSYZH8YXrZ5YgG9n7lQR7e6K/VqTJ2gO', 'John Doe'),
('jane.smith', 'jane.smith@company.com', '$2a$10$xQkYtP6w3qKV8mX.0nxnueSYZH8YXrZ5YgG9n7lQR7e6K/VqTJ2gO', 'Jane Smith');

# --- !Downs

DROP TABLE IF EXISTS users;
