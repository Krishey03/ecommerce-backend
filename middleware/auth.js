// middleware/auth.js
const jwt = require('jsonwebtoken');
const User = require('../models/User');

// For routes that require authentication
const requireAuth = async (req, res, next) => {
    const token = req.cookies.token;

    if (!token) {
        return res.status(401).json({
            success: false,
            message: "You are not authenticated!",
        });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.id);

        if (!user) {
            return res.status(401).json({
                success: false,
                message: "User not found.",
            });
        }

        if (user.isBlocked) {
            return res.status(403).json({
                success: false,
                message: "Access denied. Your account has been blocked. Please contact support if you think this was a mistake.",
            });
        }

        req.user = user;
        next();

    } catch (error) {
        return res.status(401).json({
            success: false,
            message: "Unauthorized user!",
        });
    }
};

// For routes where auth is optional
const optionalAuth = async (req, res, next) => {
    const token = req.cookies.token;

    if (!token) {
        req.user = null;
        return next();
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.id);

        if (user && !user.isBlocked) {
            req.user = user;
        } else {
            req.user = null;
        }
        next();

    } catch (error) {
        req.user = null;
        next();
    }
};

module.exports = { requireAuth, optionalAuth };